#!/usr/bin/env bash
# Cleanup dead branches and stale GitHub deployment records.
#
# Dead branch  = local branch whose PR is MERGED or CLOSED (squash merges hide
#                ancestry, so `git branch --merged` misses them). Branches with
#                an open PR, no PR, or checked out in a worktree are kept, as
#                are main/staging/development.
# Stale deploy = any GitHub deployment record except the most recent one per
#                environment (the only one Render/GitHub UI still cares about).
#
# Usage:
#   scripts/cleanup-dead.sh           # dry-run: report what would be removed
#   scripts/cleanup-dead.sh --apply   # actually delete
set -euo pipefail

APPLY=false
case "${1:-}" in
  --apply) APPLY=true ;;
  "") ;;
  *) echo "Usage: $0 [--apply]" >&2; exit 1 ;;
esac

PROTECTED='^(main|staging|development)$'

say() { printf '%s\n' "$*"; }
run() { if $APPLY; then "$@"; else say "  [dry-run] $*"; fi; }

command -v gh >/dev/null || { say "gh CLI required" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { say "gh is not authenticated (gh auth login)" >&2; exit 1; }

say "== fetch + prune remotes =="
git fetch --prune --quiet

say "== dead local branches (PR merged/closed) =="
current=$(git branch --show-current)
worktree_branches=$(git worktree list --porcelain | sed -n 's/^branch refs\/heads\///p')
deleted=0
while IFS= read -r br; do
  [[ -z "$br" || "$br" == "$current" ]] && continue
  [[ "$br" =~ $PROTECTED ]] && continue
  if grep -qx "$br" <<<"$worktree_branches"; then
    say "  keep  $br (checked out in a worktree)"
    continue
  fi
  # No stderr/exit-code suppression: a gh failure (auth, rate limit, network)
  # aborts via set -e instead of masquerading as "no PR".
  state=$(gh pr list --head "$br" --state all --limit 1 --json state -q '.[0].state')
  case "$state" in
    MERGED|CLOSED)
      say "  dead  $br (PR $state)"
      run git branch -D "$br"
      deleted=$((deleted + 1))
      ;;
    OPEN) say "  keep  $br (PR open)" ;;
    *)    say "  keep  $br (no PR)" ;;
  esac
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
say "  -> $deleted deleted"

say "== stale deployment records (keep newest per environment) =="
# The --jq filter here is element-wise, so running per --paginate page is safe;
# the "newest per environment" grouping happens below across ALL pages (a jq
# group_by inside --jq would run per page and let stale records past page 1
# survive). Captured up front so a gh failure aborts (set -e) instead of
# silently looping zero times.
all_tsv=$(gh api 'repos/{owner}/{repo}/deployments?per_page=100' --paginate \
  -q '.[] | [.environment, .created_at, .id] | @tsv')
# Sort env asc, created_at desc; awk drops the first (newest) row per env.
stale_tsv=$(sort -t$'\t' -k1,1 -k2,2r <<<"$all_tsv" |
  awk -F'\t' '$1 == prev { print $3 "\t" $1 } { prev = $1 }')

remove_deployment() {
  # Tolerate a record deleted between listing and action (rerun, manual UI
  # cleanup) — skip it rather than aborting the rest of the batch.
  { gh api -X POST "repos/{owner}/{repo}/deployments/$1/statuses" -f state=inactive --silent &&
    gh api -X DELETE "repos/{owner}/{repo}/deployments/$1" --silent; } ||
    say "  warn: could not remove $1 (already gone?)"
}

stale=0
while IFS=$'\t' read -r id env; do
  [[ -z "$id" ]] && continue
  say "  stale $env deployment $id"
  run remove_deployment "$id"
  stale=$((stale + 1))
done <<<"$stale_tsv"
say "  -> $stale stale records"

$APPLY || say "dry-run only — rerun with --apply to delete"
