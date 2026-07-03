<!-- feat PR: feat/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `feat/<slug>`
- **Base → target:** `feat/<slug>` → `development`

**Functionality delivered:**
<!-- Describe what this branch does: the capability it adds and the modules/endpoints/entities it touches. -->
-
-

## Roadmap item

<!-- Which slice in docs/ROADMAP.md this advances, and its new status. Link it. -->

## Changes

<!-- Bulleted list of notable changes (use-cases, controllers, entities, migrations, tests). -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `feat/<slug>`
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] PG entity changes ship a generated migration in this PR (`synchronize` stays false)
- [ ] `docs/database-schema.md` updated for any data-design change; declared indexes match it
- [ ] New request DTOs have class-validator + Swagger decorators; secrets (`password_hash`, tokens) never serialized
- [ ] D2 diagrams: source + rendered SVG both committed (if diagrams changed)
- [ ] README / `docs/` / `docs/ROADMAP.md` status updated (if commands, endpoints, env vars, data design, or roadmap status changed)
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
