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
- ✅ `deploy-dev.yml` hardened (PR #25): `jq` parses of Render API responses are now
  guarded so a non-JSON response body can't fail the job after the deploy hook has
  already fired; curl failures still fast-fail; response logging is redacted.
- **Incident, fixed 2026-07-19:** `COMPOSIO_API_KEY` / `COMPOSIO_AUTH_CONFIG_IDS` /
  `COMPOSIO_WEBHOOK_SECRET` were missing from the `memoflow-dev-api` Render service —
  every dev deploy from 2026-07-04 silently failed (Render `update_failed`, old
  process stayed live) until this was caught and the secrets were set 2026-07-19.
  Deploys have been green since. `RABBITMQ_URL` is also now set on the dev service
  (see the Context module async backbone section below).
- ☐ Staging and production deploy workflows/targets remain **undecided** — land
  once the user picks hosting for those tiers; don't invent infrastructure. Whenever
  they do land, both services will need `COMPOSIO_*` and `RABBITMQ_URL` set before
  their first deploy — the dev outage above is the cautionary example.

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

## 2. Documents + sections (PG) — ✅ done

- Slice implemented per the `documents`/`sections` tables in the schema doc:
  `documents` (FK → users, `ON DELETE CASCADE`) and `sections` (FK → documents,
  `ON DELETE CASCADE`); both tables carry `created_at`/`updated_at`. `sections` has
  a composite index `(document_id, order)` (`IDX_sections_document_order`) plus a
  plain index on `document_id`; `documents.user_id` is indexed.
- Migration: `CreateDocumentsAndSections`.
- Endpoints (all JWT-guarded, owner-scoped 404s, snake_case JSON responses):
  `POST/GET /documents`, `GET/PATCH/DELETE /documents/:id`;
  `POST/GET /documents/:documentId/sections`,
  `PATCH /documents/:documentId/sections/reorder`,
  `GET/PATCH/DELETE /documents/:documentId/sections/:id`.
- `word_count` is server-computed; a section's `order` is append-on-create and only
  ever changes via the reorder endpoint (absent from create/update DTOs).
- Depended on item 1 (auth + users FK); unblocks items 3, 4, 6.

## 3. Templates (PG) — ✅ done

- Slice implemented per the `templates`/`template_sections`/`document_templates`
  tables in the schema doc: `templates` (`doc_type`/`scope`/`is_published` indexed,
  nullable `created_by` for system templates, FK → users **ON DELETE SET NULL** — a
  deleted user's templates become system templates), `template_sections` (FK →
  templates **ON DELETE CASCADE**, composite index `(template_id, order)` —
  `IDX_template_sections_template_order` — plus a plain index on `template_id`), and
  `document_templates` (FKs → documents/templates, both **ON DELETE CASCADE**, plain
  indexes on `document_id`/`template_id`). `templates` carries `created_at`/
  `updated_at`. `template_sections.title` is a deliberate addition beyond the
  original schema-doc design — sections created from a template need headings.
- Migration: `CreateTemplates`.
- Endpoints (all JWT-guarded, snake_case JSON responses): `POST/GET /templates`,
  `GET/PATCH/DELETE /templates/:id` (owner-scoped for own templates, readable if
  `is_published`), `POST /templates/:id/apply` (applies a template to a document,
  appending one section per template section).
- Depended on item 2 (documents + sections FK); unblocks item 6 (gamification hooks
  can reuse the same document-events pattern).

## 4. Versioning (Mongo — `document_versions`) — ✅ done

- First Mongo module: `/new-module document-versions --db mongo`. Immutable
  snapshots, embedded `sections_snapshot` (`{title, content, order, status,
  word_count}`), indexed `document_id`/`user_id`/`saved_at`.
- **Cross-DB rule applies**: `SaveVersionUseCase`/`GetVersionUseCase` validate the
  caller owns the referenced PG document before touching Mongo.
- **Unique compound index (document_id, version)** — deliberate addition beyond the
  original design: closes the concurrent-save version race where two saves for the
  same document both compute the same `maxVersion + 1`; the repository's `create()`
  catches the resulting duplicate-key error and retries once with a freshly
  recomputed version.
- `SectionRepository` gained a `replaceAll(documentId, sections)` extension: deletes
  and reinserts a document's sections atomically in one PG transaction, used by
  restore. Restore writes nothing to Mongo — versions stay immutable.
- Endpoints (all JWT-guarded, owner-scoped 404s): `POST/GET
  /documents/:documentId/versions` (save a snapshot / list metadata newest-first),
  `GET /documents/:documentId/versions/:versionId` (full snapshot),
  `POST /documents/:documentId/versions/:versionId/restore` (replaces the
  document's current sections).
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

Item 5 (AI layer) built on this complete async backbone (submit → queue →
worker → push). Item 7's context-gatherer is real when `CONTEXT_ENGINE_URL` is set
(stub fallback otherwise); the LLM planner is likewise real when `ANTHROPIC_API_KEY`
is set (stub fallback otherwise) — see item 5 below.

**External context-engine transport — live on `development`, verified end-to-end
2026-07-20:** the async API↔context-engine transport specified in
`docs/contracts/context-engine.md` (RabbitMQ both ways — `ctx.gather.requests`
API→n8n, `ctx.gather.results` n8n→API, correlated by `job_id`; replaces the gRPC
option considered in `ARCHITECTURE.md`) landed on `feature/rabbitmq-transport`
(PR #22): publisher, results consumer, gather-timeout scheduler, and the
`gathering`/`planning` `JobStatus` states. It is gated by `RABBITMQ_URL` — unset (the
default in local dev via `.env`, test/e2e, and any environment without a provisioned
broker) keeps `ContextEngineHttpClient` (HTTP, see item 7 branch 3) as the fallback
path, with `running` as its status.

On the `development` Render service, `RABBITMQ_URL` is now set (dashboard secret,
already declared `sync: false` in `render.yaml`) to a **CloudAMQP free-tier broker**
(actually **LavinMQ** under the hood — `amqps://` TLS-only, port `5671`) shared with
the external, n8n-hosted context engine, which now consumes `ctx.gather.requests` and
replies on `ctx.gather.results` — both sides are implemented and live. Verified
round trip **~600ms**; DLQ behavior confirmed (a result for an unknown `job_id`
dead-letters correctly instead of hanging). Staging and production still need their
own `RABBITMQ_URL` provisioned before their first deploys.

## 5. AI layer — ✅ done

- Slice implemented per the `prompts`/`ai_suggestions` tables in the schema doc:
  `prompts` (`feature_type`/`is_active` indexed, no public controller — repository-
  internal active-prompt lookup) and `ai_suggestions` (FK → sections **ON DELETE
  CASCADE**, FK → users **ON DELETE CASCADE**, plain indexes on `section_id`/
  `user_id` — a deliberate addition beyond the original schema-doc design, both on
  the FK lookup path for every suggestions call). Both tables carry `created_at`/
  `updated_at`.
- Migration: `CreateAiLayer`.
- Endpoints (all JWT-guarded, snake_case JSON responses): `POST
  /sections/:sectionId/suggestions` (generates and persists a suggestion; 404 if the
  section isn't found/owned or no active prompt exists for the given `featureType`,
  503 if the generator isn't configured, 422/502/503 mapped from typed provider
  errors — refused/truncated-or-other/rate-limited), `GET
  /sections/:sectionId/suggestions` (lists a section's suggestions, newest first),
  `PATCH /suggestions/:id` (accept/reject a **pending** suggestion; 409 if already
  reviewed). Ownership is derived transitively through the section's document, same
  404-never-leaks-existence convention as items 2–4.
- Provider: Anthropic (`claude-sonnet-5` by default) via the `@anthropic-ai/sdk`
  client, wired behind two ports — `SuggestionGenerator` (suggestions) and
  `LlmPlanner` (planning jobs) — both **optional**: `ANTHROPIC_API_KEY` unset keeps
  `AiModule`'s `SUGGESTION_GENERATOR` on `NullSuggestionGenerator` (suggestions
  endpoint returns 503 "AI not configured") and `ContextModule`'s `LLM_PLANNER` on
  the existing `StubLlmPlanner` (echoes the prompt) — mirrors the item 7
  `CONTEXT_GATHERER` factory convention, so `start:dev`/smoke/e2e/tests keep working
  with no AI provider configured. New optional env vars in `env.validation.ts` +
  `.env.example`: `ANTHROPIC_API_KEY` (unset = both fallbacks), `ANTHROPIC_MODEL`
  (default `claude-sonnet-5`), `ANTHROPIC_MAX_TOKENS` (default `4096`).
  `AiModule` exports its `AnthropicClientProvider` so `ContextModule` shares one
  Anthropic client instance rather than constructing a second.
- Seed: `scripts/seed.ts` now seeds one active prompt per feature type —
  `suggestion` (v1, substitutes `{{content}}`) and `planning` (v1) — idempotent,
  dev/test only.
- Mongo `planning_jobs` completed (see `docs/database-schema.md`): `prompt_version`/
  `context_used` are now recorded by `ProcessPlanningJobUseCase` once a job runs;
  `document_id`/`section_id` are now validated and bound at submission time —
  `SubmitPlanningJobUseCase` checks the caller owns the referenced document (and
  that a given section belongs to it) before writing either into Mongo, 404ing
  uniformly on any mismatch, same convention as the ai feature's
  `assertSectionOwnedByUser`.
- Depended on items 2 and 4, and on the Context module async backbone above
  (queue/worker/WS foundation); unblocks nothing further on the roadmap.

## 6. Gamification (PG) — ✅ done

- Slice implemented per the `milestones`/`daily_missions`/`mission_progress` tables
  in the schema doc: `milestones` (FK → users **ON DELETE CASCADE**, FK → documents
  **ON DELETE CASCADE**, both indexed, plus a unique composite index `(user_id,
  document_id, milestone_type)` — `IDX_milestones_user_document_type`), `daily_missions`
  (`active_date` indexed, `criteria` jsonb shaped `{ event, target }`), and
  `mission_progress` (FK → users / FK → daily_missions, both **ON DELETE CASCADE**
  and indexed, plus a unique composite index `(user_id, mission_id)` —
  `IDX_mission_progress_user_mission`). `milestones`/`daily_missions` carry
  `created_at`; `mission_progress` carries `created_at`/`updated_at`. Both composite
  unique indexes are deliberate additions beyond the schema doc's plain column
  listing, documented in the migration itself (mirrors how `document_versions`'
  compound index and `connector_connections`' `(user_id, provider)` index are
  documented as additions in their own migrations) — they're the idempotency guards
  `MilestoneTypeOrmRepository.awardOnce` (`INSERT ... ON CONFLICT DO NOTHING
  RETURNING *`) and `MissionProgressTypeOrmRepository.incrementAtomic` (upsert then a
  guarded `UPDATE ... WHERE ... AND completed = false RETURNING *`) rely on so a
  duplicate event can never double-award XP or race a completion flip.
- Migration: `CreateGamification`.
- Endpoints (both JWT-guarded, snake_case JSON responses): `GET /gamification/me`
  (the caller's `xp`/`level`, awarded milestones, and today's active missions with
  progress/completed), `GET /gamification/leaderboard` (top users by `xp`,
  `?limit=` optional, default 10, max 50; projects only `user_id`/`display_name`/
  `xp`/`level`, never `email`/`password_hash`).
- Event hooks: three domain events defined in `src/domain/documents/document-events.ts`
  — `document.created`, `section.created`, `section.updated` (with `wordCount`) —
  emitted via `EventEmitter2` from `CreateDocumentUseCase`/`CreateSectionUseCase`/
  `UpdateSectionUseCase` after a successful write. `GamificationListener`
  (presentation layer) is the sole subscriber and the sole place errors are
  swallowed (logged, never rethrown) — a gamification failure must never fail the
  originating documents request.
- Milestone rules (`src/application/gamification/milestone-rules.ts`): `document.created`
  → `document_created` milestone, 50 XP; `section.created` → `first_section`
  milestone, 25 XP; `section.updated` → `section_goal` milestone, 25 XP, gated on
  `wordCount >= 100`. Each rule can only ever award once per document thanks to the
  `milestones` composite unique index.
- Level curve: `UserRepository.incrementXp` is a single `UPDATE ... RETURNING` that
  computes both `xp` and `level` atomically (`level = FLOOR(xp / 100) + 1` — 100 XP
  per level, level 1 at 0 XP) — never a read-modify-write, so concurrent XP awards
  for the same user can't clobber each other. No `users` schema change (both columns
  already existed; `xp` was already indexed for the leaderboard).
- Daily missions are matched on `criteria.event` against the same three domain
  events, advancing `mission_progress` atomically and awarding `mission.xp_reward`
  exactly once — on the increment that flips `completed` false → true.
- Seed: `scripts/seed.ts` seeds three daily missions active "today" (UTC calendar
  day), idempotent on `code` — `start-a-document` (`document.created`, target 1, 20
  XP), `create-a-section` (`section.created`, target 1, 10 XP), `write-3-sections`
  (`section.updated`, target 3, 15 XP).
- Hooks into document/section events from item 2. Depended on items 1–2; final
  numbered roadmap item.

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
  up by it. On `development`, the webhook is registered with Composio (V3) at
  `https://memoflow-dev-api.onrender.com/connectors/webhook` for the
  `connected_account.expired` and `trigger.disabled` events; the Composio Connect
  Link passes the MemoFlow user uuid as the Composio `user_id`, keeping the two
  systems' user identifiers aligned.
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
  planner was stubbed at the time this branch landed — real Anthropic-backed
  planning arrived with item 5 above.

---

## Roadmap complete — remaining work

All 7 numbered roadmap items are now ✅ done. What's left is infrastructure/transport
work already flagged as deferred in the sections above, not a numbered feature:

- **Staging and production deploy targets are undecided** (item 0) — only the `development`
  tier deploys today (Render + MongoDB Atlas + Upstash Redis). Land staging/production
  workflows once the user picks hosting for those tiers; don't invent infrastructure.
- **RabbitMQ context-engine transport is live on `development`, verified
  end-to-end 2026-07-20** (see the Context module async backbone section and
  `docs/contracts/context-engine.md`) — `RABBITMQ_URL` is set on the dev Render
  service (CloudAMQP/LavinMQ free tier) and the n8n-hosted context engine consumes
  `ctx.gather.requests` / replies on `ctx.gather.results`. `ContextEngineHttpClient`
  (HTTP) remains the fallback path for item 7's context-engine push wherever
  `RABBITMQ_URL` is unset — still every environment other than `development`.
  Outstanding: provisioning `RABBITMQ_URL` for staging/production before their
  first deploys.
- **`ANTHROPIC_API_KEY` is unset on `development`** — the AI suggestion endpoint
  returns 503 ("AI not configured") and the planning-job LLM planner stays on
  `StubLlmPlanner` ("(stub plan)") on the deployed dev service. Item 5's code is
  done; this is a deploy-config gap, not a missing feature.
- **`CORS_ORIGIN` / `WS_CORS_ORIGIN` are wired but not yet active on `development`**
  — `render.yaml` declares both keys (PR #46) and the Render dashboard has a value
  set for each, but a live probe of `GET /health` with a non-matching `Origin`
  still returns `access-control-allow-origin: *` as of 2026-07-20 — the running
  dev process is still on the `'*'` default. A manual redeploy (and possibly a
  blueprint sync, since #46 added the keys) is needed before REST/WS CORS actually
  locks to the frontend origin on `development`.
- **gRPC and a separate Context-module worker deployment remain explicitly deferred**
  (Context module async backbone section) — only built if a concrete trigger from
  `ARCHITECTURE.md`'s "Service boundaries" appears.
- **Security-hardening plan (helmet, CORS defaults, rate limiting, JWT-secret/Swagger/
  source-map hardening, audit log, ops runbook)** — not one of the 7 numbered items
  above; tracked outside this file. Code slices are merged (helmet #28, dependency
  vulns #29, rate limiting #30, audit log #31, and config hardening — 32-char
  `JWT_SECRET`, prod Swagger gating, source maps — #33). The operational runbook these
  slices are
  documented against is [`docs/security.md`](security.md); CI supply-chain hardening
  (dependabot, `npm audit` gate) is tracked separately with the `devops` agent.
- **Error tracking via Sentry (`@sentry/nestjs`) is now implemented** — optional and
  OFF by default (unset `SENTRY_DSN` ⇒ complete no-op, mirrors the
  `ANTHROPIC_API_KEY` convention). Captures unexpected 500s (`HttpExceptionFilter`),
  swallowed gamification-listener errors, and async job failures that never hit the
  HTTP filter (the BullMQ planning processor's handled-failure and gather-timeout
  branches, and the RabbitMQ context-results terminal-failure path — captured once,
  at the CAS winner); the BullMQ rethrow path is auto-captured by `@sentry/nestjs`'s
  `nestIntegration`, not double-reported. One Sentry project, environments
  distinguished by the `SENTRY_ENVIRONMENT` tag; errors-only sampling
  (`SENTRY_TRACES_SAMPLE_RATE=0`) to start; release tracking (`SENTRY_RELEASE`)
  deferred — the var exists with no CI wiring yet. See
  [`docs/security.md`](security.md#error-tracking--observability). **`SENTRY_DSN` is
  now set on `development`** (shipped PR #44 — error tracking is live there) but
  still unset on staging/production, same deploy-config-gap pattern as
  `ANTHROPIC_API_KEY` and `RABBITMQ_URL` above — set per environment once observability
  is wanted there.

## Standing rules for every item

- Schema doc first: any data-design change updates `docs/database-schema.md` (and
  the D2 diagram) in the same PR.
- Every PG entity change ships its generated migration; `synchronize` stays false.
- Every endpoint: validated DTOs + Swagger annotations + unit and e2e tests.
- Seed blocks stay idempotent; dev-only (guard already enforces).
- Item is done when: lint/build/unit/e2e green, reviewers APPROVE, docs + diagram
  current, merged to `development`.
