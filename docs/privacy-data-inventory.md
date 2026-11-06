# MemoFlow — Privacy Data Inventory

> Internal fact base for a future privacy notice. It is **not** the notice and **not**
> legal advice. It records what the code at this commit stores and which services
> receive it.

## 1. Purpose and scope

- Lists the personal and user-authored data MemoFlow stores, where it lives, and which
  third-party services receive it.
- Schema detail is **not** repeated here: `docs/database-schema.md` is the source of
  truth for columns, indexes and delete behaviour. This file summarizes and links.
- Describes the API repository only. Hosting facts: only the **dev** tier is deployed
  today; staging and production hosting are undecided (see `README.md`, `render.yaml`).

## 2. Data stored

| Category | Fields | Where | Purpose |
| --- | --- | --- | --- |
| Account | email, password hash, display name, role | PG `users` | Sign-in and identity. Registration takes `email`, `password`, `display_name` (`src/presentation/users/dto/register-user.dto.ts`). Password is stored hashed only. |
| Activity profile | `last_active_at`, `xp`, `level` | PG `users` | Leaderboard and "last seen". |
| User content | document title/type/status/style; section title and text; user-created templates (title, style, template sections); which template a document used | PG `documents`, `sections`, `templates`, `template_sections`, `document_templates` | The product itself. `sections.content` is free text and may contain anything the user types. |
| Version history | full section snapshots, optional user label, user and document ids | Mongo `document_versions` | Restore points. Copies section text. |
| AI usage | prompt, selected connectors, context gathered from connected apps, result, error text, user/document/section ids; per-suggestion original and suggested text, feature type, status | Mongo `planning_jobs` (incl. `context_used`, `data_chunks`); PG `ai_suggestions` | Planning jobs and suggestions. `context_used` / `data_chunks` can hold content pulled from the user's connected apps. |
| Connected apps | provider name, Composio connected-account id, status, connect time | PG `connector_connections` | Reference to a connection held at Composio. No provider tokens here. |
| Gamification | milestones awarded, mission progress | PG `milestones`, `mission_progress` | XP and daily missions. |
| Audit trail | user id, action, small metadata, `ip` (unused), time | PG `audit_logs` | Security events: `auth.login`, `auth.login_failed`, `connector.revoked`, `suggestion.reviewed` (`src/domain/audit/audit-events.ts`). A failed login stores the **typed email** in metadata, even when it matches no account (`src/application/auth/login-user.use-case.ts`). |

Tables with no user data (verified against the migrations and `scripts/seed.ts`):

| Table | Reason |
| --- | --- |
| `prompts` | System prompt templates, seeded by `scripts/seed.ts`; no public controller. |
| `daily_missions` | System-defined mission catalogue (code, description, reward, criteria). |

All other tables and both Mongo collections in the schema doc appear above.
System templates (`templates.created_by` null) are not user data; user-created ones are.

Other places data appears: HTTP request logs record method, URL, status and duration
(`src/shared/interceptors/logging.interceptor.ts`). The URL is logged as received, so
query-string values are logged; see the gap in section 5. The JWT payload carries user
id and email (`login-user.use-case.ts`).

## 3. Third parties

Tier column: **dev** is the only deployed tier. Staging and production hosting are
undecided, so nothing below is claimed for them beyond "to be decided".

| Service | Data received | Why | Tiers |
| --- | --- | --- | --- |
| Render | All API traffic (requests, responses, logs, runtime env secrets) | Hosts the web service (`render.yaml`) | dev; others undecided |
| Neon | The whole PG dataset (section 2, PG rows) | Dev Postgres (`docs/security.md`, "Backup & restore") | dev; others undecided |
| MongoDB Atlas | `document_versions`, `planning_jobs` | Dev MongoDB (`MONGODB_URI`) | dev; others undecided |
| Upstash | BullMQ job payloads with ids only: `{ jobId, userId }` (`src/infrastructure/queue/context/planning.processor.ts`), `{ jobId }` (`gather-timeout.processor.ts`) | Dev Redis for the job queue | dev; others undecided |
| CloudAMQP (RabbitMQ) | Gather request: job id, user id, prompt, connectors (provider, MCP URL, Composio account id) (`src/infrastructure/amqp/rabbit-context-request.publisher.ts`); result chunks returned by n8n (`docs/contracts/context-engine.md`) | Context-engine transport. Optional: only when `RABBITMQ_URL` is set. Without it the legacy synchronous path runs and nothing is published. | dev (if configured); others undecided |
| n8n context engine | Receives the gather request above; returns content gathered from the user's connected apps | Fetches connector context for planning jobs | dev; others undecided |
| Composio | User id (at `initiateConnection`) from this API. Composio also holds the user's OAuth grants and provider tokens, which reach it through the provider flow, not from this API | OAuth vault and MCP host for connectors (`src/infrastructure/connectors/composio.gateway.ts`). Connected accounts can be deleted there. | Where `COMPOSIO_*` is set; others undecided |
| Anthropic | Planner: planning prompt plus JSON context (`src/infrastructure/context/anthropic-llm-planner.ts`). Suggestions: the rendered prompt template **including the section text** (`src/application/ai/generate-suggestion.use-case.ts` substitutes `{{content}}` with `section.content`; sent by `src/infrastructure/ai/anthropic-suggestion-generator.ts`). | LLM calls. `ANTHROPIC_API_KEY` is optional; no calls are made where it is unset. | Dev: unset when last recorded (2026-09-14), confirm before relying on this; others undecided |
| Sentry | Error events with stack traces: unexpected 500s from `HttpExceptionFilter`, the `PlanningProcessor` rethrow path via BullMQ auto-capture, and the manual `captureException` sites listed in `docs/security.md`. Some carry ids (`jobId`, `userId`, `errorCode`) in `extra`. Request metadata attached to events can include the URL and its query string | Error tracking; optional, off unless `SENTRY_DSN` is set. `src/instrument.ts` does not set `sendDefaultPii`; the installed SDK then defaults to no user info, no cookies, no request bodies. Exception messages could still contain user data. | dev (`SENTRY_DSN` set, per `docs/security.md`); others unset |

## 4. Not collected

| Item | Basis |
| --- | --- |
| Provider OAuth tokens (Trello, Notion, GitHub, ...) | Held by Composio; this API stores only `composio_account_id` and `status` (`src/infrastructure/persistence/connectors/connector-connection.orm-entity.ts`). |
| Plaintext passwords | Only `password_hash` is stored and it is never returned in API responses (`src/infrastructure/persistence/users/user.orm-entity.ts`, schema doc). |
| IP addresses | `audit_logs.ip` exists but is not populated (`src/infrastructure/persistence/audit/audit-log.orm-entity.ts`; schema doc). Client IPs are used in memory for rate limiting and not persisted (`src/main.ts`, `src/shared/throttler/throttler.module.ts`). Hosting and proxy layers (Render) may still see IPs. |

## 5. Open gaps

| Gap | Evidence |
| --- | --- |
| No self-service account deletion | `@Delete` routes exist only for templates, sections, documents and connectors (`src/presentation/templates/templates.controller.ts`, `documents/sections.controller.ts`, `documents/documents.controller.ts`, `connectors/connectors.controller.ts`); none under `src/presentation/users/`. |
| No consent record | No consent or terms-acceptance column in `users` or any table (`docs/database-schema.md`). |
| No retention rules | No TTL index on Mongo (`src/infrastructure/persistence/context/planning-job.schema.ts`, `document-versions/document-version.schema.ts` have none other than the unique `(document_id, version)` index) and no scheduled data-cleanup job in `src`. Audit rows, versions and jobs are kept indefinitely. |
| Data outliving a deleted user | If a `users` row were removed by hand: PG `documents`, `sections`, `ai_suggestions`, `milestones`, `mission_progress` cascade; `templates.created_by` and `audit_logs.user_id` become null (templates and the trail, including typed emails from failed logins, remain). **Not removed:** `connector_connections` (no FK to `users`, `src/infrastructure/persistence/migrations/1783200000000-CreateConnectorConnections.ts`) and the matching Composio account; Mongo `document_versions` and `planning_jobs` (cross-DB uuid, no FK, `docs/database-schema.md`). Backups and third-party copies (section 3) are also outside any delete. |
| Failed-login emails are kept, for wrong passwords and unknown accounts alike | `login-user.use-case.ts`; no expiry (see retention). |
| Request URLs are logged as received | `logging.interceptor.ts` logs `request.url`, which includes any query string. Which endpoints take user data in query strings was not audited. |

## 6. Upkeep

Update this file in the same PR whenever a change affects it: a new or altered table,
collection or user-data column; a new, removed or re-tiered third party (new
dependency or `render.yaml` env var); or a change to what is sent to an external
service. Keep `docs/database-schema.md` authoritative for schema and link to it.
