# MemoFlow — Database Schema (source of truth)

This document is the authoritative data design for MemoFlow (transcribed from the
AcademiX schema diagram). Every new module, entity, index, and migration must match
what is described here. If the design needs to change, update this file in the same
PR as the code change.

## Storage strategy

- **PostgreSQL is the primary database.** Everything relational lives here: users,
  auth, documents, sections, AI suggestions, prompts, connector tokens, gamification,
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
| user_id | uuid | FK → users |
| title | varchar | |
| doc_type | varchar | |
| status | varchar | |
| style_config | jsonb | |

#### `sections`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| document_id | uuid | FK → documents |
| title | varchar | |
| content | text | |
| order | int | **indexed** (ordered fetch per document) |
| status | varchar | |
| word_count | int | |

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

#### `connector_tokens`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK → users |
| provider | varchar | **indexed** |
| access_token | text | **encrypted at rest (AES-256-GCM, key from config)** |
| refresh_token | text | **encrypted at rest (AES-256-GCM, key from config)** |
| expires_at | timestamptz | |

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
| created_by | uuid | FK → users, nullable (system templates) |
| style_config | jsonb | |
| is_published | boolean | **indexed** |

#### `template_sections`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| template_id | uuid | FK → templates |
| order | int | |
| word_count_min | int | |
| word_count_max | int | |
| is_required | boolean | |

#### `document_templates`
| column | type | notes |
| --- | --- | --- |
| id | uuid | PK |
| document_id | uuid | FK → documents |
| template_id | uuid | FK → templates |
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
which also wires real connectors. Until roadmap item 2 (documents + sections) lands,
there is no PG `documents`/`sections` row to reference, so `document_id` and
`section_id` are **nullable** — the job is created and processed with both `null`.

| field | type | notes |
| --- | --- | --- |
| _id | ObjectId | |
| user_id | uuid (string) | **indexed** — references PG `users.id` |
| document_id | uuid (string)? | **nullable until item 2** — indexed; references PG `documents.id` once populated |
| section_id | uuid (string)? | **nullable until item 2** — references PG `sections.id` once populated |
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
