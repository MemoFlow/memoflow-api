<!-- ci PR: ci/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `ci/<slug>`
- **Base → target:** `ci/<slug>` → `development`

**Functionality delivered:**
<!-- Which workflows/pipeline steps this branch changes (PR checks, deploys, migration, smoke, release). -->
-
-

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `ci/<slug>`
- [ ] Workflow/pipeline change only — no product-source change
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `actionlint` is clean on changed workflows
- [ ] Per-environment deploy order preserved (migrate → deploy → smoke); `synchronize` never enabled
- [ ] Secrets referenced via GitHub secrets, never hardcoded
- [ ] `devops` reviewed and returned APPROVE
