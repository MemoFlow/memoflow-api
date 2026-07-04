# MemoFlow API — Roadmap

Working roadmap for the orchestrator session. Statuses here are the source of truth;
`docs-maintainer` updates them in the same PR that changes reality. CLAUDE.md keeps
only the short item list.

**How to execute an item** (see CLAUDE.md "Workflow (agent orchestration)"):
branch `feature/<slug>` off `development` → design against `docs/database-schema.md`
(ask `db-mentor` when unsure) → `implementer` via `/new-module` / `/api-endpoint` →
parallel `api-reviewer` + `docs-maintainer` (+ `tooling-reviewer` if `.claude/`,
`scripts/`, or CLAUDE.md changed) → `/commit` after APPROVE → PR to `development` →
promote `development` → `staging` → `main`.

Legend: ✅ done · ◐ in progress · ☐ not started

---

## Foundation (done)

- ✅ Dual-DB foundation — PostgreSQL (TypeORM, migrations-only) + MongoDB (Mongoose),
  env validation, `/health` (both DBs), Swagger `/docs`, exception filter, logging,
  docker-compose dev DBs, Testcontainers e2e, seed/smoke scripts.
- ✅ Staging tier — gitflow `development` → `staging` → `main` with per-branch
  environments; `NODE_ENV` validated; seed guarded against staging/production;
  `SMOKE_BASE_URL` smoke mode.
- ✅ Agent orchestration — `implementer`, `api-reviewer`, `tooling-reviewer`,
  `docs-maintainer`, `devops`, `db-mentor`; explicit pipeline + parallelism rules in
  CLAUDE.md; model tiering pinned.
- ✅ Docs baseline — README, `docs/database-schema.md` (data-design source of truth),
  D2 schema diagram (`docs/diagrams/`).

## 0. CI/CD bootstrap — ◐ dev deploy live, staging/production deferred (`devops` agent)

- ✅ `ci.yml`: lint + build + unit + e2e on PRs to `development`, `staging`, `main`.
  The e2e job hard-fails in CI if the Testcontainers PostgreSQL suite would skip
  (ubuntu runners have Docker, so it genuinely runs).
- ✅ `deploy-dev.yml`: migrate → trigger Render deploy hook → smoke-check, gated by
  the GitHub Environment `development`. Deploy target for dev is **Render**
  (`render.yaml` blueprint for the web service + managed Postgres); dev MongoDB is
  external **MongoDB Atlas (free M0 tier)** since Render has no managed MongoDB —
  its connection string is set manually as the `MONGODB_URI` secret. Now that the
  BullMQ/WebSocket backbone runs in the deployed dev tier, dev Redis is likewise
  external — **Upstash free tier**, TLS-only (`REDIS_TLS=true`) — with
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` set manually as secrets.
- ☐ Staging and production deploy workflows/targets remain **undecided** — land
  once the user picks hosting for those tiers; don't invent infrastructure.

## 1. Users + JWT auth (PG) — ✅ done

- Slice implemented per the `users` table in the schema doc (email unique+indexed,
  `xp` indexed, `password_hash` never serialized).
- **Replaced the transitional Mongoose files** — `src/infrastructure/persistence/
  user.{schema,repository,module}.ts` are deleted; users live in PostgreSQL only.
- Auth: `POST /auth/register`, `POST /auth/login` (returns `{ accessToken }`),
  bcrypt password hashing, JWT via `@nestjs/jwt` + Passport-JWT, `JwtAuthGuard` on
  protected routes. `JWT_SECRET` (required) and `JWT_EXPIRES_IN` (optional, default
  `15m`) are in `env.validation.ts` + `.env.example`.
- Idempotent dev-users seed block in `scripts/seed.ts` (admin + writer accounts).
- Endpoints: `POST /auth/register`, `POST /auth/login`, `GET /users/me` (JWT-guarded),
  `GET /users/:id` (JWT-guarded). `last_active_at` updates on login.
- Migration: `CreateUsers`.

## 2. Documents + sections (PG) — ☐

- `documents` (FK → users) and `sections` (FK → documents, `order` indexed) per
  schema doc. CRUD + section reordering; ownership enforced via the JWT user.
- Depends on item 1 (auth + users FK).

## 3. Templates (PG) — ☐

- `templates` (`doc_type`/`scope`/`is_published` indexed, nullable `created_by` for
  system templates), `template_sections`, `document_templates` join.
- Apply-template-to-document use-case. Depends on item 2.

## 4. Versioning (Mongo — `document_versions`) — ☐

- First Mongo module: `/new-module document-versions --db mongo`. Immutable
  snapshots, embedded `sections_snapshot`, indexed `document_id`/`user_id`/`saved_at`.
- **Cross-DB rule applies**: use-case must validate the PG document/user rows exist
  before writing; `api-reviewer` checks this. Save/list/restore endpoints.
- Depends on item 2.

## Context module async backbone (bounded) — ✅ done (all 3 branches)

Foundation infra that roadmap item 5 (AI layer) depends on: a BullMQ (Redis) planning
queue + WebSocket push + a `planning_jobs` skeleton, wired together by an
EventEmitter2 completion signal. Runs **in-process** — one worker, one deployment,
per `ARCHITECTURE.md` ("Service boundaries"). **gRPC and a separate worker
deployment remain explicitly deferred** to a future Context-module extraction, only
if a concrete trigger from that section appears; not built now.

Landed as three sequential branches off `development`, each reviewed/merged before
the next started:

- ✅ **Branch 1 — `feature/context-queue-infra`** (foundation, no user-facing surface
  yet): Redis added to `docker-compose.yml` (AOF persistence), `REDIS_HOST` /
  `REDIS_PORT` / `REDIS_PASSWORD` / `WS_CORS_ORIGIN` env vars, BullMQ producer +
  queue module, `planning_jobs` Mongo skeleton (schema + domain entity + repo —
  subset of the documented fields, see `docs/database-schema.md`), Redis health
  indicator (`/health` now reports postgres + mongodb + redis), `EventEmitter2` +
  `enableShutdownHooks()`.
- ✅ **Branch 2 — `feature/context-worker`**: `POST /planning-jobs` (JWT-guarded,
  202 + `{ job_id, status: "pending" }`, 503 if enqueue fails) and
  `GET /planning-jobs/:id` (JWT-guarded, owner-scoped fallback) in
  `src/presentation/context/`; `submit-planning-job` / `get-planning-job` /
  `process-planning-job` use-cases in `src/application/context/`; in-process
  BullMQ `@Processor` worker runs jobs through the **stubbed** context-gatherer +
  LLM-planner ports (echo result) and emits `EventEmitter2` `planning.status` /
  `planning.completed` / `planning.failed`. No WebSocket consumer of those events
  yet — client polls `GET /planning-jobs/:id`. Connector/LLM logic stays stubbed
  (real work = roadmap items 5 & 7).
- ✅ **Branch 3 — `feature/context-websocket`**: `planning.gateway.ts` — JWT-verified
  WS handshake (token via socket.io `auth.token`, verified in `handleConnection`
  with the same secret/payload shape as REST auth), server-derived per-user rooms
  (`user:<id>` — never a client-supplied room), `subscribe {jobId}` catch-up
  (owner-scoped), and `@OnEvent('planning.*')` relays of `planning.status` /
  `planning.completed` / `planning.failed`. Delivery is best-effort; Mongo
  `planning_jobs` stays the durable source of truth and `GET /planning-jobs/:id`
  remains the REST fallback for clients without a live socket.

Item 5 (AI layer) can now build on a complete async backbone (submit → queue →
worker → push). Item 7's context-gatherer is real when `CONTEXT_ENGINE_URL` is set
(stub fallback otherwise); the LLM planner stays stubbed until item 5 lands.

**External context-engine transport — contract-defined, API-side implementation
pending:** the async API↔context-engine transport is now specified in
`docs/contracts/context-engine.md` as RabbitMQ both ways (`ctx.gather.requests`
API→n8n, `ctx.gather.results` n8n→API, correlated by `job_id`), replacing the
gRPC option considered in `ARCHITECTURE.md`. The current `ContextEngineHttpClient`
(HTTP, see item 7 branch 3) remains the live code path until the RabbitMQ
implementation task lands.

## 5. AI layer — ☐

- PG: `prompts` (`feature_type`, `is_active` indexed), `ai_suggestions`
  (FKs → sections/users). Mongo: `planning_jobs` (status-indexed job lifecycle:
  pending/running/completed/failed, flexible `context_used`/`result` payloads).
- Async job flow: enqueue → worker updates status → results fetched. Provider
  integration details resolved at design time. **Depends on items 2 and 4, and on
  the Context module async backbone above** (queue/worker/WS foundation).

## 6. Gamification (PG) — ☐

- `milestones`, `daily_missions` (`active_date` indexed), `mission_progress`;
  XP/level updates on `users` (leaderboard uses the indexed `xp`).
- Hooks into document/section events from item 2. Depends on items 1–2.

## 7. Connectors (OAuth via Composio) — ✅ done

Reframed from per-provider OAuth storing encrypted tokens: OAuth2 now runs through
**Composio**, a hosted vault + MCP host that lives inside an out-of-scope n8n
orchestrator. This API never sees or stores provider tokens — Composio is the vault.
`connector_tokens` (encrypted `access_token`/`refresh_token`) is retired; the schema
doc's `connector_connections` table (`composio_account_id` + `status`, no token
columns) is the new source of truth. Flow: **initiate** (this API asks Composio for a
connect URL) → **status** learned via Composio webhook (primary) + poll-on-read
reconcile (fallback, self-heals a missed webhook on `GET /connectors` /
`GET /connectors/:id` while a connection is `initiated`; terminal states
`revoked`/`failed` never revive from a stale webhook) → **revoke** (owner-initiated,
tears down the Composio connection) → **context-engine push**: when a planning job
runs, the worker resolves the user's active connectors and POSTs a
`{ provider, mcpUrl: null, composioAccountId }` reference per connector (built from
the local `connector_connections` row, no extra Composio call) to an external
context engine, which resolves the live MCP server itself from
provider + `composioAccountId`. Feeds item 5's AI layer. Depends on item 1.

**Branch status:** Branch 1–3 implemented (foundation, webhook/reconcile/revoke,
context-engine push).

- **Branch 1 (implemented)** — `connector_connections` PG table + migration;
  `POST /connectors/:provider/connect`, `GET /connectors`, `GET /connectors/:id`
  (JWT-guarded); Composio gateway via the `@composio/core` SDK; `COMPOSIO_API_KEY`
  (required), `COMPOSIO_BASE_URL` (optional), `COMPOSIO_AUTH_CONFIG_IDS` (required,
  comma-separated `provider:authConfigId` map) in `env.validation.ts` +
  `.env.example`.
- **Branch 2 (implemented)** — `POST /connectors/webhook` (public, Composio-signed:
  verifies `webhook-id`/`webhook-timestamp`/`webhook-signature` via HMAC with
  `COMPOSIO_WEBHOOK_SECRET`) updates connection status as the primary signal;
  reconcile-on-read polls Composio and self-heals an `initiated` connection's status
  on `GET /connectors` / `GET /connectors/:id` if a webhook was missed; `DELETE
  /connectors/:id` (JWT-guarded, owner-scoped) revokes the Composio connection and
  sets status `revoked`, returns 204. `composio_account_id` is now **indexed**
  (migration `AddConnectorComposioAccountIndex`) since the webhook looks connections
  up by it.
- **Branch 3 (implemented, `feature/connector-context-engine`)** — planning-job
  worker resolves the user's active connectors and POSTs
  `{ userId, connectors: [...], prompt }` to `CONTEXT_ENGINE_URL`; the context
  engine (n8n/Composio side) resolves the live MCP server from
  provider + `composioAccountId` — `mcpUrl` stays `null` from this side by design
  (Composio's MCP URL generation needs a provisioned/deprecated server-session, so
  resolution is deferred to the context engine). `ContextModule`'s `CONTEXT_GATHERER`
  provider is now a factory: a real HTTP gatherer (`ContextEngineHttpClient`) when
  `CONTEXT_ENGINE_URL` is set, else the existing `StubContextGatherer` — so
  dev/smoke/e2e keep running without a context engine. New optional env vars
  `CONTEXT_ENGINE_URL`, `CONTEXT_ENGINE_API_KEY` (Bearer auth when set),
  `CONTEXT_ENGINE_TIMEOUT_MS` (default `10000`ms fetch-abort timeout so a hung
  context engine fails the job fast, not silently). No PG schema change. The LLM
  planner stays stubbed — that's item 5's remaining work.

---

## Standing rules for every item

- Schema doc first: any data-design change updates `docs/database-schema.md` (and
  the D2 diagram) in the same PR.
- Every PG entity change ships its generated migration; `synchronize` stays false.
- Every endpoint: validated DTOs + Swagger annotations + unit and e2e tests.
- Seed blocks stay idempotent; dev-only (guard already enforces).
- Item is done when: lint/build/unit/e2e green, reviewers APPROVE, docs + diagram
  current, merged to `development`.
