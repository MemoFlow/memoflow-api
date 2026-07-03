<!-- Hotfix PR: hotfix/<slug> -> main (then back-merge to staging + development) -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `hotfix/<slug>`
- **Base → target:** `hotfix/<slug>` → `main`

**Functionality delivered:**
<!-- Describe what this branch does: what the hotfix changes and its scope. -->
-
-

## Incident / impact

<!-- What production issue this fixes and who/what it affects. Link the incident if there is one. -->

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `main`; branch is `hotfix/<slug>`
- [ ] Back-merge planned to `staging` **and** `development` so branches don't diverge
- [ ] Migration (if any) is safe to apply forward on production
- [ ] Change is minimal and scoped to the incident
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] PG entity changes ship a generated migration in this PR (`synchronize` stays false)
- [ ] `docs/database-schema.md` updated for any data-design change; declared indexes match it
- [ ] New request DTOs have class-validator + Swagger decorators; secrets (`password_hash`, tokens) never serialized
- [ ] D2 diagrams: source + rendered SVG both committed (if diagrams changed)
- [ ] README / `docs/` updated (if commands, endpoints, env vars, or data design changed)
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
