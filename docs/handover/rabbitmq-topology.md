# RabbitMQ Topology — MemoFlow ↔ Context Engine

Shared reference for the **MemoFlow API** team and the **context-engine (n8n)** team. It
defines the exact broker layout both sides bind to. The message *bodies* live in the
JSON schemas (`context-request.schema.json`, `context-result.schema.json`); this document
is only the **transport plumbing**.

> **⚠️ Status — contract-first, not yet live.** The MemoFlow API's RabbitMQ
> producer/consumer isn't built yet; today context gathering runs over a synchronous HTTP
> call. This is the agreed target both sides build against. Coordinate the cutover date.

---

## 1. What "topology" means

RabbitMQ never delivers a message straight from sender to receiver. A publisher hands a
message to an **exchange** (a router that stores nothing), and the exchange forwards it —
based on the message's **routing key** — into one or more **queues** (durable mailboxes
that hold messages until a consumer takes them). The set of exchange + queues + the
**bindings** (routing rules) that tie them together is the *topology*.

Both teams publish to the **same exchange**; the routing key alone decides which mailbox a
message lands in, and therefore which side consumes it. Neither side ever calls the other
directly — they only ever talk to the broker.

---

## 2. The objects

| Object | Name | Type / detail |
| --- | --- | --- |
| Exchange | `context` | `topic`, durable |
| Request queue | `ctx.gather.requests` | durable — **API publishes, n8n consumes** |
| Result queue | `ctx.gather.results` | durable — **n8n publishes, API consumes** |
| Request DLQ | `ctx.gather.requests.dlq` | durable — dead-letter target for rejected requests |
| Result DLQ | `ctx.gather.results.dlq` | durable — dead-letter target for rejected results |

| Binding (routing key → queue) | |
| --- | --- |
| `ctx.gather.request` → `ctx.gather.requests` | API → n8n direction |
| `ctx.gather.result` → `ctx.gather.results` | n8n → API direction |

> Note the singular/plural split: the **routing key** is singular (`…request` /
> `…result`), the **queue** is plural (`…requests` / `…results`). Copy both exactly — a
> single typo silently drops messages (they route nowhere and vanish).

The exchange is `topic` so wildcard keys (e.g. `ctx.gather.*`) stay possible for future
versioning; today the keys are exact strings.

---

## 3. How a message routes

```
                          exchange: context  (topic, durable)
                          ┌──────────────────────────────────┐
 publish  rk=ctx.gather.request ─▶│  match routing key vs bindings  │
                          └───────────────┬──────────────────┘
                              binding: "ctx.gather.request"
                                          ▼
                              [ ctx.gather.requests ] ──── consume ───▶ n8n

 publish  rk=ctx.gather.result ─▶│  match routing key vs bindings  │
                                          ▼
                              binding: "ctx.gather.result"
                              [ ctx.gather.results ]  ──── consume ───▶ MemoFlow API
```

---

## 4. Full round-trip for one job

```
 MemoFlow API             exchange `context`              queues                     n8n
      │  publish rk=ctx.gather.request ─▶ route ─▶  ctx.gather.requests  ─▶  consume
      │  msg_id = correlation_id = job_id                                     gather via MCP
      │                                                                          │
      │                                              ctx.gather.results  ◀─ publish data (seq 0)
      │  consume ◀───────────────── route ◀──────────  (rk=ctx.gather.result)   │
      │                                              ctx.gather.results  ◀─ publish data (seq 1)
      │  consume ◀──────────────────────────────────                            │
      │                                              ctx.gather.results  ◀─ publish status
      │  consume ◀────────────────────────────────── (phase: completed) ── terminal
      ▼ assemble context + run planner
```

One request in, many result chunks back, ending in exactly one terminal `status` chunk
(`completed` or `failed`). All correlated by `job_id`.

---

## 5. Message properties (both directions)

| Property | Value | Why |
| --- | --- | --- |
| `content_type` | `application/json` (UTF-8) | Bodies are JSON per the schemas |
| `delivery_mode` | `2` (persistent) | Message survives a broker restart |
| `message_id` | `job_id` | Identifies the message |
| `correlation_id` | `job_id` | Ties a result stream back to its request |
| `timestamp` | set at publish | Ordering / debugging |

---

## 6. Reliability semantics

- **Durability.** Exchange, queues, and every message are durable/persistent — a broker
  restart loses nothing already accepted.
- **Manual ack.** A consumer removes a message only after it `ack`s. Crash before ack →
  the broker **redelivers**. Consequence: a message can arrive **more than once**.
  - Requests: **dedupe by `job_id`** — never gather the same job twice.
  - Results: **idempotent by `(job_id, sequence)`** — the API ignores a repeated sequence.
- **Dead-lettering.** Each main queue has a dead-letter exchange (DLX) routing to its
  `.dlq`. On an unrecoverable message a consumer **`nack`s without requeue**, and the
  broker parks it in the DLQ instead of redelivering forever (prevents hot-loops on poison
  messages). Nothing consumes the DLQs automatically — they're for inspection/replay.
- **Prefetch.** Each consumer caps how many unacked messages it holds at once (n8n: ~1–10)
  to bound concurrency.
- **Correlation.** `correlation_id = job_id` on every message — no shared database lookup
  is needed to match a result stream to its request.

---

## 7. Ordering & termination

- `sequence` on result chunks is **0-based and monotonic per `job_id`**. The API relays
  chunks best-effort; a gap is tolerated.
- Correctness rests on the **terminal marker**, not on receiving every chunk: exactly one
  `status` chunk with `phase` `completed` or `failed` ends the job. Termination is gated on
  **`phase`, not `type`** — non-terminal `status` chunks (`started` / `gathering`) are
  allowed as progress signals.
- If no terminal chunk arrives within the API's timeout window, the API fails the job
  itself (`error_code: CONTEXT_ENGINE_TIMEOUT`).

---

## 8. Who declares the topology — decide before cutover

Exchange, queues, bindings, and the DLX wiring must exist before either side runs. Pick
**one** owner so they can't drift:

- **Option A — MemoFlow API declares (recommended).** On boot the API idempotently asserts
  the exchange, both queues, both DLQs, and the bindings. n8n simply binds a consumer to
  the existing `ctx.gather.requests` and publishes to the `context` exchange. Single source
  of truth.
- **Option B — n8n / infra declares.** Works, but then the API must **not** redeclare with
  conflicting arguments. RabbitMQ rejects a redeclaration whose durability/DLX/arguments
  differ from the existing object (`PRECONDITION_FAILED`), which fails boot.

Whichever is chosen, the **names, routing keys, and DLX config are fixed by this document**
— the declaring side owns creation, not the naming.

---

## 9. Connection

- Single connection string shared by both sides: `RABBITMQ_URL` =
  `amqps://<user>:<pass>@<host>/<vhost>` (TLS — the `amqps://` scheme). Managed
  (e.g. CloudAMQP) or self-hosted.
- A `vhost` (virtual host) namespaces this topology inside the broker — keep both sides on
  the same vhost or nothing routes between them.

---

## 10. Quick checklist (both teams)

- [ ] Exchange `context` (topic, durable) exists.
- [ ] Queues `ctx.gather.requests` + `ctx.gather.results` (durable) exist.
- [ ] DLQs `ctx.gather.requests.dlq` + `ctx.gather.results.dlq` exist; each main queue's
      DLX points at its DLQ.
- [ ] Bindings: `ctx.gather.request → ctx.gather.requests`,
      `ctx.gather.result → ctx.gather.results`.
- [ ] One agreed owner declares all of the above (§8).
- [ ] Both sides on the same `RABBITMQ_URL` + vhost, TLS.
- [ ] Consumers use manual ack, sane prefetch, and nack-without-requeue → DLQ on poison.
- [ ] Publishers set persistent delivery + `correlation_id = message_id = job_id`.
