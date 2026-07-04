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
  its connection string is set manually as the `MONGODB_URI` secret.
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

## Context module async backbone (bounded) — ◐ Branch 1 of 3 done

Foundation infra that roadmap item 5 (AI layer) depends on: a BullMQ (Redis) planning
queue + WebSocket push + a `planning_jobs` skeleton, wired together by an
EventEmitter2 completion signal. Runs **in-process** — one worker, one deployment,
per `ARCHITECTURE.md` ("Service boundaries"). **gRPC and a separate worker
deployment are explicitly deferred** to a future Context-module extraction, only if
a concrete trigger from that section appears; not built now.

Landing as three sequential branches off `development`, each reviewed/merged before
the next starts:

- ✅ **Branch 1 — `feature/context-queue-infra`** (foundation, no user-facing surface
  yet): Redis added to `docker-compose.yml` (AOF persistence), `REDIS_HOST` /
  `REDIS_PORT` / `REDIS_PASSWORD` / `WS_CORS_ORIGIN` env vars, BullMQ producer +
  queue module, `planning_jobs` Mongo skeleton (schema + domain entity + repo —
  subset of the documented fields, see `docs/database-schema.md`), Redis health
  indicator (`/health` now reports postgres + mongodb + redis), `EventEmitter2` +
  `enableShutdownHooks()`.
- ☐ **Branch 2 — `feature/context-worker`**: `POST /planning-jobs` (202 + jobId) /
  `GET /planning-jobs/:id` fallback, in-process `@Processor` worker running the
  (stubbed) planning use-case, `EventEmitter2` completion events.
- ☐ **Branch 3 — `feature/context-websocket`**: `planning.gateway.ts` — JWT-verified
  WS handshake, server-derived per-user rooms, `subscribe {jobId}` catch-up, relays
  `planning.status` / `planning.completed` / `planning.failed`.

No REST endpoint or WebSocket exists yet — both land in Branches 2 and 3.

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

## 7. Connectors (OAuth) — ☐

- `connector_tokens` per schema doc: `access_token`/`refresh_token` encrypted at
  rest with **AES-256-GCM**, key from config (new env var, e.g.
  `TOKEN_ENCRYPTION_KEY`, 32 bytes — into `env.validation.ts` + `.env.example` in
  the same PR, provisioned in GitHub Environments once item 0 lands; never
  hardcoded, never serialized, never logged).
- OAuth flows per provider (e.g. notion, github — the `planning_jobs.connectors`
  values). Feeds item 5's context engine. Depends on item 1.

---

## Standing rules for every item

- Schema doc first: any data-design change updates `docs/database-schema.md` (and
  the D2 diagram) in the same PR.
- Every PG entity change ships its generated migration; `synchronize` stays false.
- Every endpoint: validated DTOs + Swagger annotations + unit and e2e tests.
- Seed blocks stay idempotent; dev-only (guard already enforces).
- Item is done when: lint/build/unit/e2e green, reviewers APPROVE, docs + diagram
  current, merged to `development`.
