#!/usr/bin/env bash
# Point this repo's git hooks at the tracked .githooks/ directory.
# Run once per clone:  bash scripts/install-hooks.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "Installed: core.hooksPath -> .githooks"
echo "Active hooks:"
ls -1 .githooks
