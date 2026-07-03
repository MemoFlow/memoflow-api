# MemoFlow API

REST API for MemoFlow — users, documents, AI-assisted writing features, and external
connectors. Built with [NestJS 11](https://nestjs.com) on a **dual-database** design:

- **PostgreSQL** (primary) — everything relational, via TypeORM with migrations only.
- **MongoDB** (specialist) — exactly two collections (`document_versions`,
  `planning_jobs`), via Mongoose.

The full data design lives in [`docs/database-schema.md`](docs/database-schema.md)
(source of truth) and is visualized in
[`docs/diagrams/database-schema.svg`](docs/diagrams/database-schema.svg):

![Database schema](docs/diagrams/database-schema.svg)

## Quickstart

Prerequisites: Node 24+, Docker (with compose).

```bash
cp .env.example .env   # localhost defaults, works out of the box
npm install
npm run db:up          # postgres:16 + mongo:7 via docker compose
npm run start:dev
```

- Swagger UI: http://localhost:3000/docs
- Health (checks both databases): http://localhost:3000/health

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

Protected routes require `Authorization: Bearer <accessToken>`. Full request/response
shapes are in Swagger (`/docs`).

## Environment variables

Beyond the database connection vars, auth requires:

| var | required | default | notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | yes | — | signing key for access tokens; must be a long random value outside dev |
| `JWT_EXPIRES_IN` | no | `15m` | access token lifetime |

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

The `development` tier deploys to **Render** (see [`render.yaml`](render.yaml) for the
web service + managed Postgres blueprint). Render has no managed MongoDB, so dev
MongoDB is an external **MongoDB Atlas M0 (free tier)** instance, with its connection
string set manually as the `MONGODB_URI` secret. Staging and production deploy
targets are not yet decided.

## Documentation

- [`docs/database-schema.md`](docs/database-schema.md) — authoritative data design
  (tables, collections, indexes, which database each entity lives in).
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — feature roadmap with per-item specs and
  current status.
- [`docs/diagrams/`](docs/diagrams/) — diagrams authored in
  [D2](https://d2lang.com) (`.d2` sources) with rendered SVGs committed alongside.
  Regenerate with `d2 <name>.d2 <name>.svg`.
