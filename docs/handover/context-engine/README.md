# MemoFlow ↔ Context-Engine Integration (n8n)

Self-contained handover for the team building the **context engine** — an n8n
environment that drives per-connector MCP agents to gather context for MemoFlow
planning jobs.

This bundle is everything you need. It contains no MemoFlow source code; the wire
shapes below are the whole contract.

> **⚠️ Status — contract-first, not yet live.** The MemoFlow API's RabbitMQ
> producer/consumer described here **is not built yet**. Today the API gathers context over
> a synchronous **HTTP** call; this RabbitMQ contract is the agreed target that supersedes
> it. Build your side against these schemas now, but **coordinate the cutover date** with
> the MemoFlow team — nothing is publishing to `ctx.gather.requests` until they ship the
> producer.

| File | Purpose |
| --- | --- |
| `README.md` (this file) | Role, topology, setup, wire shapes, checklist |
| `context-request.schema.json` | JSON Schema for the request you **consume** (API → you) |
| `context-result.schema.json` | JSON Schema for the chunks you **publish** (you → API) |

Contract version: `schema_version: 1`. Changes within v1 are additive-only (new
optional fields). A breaking change bumps the version and the routing keys
(`ctx.gather.request.v2`).

---

## 0. Message queues in 5 minutes (read this first if RabbitMQ is new)

You don't call our API and we don't call yours. Instead we hand messages to a **broker**
(RabbitMQ) that holds them until the other side picks them up. Think of it as a shared
post office with labelled mailboxes.

- **Exchange** = the sorting office. We publish every message to the exchange named
  `context`; it routes each one to the right mailbox based on a **routing key** (a label
  string like `ctx.gather.request`).
- **Queue** = a mailbox. Messages wait here, in order, until a consumer takes them. Two
  mailboxes matter to you: `ctx.gather.requests` (we fill it, you empty it) and
  `ctx.gather.results` (you fill it, we empty it).
- **Publish** = drop a message into the exchange. **Consume** = take the next message off
  a queue.
- **Ack** (acknowledge) = you tell the broker "I've safely handled this one, delete it."
  Until you ack, the broker keeps the message and will redeliver it if your worker
  crashes. So a message can arrive **more than once** — that's why you dedupe by `job_id`
  (§5b) and why every result chunk is idempotent by `(job_id, sequence)` (§6).
- **Nack (no requeue)** = "this message is broken, don't give it back to me." It goes to a
  **dead-letter queue** (DLQ) — a parking lot for bad messages — instead of looping
  forever.
- **Durable / persistent** = survives a broker restart. Everything here is durable so
  nothing is lost on a reboot.
- **Correlation** = we stamp each message with `correlation_id = job_id` so both sides can
  match a request to its results. Always echo `job_id` back.

Mental model for one job: **we drop a request in your mailbox → you pick it up → you gather
context → you drop several result messages in our mailbox → you finish with one "done"
message.** No direct calls, no waiting on an open connection.

Any AMQP 0-9-1 client works (`amqplib` for Node, `pika` for Python, etc.); the schemas and
topology below are the whole contract.

---

## 1. Your role

The MemoFlow API and the context engine talk **asynchronously over RabbitMQ in both
directions**, correlated by `job_id`. For each planning job:

1. **Consume** a context-gather request from `ctx.gather.requests`.
2. **Gather** context by driving the MCP agent for each connector (e.g. a Trello agent
   → Composio's Trello MCP), resolving the live MCP from `provider` +
   `composio_account_id` using **your own Composio credentials**.
3. **Publish** the gathered context back as ordered `data` chunks on
   `ctx.gather.results`, ending with **exactly one terminal `status` chunk**.

```
MemoFlow API --publish--> [ctx.gather.requests] --trigger--> n8n workflow
                                                                │  gather via MCP
n8n workflow --publish chunks--> [ctx.gather.results] --consume--> MemoFlow API --WS--> browser
```

You never receive provider OAuth tokens — Composio is the vault. `composio_account_id`
is an id, not a secret; you use it with **your** Composio API key to reach the MCP. The
MemoFlow API never talks to your workflow directly, and the browser never sees RabbitMQ
— the API relays your chunks to the user over its own WebSocket.

---

## 2. Prerequisites

- **RabbitMQ access** — connection string `amqps://<user>:<pass>@<host>/<vhost>` (TLS),
  shared with the MemoFlow API. Managed (e.g. CloudAMQP) or self-hosted.
- **Composio credentials** — a Composio API key with access to the same connected
  accounts the API created, so you can resolve each `composio_account_id` to a live MCP.
- **n8n** — with the **RabbitMQ Trigger** and **RabbitMQ** (producer) nodes available.

---

## 3. RabbitMQ topology (must match the API exactly)

| Property | Value |
| --- | --- |
| Exchange | `context` (type `topic`, durable) |
| Request queue (you consume) | `ctx.gather.requests`, bound with routing key `ctx.gather.request` |
| Result queue (you publish to) | `ctx.gather.results`, routing key `ctx.gather.result` |
| Dead-letter (requests) | `ctx.gather.requests.dlq` (set as the request queue's DLX) |
| Dead-letter (results) | `ctx.gather.results.dlq` (set as the result queue's DLX) |
| Message props (both directions) | `content_type: application/json` (UTF-8), `delivery_mode: 2` (persistent), `message_id` = `correlation_id` = `job_id`, `timestamp` at publish |

Declare the exchange + queues **durable**, each with its own DLX (`ctx.gather.requests.dlq`
on the request queue, `ctx.gather.results.dlq` on the result queue), before wiring n8n. If
the API owns declaration, just bind your consumer to the existing names — do not redeclare
with conflicting arguments. Full topology detail: `../rabbitmq-topology.md`.

---

## 4. Sequence

```
 Frontend            MemoFlow API                 RabbitMQ                Context engine (you)
    |  POST /planning-jobs  |                         |                            |
    |   202 {job_id}        | create job (pending)    |                            |
    |<----------------------|                         |                            |
    |                       | publish request ------->| ctx.gather.requests ------>| consume
    |                       | (status: gathering)     |                            | gather via MCP
    |                       |         ctx.gather.results <---- publish data (seq 0) ----|
    |<-- WS (relay) --------|<-- consume + relay ------|                            |
    |                       |         ctx.gather.results <---- publish data (seq 1) ----|
    |<-- WS (relay) --------|                         |                            |
    |                       |         ctx.gather.results <---- status completed (terminal) --|
    |<-- WS completed ------| assemble + plan         |                            |
```

---

## 5. Setup — step by step

### a. Consume requests
- Add a **RabbitMQ Trigger** node on `ctx.gather.requests`.
- Use **manual ack** — ack only after you've durably started/finished processing; on an
  unrecoverable parse/validation error, **nack without requeue** so it dead-letters
  (`ctx.gather.requests.dlq`) instead of hot-looping.
- Set a sane **prefetch** (e.g. 1–10) to bound concurrency.

### b. Validate + dedupe
- Validate the body against `context-request.schema.json`.
- **Dedupe by `job_id`** — a redelivered/duplicate request for a job already in flight
  must not gather twice.

Request body you'll receive:
```json
{
  "schema_version": 1,
  "job_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "user_id": "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  "prompt": "Draft an outline for chapter 3",
  "connectors": [
    { "provider": "trello", "mcp_url": null, "composio_account_id": "ca_abc123" }
  ],
  "requested_at": "2026-07-05T12:00:00.000Z"
}
```

- `connectors[]` carries only the user's **active** connectors. An empty array means no
  connector context was requested/available — still gather nothing and return a terminal
  `completed`.
- `mcp_url` is **always `null`** by design — you resolve the live MCP from `provider` +
  `composio_account_id`.
- `provider` is one of the MemoFlow allowlist: `trello`, `notion`, `github`.

### c. Gather via MCP
- For each `connectors[]` entry: resolve the MCP server for `provider` +
  `composio_account_id` (with your Composio creds), run the agent, collect context.

### d. Publish result chunks
Use the **RabbitMQ** producer node to publish to exchange `context`, routing key
`ctx.gather.result`. Emit ordered `data` chunks, then **exactly one terminal `status`
chunk**. Echo `job_id` and `user_id`; set `schema_version: 1`, persistent delivery,
`correlation_id = job_id`. Validate each against `context-result.schema.json`.

```json
// data chunk (sequence 0, 1, …)
{ "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
  "sequence": 0, "type": "data",
  "data": { "provider": "trello", "content": "{…gathered…}", "token_estimate": 420 } }

// optional progress (non-terminal) — termination is gated by `phase`, not `type`
{ "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
  "sequence": 1, "type": "status", "status": { "phase": "gathering", "message": "2/3 connectors" } }

// terminal — exactly one, ends the job
{ "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
  "sequence": 2, "type": "status", "status": { "phase": "completed" } }
```

Rules:
- `sequence` is **0-based, monotonic per job**. The API treats chunks as idempotent by
  `(job_id, sequence)` — safe to resend, but never reuse a sequence for different content.
- `content` is an opaque string (JSON string or text blob) — the API does not parse it;
  the LLM planner downstream consumes it.
- Termination is gated by **`phase`, not `type`**: a `status` chunk is terminal only when
  `phase` is `completed` or `failed`. `started` / `gathering` are optional non-terminal
  progress signals you may interleave with `data` chunks.
- End with **one** terminal `status`: `completed` (success) or `failed` with an
  `error_code`.
- On failure, publish a terminal `{ "type": "status", "status": { "phase": "failed",
  "error_code": "…", "message": "…" } }` rather than going silent — the API otherwise
  fails the job on a timeout.

---

## 6. Idempotency & ordering — summary

| Concern | Rule |
| --- | --- |
| Duplicate request | Dedupe by `job_id`; gather once |
| Duplicate result chunk | API ignores repeats of `(job_id, sequence)` |
| Ordering | `sequence` ascending; a gap is tolerated, the terminal marker is authoritative |
| Termination | One `status` chunk with `phase` `completed` / `failed` |
| Poison request | `nack` (no requeue) → `ctx.gather.requests.dlq` |
| No terminal chunk | The API times the job out — always emit a terminal `status` |

---

## 7. Local testing

- Run RabbitMQ locally
  (`docker run -p 5672:5672 -p 15672:15672 rabbitmq:3-management`), declare the
  exchange/queues, point both n8n and a test publisher at it.
- Publish a sample request (body in §5b) to `ctx.gather.requests`; confirm your workflow
  consumes it, then publish `data` + terminal `status` chunks to `ctx.gather.results`.
- Validate every message against the schemas (e.g. `ajv validate`).
- Confirm your consumer **acks** correctly and that a malformed message dead-letters.

---

## 8. Checklist

- [ ] RabbitMQ reachable (TLS); exchange `context` + both queues + both DLQs declared,
      each DLQ set as its queue's DLX.
- [ ] n8n RabbitMQ Trigger on `ctx.gather.requests`, manual ack, prefetch set.
- [ ] Request bodies validated against `context-request.schema.json`; deduped by `job_id`.
- [ ] Composio creds resolve `composio_account_id` → live MCP per provider.
- [ ] Result chunks validate against `context-result.schema.json`; `job_id`/`user_id`
      echoed, `schema_version: 1`, persistent, `correlation_id = job_id`.
- [ ] Ordered `data` chunks + exactly one terminal `status` (`completed` / `failed`).
- [ ] Failures emit a terminal `failed` status with `error_code`; poison messages DLQ.

---

## 9. What to hand back to MemoFlow

For MemoFlow to point at you, send these back:

| Item | Fills (MemoFlow env var) | When |
| --- | --- | --- |
| Your HTTP context-gather endpoint URL | `CONTEXT_ENGINE_URL` | now (current live transport) |
| Bearer token for that endpoint, if you require auth | `CONTEXT_ENGINE_API_KEY` | now |
| **RabbitMQ:** the shared broker URL `amqps://…` (if you/infra own the broker) | `RABBITMQ_URL` | at cutover |
| **Decision:** who declares the exchange/queues/bindings (topology doc §8) | — | before cutover |
| **Confirmation:** you hold Composio credentials with access to the **same connected accounts** MemoFlow created (so you resolve MCP from `composio_account_id`) | — | before first test |
| A go-live / cutover date for switching HTTP → RabbitMQ | — | before cutover |

---

> **Go-live coordination:** the MemoFlow API's RabbitMQ producer/consumer is contract-first
> (built against these schemas). Coordinate connection details (RabbitMQ URL, who declares
> the topology) and cutover timing with the MemoFlow team before going live.
