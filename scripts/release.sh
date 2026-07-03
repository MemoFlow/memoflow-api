#!/usr/bin/env bash
set -euo pipefail

# Conventional-versioning release wrapper.
#
# The version is SemVer derived from Conventional Commits by commit-and-tag-version
# (config: .versionrc.json). Bumping the version, writing CHANGELOG.md, and tagging
# vX.Y.Z is a CI-only action on the `main`-push (production) workflow — see the
# `devops` agent and CLAUDE.md's gitflow/versioning rules.
#
# This wrapper is the actual guard behind that rule: a mutating release is refused
# outside CI unless deliberately overridden. Previews (--dry-run) are always allowed.
#
# Usage:
#   scripts/release.sh [commit-and-tag-version args]   # mutating; CI-only by default
#   scripts/release.sh --dry-run                        # preview, allowed anywhere
#
# Env:
#   CI=true                 set by the CI runner; the sanctioned place to release
#   RELEASE_ALLOW_LOCAL=1   deliberate local override (e.g. cutting the 1.0.0 release)

args=("$@")

is_dry=false
for a in ${args[@]+"${args[@]}"}; do
  if [[ "$a" == "--dry-run" ]]; then
    is_dry=true
  fi
done

if [[ "$is_dry" == false && "${CI:-}" != "true" && "${RELEASE_ALLOW_LOCAL:-}" != "1" ]]; then
  echo "release: refusing to mutate version / CHANGELOG.md / tags outside CI." >&2
  echo "  The release runs in the main-push (production) workflow, not by hand." >&2
  echo "  Preview locally with:   npm run release:dry" >&2
  echo "  Deliberate override:    RELEASE_ALLOW_LOCAL=1 npm run release:first" >&2
  exit 1
fi

exec npx commit-and-tag-version ${args[@]+"${args[@]}"}
