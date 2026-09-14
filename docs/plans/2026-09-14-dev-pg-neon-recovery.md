# Dev-tier recovery: expired Render free Postgres → Neon (2026-09-14)

## Incident

Dev API (`memoflow-dev-api.onrender.com`) unreachable: TCP/TLS to Render edge
succeeds, zero HTTP bytes even after 110s. Last deploy 2026-07-20; ~8 weeks idle.
All provider status pages operational — not an outage.

Root cause (confirmed by user in Render dashboard): **Render free Postgres
expired** (free plan expires ~30 days after creation). App crash-loops at boot
(TypeORM cannot connect), so no HTTP listener. Cascade also left idle
free-tier deps suspect: Atlas M0 (auto-pause after ~60 days idle) and Upstash
free Redis.

Dev data is considered disposable (reseedable via `scripts/seed.ts`).

## Decision

Replace Render managed free PG with **Neon free tier** (external, does not
expire) — same external-secret pattern already used for Atlas (MONGODB_URI)
and Upstash (REDIS_*). No code change needed: `POSTGRES_SSL` toggle already
exists (`parsePostgresSsl` in `src/config/env.validation.ts`, `ssl:` wired in
`src/app.module.ts` and `src/infrastructure/persistence/typeorm.data-source.ts`),
and the CI migration step already sets `POSTGRES_SSL=true`.

## Tasks (mirror: this file + `.tasks.json`; native list is session-scoped)

1. **render.yaml → external PG** — drop `databases:` block, `POSTGRES_*`
   `fromDatabase` → `sync: false` secrets, add `POSTGRES_SSL: "true"` literal
   (Neon is TLS-only). Branch `bugfix/dev-pg-neon`, review, PR to development.
2. **Provision Neon** (user) — project in AWS us-west-2, report
   POSTGRES_HOST (direct endpoint, not `-pooler`, so migrations get a direct
   connection) / PORT / USER / PASSWORD / DB.
3. **Resume Atlas M0 + verify Upstash** (user) — dashboards.
4. **GitHub `development` env secrets** — `gh secret set POSTGRES_* -e development`.
5. **Render dashboard env vars** (user) — set `POSTGRES_*` on `memoflow-dev-api`;
   optional: finally set `ANTHROPIC_API_KEY`.
6. **Merge → deploy → verify** — deploy-dev.yml migrates empty Neon DB, deploy
   hook, smoke; then `/health` 200, optional reseed, ROADMAP + memory sync.

Dependencies: 4,5 ← 2; 6 ← 1,3,4,5.
