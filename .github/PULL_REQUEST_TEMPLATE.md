<!--
Default PR template. Every branch type has its own template — recreate this PR with the
matching one via the URL param `?template=<type>.md` or the CLI `gh pr create --template <type>.md`:

  feat       feature work                      -> development
  fix        bug fix                           -> development
  hotfix     urgent production fix             -> main (back-merged to staging + development)
  docs       documentation only                -> development
  refactor   behaviour-preserving restructure  -> development
  perf       performance improvement           -> development
  test       tests only                        -> development
  build      build system / dependencies       -> development
  ci         CI/CD pipeline                     -> development
  chore      tooling / maintenance             -> development
  style      formatting only, no logic change  -> development

Branch names must be `<type>/<slug>` (enforced in CI and by the local pre-push hook).
-->

## Summary

<!-- What & why in 1-3 sentences. -->

## Branch

- **Branch:** `<type>/<slug>`
- **Base → target:** `<branch>` → `development` (or `main` for a hotfix)

**Functionality delivered:**
<!-- What this branch does: the capability it adds/changes and the modules/endpoints/entities it touches. -->
-
-

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `hotfix` — urgent production fix (targets `main`)
- [ ] `docs` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `style`

## Checklist

- [ ] Branch is named `<type>/<slug>` with a Conventional-Commit type and targets the correct base
- [ ] Commits are Conventional Commits (authored via `/commit`)
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` pass locally
- [ ] PG entity changes ship a generated migration in this PR (`synchronize` stays false)
- [ ] `docs/database-schema.md` updated for any data-design change; declared indexes match it
- [ ] New request DTOs have class-validator + Swagger decorators; secrets (`password_hash`, tokens) never serialized
- [ ] D2 diagrams: source + rendered SVG both committed (if diagrams changed)
- [ ] README / `docs/` / `docs/ROADMAP.md` updated (if commands, endpoints, env vars, data design, or roadmap status changed)
- [ ] Required reviewers returned APPROVE (`api-reviewer` always; `tooling-reviewer` / `docs-maintainer` if in scope)
