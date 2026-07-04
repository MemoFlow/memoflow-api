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
worker → push). Real connector/LLM logic stays stubbed until items 5 & 7 land.

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

## 7. Connectors (OAuth via Composio) — ◐ in progress

Reframed from per-provider OAuth storing encrypted tokens: OAuth2 now runs through
**Composio**, a hosted vault + MCP host that lives inside an out-of-scope n8n
orchestrator. This API never sees or stores provider tokens — Composio is the vault.
`connector_tokens` (encrypted `access_token`/`refresh_token`) is retired; the schema
doc's `connector_connections` table (`composio_account_id` + `status`, no token
columns) is the new source of truth. Flow: **initiate** (this API asks Composio for a
connect URL) → **status** learned via Composio webhook + poll-on-read reconcile →
**MCP selection push** to the external context engine so it can call the right
provider MCP for a planning run. Feeds item 5's context engine. Depends on item 1.

- **Branch 1 (implemented)** — `connector_connections` PG table + migration;
  `POST /connectors/:provider/connect`, `GET /connectors`, `GET /connectors/:id`
  (JWT-guarded); Composio gateway via the `@composio/core` SDK; `COMPOSIO_API_KEY`
  (required), `COMPOSIO_BASE_URL` (optional), `COMPOSIO_AUTH_CONFIG_IDS` (required,
  comma-separated `provider:authConfigId` map) in `env.validation.ts` +
  `.env.example`.
- **Branch 2 (pending)** — Composio webhook intake (`POST /connectors/webhook`,
  public, HMAC-signed via a planned `COMPOSIO_WEBHOOK_SECRET`) + poll-fallback
  reconcile on read; connection revoke.
- **Branch 3 (pending)** — MCP reference resolution + push to a planned external
  context-engine service (`CONTEXT_ENGINE_URL` / `CONTEXT_ENGINE_API_KEY`), replacing
  the stubbed context-gatherer with a real adapter.

---

## Standing rules for every item

- Schema doc first: any data-design change updates `docs/database-schema.md` (and
  the D2 diagram) in the same PR.
- Every PG entity change ships its generated migration; `synchronize` stays false.
- Every endpoint: validated DTOs + Swagger annotations + unit and e2e tests.
- Seed blocks stay idempotent; dev-only (guard already enforces).
- Item is done when: lint/build/unit/e2e green, reviewers APPROVE, docs + diagram
  current, merged to `development`.
