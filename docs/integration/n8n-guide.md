# n8n Transport & Orchestration Guide

The **n8n team** owns the transport + orchestration layer between the MemoFlow API and the
**context engine** (the gathering brains — see
[`context-engine-guide.md`](./context-engine-guide.md)). n8n consumes gather requests from
RabbitMQ, invokes the context engine per connector, and publishes the results back. This
is the practical setup companion to the wire contract in
[`../contracts/context-engine.md`](../contracts/context-engine.md) and its two JSON schemas
([request](../contracts/context-request.schema.json),
[result](../contracts/context-result.schema.json)).

## 1. Your role

For each planning job, the MemoFlow API publishes a **context-gather request** to a
RabbitMQ queue. Your job:

1. **Consume** the request from `ctx.gather.requests`.
2. **Orchestrate the gather**: for each connector, invoke the **context engine** (the
   gathering brains), handing it `provider` + `composio_account_id` + the user's `prompt`;
   it resolves the MCP and returns the gathered content. The Composio/MCP resolution lives
   in the context engine, not here — n8n coordinates.
3. **Publish** the gathered content back as ordered chunks on `ctx.gather.results`, ending
   with a terminal status.

You never handle provider OAuth tokens — Composio is the vault, and the context engine (not
n8n) reaches the MCP. `composio_account_id` is an id, not a secret; you only pass it
through to the context engine.

```
MemoFlow API --publish--> [ctx.gather.requests] --trigger--> n8n workflow
                                                                 │  invoke context engine (gather)
n8n workflow --publish chunks--> [ctx.gather.results] --consume--> MemoFlow API --WS--> browser
```

## 2. Prerequisites

- **RabbitMQ access** — connection string `amqps://<user>:<pass>@<host>/<vhost>` (TLS).
  Shared with the MemoFlow API. Managed (e.g. CloudAMQP) or self-hosted.
- **A way to call the context engine** — whatever protocol you and the context-engine team
  agree on (HTTP, a sub-workflow, a queue of your own). That n8n↔CE hop is internal to your
  two teams and is **not** part of the MemoFlow contract. n8n itself does **not** need
  Composio credentials — the context engine holds those.
- **n8n** — with the **RabbitMQ Trigger** and **RabbitMQ** (producer) nodes available.

## 3. RabbitMQ topology (must match the API)

| Property | Value |
| --- | --- |
| Exchange | `context` (type `topic`, durable) |
| Request queue (you consume) | `ctx.gather.requests`, bound with routing key `ctx.gather.request` |
| Result queue (you publish to) | `ctx.gather.results`, routing key `ctx.gather.result` |
| Dead-letter | `ctx.gather.requests.dlq` (set as the request queue's DLX) |
| Message props | `content_type: application/json`, `delivery_mode: 2` (persistent), `correlation_id` = `message_id` = `job_id` |

Declare the exchange + queues **durable**, with the DLX on the request queue, before
wiring n8n. If the API owns declaration, just bind your consumer to the existing names.

## 4. Setup — step by step

### a. Consume requests
- Add a **RabbitMQ Trigger** node on `ctx.gather.requests`.
- Use **manual ack** — ack only after you've durably started/finished processing; on an
  unrecoverable parse/validation error, **nack without requeue** so it dead-letters
  (`ctx.gather.requests.dlq`) instead of hot-looping.
- Set a sane **prefetch** (e.g. 1–10) to bound concurrency.

### b. Validate + dedupe
- Validate the body against
  [`context-request.schema.json`](../contracts/context-request.schema.json).
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

### c. Invoke the context engine (gather)
- For each `connectors[]` entry: call the **context engine**, passing `provider`,
  `composio_account_id`, and the request `prompt`. It resolves the MCP (`mcp_url` in the
  request is intentionally `null`) and returns the gathered content for that connector.
  Only active connectors are ever sent. What the CE receives/returns is specced in
  [`context-engine-guide.md`](./context-engine-guide.md).

### d. Publish result chunks
Use the **RabbitMQ** producer node to publish to exchange `context`, routing key
`ctx.gather.result`. Emit ordered `data` chunks, then **exactly one terminal `status`
chunk**. Echo `job_id` and `user_id`; set `schema_version: 1`, persistent delivery,
`correlation_id = job_id`. Validate each against
[`context-result.schema.json`](../contracts/context-result.schema.json).

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
  `(job_id, sequence)` — safe to resend, but don't reuse a sequence for different content.
- End with **one** terminal `status`: `completed` (success) or `failed` with an
  `error_code`. `started`/`gathering` are optional non-terminal progress signals.
- On failure, publish a terminal `{ "type": "status", "status": { "phase": "failed",
  "error_code": "…", "message": "…" } }` rather than going silent — the API otherwise
  fails the job on a timeout (`CONTEXT_ENGINE_TIMEOUT`).

## 5. Idempotency & ordering — summary

| Concern | Rule |
| --- | --- |
| Duplicate request | Dedupe by `job_id`; gather once |
| Duplicate result chunk | API ignores repeats of `(job_id, sequence)` |
| Ordering | `sequence` ascending; a gap is tolerated, the terminal marker is authoritative |
| Termination | One `status` chunk with `phase` `completed`/`failed` |
| Poison request | `nack` (no requeue) → `ctx.gather.requests.dlq` |

## 6. Local testing

- Run RabbitMQ locally (`docker run -p 5672:5672 -p 15672:15672 rabbitmq:3-management`),
  declare the exchange/queues, point both n8n and a test publisher at it.
- Publish a sample request (body above) to `ctx.gather.requests`; confirm your workflow
  consumes it, then publish `data` + terminal `status` chunks to `ctx.gather.results` and
  confirm the shapes validate against the result schema (`ajv validate`).
- Confirm your consumer **acks** correctly and that a malformed message dead-letters.

## 7. Checklist

- [ ] RabbitMQ reachable (TLS), exchange `context` + both queues + request DLQ declared.
- [ ] n8n RabbitMQ Trigger on `ctx.gather.requests`, manual ack, prefetch set.
- [ ] Request bodies validated against the request schema; deduped by `job_id`.
- [ ] Context engine reachable; it receives `provider`/`composio_account_id`/`prompt` and
      returns gathered content per connector.
- [ ] Result chunks validate against the result schema; `job_id`/`user_id` echoed,
      `schema_version: 1`, persistent, `correlation_id = job_id`.
- [ ] Ordered `data` chunks + exactly one terminal `status` (`completed`/`failed`).
- [ ] Failures emit a terminal `failed` status with `error_code`; poison messages DLQ.

> Full field semantics, lifecycle, and versioning:
> [`../contracts/context-engine.md`](../contracts/context-engine.md). The API-side
> producer/consumer isn't built yet (contract-first) — coordinate go-live with the
> MemoFlow team.
