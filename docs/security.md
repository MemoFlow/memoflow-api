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
convention as `ANTHROPIC_API_KEY`: leave `SENTRY_DSN` unset and `src/instrument.ts`
never calls `Sentry.init()`, so the app boots identically with zero Sentry config
(`start:dev`, unit tests, e2e, smoke all unaffected). `SENTRY_DSN` is now **set on
`development`** (shipped PR #44 — error tracking is live there) but still unset on
staging/production — a deploy-config gap for those environments, not a missing
feature; see the checklist item below and `docs/ROADMAP.md`.

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
`ANTHROPIC_API_KEY`/`COMPOSIO_*`. One Sentry project is used for all environments,
distinguished by the `SENTRY_ENVIRONMENT` tag rather than separate projects.
`SENTRY_TRACES_SAMPLE_RATE` defaults to `0` (errors-only, no performance/tracing
data) and is bounded to `[0, 1]`; `SENTRY_RELEASE` exists in config but has **no CI
wiring yet** — release tracking is deliberately deferred.

**PII note:** error payloads (stack traces, request context) may carry user data.
`@sentry/nestjs` defaults `sendDefaultPii: false` (not overridden here), and this
slice relies on that plus Sentry's own server-side scrubbing rather than
hand-redacting every capture site. Manual `captureException` calls only attach
non-secret identifiers in `extra` (`jobId`, `errorCode`, `userId`, `documentId`) —
never tokens, passwords, or `COMPOSIO_*`/`ANTHROPIC_API_KEY`-style secrets.

## Backup & restore

PostgreSQL is primary — see `docs/database-schema.md`. MongoDB holds exactly two
collections (`document_versions`, `planning_jobs`); both are derived/append-mostly
data, not the sole source of truth for anything a user typed into a document (that's
the PG `sections` table).

**PostgreSQL (Render managed, dev tier today):**

- Render's managed Postgres includes automatic daily backups and point-in-time
  recovery (PITR) on paid plans; confirm the plan tier before relying on PITR — the
  dev database is currently the **free** plan, which has materially weaker backup
  guarantees than a paid plan. Re-check this before staging/production go live.
- Restore-drill outline (do this at least once before production, not for the first
  time during an incident):
  1. Spin up a scratch Render Postgres instance (or restore-in-place if the plan
     supports it).
  2. Restore the latest backup / PITR snapshot into it.
  3. Run `npm run migration:show` against the restored instance to confirm the
     migration history matches what's expected.
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
- [ ] `WS_CORS_ORIGIN` set to the real frontend origin — same rule, same default (item 27).
- [ ] `JWT_SECRET` is a unique, random value **at least 32 characters**, different per
      environment (item 26) — enforced at boot by `@MinLength(32)` on
      `EnvironmentVariables.JWT_SECRET` (`src/config/env.validation.ts`); a shorter
      value fails validation and the app won't start.
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
      **Not yet true for the `development` tier** — Render's managed Postgres
      provisions a single owner role today, so this is currently a gap to close
      before staging/production, not a solved problem to just document.
- [ ] `SENTRY_DSN` set if this environment should report errors to Sentry — optional
      (unset keeps Sentry a complete no-op, see "Error tracking / observability"
      above), but a deliberate choice per environment, not an oversight; currently
      set on `development` only — still unset on staging/production.

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

Spot-checked `src/infrastructure/ai/anthropic-suggestion-generator.ts` and
`src/infrastructure/context/anthropic-llm-planner.ts` (the only two call sites that
send content to the Anthropic API).

**Result: pass.**

- Both call sites build a single `messages: [{ role: 'user', content: ... }]` array —
  neither uses the SDK's `system` parameter at all, so there's no system prompt for
  user-supplied content to be concatenated into. `AnthropicSuggestionGenerator.generate`
  sends `input.promptTemplate` verbatim as the user message; `AnthropicLlmPlanner.plan`
  renders the prompt + gathered context into one string (`renderPrompt`) and sends
  that, also as the user message.
- Both responses are constrained with `output_config.format: json_schema` and parsed
  with `JSON.parse` into a typed shape (`SuggestionOutputShape` /
  `PlanningOutputShape`); malformed output throws rather than being interpreted as
  instructions. Neither file ever `eval`s, execs, or templates the model's output
  back into a prompt — the parsed result is returned up to the use-case layer and
  persisted as inert data (`ai_suggestions` rows / `planning_jobs.result` in Mongo).
  Nothing downstream re-feeds stored suggestion/plan text into another LLM call
  unsanitized.

No code change made or needed for this item.

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

## Related docs

- [`docs/database-schema.md`](database-schema.md) — `audit_logs` table shape, indexes.
- [`docs/ROADMAP.md`](ROADMAP.md) — security-hardening slices and current status.
- [`docs/contracts/context-engine.md`](contracts/context-engine.md) — RabbitMQ
  transport contract (relevant to the `RABBITMQ_URL` deploy-checklist item above).
- [README.md](../README.md) — environment variables table, `CORS_ORIGIN` /
  `WS_CORS_ORIGIN` / `JWT_SECRET` defaults.
