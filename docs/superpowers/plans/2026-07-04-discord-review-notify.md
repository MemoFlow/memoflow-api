# Discord Review-Notify Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that pings a Discord reviewer role with the PR's markdown recap whenever a PR becomes ready for review.

**Architecture:** One new `pull_request`-triggered workflow (`opened` + `ready_for_review`, non-draft only) posts to a Discord incoming webhook via raw `curl` + `jq` — mirroring the existing `deploy-dev.yml` Render pattern. No third-party actions. The role mention lives in `content` with `allowed_mentions` scoping; the PR body verbatim goes in an embed description; the target environment (mapped from the base branch) is the embed title.

**Tech Stack:** GitHub Actions YAML, `bash`, `curl`, `jq`, Discord webhook API, `actionlint`.

**User decisions (already made):**
- Trigger: ready-for-review (`opened` non-draft + `ready_for_review`) — user chose "Ready for review".
- Recap: "PR body verbatim" — the exact filled-in PR body.
- Role config: both `DISCORD_WEBHOOK_URL` and `DISCORD_REVIEWER_ROLE_ID` as GitHub **secrets**.
- Fires on all three bases (development, staging, main); missing secret = **soft skip** (warn, exit 0).
- Environment shown prominently as the embed title (mapped from base branch).

---

### Task 1: Create the notify-review workflow

**Goal:** Add `.github/workflows/notify-review.yml` that posts the PR recap to Discord and pings the reviewer role, guarded and soft-skipping when unconfigured.

**Files:**
- Create: `.github/workflows/notify-review.yml`

**Acceptance Criteria:**
- [ ] Triggers on `pull_request` types `[opened, ready_for_review]` for bases `development`, `staging`, `main`.
- [ ] Job guarded by `if: github.event.pull_request.draft == false`.
- [ ] `permissions: contents: read` only.
- [ ] Missing `DISCORD_WEBHOOK_URL` or `DISCORD_REVIEWER_ROLE_ID` → `::warning::` + `exit 0` (no failure).
- [ ] Role mention in `content`; `allowed_mentions.roles` scopes the ping; PR body verbatim in `embeds[0].description`; env label (PRODUCTION/STAGING/DEVELOPMENT) in `embeds[0].title`.
- [ ] PR body passed via `jq --arg` (never string interpolation); empty body → `_(no description provided)_`; body > 4000 chars truncated with a "full recap on the PR" note.
- [ ] `actionlint` reports no errors.

**Verify:** `actionlint .github/workflows/notify-review.yml` → no output / exit 0. Also `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/notify-review.yml'))"` → no error.

**Steps:**

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/notify-review.yml`:

```yaml
name: Notify reviewers (Discord)

# Pings a Discord reviewer role with the PR's markdown recap when a PR becomes
# ready for review. Requires two GitHub Actions secrets (CI-only, NOT app runtime
# env — do not add these to .env.example):
#   DISCORD_WEBHOOK_URL       - incoming webhook URL for the target channel
#   DISCORD_REVIEWER_ROLE_ID  - numeric Discord role id to mention
# If either secret is unset the job soft-skips (warning, no failure) so a PR is
# never blocked because Discord isn't wired up yet.

on:
  pull_request:
    types: [opened, ready_for_review]
    branches: [development, staging, main]

permissions:
  contents: read

concurrency:
  group: notify-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  notify:
    name: Ping Discord reviewers
    runs-on: ubuntu-latest
    # `opened` fires for drafts too; `ready_for_review` never does. This guard
    # suppresses the ping until the PR is actually ready for a reviewer.
    if: github.event.pull_request.draft == false
    steps:
      - name: Post PR recap to Discord
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          DISCORD_REVIEWER_ROLE_ID: ${{ secrets.DISCORD_REVIEWER_ROLE_ID }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          BASE_REF: ${{ github.event.pull_request.base.ref }}
        run: |
          set -euo pipefail

          # Soft skip when Discord isn't configured — never block the PR.
          if [ -z "${DISCORD_WEBHOOK_URL:-}" ] || [ -z "${DISCORD_REVIEWER_ROLE_ID:-}" ]; then
            echo "::warning::DISCORD_WEBHOOK_URL or DISCORD_REVIEWER_ROLE_ID not set — skipping Discord notification."
            exit 0
          fi

          # Map the PR base branch to the environment it deploys to.
          case "$BASE_REF" in
            main)        env_label="PRODUCTION" ;;
            staging)     env_label="STAGING" ;;
            development) env_label="DEVELOPMENT" ;;
            *)           env_label="$BASE_REF" ;;
          esac

          # PR body verbatim = the same markdown recap the reviewer reads on the PR.
          body="${PR_BODY:-}"
          if [ -z "$body" ]; then
            body="_(no description provided)_"
          fi
          # Discord embed description hard cap is 4096 chars; leave margin.
          max=4000
          if [ "${#body}" -gt "$max" ]; then
            body="${body:0:$max}"$'\n\n…\n\n_(truncated — full recap on the PR)_'
          fi

          # Build JSON with jq --arg so quotes/newlines/$ in the PR body can't
          # break the JSON, the shell, or inject extra mentions.
          payload="$(jq -n \
            --arg role "$DISCORD_REVIEWER_ROLE_ID" \
            --arg title "🔍 Review requested → ${env_label} (${BASE_REF})" \
            --arg url "$PR_URL" \
            --arg prtitle "$PR_TITLE" \
            --arg author "$PR_AUTHOR" \
            --arg body "$body" \
            '{
              content: "<@&\($role)> **\($prtitle)** by \($author)\n\($url)",
              allowed_mentions: { roles: [$role] },
              embeds: [ {
                title: $title,
                url: $url,
                description: $body
              } ]
            }')"

          # Capture the HTTP status instead of letting curl's exit code kill the
          # step: a transient Discord outage or timeout should warn, not fail a
          # PR check (same "never block the PR" intent as the missing-secret skip).
          http_code="$(printf '%s' "$payload" | curl -sS -o /dev/null -w '%{http_code}' \
            --connect-timeout 10 --max-time 15 -X POST \
            -H "Content-Type: application/json" \
            --data @- \
            "$DISCORD_WEBHOOK_URL")" || http_code="000"

          case "$http_code" in
            2*) echo "Discord notification sent for PR: $PR_URL" ;;
            *)  echo "::warning::Discord webhook returned HTTP ${http_code} — notification not delivered (not blocking the PR)." ;;
          esac
```

- [ ] **Step 2: Lint the workflow**

Run: `actionlint .github/workflows/notify-review.yml`
Expected: no output, exit 0. (If `actionlint` isn't installed: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/notify-review.yml'))"` → no error.)

- [ ] **Step 3: Commit**

Via `/commit` (code-reviewer gate applies). Message: `ci: notify Discord reviewer role on ready-for-review PRs`.

---

### Task 2: Document the Discord CI secrets

**Goal:** Record the two new GitHub Actions secrets in `README.md` so a maintainer knows to configure them; state explicitly they are CI-only (not `.env`).

**Files:**
- Modify: `README.md` (CI/CD or secrets section — locate the existing deploy-secrets docs, e.g. where `RENDER_DEPLOY_HOOK_URL` is described).

**Acceptance Criteria:**
- [ ] `README.md` lists `DISCORD_WEBHOOK_URL` and `DISCORD_REVIEWER_ROLE_ID` with a one-line purpose each.
- [ ] Notes they are GitHub Actions secrets, not application env vars (absent from `.env.example`), and that an unset value soft-skips the notification.
- [ ] `.env.example` is NOT modified.

**Verify:** `grep -n "DISCORD_" README.md` → shows both secrets; `grep -c "DISCORD_" .env.example` → `0`.

**Steps:**

- [ ] **Step 1: Locate the CI secrets documentation**

Run: `grep -rn "RENDER_DEPLOY_HOOK_URL\|secrets\." README.md docs/ | head -30`
Use the section where existing GitHub Actions secrets are documented; if none exists, add a short "CI/CD secrets" subsection near the deployment docs.

- [ ] **Step 2: Add the two secrets**

Add (matching the surrounding format), for example:

```markdown
| `DISCORD_WEBHOOK_URL` | Incoming webhook for the reviewer channel. Consumed only by `.github/workflows/notify-review.yml`. |
| `DISCORD_REVIEWER_ROLE_ID` | Numeric Discord role id pinged when a PR is ready for review. |

> Both are **GitHub Actions secrets**, not application env vars — they are not in `.env.example`. If either is unset the notification step soft-skips (warning, no failure).
```

- [ ] **Step 3: Commit**

Via `/commit`. Message: `docs: document Discord review-notify CI secrets`.

---

## Review + docs (parallel step, per CLAUDE.md workflow)

Before each commit, once the tree is stable:
- `code-reviewer` on the diff — always (hook-enforced APPROVE gate).
- `api-reviewer` — always per project rule (will find no clean-arch/dual-DB surface here; run anyway).
- `docs-maintainer` — owns the Task 2 README change.
- `tooling-reviewer` — only if `.claude/`, `scripts/`, or `CLAUDE.md` change (they don't here).

## Notes / gotchas

- **The workflow will NOT fire on its own introducing PR.** GitHub resolves a `pull_request`-triggered workflow from the **base** branch's copy of the file. First live run happens only after this lands on `development`. Validate afterward with a throwaway test PR pointed at a test-channel webhook.
- Keep it a `ci:` type change; branch is `ci/discord-review-notify`.
