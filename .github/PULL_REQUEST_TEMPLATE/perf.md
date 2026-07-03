<!-- perf PR: perf/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `perf/<slug>`
- **Base → target:** `perf/<slug>` → `development`

**Functionality delivered:**
<!-- Describe what this branch speeds up and which modules/queries/endpoints it touches. -->
-
-

## Measurement

<!-- Before/after numbers (latency, query count, memory) and how you measured them. -->

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `perf/<slug>`
- [ ] Behaviour unchanged; only performance characteristics differ
- [ ] Before/after measurement included above
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] New/changed indexes are declared on the entity and reflected in `docs/database-schema.md`
- [ ] PG entity changes ship a generated migration in this PR (`synchronize` stays false)
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
