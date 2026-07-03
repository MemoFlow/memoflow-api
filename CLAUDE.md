# MemoFlow API

NestJS 11 REST API for MemoFlow (users, documents, AI features, connectors).
**Dual-database:** PostgreSQL (primary, via TypeORM) + MongoDB (specialist, via Mongoose).

**`docs/database-schema.md` is the source of truth for all data design** — tables,
collections, indexes, and which database each entity lives in. Consult it before
creating or changing any entity; update it in the same PR as schema changes.

## Commands

| command | what it does |
| --- | --- |
| `npm run start:dev` | dev server with watch (needs DBs up + `.env`) |
| `npm test` / `npm run test:e2e` | unit / e2e tests (e2e: Testcontainers PG + in-memory Mongo; PG suite auto-skips without Docker) |
| `npm run lint` / `npm run build` | lint (with autofix) / compile |
| `npm run db:up` / `db:down` / `db:reset` | dev databases via docker compose (`reset` wipes volumes) |
| `npm run db:seed` | idempotent dev seed (`scripts/seed.ts`) |
| `npm run smoke` | boots the app and polls `/health` |
| `npm run migration:generate -- src/infrastructure/persistence/migrations/<Name>` | generate migration from entity diff |
| `npm run migration:run` / `migration:revert` / `migration:show` | apply / revert / list migrations |

Copy `.env.example` to `.env` before first run. Swagger UI: `http://localhost:3000/docs`.

## Architecture (clean architecture — enforced by skills and `api-reviewer`)

Each feature is a vertical slice across four layers:

- `src/domain/<feature>/` — domain entities + repository **interfaces**. Imports nothing from other layers.
- `src/application/<feature>/` — use-cases. Depends only on domain.
- `src/infrastructure/persistence/<feature>/` — TypeORM entities / Mongoose schemas + repository **implementations**. **The only layer allowed to import `typeorm` or `mongoose`.**
- `src/presentation/<feature>/` — controllers + DTOs (class-validator + Swagger decorators). Calls use-cases only; never touches repositories directly.

Shared plumbing lives in `src/shared/` (exception filter, logging interceptor, health)
and `src/config/` (env validation).

## Dual-database rules

- **PostgreSQL is primary.** Everything relational per `docs/database-schema.md`.
- **MongoDB holds exactly two collections:** `document_versions` and `planning_jobs`. Nothing else goes in Mongo without updating the schema doc first.
- **Cross-DB references are plain uuids** (`document_id`, `user_id` in Mongo docs). There is no FK across databases — the use-case must validate the referenced PG row exists before writing to Mongo.
- **Every PG entity change ships with a generated migration** in the same commit. `synchronize` stays `false` — no exceptions.
- **Secrets encrypted at rest:** `connector_tokens.access_token` / `refresh_token` use AES-256-GCM with the key from config (never hardcoded).

## Conventions

- Every request body/query goes through a DTO with class-validator decorators and Swagger annotations. The global ValidationPipe uses `whitelist: true`.
- Indexes follow the schema doc — if you query by a field marked indexed there, the entity must declare the index.
- Errors use the uniform shape from `HttpExceptionFilter`: `{ statusCode, message, error, path, timestamp }`.
- `password_hash` (and any token/secret column) is never serialized into API responses.
- Any Mongoose user schema files found under `src/infrastructure/persistence/` are **transitional** — users belong in PostgreSQL (roadmap item 1 replaces them).

## Workflow

1. `/new-module <name> --db pg|mongo` — scaffold a feature slice across all four layers.
2. `/api-endpoint <module> <verb> <path>` — add individual endpoints to an existing module.
3. Run the `api-reviewer` agent on the diff **before every commit**.
4. Commit via `/commit` (global hook enforces this).

### Model tiering (deliberate — keep explicit, never leave to default)

- **Orchestrator (this session): `opus`** — pinned in `.claude/settings.json`. Makes architecture decisions and runs the scaffolding skills.
- **`api-reviewer` agent: `sonnet`** — strong enough for architectural review, cheap enough to run on every commit.
- **`db-mentor` agent: `haiku`** — explanatory Q&A only, no code changes.

## MongoDB primer (for developers new to Mongo)

**Embed vs reference, rule of thumb:** if data is always read together with its parent
and never queried independently, embed it inside one document. If it's shared, updated
independently, or queried across parents — that's relational data and belongs in PG here.

Why our two collections fit Mongo:
- `document_versions` are write-once snapshots read as a whole — embedding the full
  `sections_snapshot` means one read per restore, no joins, and the shape can evolve
  without migrations.
- `planning_jobs` carry flexible nested payloads (`context_used`, `result`) that vary
  by connector and prompt version — a rigid SQL row would fight that shape.

When in doubt about placement or schema design, ask the `db-mentor` agent.

## Roadmap (each item starts with `/new-module`)

1. Users + JWT auth (PG) — replaces any transitional Mongoose user files
2. Documents + sections (PG)
3. Templates (PG)
4. Versioning (Mongo — `document_versions`)
5. AI layer (`prompts` + `ai_suggestions` PG, `planning_jobs` Mongo)
6. Gamification (PG)
7. Connectors (OAuth + encrypted `connector_tokens`)
