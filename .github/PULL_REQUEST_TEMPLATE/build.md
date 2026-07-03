<!-- build PR: build/<slug> -> development -->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `build/<slug>`
- **Base → target:** `build/<slug>` → `development`

**Functionality delivered:**
<!-- Build-system / dependency changes this branch makes (package.json, tsconfig, Docker, lockfile). -->
-
-

## Changes

<!-- Bulleted list of notable changes. -->
-
-

## Checklist

- [ ] Base branch is `development`; branch is `build/<slug>`
- [ ] Build/dependency change only — no product-source behaviour change
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] Lockfile (`package-lock.json`) committed alongside any dependency change
- [ ] `tooling-reviewer` reviewed (if `scripts/` or tooling config changed) and returned APPROVE
