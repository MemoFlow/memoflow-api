<!-- fix PR: fix/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `fix/<slug>`
- **Base → target:** `fix/<slug>` → `development`

**Functionality delivered:**
<!-- Describe what this branch does: what the fix changes and which modules/endpoints/entities it touches. -->
-
-

## Bug / root cause

<!-- What broke, and why. Link the issue if there is one. -->

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `fix/<slug>`
- [ ] Added/updated a regression test that fails without this fix
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] PG entity changes ship a generated migration in this PR (`synchronize` stays false)
- [ ] `docs/database-schema.md` updated for any data-design change; declared indexes match it
- [ ] New request DTOs have class-validator + Swagger decorators; secrets (`password_hash`, tokens) never serialized
- [ ] D2 diagrams: source + rendered SVG both committed (if diagrams changed)
- [ ] README / `docs/` updated (if commands, endpoints, env vars, or data design changed)
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
