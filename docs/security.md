# Security Runbook

Operational guide for running MemoFlow safely: what to watch, how to back up and
restore, what to check before a deploy, and the security posture of a few specific
attack surfaces (SSRF, prompt injection). This is the acceptance doc for the
security-hardening plan's ops items (43, 44, 23, 39, 7, 41, 27).

## Monitoring & alerting

**No alerting is wired up yet** — this section documents what SHOULD be watched
(the acceptance for checklist item 43), not a live system.

| signal | why | where |
| --- | --- | --- |
| 5xx rate | general service health | Render metrics/logs |
| `audit_logs` rows with `action = 'auth.login_failed'`, rate/spikes | brute-force indicator — pairs with the login endpoint's tight throttle cap | query PG directly (`audit_logs`, see `docs/database-schema.md`) |
| 429 rate from `ThrottlerGuard` | scraping/abuse or a cap set too low | Render logs (throttled responses are logged) |
| Render deploy status `update_failed` | a deploy silently failed and the old process kept serving — this is exactly how the 2026-07 dev outage (see [`docs/ROADMAP.md`](ROADMAP.md), "0. CI/CD bootstrap" incident note) went undetected for two weeks | Render dashboard / deploy hook response |

Dashboards in use today (all manual, no alerts configured):

- **Render** — service metrics, request logs, deploy history.
- **Neon** (Postgres) — connection count, storage, branch/compute activity.
- **MongoDB Atlas** — cluster metrics (`document_versions`, `planning_jobs`).
- **Upstash** (Redis) — command throughput, memory, connection count.
- **CloudAMQP / LavinMQ** — queue depth, consumer count, message rates for
  `ctx.gather.requests` / `ctx.gather.results` (see
  [`docs/contracts/context-engine.md`](contracts/context-engine.md)).

Note: `audit_logs.ip` is **not populated yet** even though `trust proxy` gives the
app a real `req.ip` (see `docs/database-schema.md#audit_logs`) — a future slice
would thread the request IP into the audit-event use-cases before per-IP
brute-force detection is possible from the audit trail alone.

## Error tracking / observability

Sentry (`@sentry/nestjs`) is wired in but **optional and OFF by default** — same
convention as `OPENROUTER_API_KEY`: leave `SENTRY_DSN` unset and `src/instrument.ts`
never calls `Sentry.init()`, so the app boots identically with zero Sentry config
(`start:dev`, unit tests, e2e, smoke all unaffected). `SENTRY_DSN` is now **set on
`development`** (shipped PR #44 — error tracking is live there) but still unset on
staging/production — a deploy-config gap for those environments, not a missing
feature; see the checklist item below and `docs/ROADMAP.md`.

**What's never sent:** request bodies, cookies, query strings and `authorization`/`cookie` headers are removed from every event (`scrubSentryEvent` in `src/instrument.ts`), and body capture is disabled in the HTTP integration. Passwords and reset or verification tokens travel in request bodies, so they must stay out of error reports.

**What's captured** (only via `Sentry.captureException`, manual call sites — no blanket
instrumentation beyond BullMQ's built-in integration):

- Unexpected 500s in `HttpExceptionFilter` (`src/shared/filters/http-exception.filter.ts`)
  — only the `else` branch (non-`HttpException` errors). **4xx `HttpException`s are
  never reported** — they're expected control flow (validation failures, 404s,
  409s, etc.), not incidents.
- Gamification event-handling failures that `GamificationListener`
  (`src/presentation/gamification/gamification.listener.ts`) deliberately swallows so
  a gamification bug can never fail the originating documents/sections request —
  swallowed must not mean invisible.
- Async job failures that never reach the HTTP filter at all: `PlanningProcessor`'s
  handled-failure branch (a job that finishes with `status: 'failed'` and returns
  normally, `src/infrastructure/queue/context/planning.processor.ts`),
  `GatherTimeoutProcessor`'s gather-timeout branch (also returns normally,
  `src/infrastructure/queue/context/gather-timeout.processor.ts`), and the RabbitMQ
  terminal-failure path in `ContextResultsConsumer`
  (`src/infrastructure/amqp/context-results.consumer.ts`) — captured **once**, at the
  compare-and-swap winner, so a losing racer (e.g. a timeout racing a slow failure
  chunk) never double-reports the same job.
- `PlanningProcessor`'s unhandled-rethrow path is **not** manually captured — it's
  picked up automatically by `@sentry/nestjs`'s BullMQ `nestIntegration` (wired via
  `SentryModule.forRoot()` in `src/app.module.ts`), which wraps `process()` and
  captures anything that propagates out of it. A manual capture there would
  double-report.

**Per-environment setup:** set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`,
which otherwise falls back to `NODE_ENV`) as a secret on each deployed environment
that should report to Sentry — same "operator-set config" treatment as
`OPENROUTER_API_KEY`/`COMPOSIO_*`. One Sentry project is used for all environments,
distinguished by the `SENTRY_ENVIRONMENT` tag rather than separate projects.
`SENTRY_TRACES_SAMPLE_RATE` defaults to `0` (errors-only, no performance/tracing
data) and is bounded to `[0, 1]`; `SENTRY_RELEASE` exists in config but has **no CI
wiring yet** — release tracking is deliberately deferred.

**PII note:** error payloads (stack traces, request context) may carry user data.
`@sentry/nestjs` defaults `sendDefaultPii: false` (not overridden here), and this
slice relies on that plus Sentry's own server-side scrubbing rather than
hand-redacting every capture site. Manual `captureException` calls only attach
non-secret identifiers in `extra` (`jobId`, `errorCode`, `userId`, `documentId`) —
never tokens, passwords, or `COMPOSIO_*`/`OPENROUTER_API_KEY`-style secrets.

## Backup & restore

PostgreSQL is primary — see `docs/database-schema.md`. MongoDB holds exactly two
collections (`document_versions`, `planning_jobs`); both are derived/append-mostly
data, not the sole source of truth for anything a user typed into a document (that's
the PG `sections` table).

**PostgreSQL (Neon free tier, dev tier today):**

- Dev Postgres moved from a Render-managed free database to **Neon free tier** in
  2026-09, after the Render one silently **expired** (Render free-plan databases
  live ~30 days) and crash-looped the dev API for weeks — see `docs/ROADMAP.md`,
  "0. CI/CD bootstrap", the 2026-09-14 incident note. Neon does not expire, but
  confirm the current point-in-time-restore retention window for the free plan in
  the Neon dashboard before relying on it — free-tier retention is shorter than
  paid, and treat dev Postgres data as **disposable regardless**: it is reseedable
  via `scripts/seed.ts`, and the 2026-09 incident's data loss makes a full reseed
  part of its recovery. Re-check backup guarantees before staging/production go live.
- Restore-drill outline (do this at least once before production, not for the first
  time during an incident):
  1. Create a Neon branch (or restore point) from the desired recovery point.
  2. Point `POSTGRES_*` at the restored branch's connection details.
  3. Run `npm run migration:show` against it to confirm the migration history
     matches what's expected.
  4. Point a throwaway app instance at it and hit `/health` + a read endpoint
     (`GET /users/me` with a known token) to confirm data integrity.
  5. Record how long the drill took — that's your RTO estimate.

**MongoDB (Atlas M0, dev tier today):**

- **M0 (free tier) has no continuous backup and limited/no automated snapshotting** —
  call this out explicitly to whoever owns the Atlas project. Losing the M0 cluster
  today means losing `document_versions` and `planning_jobs` with no vendor-side
  recovery path.
  - `document_versions` loss is recoverable in the sense that the *current* document
    state still lives in PG (`sections`) — only the historical snapshots are gone.
  - `planning_jobs` loss is not user-data-destructive (jobs are re-submittable) but
    does lose the audit trail of past AI planning runs.
- Before staging/production, move off M0 to a tier with continuous backup, or accept
  and document the gap explicitly in the go-live checklist.

## Deploy security checklist (per environment)

Run through this before the **first** deploy of any new environment (staging,
production), and re-check on every environment's secret rotation:

- [ ] `CORS_ORIGIN` set to the real frontend origin — **never `*`** outside `development`
      (item 27). `*` is the documented dev-only default; see the README env-vars table.
      Boot fails on staging and production if it is `*` or blank.
- [ ] `WS_CORS_ORIGIN` set to the real frontend origin — same rule, same default, same
      boot failure (item 27).
- [ ] `JWT_SECRET` is a unique, random value **at least 32 characters**, different per
      environment (item 26) — enforced at boot by `@MinLength(32)` on
      `EnvironmentVariables.JWT_SECRET` (`src/config/env.validation.ts`); a shorter
      value fails validation and the app won't start. On staging and production, boot
      also fails if it equals the `.env.example` placeholder.
- [ ] All `COMPOSIO_*` vars (`COMPOSIO_API_KEY`, `COMPOSIO_AUTH_CONFIG_IDS`,
      `COMPOSIO_WEBHOOK_SECRET`) and `RABBITMQ_URL` are set **before** the environment's
      first deploy, not added reactively after. The **2026-07 dev outage** is the
      cautionary precedent: missing `COMPOSIO_*` secrets on the `memoflow-dev-api`
      Render service made every deploy from 2026-07-04 fail silently
      (`update_failed`, old process stayed live) for two weeks before anyone noticed
      — see `docs/ROADMAP.md`, "0. CI/CD bootstrap" incident note. `RABBITMQ_URL` is
      optional at the code level (its absence falls back to the synchronous HTTP
      context-engine path) but should still be a deliberate choice per environment,
      not an oversight.
- [ ] The Postgres role the app connects as is **not** `SUPERUSER` and does not own
      the schema's DDL (items 7, 41) — migrations (`npm run migration:run`) should run
      under a separate, more-privileged role at deploy time, while the runtime app
      connects with a least-privilege role (read/write DML on its own tables only).
      **Not yet true for the `development` tier** — Neon (like Render's managed
      Postgres before it) provisions a single owner role by default today, so this
      is currently a gap to close before staging/production, not a solved problem
      to just document.
- [ ] `RESEND_API_KEY`, `EMAIL_FROM` (on a verified sending domain) and `APP_BASE_URL`
      are set — required at boot in staging/production; see "Email identity".
- [ ] `SENTRY_DSN` set if this environment should report errors to Sentry — optional
      (unset keeps Sentry a complete no-op, see "Error tracking / observability"
      above), but a deliberate choice per environment, not an oversight; currently
      set on `development` only — still unset on staging/production.
- [ ] `POSTGRES_SSL=true` with `POSTGRES_SSL_REJECT_UNAUTHORIZED` left at its default
      (`true`) — see "Postgres TLS". Boot fails on staging/production if it is `false`.
- [ ] Swagger is not served: it is on only for `NODE_ENV` `development` and `test`;
      staging, production and any other value serve neither `/docs` nor the OpenAPI JSON.
- [ ] Each tier has its own broker credentials, with queue permissions restricted to
      what it needs — see "Message broker".

## Postgres TLS

With `POSTGRES_SSL=true` the app verifies the database server's certificate and
hostname, in both the runtime connection and the TypeORM CLI data source. Neon
presents a publicly trusted chain, so no setting is needed there.
`POSTGRES_SSL_REJECT_UNAUTHORIZED=false` exists only for a private-CA database on
`development`; boot and migrations fail with that value on staging and production. Any
value other than `true` or `false` (or unset or blank) fails boot, so a typo can't
disable verification.

## Swagger exposure

Swagger UI (`/docs`) and the OpenAPI JSON are served only when `NODE_ENV` is
`development` or `test`. It is an allowlist, so staging, production and any unknown
tier have no API documentation endpoint.

## Message broker

Planning jobs use RabbitMQ (`RABBITMQ_URL`) to talk to the context engine.

- Each tier (development, staging, production) uses its own broker credentials, never
  shared across tiers.
- Queue permissions are restricted to what that tier needs: the API publishes to
  `ctx.gather.requests` and consumes `ctx.gather.results`; nothing broader.
- **Trust boundary:** messages arriving from the broker are treated as coming from the
  context engine. Anyone holding broker credentials can therefore feed planning
  jobs, so those credentials are secrets to be rotated like any other.

Each tier needs its own credentials with those restricted permissions, set through
`RABBITMQ_URL` on that tier's service.

## Audit coverage

Beyond login, logout, password, connector and prompt events, `audit_logs` records:
`template.created`, `template.updated` (with the names of the changed fields, not their
values), `template.published`, `template.unpublished`, `template.deleted`,
`user.disabled`, `user.enabled`, `user.role_changed`, `auth.login_throttled`,
`ai.consent_accepted` (notice version in metadata) and `ai.consent_withdrawn`. For
admin actions the acting admin is the row's user and the target account is in
metadata. Role changes come from `npm run admin:promote`, which records them with no
acting user. Rows hold ids and field names, never template content.

Template edits by non-admins are checked against the stored published state at write
time, so an edit that races an admin publish is refused with `403`.

Reconnecting a connector replaces the stored reference and revokes the previous
Composio account (best effort; a failed revoke is logged and does not fail the
reconnect).

## SSRF note (item 23)

The planning worker's context-gatherer POSTs to `CONTEXT_ENGINE_URL`
(`ContextEngineHttpClient`, used on the legacy synchronous path — see the README's
"Planning jobs" section) when that env var is set. `CONTEXT_ENGINE_URL` is
**operator-set configuration only** — it comes from `ConfigService`/environment,
never from a request body, query param, or any other user-supplied input. There is
no code path where a caller can influence the fetch target. Keep it that way: any
future change that lets a request parameterize an outbound URL (context-engine or
otherwise) needs an allowlist, not just validation.

## Prompt-injection posture (item 39)

Content reaches the model only through `OpenRouterGateway`
(`src/infrastructure/ai/openrouter.gateway.ts`) from
`src/infrastructure/ai/gateway-suggestion-generator.ts` and
`src/infrastructure/context/gateway-llm-planner.ts`.

**Result: layered defenses in place (slice 3); injection risk is reduced, not
eliminated.** Delimiters, redaction and output checks make attacks harder and limit
what a successful one can do, but none of them is a guarantee. Treat all model output
as untrusted data: never execute it or act on it automatically, and always show it to
the user for review before it is applied. Slice 7 revisits this section with live
testing against a real model.

- The use-cases render the active prompt's `system_template` and user template with a
  random per-request nonce, and the adapters forward them unchanged as the `system` and
  `user` messages through the `LlmGateway` port. Document and connector text goes only
  in the user message, inside `<untrusted_{{nonce}}>` tags; system templates accept no
  other placeholder. Admins author the prompts, so they're trusted with the system text.
- Both requests set a `json_schema` `response_format` and the reply is parsed
  with `JSON.parse` into a typed shape; malformed output throws rather than being
  interpreted as instructions. Neither file ever `eval`s or execs the model's output.
  The only time a reply goes back to the model is the gateway's one repair retry, which
  sends the unparsed reply as an `assistant` turn within that same call. The parsed result is returned up to the
  use-case layer and persisted as inert data (`ai_suggestions` rows /
  `planning_jobs.result` in Mongo). Nothing downstream re-feeds stored
  suggestion/plan text into another LLM call unsanitized.
- **Input handling.** Before text reaches the model, secrets are redacted on a best-effort
  basis and look-alikes of the untrusted-data tags are neutralised. Stored originals are
  unchanged; only the copy sent to the model is altered. Redaction is not a substitute
  for keeping secrets out of documents.
- **Retrieval scope.** Planning retrieval (`SectionRetrieverTypeOrm`) takes the user id
  from the job, never from the prompt, and every query joins `documents` on
  `user_id`, so another user's section is never returned, bound document or not. The
  prompt is turned into lexemes by Postgres and passed as bind parameters; the SQL text
  never varies with prompt content. Retrieved text is redacted and fenced like other
  untrusted input, is never written to `planning_jobs` (only `context_used.retrieval`
  metadata is), and `result.sources` is reduced to `{ id, type, title }` with unknown
  citations removed. A retrieval error is logged by error name only and the job
  continues without retrieval.
- **Size limits.** Section text over `AI_MAX_INPUT_CHARS` is rejected with `422` before
  any provider call, planning prompts are capped at 5000 characters (`400`), and
  planning context is cut to the limit.
- **Output validation.** Replies are validated against the expected shape, and a reply
  that echoes the prompt is rejected: `502` for suggestions, a failed job for planning.
- **Fixed client errors.** Clients see fixed error messages. Provider detail goes only to
  logs and Sentry, and logs carry no document or prompt content.
- **Bounded retries.** `OPENROUTER_MAX_RETRIES` allows a few conservative retries that
  share a single deadline with the call, so retries can't extend a request indefinitely.

## AI usage quota

Each provider attempt first reserves one unit from a per-user and a global daily counter in Redis
(`AI_USER_DAILY_LIMIT`, default 10; `AI_GLOBAL_DAILY_LIMIT`, default 40; UTC day). It is a cost
control, applied before every attempt, so retries and failed attempts count. Over the limit the routes
return 429 with `Retry-After`, and a planning job fails with `AI_QUOTA_EXCEEDED`. If Redis is
unavailable the quota blocks AI use (503 on the routes, `AI_QUOTA_UNAVAILABLE` on a job). Counter keys
hold a hash of the user id. Suggestion cache hits use no quota; cache errors fall through to the
provider. The planning worker re-checks that the user is still active (`USER_INACTIVE`). Planning
`connectors` must be the user's active providers.

## AI consent

AI use needs recorded consent to a specific notice version (`users.ai_consent_at`,
`users.ai_consent_version`; draft text in [`ai-data-notice.md`](ai-data-notice.md), version
`AI_NOTICE_VERSION` in `src/domain/ai/ai-consent.ts`). `AiConsentGuard` on
`POST /sections/:sectionId/suggestions` and `POST /planning-jobs` returns 403 with
`error: 'AI_CONSENT_REQUIRED'` when consent is missing or for another version; it reads the
user `JwtStrategy` loads on each request, so withdrawal takes effect immediately, and it
applies to admins too. Accepting a version other than the current one is a 409. The
planning worker re-checks consent before gathering or calling a provider and fails the job
with `AI_CONSENT_REQUIRED` if it is gone. Accept and withdraw are audited as
`ai.consent_accepted` (with the version) and `ai.consent_withdrawn`. The consent gate is
separate from the quota and does not replace the email-verification gate.

## Rate-limiting note

`src/shared/throttler/throttler.module.ts` registers a global default throttle
(`THROTTLE_TTL`/`THROTTLE_LIMIT`, defaults 100 req/60s) via `ThrottlerGuard` as an
`APP_GUARD`, with tighter per-route `@Throttle` caps on auth (login/register) and AI
endpoints (suggestion generation, planning-job submission). Storage is the
throttler's **default in-memory store** — deliberately not Redis-backed, so a Redis
blip can't take rate limiting (and therefore the whole API, since the guard runs on
every request) down with it. The tradeoff: counters are **per-instance, not shared**
across replicas. Fine for the current single-instance deployment; a Redis-backed
shared store is a future scaling step, and should only be adopted once that store is
made **fail-open** (a Redis outage must not block requests). Throttling is skipped
under `NODE_ENV=test` so e2e suites don't trip it.

## Role model

- Two roles, stored in `users.role`: `user` (default for every registration) and `admin`.
  Registration never grants `admin`.
- Admins can publish templates; edit, unpublish or delete any template, including
  system templates; view any user via `GET /users/:id` (including `disabled_at`) and
  any template's `created_by`; and disable/enable accounts
  (`POST /users/:id/disable`, `/enable`; an admin can't disable their own account); and
  list, create and activate AI prompts (`/admin/prompts`).
- Non-admins can create, edit and delete their own unpublished templates. They can't
  publish, or edit a template once it's published, but can delete their own.
- The first admin is created out-of-band: `ADMIN_EMAIL=<email> npm run admin:promote`
  promotes an existing user and re-enables the account if it's disabled (needs
  `POSTGRES_*`; idempotent). Further admins are promoted the same way, and it's also the
  recovery path if every admin account is disabled.
- A disabled account (`users.disabled_at` set) is rejected at login, on JWT
  validation, and on WebSocket connection, and its open sockets are dropped when it's
  disabled. Disabled accounts are left off the leaderboard. Re-enabling clears the flag.
  Dropping open sockets is per-process, so running more than one instance would need a
  socket.io adapter; `subscribe` also re-checks the account.
- Seeded dev credentials (`npm run db:seed`) are for local development only.

## Email identity

Verification and password-reset emails are sent through Resend.

- **Normalization:** email addresses are trimmed and lowercased on register, login and
  forgot-password, so one mailbox maps to one account.
- **No enumeration:** `POST /auth/register`, `/auth/forgot-password` and
  `/auth/resend-verification` always answer `202` with a fixed body; the outcome is
  only visible in the mailbox. `reset-password` and `verify-email` fail with one
  generic `400 Invalid or expired token`.
- **Tokens:** 256-bit random values; only the SHA-256 hash is stored
  (`auth_tokens`), and a token is single-use. Password-reset tokens expire after
  1 hour, verification tokens after 24 hours.
- **Issue limit:** at most one token per type per account every 5 minutes; further
  requests inside the window send nothing.
- **Links:** built from `APP_BASE_URL` (configuration only, never request data), with
  the token in the URL fragment so it stays out of server logs.
- **Sessions:** a password reset or change bumps the account's token version, so
  existing JWTs are rejected and open WebSocket connections are dropped;
  `change-password` returns a fresh token.
- **Verification gate:** with `EMAIL_VERIFICATION_REQUIRED=true`, unverified accounts
  get `403 Email not verified` on AI suggestion, connector and planning-job routes.

## Session and login hardening

- **Logout:** `POST /auth/logout` (JWT) bumps the account's token version, so every
  access token issued so far stops working, not just the caller's. Open WebSocket
  connections are closed. Audited as `auth.logout`.
- **Socket lifetime:** a WebSocket is disconnected when its JWT expires; the client
  reconnects with a fresh token. A token without an `exp` claim is refused.
- **Login throttle:** besides the per-IP limit, `POST /auth/login` allows 10 attempts per
  normalized email per 15 minutes, then answers `429` with `Retry-After`. A successful
  login or password reset clears the count. The counter lives in Redis under a hashed key, so no address
  is stored there.
- **Login timing:** an unknown email costs the same password check as a wrong password.
- **Password length:** bcrypt ignores input past 72 bytes, so register, reset and
  change-password reject longer passwords with `400`. The limit counts bytes, not
  characters. Login doesn't enforce it, so existing accounts can still sign in.
- **Boot checks:** see the deploy checklist for the refused CORS and `JWT_SECRET` values.

Mail configuration per tier:

| tier | `RESEND_API_KEY` / `EMAIL_FROM` / `APP_BASE_URL` | `EMAIL_VERIFICATION_REQUIRED` |
| --- | --- | --- |
| development / test | optional; with no key nothing is sent | `false` by default |
| staging / production | all three required; boot fails without them | forced on; boot fails if set to `false` |

Without a verified sending domain, Resend's test sender (`onboarding@resend.dev`)
delivers only to the Resend account owner's address. Verification therefore stays off
on development, and a verified sending domain (with `EMAIL_FROM` on it) is required
before staging or production can send to real users.

## Related docs

- [`docs/database-schema.md`](database-schema.md) — `audit_logs` table shape, indexes.
- [`docs/ROADMAP.md`](ROADMAP.md) — security-hardening slices and current status.
- [`docs/contracts/context-engine.md`](contracts/context-engine.md) — RabbitMQ
  transport contract (relevant to the `RABBITMQ_URL` deploy-checklist item above).
- [README.md](../README.md) — environment variables table, `CORS_ORIGIN` /
  `WS_CORS_ORIGIN` / `JWT_SECRET` defaults.
- [`docs/ai-data-notice.md`](ai-data-notice.md) — draft AI data notice (needs legal review).
- [`docs/privacy-data-inventory.md`](privacy-data-inventory.md) — what personal data
  is stored and which third parties receive it (internal fact base, not a notice).
