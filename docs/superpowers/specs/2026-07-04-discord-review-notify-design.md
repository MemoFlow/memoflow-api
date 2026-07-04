# Discord review-notification workflow — design

**Date:** 2026-07-04
**Branch:** `ci/discord-review-notify` (off `development`)
**Type:** `ci` — CI/CD pipeline addition

## Goal

When a pull request becomes ready for a reviewer, post a Discord message that
pings a reviewer role and shows the **same markdown recap** the reviewer would
read on the PR (the filled-in PR body). This removes the "did anyone see my PR"
gap without making reviewers poll GitHub.

## Trigger

New workflow `.github/workflows/notify-review.yml`:

```yaml
on:
  pull_request:
    types: [opened, ready_for_review]
    branches: [development, staging, main]
```

- `ready_for_review` fires when a draft is flipped to ready.
- `opened` covers PRs opened directly as non-draft.
- Guard `if: github.event.pull_request.draft == false` suppresses the ping for
  PRs opened while still a draft (the `opened` event fires for drafts too;
  `ready_for_review` is always non-draft).
- Fires for all three long-lived bases: `development`, `staging`, `main`.

## Message shape

Delivered to a Discord **incoming webhook** via `curl` + `jq` (no third-party
action — mirrors how `deploy-dev.yml` calls Render with raw `curl`/`jq`, and
keeps full control over `allowed_mentions`).

- **`content`** — carries the role mention (mentions inside embeds do **not**
  ping): `<@&${DISCORD_REVIEWER_ROLE_ID}>` followed by the PR title and link.
- **`allowed_mentions`** — `{ "roles": ["<role id>"] }` so the role actually
  pings and nothing else (no `@everyone`/user injection from PR text).
- **`embeds[0].title`** — the **target environment**, mapped from the base
  branch, shown prominently:
  - `development` → `🔍 Review requested → DEVELOPMENT (development)`
  - `staging` → `🔍 Review requested → STAGING (staging)`
  - `main` → `🔍 Review requested → PRODUCTION (main)`
- **`embeds[0].url`** — the PR URL (makes the title clickable).
- **`embeds[0].description`** — the **PR body verbatim** = the same markdown
  recap. Discord renders `#`/`##`/`###` headers and lists; checkbox syntax
  `- [ ]` shows as literal text (acceptable).

### Content edge cases

- **Body length:** Discord caps an embed description at 4096 chars. If the body
  is longer, slice to a safe bound and append
  `\n\n…\n\n_(truncated — full recap on the PR)_`.
- **Empty body:** substitute `_(no description provided)_`.
- **Injection safety:** the body is passed through `jq --arg` (never string
  interpolation), so quotes/newlines/`$` in the PR body cannot break the JSON or
  the shell. `allowed_mentions` prevents the body from pinging anyone.

## Configuration (new, CI-only)

GitHub Actions **secrets** (both secret — role ID kept out of logs):

- `DISCORD_WEBHOOK_URL`
- `DISCORD_REVIEWER_ROLE_ID`

These are CI configuration, **not** application runtime env — they do **not** go
in `.env.example`. Documented in the workflow header comment and the README CI
section.

## Error handling

- **Missing `DISCORD_WEBHOOK_URL` or `DISCORD_REVIEWER_ROLE_ID`** → soft skip:
  emit `::warning::` and exit 0. A PR must not be blocked because Discord isn't
  wired up yet.
- **Discord HTTP failure** (non-2xx) → `curl -fsS` fails, emit `::error::` and
  exit non-zero so the failure is visible in checks.

## Permissions

```yaml
permissions:
  contents: read
```

All PR fields are read from the event payload (`github.event.pull_request.*`);
no API call, so no `pull-requests` scope is needed.

## Testing / verification

- No unit tests — pure CI YAML.
- Lint the workflow with `actionlint` (devops agent).
- **First live run only happens after merge.** GitHub resolves a
  `pull_request`-triggered workflow from the **base** branch's copy of the file,
  not the PR's head — so `notify-review.yml` does **not** fire on its own
  introducing PR. It starts working once merged into `development`. Verify with a
  throwaway test PR opened *after* the merge: point `DISCORD_WEBHOOK_URL` at a
  test-channel webhook, open a draft PR, flip it to ready, confirm the role pings
  and the recap renders.

## Out of scope (YAGNI)

- Re-pinging on `synchronize`/new pushes.
- Label-gated notifications.
- A composite/reusable action (single caller today).
- Per-reviewer (as opposed to per-role) mentions.
