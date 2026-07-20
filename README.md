# MemoFlow API

REST API for MemoFlow — users, documents, AI-assisted writing features, gamification,
and external connectors. Built with [NestJS 11](https://nestjs.com) on a
**dual-database** design:

- **PostgreSQL** (primary) — everything relational, via TypeORM with migrations only.
- **MongoDB** (specialist) — exactly two collections (`document_versions`,
  `planning_jobs`), via Mongoose.
- **Redis** — BullMQ-backed async job queue (AOF persistence), used by the Context
  module's planning-job pipeline.

The full data design lives in [`docs/database-schema.md`](docs/database-schema.md)
(source of truth) and is visualized in
[`docs/diagrams/database-schema.svg`](docs/diagrams/database-schema.svg):

![Database schema](docs/diagrams/database-schema.svg)

## Quickstart

Prerequisites: Node 24+, Docker (with compose).

```bash
cp .env.example .env   # localhost defaults, works out of the box
npm install
npm run db:up          # postgres:16 + mongo:7 + redis:7 via docker compose
npm run start:dev
```

- Swagger UI: http://localhost:3000/docs
- Health (checks Postgres, MongoDB, and Redis): http://localhost:3000/health

## Commands

| command | what it does |
| --- | --- |
| `npm run start:dev` | dev server with watch (needs DBs up + `.env`) |
| `npm test` / `npm run test:e2e` | unit / e2e tests (e2e: Testcontainers PostgreSQL + in-memory Mongo — needs Docker) |
| `npm run lint` / `npm run build` | lint (with autofix) / compile |
| `npm run db:up` / `db:down` / `db:reset` | local dev databases (`reset` wipes volumes) |
| `npm run db:seed` | idempotent dev seed (refuses to run against staging/production) — creates two dev users, `admin@memoflow.dev` / `writer@memoflow.dev` (password `dev-password-123`) |
| `npm run smoke` | boots the app and polls `/health`; set `SMOKE_BASE_URL` to smoke a deployed environment instead |
| `npm run migration:generate -- src/infrastructure/persistence/migrations/<Name>` | generate migration from entity diff |
| `npm run migration:run` / `migration:revert` / `migration:show` | apply / revert / list migrations |

## Authentication & endpoints

Users live in PostgreSQL. Passwords are hashed with bcrypt; auth uses JWTs issued
via `@nestjs/jwt` and validated by Passport-JWT.

| method | path | auth | notes |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | — | creates a user, returns the user (no password hash) |
| `POST` | `/auth/login` | — | returns `{ accessToken }`; updates `last_active_at` |
| `GET` | `/users/me` | JWT | the authenticated user |
| `GET` | `/users/:id` | JWT | fetch a user by id |
| `POST` | `/documents` | JWT | creates a document owned by the caller |
| `GET` | `/documents` | JWT | lists the caller's documents |
| `GET` | `/documents/:id` | JWT | fetch a document by id, owner-scoped |
| `PATCH` | `/documents/:id` | JWT | partial update, owner-scoped |
| `DELETE` | `/documents/:id` | JWT | owner-scoped; cascades to its sections; returns **204** |
| `POST` | `/documents/:documentId/sections` | JWT | creates a section, appended to the end (`order` server-assigned) |
| `GET` | `/documents/:documentId/sections` | JWT | lists a document's sections, ordered |
| `PATCH` | `/documents/:documentId/sections/reorder` | JWT | reorders sections; body is the full set of section ids in the new order |
| `GET` | `/documents/:documentId/sections/:id` | JWT | fetch a section by id, owner-scoped |
| `PATCH` | `/documents/:documentId/sections/:id` | JWT | partial update (`title`/`content`/`status`); `order` not settable here |
| `DELETE` | `/documents/:documentId/sections/:id` | JWT | owner-scoped; returns **204** |
| `POST` | `/templates` | JWT | creates a template (with its sections) owned by the caller |
| `GET` | `/templates` | JWT | lists templates visible to the caller (published or own); filter by `docType`/`scope` query params |
| `GET` | `/templates/:id` | JWT | fetch a template by id; visible if published or owned by the caller |
| `PATCH` | `/templates/:id` | JWT | partial update, owner-scoped; `sections` replaces the template's sections wholesale when provided |
| `DELETE` | `/templates/:id` | JWT | owner-scoped; returns **204** |
| `POST` | `/templates/:id/apply` | JWT | applies a template to a document, appending one section per template section |
| `POST` | `/documents/:documentId/versions` | JWT | snapshots the document's current sections into a new immutable version |
| `GET` | `/documents/:documentId/versions` | JWT | lists the document's version metadata (no sections payload), newest first |
| `GET` | `/documents/:documentId/versions/:versionId` | JWT | fetch a version's full sections snapshot, owner-scoped |
| `POST` | `/documents/:documentId/versions/:versionId/restore` | JWT | replaces the document's current sections with the version's snapshot; writes nothing to Mongo |
| `POST` | `/planning-jobs` | JWT | submits a planning prompt (optionally bound to an owned `documentId`/`sectionId`); returns **202** + `{ job_id, status: "pending" }` |
| `GET` | `/planning-jobs/:id` | JWT | fetch a planning job by id, owner-scoped |
| `POST` | `/sections/:sectionId/suggestions` | JWT | generates an AI suggestion for a section; 404 if the section isn't owned by the caller or no active prompt exists for `featureType`; 503 if AI isn't configured |
| `GET` | `/sections/:sectionId/suggestions` | JWT | lists a section's AI suggestions, newest first |
| `PATCH` | `/suggestions/:id` | JWT | accepts or rejects a **pending** suggestion; 409 if already reviewed |
| `POST` | `/connectors/:provider/connect` | JWT | starts a Composio OAuth connection for a provider; returns `{ redirect_url, connection_id, status }` |
| `GET` | `/connectors` | JWT | lists the caller's connector connections; reconciles any `initiated` connection against Composio first |
| `GET` | `/connectors/:id` | JWT | fetch a connector connection by id, owner-scoped; reconciles if `initiated` |
| `POST` | `/connectors/webhook` | — | Composio-signed webhook (public); updates a connection's status |
| `DELETE` | `/connectors/:id` | JWT | owner-scoped; revokes the Composio connection, sets status `revoked`; returns **204** |
| `GET` | `/gamification/me` | JWT | the caller's `xp`/`level`, awarded milestones, and today's active daily missions with progress/completed |
| `GET` | `/gamification/leaderboard` | JWT | top users by `xp`; `?limit=` optional (default 10, max 50) |

Protected routes require `Authorization: Bearer <accessToken>`. Full request/response
shapes are in Swagger (`/docs`).

### Connectors (OAuth via Composio)

MemoFlow doesn't run per-provider OAuth or store provider tokens itself. **Composio**
is a hosted vault + MCP host: `POST /connectors/:provider/connect` asks Composio for a
connect URL and stores a `connector_connections` row (`composio_account_id`, `status`)
— never an access/refresh token. Response DTOs expose only
`id, provider, status, connected_at, created_at`. Providers are an allowlist (trello,
notion, github). Status transitions to `active` (or `failed`) via a **Composio
webhook** (`POST /connectors/webhook`, public, verified via HMAC over
`webhook-id`/`webhook-timestamp`/`webhook-signature` with `COMPOSIO_WEBHOOK_SECRET`)
as the primary signal, with **reconcile-on-read** as fallback: any `GET /connectors`
or `GET /connectors/:id` on an `initiated` connection re-checks Composio and
self-heals a missed webhook. Terminal states (`revoked`/`failed`) never revive from a
stale webhook. `DELETE /connectors/:id` (JWT, owner-scoped) revokes the connection at
Composio and marks it `revoked`.

When a planning job runs, the worker resolves the user's **active** connectors and
sends a `{ provider, mcpUrl: null, composioAccountId }` reference per connector
(built from the local `connector_connections` row, no extra Composio call) to the
external context engine, which resolves the live MCP server itself from
provider + `composioAccountId`. This travels as an HTTP POST to `CONTEXT_ENGINE_URL`
on the legacy synchronous path, or as the `connectors[]` field of the RabbitMQ
`ctx.gather.requests` message when `RABBITMQ_URL` is set — see "Planning jobs" below
for the two transports. See
[`docs/ROADMAP.md`](docs/ROADMAP.md#7-connectors-oauth-via-composio---done) for
current implementation status.

### Planning jobs (async, real-time over WebSocket)

`POST /planning-jobs` never runs planning synchronously in the request: it writes a
`pending` job to MongoDB (`planning_jobs`) and enqueues it on the Redis/BullMQ
`planning` queue, returning immediately. An in-process worker (`@Processor`) then
picks the job up and processes it through the context-gatherer + LLM-planner ports.

Two context-gathering transports exist, selected by `RABBITMQ_URL`:

- **Unset (default in dev/test/e2e):** the legacy synchronous path. If
  `CONTEXT_ENGINE_URL` is also set, the worker POSTs the user's active connectors +
  prompt to that URL (`ContextEngineHttpClient`) and awaits the response inline;
  otherwise it uses the built-in stub, which echoes the prompt back. The job's
  status is `running` while this is in flight.
- **Set (`amqp://`/`amqps://`):** the async RabbitMQ transport
  (`docs/contracts/context-engine.md`) — the worker publishes a request to
  `ctx.gather.requests` (job moves to `gathering`) and a consumer assembles the
  context from the `ctx.gather.results` chunk stream published by the external
  context engine (n8n), each chunk relayed live over the WebSocket gateway
  (`planning.chunk`). Once the terminal chunk arrives the job moves to `planning`.
  A job stuck in `gathering` longer than `CONTEXT_GATHER_TIMEOUT_MS` fails with
  `error_code: CONTEXT_ENGINE_TIMEOUT`. **Live on the `development` environment**,
  verified end-to-end 2026-07-20 (~600ms round trip; DLQ behavior confirmed) against
  a CloudAMQP free-tier broker (LavinMQ under the hood, `amqps://` TLS-only) and the
  external n8n-hosted context engine. Staging and production still need their own
  `RABBITMQ_URL` provisioned before their first deploys — see
  [`docs/contracts/context-engine.md`](docs/contracts/context-engine.md).

A submitted job can optionally be bound to an owned `documentId`/`sectionId` — the
use-case validates the caller owns the document (and that a given section belongs to
it) before writing either into Mongo, 404ing uniformly on any mismatch. The
LLM-planner port is likewise real when `ANTHROPIC_API_KEY` is set (Anthropic
`claude-sonnet-5` by default), recording the active `planning` prompt's version and
the context used on the job once it runs; unset keeps the built-in `StubLlmPlanner`
(echoes the prompt back).

The frontend gets the result pushed in real time over WebSocket (`@nestjs/websockets`
+ socket.io) instead of only polling:

- Connect with the same JWT used for REST, passed in the socket.io handshake as
  `auth.token` (not an `Authorization` header — browsers can't set WS headers). A
  missing or invalid token disconnects the socket immediately.
- Each socket is joined server-side to a room derived from the verified token
  (`user:<id>`) — a client only ever receives events for its own planning jobs.
- Four events relay a job's lifecycle: `planning.status` (`running` on the legacy
  path, or `gathering`/`planning` on the RabbitMQ transport path), `planning.chunk`
  (RabbitMQ transport only — one per `ctx.gather.results` chunk, live), and one
  terminal event per outcome: `planning.completed` (with `result`), `planning.failed`
  (with `errorCode`/`errorMessage`).
- After connecting (or reconnecting), emit `subscribe { jobId }` to get that job's
  *current* state immediately — covers a client that connects after the job already
  finished, or reconnects mid-job.

Delivery is **best-effort, at-most-once** — MongoDB `planning_jobs` remains the
durable source of truth. `GET /planning-jobs/:id` stays available as the REST
fallback for clients without a live WebSocket connection. Full request/response and
event shapes are in Swagger (`/docs`).

## Environment variables

Beyond the database connection vars, auth requires:

| var | required | default | notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | yes | — | signing key for access tokens; must be a long random value outside dev |
| `JWT_EXPIRES_IN` | no | `15m` | access token lifetime |
| `REDIS_HOST` | yes | — | Redis host for the BullMQ planning queue |
| `REDIS_PORT` | yes | — | Redis port (`0`–`65535`) |
| `REDIS_PASSWORD` | no | — | Redis auth password, if required |
| `REDIS_TLS` | no | `false` | set `true` for managed TLS-only Redis (e.g. Upstash); local docker Redis stays `false` — mirrors `POSTGRES_SSL` |
| `CORS_ORIGIN` | no | `*` | frontend origin allowed for cross-origin REST API requests; `*` is dev-only — must be set explicitly in staging/production, never `*` |
| `WS_CORS_ORIGIN` | no | `*` | frontend origin allowed to open the planning WebSocket; `*` is dev-only — must be set explicitly in staging/production, never `*` |
| `COMPOSIO_API_KEY` | yes | — | authenticates this API to Composio (the OAuth vault + MCP host for connectors) |
| `COMPOSIO_BASE_URL` | no | — | override the Composio API base URL (defaults to Composio's hosted endpoint) |
| `COMPOSIO_AUTH_CONFIG_IDS` | yes | — | comma-separated `provider:authConfigId` map, e.g. `trello:ac_...,notion:ac_...` |
| `COMPOSIO_WEBHOOK_SECRET` | yes | — | HMAC secret used to verify `POST /connectors/webhook` signatures from Composio |
| `CONTEXT_ENGINE_URL` | no | — | base URL of the external context engine; unset keeps the planning worker on the built-in stub context-gatherer |
| `CONTEXT_ENGINE_API_KEY` | no | — | sent as `Authorization: Bearer <key>` on context-engine requests, when set |
| `CONTEXT_ENGINE_TIMEOUT_MS` | no | `10000` | aborts the context-engine POST after this many ms, failing the planning job fast instead of hanging |
| `RABBITMQ_URL` | no | — | `amqp://`/`amqps://` broker URL; unset keeps the legacy synchronous `ContextEngineHttpClient`/stub gather path (`CONTEXT_ENGINE_URL` above); set to switch planning jobs onto the async RabbitMQ transport (`docs/contracts/context-engine.md`) |
| `CONTEXT_GATHER_TIMEOUT_MS` | no | `120000` | only meaningful when `RABBITMQ_URL` is set — fails a job stuck in `gathering` past this many ms with `error_code: CONTEXT_ENGINE_TIMEOUT` |
| `ANTHROPIC_API_KEY` | no | — | powers AI suggestion generation and the planning-job LLM planner; unset keeps both on their null/stub fallbacks (suggestions endpoint returns 503, planning jobs keep using `StubLlmPlanner`) |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5` | Anthropic model id used for both suggestions and planning |
| `ANTHROPIC_MAX_TOKENS` | no | `4096` | max output tokens per Anthropic call |

See [`.env.example`](.env.example) for the full list (`NODE_ENV`, `PORT`,
`MONGODB_URI`, `POSTGRES_*`).

## Architecture

Clean architecture: each feature is a vertical slice across four layers —
`src/domain` (entities + repository interfaces), `src/application` (use-cases),
`src/infrastructure/persistence` (TypeORM/Mongoose implementations — the only layer
that touches a database library), and `src/presentation` (controllers + validated
DTOs). Shared plumbing (exception filter, logging, health) lives in `src/shared`;
env validation in `src/config`.

## Branching & environments (gitflow)

| branch | environment | role |
| --- | --- | --- |
| `main` | production | releases only, tagged |
| `staging` | staging | pre-production validation (release-branch role) |
| `development` | dev | integration — all feature PRs target this |

Work happens on `feature/<slug>` / `bugfix/<slug>` branches off `development`
(`hotfix/<slug>` off `main`); promotion is one-way via PR:
`development` → `staging` → `main`. Database migrations are applied per environment
at deploy time — `synchronize` is always off.

### Branch naming & PR templates

Branch names follow Conventional-Commit types: **`<type>/<slug>`**.

| type | for | base branch |
| --- | --- | --- |
| `feat` | new feature | `development` |
| `fix` | bug fix | `development` |
| `hotfix` | urgent production fix | `main` (back-merged to `staging` + `development`) |
| `docs` | documentation only | `development` |
| `refactor` | behaviour-preserving restructure | `development` |
| `perf` | performance improvement | `development` |
| `test` | tests only | `development` |
| `build` | build system / dependencies | `development` |
| `ci` | CI/CD pipeline | `development` |
| `chore` | tooling / maintenance | `development` |
| `style` | formatting only | `development` |

`slug` is kebab-case (`[a-z0-9._-]+`), e.g. `feat/user-auth`, `fix/token-expiry`.

**Enforcement**

- **CI** — `.github/workflows/branch-naming.yml` fails any PR whose source branch
  doesn't match the convention. Long-lived branches (`development`, `staging`, `main`)
  are exempt so promotion PRs pass.
- **Local** — a `pre-push` hook rejects non-conventional branch names before they leave
  your machine. Install it once per clone:

  ```bash
  bash scripts/install-hooks.sh
  ```

**PR templates** — each type has its own template under
`.github/PULL_REQUEST_TEMPLATE/`. Pick one when opening a PR:

```bash
gh pr create --template feat.md      # or fix.md, hotfix.md, docs.md, ...
```

Or add `?template=feat.md` to the compare URL. Opening a PR without choosing one loads
the default `.github/PULL_REQUEST_TEMPLATE.md`.

## CI/CD

GitHub Actions (`.github/workflows/`):

- `ci.yml` — on every PR to `development`/`staging`/`main`: lint, build, unit tests,
  e2e tests (Testcontainers PostgreSQL + in-memory Mongo; hard-fails if the e2e
  Docker suite would skip).
- `deploy-dev.yml` — on push to `development`: run migrations, trigger a Render
  deploy hook, then smoke-check via `scripts/smoke.sh`. Gated by the GitHub
  Environment `development`.
- `notify-review.yml` — on a PR to `development`/`staging`/`main` being opened or
  marked ready for review (non-draft only): posts the PR recap to Discord and pings
  a reviewer role.

### CI secrets

These are **GitHub Actions secrets**, not application env vars — they are consumed
only inside workflow runs and must not be added to `.env.example`.

| secret | purpose |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | Incoming webhook URL for the reviewer channel (`notify-review.yml`). |
| `DISCORD_REVIEWER_ROLE_ID` | Numeric Discord role id pinged when a PR is ready for review (`notify-review.yml`). |

If either is unset, `notify-review.yml` soft-skips (a `::warning::`, no failure) —
it never blocks the PR.

The `development` tier deploys to **Render** (see [`render.yaml`](render.yaml) for the
web service + managed Postgres blueprint). Render has no managed MongoDB, so dev
MongoDB is an external **MongoDB Atlas M0 (free tier)** instance, with its connection
string set manually as the `MONGODB_URI` secret. Render also has no managed free
Redis, so dev Redis is likewise external — **Upstash free tier**, TLS-only
(`REDIS_TLS=true`) — with `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` set manually
as secrets. Staging and production deploy targets are not yet decided.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture: service topology,
  module boundaries, and shared infrastructure (including the Context module's
  bounded async backbone and future extraction triggers).
- [`docs/database-schema.md`](docs/database-schema.md) — authoritative data design
  (tables, collections, indexes, which database each entity lives in).
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — feature roadmap with per-item specs and
  current status.
- [`docs/diagrams/`](docs/diagrams/) — diagrams authored in
  [D2](https://d2lang.com) (`.d2` sources) with rendered SVGs committed alongside.
  Regenerate with `d2 <name>.d2 <name>.svg`.
