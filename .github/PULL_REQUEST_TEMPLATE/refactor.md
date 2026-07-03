<!-- refactor PR: refactor/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `refactor/<slug>`
- **Base → target:** `refactor/<slug>` → `development`

**Functionality delivered:**
<!-- Describe what this branch restructures and which modules/layers it touches. Behaviour must not change. -->
-
-

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `refactor/<slug>`
- [ ] No behaviour change — public API, responses, and DB shape are identical
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] Existing tests still pass unchanged (no test rewrites masking behaviour drift)
- [ ] Clean-architecture layer boundaries preserved (domain imports nothing; only infrastructure imports typeorm/mongoose)
- [ ] D2 diagrams updated (source + SVG) if structure changed
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
