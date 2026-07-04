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
| `npm run release` / `release:dry` / `release:first` | bump version + `CHANGELOG.md` + tag from Conventional Commits — mutating release CI-only, guarded by `scripts/release.sh`; `dry` previews (always allowed), `first` cuts the initial release |

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
- **No provider tokens at rest here.** Connector OAuth runs through **Composio**, which
  is the token vault and MCP host; this API stores only a connection reference
  (`connector_connections.composio_account_id` + `status`) — never an access/refresh
  token. `COMPOSIO_API_KEY` (and related `COMPOSIO_*` vars) authenticate this API to
  Composio, not end users to providers.

## Conventions

- Every request body/query goes through a DTO with class-validator decorators and Swagger annotations. The global ValidationPipe uses `whitelist: true`.
- Indexes follow the schema doc — if you query by a field marked indexed there, the entity must declare the index.
- Errors use the uniform shape from `HttpExceptionFilter`: `{ statusCode, message, error, path, timestamp }`.
- `password_hash` (and any token/secret column) is never serialized into API responses.

## Workflow (agent orchestration)

The orchestrator (this session) coordinates the pipeline below and delegates to the
specialist agents instead of doing their work inline. Standard pipeline for a
feature or endpoint:

1. **Design** (orchestrator) — resolve the slice against `docs/database-schema.md`;
   for placement/index questions consult `db-mentor` (read-only, cheap, can run
   anytime in parallel with anything).
2. **Implement** (`implementer`) — hand it the resolved spec via
   `/new-module <name> --db pg|mongo` (whole slice) or
   `/api-endpoint <module> <verb> <path>` (single endpoint). It writes `src/`,
   `test/`, and migrations, and must return with lint/build/tests green.
3. **Review + docs (parallel step)** — once the tree is stable, launch together:
   - `code-reviewer` on the diff — **always, before every commit** (Copilot-style
     correctness/error-handling/concurrency/type-safety/spec-sync pass).
   - `api-reviewer` on the diff — always (clean-architecture + dual-DB rules).
   - `tooling-reviewer` — only if `.claude/`, `scripts/`, or CLAUDE.md changed.
   - `docs-maintainer` — if commands, endpoints, env vars, data design,
     environments, or roadmap status changed. Diagrams are D2 sources in
     `docs/diagrams/` rendered to SVG (`d2 <name>.d2 <name>.svg`, both committed).
4. **Commit** via `/commit` — only after reviewers return APPROVE; re-run step 3 on
   fix-ups. (The global hook enforces the `/commit` routing.) The **`code-reviewer`
   APPROVE gate is hook-enforced**: the `PreToolUse` hook
   `.claude/hooks/pre-commit-review-gate.py` blocks the `/commit` apply step until
   the current `git diff HEAD` has been approved. After `code-reviewer` returns
   APPROVE, record it so the gate opens:
   `git diff HEAD | sha256sum | cut -d' ' -f1 > "$(git rev-parse --git-dir)/code-review-ok"`.
   Any further edit changes the diff hash and re-arms the gate. Deliberate bypass:
   prefix the commit with `SKIP_CODE_REVIEW=1`.
5. **CI/CD** (`devops`) — pipeline or deployment changes, as their own step.

### Parallelism rules

- **Read-only agents** (`api-reviewer`, `tooling-reviewer`, `db-mentor`) may always
  run in parallel — with each other and with any writer.
- **Writing agents** (`implementer`, `docs-maintainer`, `devops`) have disjoint
  territories (`src`+`test` / `README`+`docs`+CLAUDE.md's factual sections /
  `.github`) and may run in parallel with each other **only within their own
  territory**; never launch two writers whose scopes overlap, and never two
  `implementer` runs at once.
- The territories are a convention the orchestrator upholds, not a technical
  guarantee — writers' Write/Edit tools are not path-restricted; `tooling-reviewer`
  checks for strays.
- Anything not covered: default to sequential.

### Branching & commits (gitflow — mandatory)

- Three long-lived branches, each deployed to its environment:
  `development` → dev, `staging` → staging, `main` → production.
- Promotion is one-way via PR: `development` → `staging` → `main` (tagged on `main`).
  `staging` plays the role of gitflow's release branch — validated in the staging
  environment before promotion; fixes found there land as `bugfix/<slug>` off
  `development` and re-promote.
- Never commit directly to `main`, `staging`, or `development` — all human work lands
  via PR. The sole exception is the automated `chore(release)` commit (see the
  versioning bullet below).
- New work branches off `development` as `feature/<slug>`; bug fixes as `bugfix/<slug>`.
- `hotfix/<slug>` branches off `main`, merges back to `main`, `staging`, and `development`.
- Migrations are applied per environment (`npm run migration:run` at deploy) in the
  same order they were promoted — never `synchronize`.
- Commit messages remain Conventional Commits, authored via `/commit`.
- **Versioning is conventional (SemVer from commits).** The version is never bumped by
  hand: `commit-and-tag-version` (`npm run release`, config `.versionrc.json`) derives
  the next version from the Conventional Commits since the last `v*` tag — `fix:` →
  patch, `feat:` → minor, `!`/`BREAKING CHANGE:` → major (while `0.x`, breaking bumps
  the minor; `1.0.0` is a deliberate `release:first` call). `npm run release` goes
  through `scripts/release.sh`, which **refuses** a mutating release outside CI (override
  `RELEASE_ALLOW_LOCAL=1` for the deliberate `1.0.0` cut). The release job runs **only
  on push to `main`** (production), commits `chore(release): x.y.z` + `CHANGELOG.md`,
  and tags `vX.Y.Z`. That automated `chore(release)` commit is the **only** commit
  allowed directly on `main`; it is backported to `development` so versions never
  diverge. `CHANGELOG.md` is generated, never hand-edited. The `devops` agent owns the
  release job.

### Model tiering (deliberate — keep explicit, never leave to default)

- **Orchestrator (this session): `opus`** — pinned in `.claude/settings.json`. Makes architecture decisions and runs the scaffolding skills.
- **`implementer` agent: `sonnet`** — executes a spec the opus orchestrator already resolved; the design thinking happened upstream.
- **`code-reviewer` agent: `sonnet`** — Copilot-style correctness/type-safety/spec-sync review; runs on every commit, so review-strength but cost-conscious.
- **`api-reviewer` agent: `sonnet`** — strong enough for architectural review, cheap enough to run on every commit.
- **`tooling-reviewer` agent: `sonnet`** — reviews `.claude/` agents/skills, `scripts/`, and CLAUDE.md changes; same review-strength reasoning as `api-reviewer`.
- **`devops` agent: `sonnet`** — writes GitHub Actions workflows (`.github/workflows/`) and deployment automation; code-authoring agent, so review-tier strength.
- **`docs-maintainer` agent: `sonnet`** — keeps README/docs/D2 diagrams in sync with the code; cross-file consistency work.
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

## Roadmap (details + status: `docs/ROADMAP.md` — that file is the status source of truth)

1. Users + JWT auth (PG) — replaces any transitional Mongoose user files
2. Documents + sections (PG)
3. Templates (PG)
4. Versioning (Mongo — `document_versions`)
5. AI layer (`prompts` + `ai_suggestions` PG, `planning_jobs` Mongo)
6. Gamification (PG)
7. Connectors (OAuth via Composio + `connector_connections` reference table)
