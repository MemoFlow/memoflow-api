# MemoFlow — Database Schema (source of truth)

This document is the authoritative data design for MemoFlow (transcribed from the
AcademiX schema diagram). Every new module, entity, index, and migration must match
what is described here. If the design needs to change, update this file in the same
PR as the code change.

## Storage strategy

- **PostgreSQL is the primary database.** Everything relational lives here: users,
  auth, documents, sections, AI suggestions, prompts, connector connections, gamification,
  and the template system. Accessed via TypeORM with migrations only
  (`synchronize: false`, always).
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
| email | varchar | unique, **indexed** |
| password_hash | varchar | never serialized in API responses |
| display_name | varchar | |
| role | varchar | |
| xp | int | **indexed** (leaderboards) |
| level | int | |
| last_active_at | timestamptz | |

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
| section_id | uuid | FK → sections |
| user_id | uuid | FK → users |
| feature_type | varchar | |
| original_text | text | |
| suggested_text | text | |
| status | varchar | |
| prompt_version | varchar | |

#### `prompts`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| feature_type | varchar | **indexed** |
| version | varchar | |
| template | text | |
| is_active | boolean | **indexed** |

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

### Gamification

#### `milestones`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users |
| document_id | uuid | FK → documents |
| milestone_type | varchar | |
| xp_awarded | int | |

#### `daily_missions`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| code | varchar | |
| description | varchar | |
| xp_reward | int | |
| criteria | jsonb | |
| active_date | date | **indexed** |

#### `mission_progress`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users |
| mission_id | uuid | FK → daily_missions |
| progress | int | |
| completed | boolean | |

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
| document_id | uuid (string) | **indexed** — references PG `documents.id` |
| user_id | uuid (string) | **indexed** — references PG `users.id` |
| version | int | |
| label | string? | optional user label |
| sections_snapshot | array | embedded full section contents |
| saved_at | date | **indexed** |

### `planning_jobs`
Async AI context-engine jobs (outline/suggestion generation using connector context).

**Implementation status:** the *Context module async backbone* item (BullMQ queue +
`planning_jobs` persistence, see `docs/ROADMAP.md`) lands a **subset skeleton** of
this collection first: `user_id`, `status`, `prompt`, `connectors`, `result`,
`error_code`/`error_message`, and the timestamp fields. `prompt_version` and
`context_used`, plus a richer `result` shape, arrive with roadmap item 5 (AI layer),
which also wires real connectors. `document_id`/`section_id` stay **nullable** — the
job is created and processed with both `null` today. Roadmap item 2 (documents +
sections) has now landed, so a real PG `documents`/`sections` row exists to
reference; binding a planning job to one is item 5's remaining work, not a schema
change here.

| field | type | notes |
| --- | --- | --- |
| _id | ObjectId | |
| user_id | uuid (string) | **indexed** — references PG `users.id` |
| document_id | uuid (string)? | **nullable** — indexed; item 2's `documents` table now exists to reference, but no use-case binds it yet (item 5) |
| section_id | uuid (string)? | **nullable** — item 2's `sections` table now exists to reference, but no use-case binds it yet (item 5) |
| status | string | **indexed** (pending / running / completed / failed) |
| prompt | string | user's planning prompt |
| connectors | string[] | e.g. ["notion", "github"] — unused until item 7 |
| prompt_version | string | **arrives with item 5** (AI layer) |
| context_used | object | **arrives with item 5**: `{ notion?, github?, total_tokens }` |
| result | object | subset skeleton: stub/echo payload; richer `{ suggestions[], outline?, sources[] }` shape arrives with item 5 |
| error_code / error_message | string? | set when failed |
| created_at / started_at / finished_at | date | timestamps |

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
