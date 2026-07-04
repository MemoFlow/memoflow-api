# Context-Engine Transport Contract

> **Status:** contract defined; API-side implementation pending.
> **Audience:** the context-engine (n8n) team and the MemoFlow frontend team.
> **Machine-readable schemas:** [`context-request.schema.json`](./context-request.schema.json),
> [`context-result.schema.json`](./context-result.schema.json).

MemoFlow's planning pipeline gathers connector context for a job through an **external
context engine** (an n8n environment that drives per-connector MCP agents). Because real
MCP gathering far exceeds a synchronous HTTP timeout, the API↔CE hop is **asynchronous
over RabbitMQ in both directions**, correlated by `job_id`.

> Today the API still uses a synchronous HTTP call (`ContextEngineHttpClient`). This
> contract defines the target transport; it **supersedes** that HTTP path when the
> implementation task lands. Until then this document is the agreed wire contract the CE
> team builds against — no API runtime code implements it yet.

## Overview & sequence

```
 Frontend            MemoFlow API                 RabbitMQ                Context engine (n8n)
    |  POST /planning-jobs  |                         |                            |
    |---------------------->| create planning_jobs    |                            |
    |   202 {job_id}        | (status: pending)       |                            |
    |<----------------------|                         |                            |
    |                       | publish request ------->| ctx.gather.requests        |
    |                       | (status: gathering)     |------ trigger ------------>| consume
    |                       |                         |                            | gather via MCP
    |                       |         ctx.gather.results <---- publish chunk (data, seq 0) ----|
    |   WS planning.status  |<-- consume + relay -----|                            |
    |<----------------------|                         |                            |
    |                       |         ctx.gather.results <---- publish chunk (data, seq 1) ----|
    |<-- WS (relay) --------|                         |                            |
    |                       |         ctx.gather.results <---- status: completed (terminal) --|
    |                       | assemble + plan (item 5)|                            |
    |   WS planning.completed| (status: completed)    |                            |
    |<----------------------|                         |                            |
```

The frontend never talks to RabbitMQ or the context engine — it only sees the existing
REST + WebSocket surface. The API relays result chunks to the browser over the WebSocket
gateway it already runs.

## §1 RabbitMQ topology

| Property | Value |
| --- | --- |
| Exchange | `context` (type: `topic`, durable) |
| Request routing key | `ctx.gather.request` |
| Request queue | `ctx.gather.requests` (durable) — **bound and consumed by n8n/CE** |
| Result routing key | `ctx.gather.result` |
| Result queue | `ctx.gather.results` (durable) — **bound and consumed by the API** |
| Dead-letter | `ctx.gather.requests.dlq`, `ctx.gather.results.dlq` (per-queue DLX for poison/rejected messages) |
| Connection | `amqps://` (TLS), credentials + vhost via `RABBITMQ_URL` |

**Message properties** (both directions):

- `content_type: application/json`, UTF-8 body.
- `message_id` = `correlation_id` = `job_id`.
- `delivery_mode: 2` (persistent).
- `timestamp` set at publish.

Consumers **ack** only after durably handling a message; on an unrecoverable error they
`nack` (no requeue) so it lands in the DLQ rather than hot-looping.

## §2 Request message — API → CE (`ctx.gather.requests`)

Body validated by [`context-request.schema.json`](./context-request.schema.json):

```json
{
  "schema_version": 1,
  "job_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "user_id": "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  "prompt": "Draft an outline for chapter 3",
  "connectors": [
    { "provider": "trello", "mcp_url": null, "composio_account_id": "ca_abc123" }
  ],
  "requested_at": "2026-07-04T12:00:00.000Z"
}
```

- `connectors[]` mirrors the API's `ConnectorMcpReference`
  (`src/domain/connectors/connector-gateway.port.ts`). `mcp_url` is **always `null`** —
  the CE resolves the live MCP from `provider` + `composio_account_id` using its own
  Composio credentials. Only **active** connections are sent.
- **Idempotency:** `job_id` is the dedupe key. A re-published request for a job already
  in flight (BullMQ retry, redelivery) MUST NOT trigger a second gather — the CE keys work
  by `job_id`.

## §3 Result messages — CE → API (`ctx.gather.results`)

Each message is one **chunk**, validated by
[`context-result.schema.json`](./context-result.schema.json). The CE emits `data` chunks
as context is gathered, then a **terminal `status` chunk** (`phase: completed` or
`failed`):

```json
{ "schema_version": 1, "job_id": "665f1a2b3c4d5e6f7a8b9c0d", "user_id": "6f96...64ff",
  "sequence": 0, "type": "data",
  "data": { "provider": "trello", "content": "{...}", "token_estimate": 420 } }
```
```json
{ "schema_version": 1, "job_id": "665f1a2b3c4d5e6f7a8b9c0d", "user_id": "6f96...64ff",
  "sequence": 1, "type": "status", "status": { "phase": "completed" } }
```

- **Ordering:** `sequence` is 0-based and monotonic per `job_id`. Chunks are **idempotent
  by `(job_id, sequence)`** — the API ignores a duplicate sequence.
- **Non-terminal vs terminal `status`:** the CE MAY emit non-terminal `status` chunks
  (`phase: started` / `gathering`) as progress signals interleaved with `data` chunks.
  Termination is gated by **`phase`, not `type`** — a consumer treats a `status` chunk as
  terminal only when `phase` is `completed` or `failed`, never merely because
  `type: status`.
- **Terminal marker:** exactly one terminal `status` chunk ends the job. `completed`
  hands the assembled context to the planner (roadmap item 5); `failed` (with
  `error_code`) marks the planning job `failed`.
- **WebSocket relay:** the API relays each `data`/`status` chunk to the owning user over
  the existing gateway (`src/presentation/context/planning.gateway.ts`, `planning.*`
  events) — the FE streams context live without knowing a second service exists.

## §4 Correlation & lifecycle

`job_id` (= `planning_jobs._id`) ties both hops. It drives these planning-job states
(the durable record stays `planning_jobs` in Mongo):

```
pending ── publish request ──▶ gathering ── terminal `completed` ──▶ planning ──▶ completed
                                   │
                                   └────────── terminal `failed` ─────────────▶ failed
```

- **Missing/duplicate chunk:** duplicates are ignored by `(job_id, sequence)`; a gap in
  `sequence` is tolerated (best-effort relay) — correctness rests on the terminal marker.
- **`failed` terminal chunk:** the job is marked `failed` with the chunk's `error_code`;
  no planning runs.
- **No-result timeout:** if no terminal chunk arrives within a configured window, the API
  fails the job (`error_code: CONTEXT_ENGINE_TIMEOUT`). The request queue's DLQ captures
  requests the CE never acked.

## §5 Responsibilities

**Context-engine (n8n) team implements:**
- Consume `ctx.gather.requests` (RabbitMQ trigger), keyed/deduped by `job_id`.
- Gather context via the MCP agents (resolving MCP from `provider` + `composio_account_id`).
- Publish ordered `data` chunks then a terminal `status` chunk to `ctx.gather.results`,
  echoing `job_id`/`user_id`, per [`context-result.schema.json`](./context-result.schema.json).
- `nack`→DLQ on unrecoverable errors; keep processing idempotent.

**MemoFlow API provides** (future implementation task — not built yet):
- Publish requests to `ctx.gather.requests` per [`context-request.schema.json`](./context-request.schema.json).
- Consume `ctx.gather.results`, relay chunks to the FE over WebSocket, assemble context,
  resume/complete/fail the planning job.
- **Implementation prerequisites (not present today):** a RabbitMQ client
  (`amqplib`, or the `@nestjs/microservices` RMQ transport), env vars `RABBITMQ_URL` +
  configurable exchange/queue names, and retiring `ContextEngineHttpClient` in favour of
  the queue producer. The `gathering`/`planning` states in §4 do **not** yet exist in
  `JobStatus` (`src/domain/context/planning-job.ts`, today `pending`/`running`/`completed`/
  `failed`) — the implementation task must add them and update `planning_jobs.status` in
  `docs/database-schema.md` in the same change (deciding whether `running` is dropped or
  kept as a superstate).

## §6 Versioning & non-goals

- `schema_version` is `1`; changes within v1 are **additive only** (new optional fields).
  A breaking change bumps the version and the routing keys (`ctx.gather.request.v2`).
- **Non-goals:** this contract does not cover the CE's internal MCP orchestration, the
  LLM planner (roadmap item 5, still stubbed), or the frontend contract (the existing REST
  + WebSocket surface, Swagger `/docs`).
