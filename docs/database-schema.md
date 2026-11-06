# MemoFlow — Database Schema (source of truth)

This document is the authoritative data design for MemoFlow (transcribed from the
AcademiX schema diagram). Every new module, entity, index, and migration must match
what is described here. If the design needs to change, update this file in the same
PR as the code change.

## Storage strategy

- **PostgreSQL is the primary database.** Everything relational lives here: users,
  auth, documents, sections, AI suggestions, prompts, connector connections, gamification,
  the template system, onboarding answers and lead scores, and the security audit log. Accessed via TypeORM with
  migrations only (`synchronize: false`, always).
- **MongoDB is the specialist store.** Only two collections:
  `document_versions` (immutable snapshots) and `planning_jobs` (AI context engine
  jobs). Accessed via Mongoose.

### Cross-database references

Mongo documents reference PostgreSQL rows by plain uuid (`document_id`, `user_id`).
There is **no foreign key** across databases: the application (use-case layer) must
validate that the referenced PG row exists before writing to Mongo. The
`api-reviewer` agent checks for this.

---

## PostgreSQL

### Core

#### `users`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| email | varchar | unique, **indexed**; stored trimmed and lowercase (`normalizeEmail`), enforced by `CHK_users_email_lowercase` (`email = lower(email)`) |
| password_hash | varchar | never serialized in API responses |
| display_name | varchar | |
| role | varchar | `user` (default) or `admin`, enforced by `CHK_users_role`; promote via `npm run admin:promote` |
| xp | int | **indexed** (leaderboards) |
| level | int | |
| last_active_at | timestamptz | |
| disabled_at | timestamptz | nullable; set while the account is disabled (login, JWT and WebSocket auth reject it); exposed only to admin viewers |
| created_at | timestamptz | default `now()`; accounts older than this column carry the time it was added |
| email_verified_at | timestamptz | nullable; null until the address is verified (set by email verification or a completed password reset). Existing rows were backfilled to the migration time. Gates AI, connector and planning routes when `EMAIL_VERIFICATION_REQUIRED` is on |
| token_version | int | NOT NULL, default 0; embedded in the JWT as `tv` and bumped on password reset/change — a token (or WebSocket) whose `tv` differs from this value is rejected |

#### `auth_tokens`
Single-use, expiring tokens for password reset and email verification. Only the
SHA-256 hex of the token is stored (the raw value exists only in the emailed link);
no API response ever includes this table.

| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **ON DELETE CASCADE**, **indexed** |
| type | varchar | `password_reset` or `email_verification`, enforced by `CHK_auth_tokens_type` |
| token_hash | varchar | SHA-256 hex of the raw token, **unique** |
| expires_at | timestamptz | reset: 1 hour after issue; verification: 24 hours |
| used_at | timestamptz | nullable; set when consumed (one atomic conditional update) |
| created_at | timestamptz | |

Composite index **(user_id, type, created_at)** — `IDX_auth_tokens_user_type_created` —
serves the per-account issue limit (no new token of a type within 5 minutes of the
previous one).

#### `documents`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, ON DELETE CASCADE, **indexed** |
| title | varchar | |
| doc_type | varchar | |
| status | varchar | |
| style_config | jsonb | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `sections`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| document_id | uuid | FK → documents, ON DELETE CASCADE, **indexed** |
| title | varchar | |
| content | text | |
| order | int | see composite index below |
| status | varchar | |
| word_count | int | server-computed, never client-set |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Composite index **(document_id, order)** — `IDX_sections_document_order` — satisfies
"ordered fetch per document"; `document_id` also has its own plain index (FK lookup /
existence checks).

#### `ai_suggestions`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| section_id | uuid | FK → sections, ON DELETE CASCADE, **indexed** |
| user_id | uuid | FK → users, ON DELETE CASCADE, **indexed** |
| feature_type | varchar | |
| original_text | text | |
| suggested_text | text | |
| status | varchar | pending / accepted / rejected |
| prompt_version | varchar | |
| model | varchar? | **nullable** — the model that served the call; null for rows created before models were recorded |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Plain indexes on `section_id` and `user_id` are a deliberate addition beyond the
original design (landed with roadmap item 5): `section_id` is the FK lookup path for
every suggestions-list/generate call; `user_id` is on the FK today and a natural
future "my suggestions" query path.

#### `prompts`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| feature_type | varchar | `suggestion` / `rewrite` / `summarize` / `expand` / `planning` |
| version | varchar | |
| system_template | text | system message template |
| template | text | user message template |
| user_invocable | boolean | default `false`; whether a client may run this type via `POST /sections/:sectionId/suggestions` (true for `suggestion`, `rewrite`, `summarize`, `expand`; false for `planning`) |
| is_active | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Indexes: unique **(feature_type, version)** (`UQ_prompts_feature_type_version`) and a
partial unique index on `feature_type` `WHERE is_active = true`
(`UQ_prompts_active_feature_type`), which guarantees at most one active prompt per
feature type and serves the active-prompt lookup (`findActiveByFeatureType`). The
earlier plain `is_active` index was dropped.

The v2 prompts for all five feature types ship in the `PromptSystem` migration and are
the active ones; they are not seeded by `scripts/seed.ts`. Admins manage prompts through
`GET /admin/prompts` (optional `feature_type` filter), `POST /admin/prompts` (creates an
**inactive** version) and `POST /admin/prompts/:id/activate` (makes it the active one
for its type), all admin-only. Create and activate are audited as `prompt.created` and
`prompt.activated`.

#### `connector_connections`
No provider tokens are stored here — **Composio is the token vault**; this API keeps
only a connection reference. See `docs/plans/2026-07-04-connectors-composio.md` for
the OAuth flow this table supports.

| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **indexed** |
| provider | varchar | **indexed** (e.g. trello, notion, github) |
| composio_account_id | varchar | Composio connected-account reference; nullable until initiated; **indexed** (webhook lookup) |
| status | varchar | **indexed** (initiated / active / revoked / failed) |
| connected_at | timestamptz | nullable — set when the connection goes active |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique composite index on **(user_id, provider)** — one connection per user per provider.

#### `audit_logs`
Write-only internal sink for security-relevant events (security-hardening plan,
slice 5) — no public controller, `AuditLog` is never serialized into an API
response. Populated by the single `AuditListener` consuming domain events emitted
by other features (auth login/login-failed, connector revoke, suggestion review, prompt create/activate)
via `EventEmitter2`, same swallow-and-log pattern as `GamificationListener`.

| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **ON DELETE SET NULL** (nullable — the trail must outlive a deleted user, same pattern as `templates.created_by`; also null for a failed login against an unknown email) |
| action | varchar | `auth.login` / `auth.login_failed` / `auth.password_reset_requested` / `auth.password_reset_completed` / `auth.password_changed` / `auth.email_verified` / `connector.revoked` / `suggestion.reviewed` / `prompt.created` / `prompt.activated` |
| metadata | jsonb | small contextual payload, e.g. `{ email }` on a failed login, `{ connectionId, provider }` on revoke, `{ suggestionId, decision }` on review, `{ promptId, featureType, version }` on prompt create/activate |
| ip | varchar | nullable — not yet populated (would require threading the request IP through use-case inputs); reserved for a future slice |
| created_at | timestamptz | |

Composite index **(user_id, created_at DESC)** — `IDX_audit_logs_user_created` —
covers "events for a user, newest first" (db-mentor's recommendation); no separate
plain `user_id` index (would be redundant with the composite's leading column).

### Leads

Onboarding answers and the stored lead score (`docs/contracts/lead-scoring.md`). The
score is written only by `RecalculateLeadScoreUseCase`, on onboarding submit, paywall
signal and connector status change. It is not refreshed as time passes. All three
tables cascade-delete with their user. The migration also backfills a `lead_scores` row
(score 3, rule `connected_tool`) for users who already have an `active` connector.

#### `onboarding_profiles`
One row per user, created by the first `PUT /onboarding/me`. No row means not submitted.

| column | type | notes |
| --- | --- | --- |
| user_id | uuid | PK, FK → users, **ON DELETE CASCADE** |
| persona | varchar | enum values: see the contract |
| deliverable_type | varchar | |
| due_date | date | |
| academic_level | varchar | |
| school_name | varchar(120) | nullable, free text |
| work_tools | text[] | may be empty |
| blockers | text[] | |
| acquisition_channel | varchar | |
| marketing_opt_in | boolean | default false |
| marketing_opt_in_at | timestamptz | NOT NULL; set on first submit, then only when the value changes |
| submitted_at | timestamptz | latest submit |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `lead_signals`
Behaviour reported by the frontend. Client-reported, so treat as a heuristic.

| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **ON DELETE CASCADE** |
| type | varchar | `export_paywall_hit` |
| first_seen_at | timestamptz | |
| last_seen_at | timestamptz | |
| occurrences | int | default 1 |

Unique **(user_id, type)** — also covers lookups by user.

#### `lead_scores`
Current score per user. Admin-only: never serialized on a user route. No row reads as
score 0, tier `cold`.

| column | type | notes |
| --- | --- | --- |
| user_id | uuid | PK, FK → users, **ON DELETE CASCADE** |
| score | int | **indexed** |
| tier | varchar | **indexed**; CHECK in `hot` / `warm` / `cold` |
| breakdown | jsonb | `[{ rule, points }]` for rules that fired |
| computed_at | timestamptz | a write never replaces a newer value |

### Gamification

#### `milestones`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **ON DELETE CASCADE**, **indexed** |
| document_id | uuid | FK → documents, **ON DELETE CASCADE**, **indexed** |
| milestone_type | varchar | |
| xp_awarded | int | |
| created_at | timestamptz | |

Unique composite index **(user_id, document_id, milestone_type)** —
`IDX_milestones_user_document_type` — deliberate addition beyond the original
design: it's the idempotent-award guard `MilestoneTypeOrmRepository.awardOnce`
relies on (`INSERT ... ON CONFLICT DO NOTHING RETURNING *`), so a double
`document.created`/`section.created`/`section.updated` event can never award the
same milestone twice for the same document.

#### `daily_missions`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| code | varchar | |
| description | varchar | |
| xp_reward | int | |
| criteria | jsonb | `{ event, target }` — `event` matches a documents domain event name (e.g. `section.updated`), `target` is the count of that event required to complete the mission |
| active_date | date | **indexed** |
| created_at | timestamptz | |

#### `mission_progress`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users, **ON DELETE CASCADE**, **indexed** |
| mission_id | uuid | FK → daily_missions, **ON DELETE CASCADE**, **indexed** |
| progress | int | |
| completed | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique composite index **(user_id, mission_id)** — `IDX_mission_progress_user_mission`
— deliberate addition beyond the original design: exactly one progress row per
(user, mission), so `MissionProgressTypeOrmRepository.incrementAtomic` can upsert
against it (`ON CONFLICT DO NOTHING`) and then run a single guarded
`UPDATE ... WHERE ... AND completed = false RETURNING *`, making the progress
increment and the completion flip race-safe without a read-modify-write.

`users.xp`/`users.level` are updated atomically by `UserRepository.incrementXp` —
a single `UPDATE ... RETURNING` that computes both columns in one statement
(`level = FLOOR(xp / 100) + 1`, 100 XP per level, level 1 at 0 XP). No schema
change: both columns already exist on `users` (see Core above; `xp` is indexed
for the leaderboard).

### Templates

#### `templates`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| title | varchar | |
| doc_type | varchar | **indexed** |
| scope | varchar | **indexed** |
| created_by | uuid | FK → users, nullable (system templates), **ON DELETE SET NULL** — a deleted user's templates become system templates rather than being deleted |
| style_config | jsonb | |
| is_published | boolean | **indexed** |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `template_sections`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| template_id | uuid | FK → templates, **ON DELETE CASCADE**, **indexed** |
| title | varchar | deliberate addition beyond the original design — sections created from a template need headings |
| order | int | see composite index below |
| word_count_min | int | |
| word_count_max | int | |
| is_required | boolean | |

Composite index **(template_id, order)** — `IDX_template_sections_template_order` —
satisfies "ordered fetch per template"; `template_id` also has its own plain index
(FK lookup / existence checks).

#### `document_templates`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| document_id | uuid | FK → documents, **ON DELETE CASCADE**, **indexed** |
| template_id | uuid | FK → templates, **ON DELETE CASCADE**, **indexed** |
| applied_at | timestamptz | |
| customised | boolean | |

---

## MongoDB

### `document_versions`
Immutable snapshots of a document's sections at save time.

| field | type | notes |
| --- | --- | --- |
| _id | ObjectId | |
| document_id | uuid (string) | **indexed** — references PG `documents.id`; also part of the unique compound index below |
| user_id | uuid (string) | **indexed** — references PG `users.id` |
| version | int | also part of the unique compound index below |
| label | string? | optional user label |
| sections_snapshot | array | embedded full section contents: `[{ title, content, order, status, word_count }]` |
| saved_at | date | **indexed** |

**Unique compound index (document_id, version).** Deliberate addition beyond the
original design: closes the concurrent-save version race where two saves for the
same document both compute the same `maxVersion + 1`. The Mongoose repository's
`create()` catches the resulting `E11000` duplicate-key error and retries once with
a freshly recomputed version before giving up.

**Restore semantics:** `POST /documents/:documentId/versions/:versionId/restore`
replaces the document's current PostgreSQL `sections` rows atomically (delete +
reinsert, single transaction, via `SectionRepository.replaceAll`) with the
snapshot's `order`/`status`/`word_count` as stored. Restoring writes nothing to
Mongo — versions are immutable and restoring doesn't create a new one.

### `planning_jobs`
Async AI context-engine jobs (outline/suggestion generation using connector context).

**Implementation status:** the *Context module async backbone* item (BullMQ queue +
`planning_jobs` persistence, see `docs/ROADMAP.md`) landed a **subset skeleton** of
this collection first: `user_id`, `status`, `prompt`, `connectors`, `result`,
`error_code`/`error_message`, and the timestamp fields. Roadmap item 5 (AI layer) has
now landed the rest: `prompt_version` and `context_used` are recorded by
`ProcessPlanningJobUseCase` from the active `planning` prompt and the
context-gatherer's output once a job runs (both stay `null` until then), and
`document_id`/`section_id` are validated and bound at submission time —
`SubmitPlanningJobUseCase` checks the caller owns the referenced PG `document` (and
that a given `section` belongs to it) before writing either into Mongo, 404ing
uniformly on any mismatch. Both stay `null` when the caller submits a job without a
binding.

**RabbitMQ context-engine transport** (`docs/contracts/context-engine.md`, API-side
implemented flag-gated by `RABBITMQ_URL`) added `gathering`/`planning` to `status` and
two chunk-accumulation fields, `chunk_sequences`/`data_chunks`:

- `status` gains `gathering` (request published, awaiting `ctx.gather.results`) and
  `planning` (terminal `completed` chunk received, LLM planner running) — the async
  queue-transport path moves `pending -> gathering -> planning ->
  completed/failed`. `running` is **kept**, not dropped: it remains the status used by
  the legacy synchronous HTTP/stub path (`ProcessPlanningJobUseCase`'s in-process
  gather+plan, still the active path when `RABBITMQ_URL` is unset) — that path never
  sets `gathering`/`planning`.
- `chunk_sequences`/`data_chunks` accumulate the `ctx.gather.results` stream durably so
  a terminal `completed` chunk can assemble the full context without replaying the
  RabbitMQ stream. **Idempotency:** each incoming chunk's `sequence` is pushed to
  `chunk_sequences` via an atomic `chunk_sequences: { $ne: sequence }` filter on the
  update — a redelivered/duplicate `(job_id, sequence)` is rejected by that filter
  instead of double-appended to `data_chunks`, matching the contract's
  idempotent-by-`(job_id, sequence)` rule (§3). Both fields are `[]` for jobs that
  never went through the queue-transport path.

| field | type | notes |
| --- | --- | --- |
| _id | ObjectId | |
| user_id | uuid (string) | **indexed** — references PG `users.id` |
| document_id | uuid (string)? | **nullable, indexed** — references PG `documents.id`; validated (caller-owned) and bound at submission time (item 5) |
| section_id | uuid (string)? | **nullable** — references PG `sections.id`; validated (belongs to `document_id` when both given) and bound at submission time (item 5) |
| status | string | **indexed** (pending / running / gathering / planning / completed / failed — `running` is the legacy HTTP/stub path, `gathering`/`planning` are the RabbitMQ transport path) |
| prompt | string | user's planning prompt |
| connectors | string[] | e.g. ["notion", "github"] — unused until item 7 |
| prompt_version | string? | **nullable** — the active `planning` prompt's version, recorded once the job runs (item 5) |
| model | string? | **nullable** — the model that served the planning call, when known; null until the job runs, for the stub planner, and for jobs created before models were recorded |
| context_used | object? | **nullable** — the context-gatherer's output for this run, recorded once the job runs (item 5); flexible shape, varies by connector |
| result | object? | **nullable** — stub/echo payload today; a richer `{ suggestions[], outline?, sources[] }` shape is provider-dependent future work |
| error_code / error_message | string? | set when failed |
| created_at / started_at / finished_at | date | timestamps |
| chunk_sequences | number[] | RabbitMQ transport only — `[]` otherwise; guards idempotent chunk append, see above |
| data_chunks | object[] | RabbitMQ transport only — `[]` otherwise; each `{ sequence, provider, content, token_estimate }`, assembled into `context_used` once the terminal `completed` chunk arrives |

---

## Why these two live in Mongo (primer)

**Rule of thumb — embed vs reference:** if data is always read together and never
queried on its own, embed it in one document. If it is shared, updated
independently, or queried across parents, keep it relational (in PG here).

- `document_versions` are **write-once snapshots** read as a whole (restore/preview).
  Embedding the full `sections_snapshot` array means one read per restore, no joins,
  and the shape can evolve freely without migrations.
- `planning_jobs` have a **flexible, deeply nested payload** (`context_used`,
  `result`) that varies by connector and prompt version. A schemaless-ish document
  fits better than a jsonb column plus a rigid row.

Everything else has stable relationships (users → documents → sections, FK
integrity, cross-entity queries) — that's PostgreSQL territory.
