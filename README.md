# memoflow-api

## Branching & PR conventions

Branch names follow Conventional-Commit types: **`<type>/<slug>`**.

| type | for | base branch |
| --- | --- | --- |
| `feat` | new feature | `development` |
| `fix` | bug fix | `development` |
| `hotfix` | urgent production fix | `main` (back-merged to `staging` + `development`) |
| `docs` | documentation only | `development` |
| `refactor` | behaviour-preserving restructure | `development` |
| `perf` | performance improvement | `development` |
| `test` | tests only | `development` |
| `build` | build system / dependencies | `development` |
| `ci` | CI/CD pipeline | `development` |
| `chore` | tooling / maintenance | `development` |
| `style` | formatting only | `development` |

`slug` is kebab-case (`[a-z0-9._-]+`), e.g. `feat/user-auth`, `fix/token-expiry`.

**Enforcement**

- **CI** — `.github/workflows/branch-naming.yml` fails any PR whose source branch
  doesn't match the convention. Long-lived branches (`development`, `staging`, `main`)
  are exempt so promotion PRs pass.
- **Local** — a `pre-push` hook rejects non-conventional branch names before they leave
  your machine. Install it once per clone:

  ```bash
  bash scripts/install-hooks.sh
  ```

**PR templates** — each type has its own template under
`.github/PULL_REQUEST_TEMPLATE/`. Pick one when opening a PR:

```bash
gh pr create --template feat.md      # or fix.md, hotfix.md, docs.md, ...
```

Or add `?template=feat.md` to the compare URL. Opening a PR without choosing one loads
the default `.github/PULL_REQUEST_TEMPLATE.md`.
