<!-- test PR: test/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `test/<slug>`
- **Base → target:** `test/<slug>` → `development`

**Functionality delivered:**
<!-- Which tests this branch adds/changes and what behaviour they now cover. No product-source change. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `test/<slug>`
- [ ] Tests only — no product-source behaviour change
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm test` and `npm run test:e2e` pass locally (e2e uses Testcontainers PG + in-memory Mongo)
- [ ] New tests fail against the pre-change code path they are meant to guard
- [ ] Required reviewers returned APPROVE (`api-reviewer` if test scope touches a slice under review)
