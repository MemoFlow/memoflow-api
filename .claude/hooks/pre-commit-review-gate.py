#!/usr/bin/env python3
"""PreToolUse/Bash gate: block the `/commit` apply step until the code-reviewer
agent has approved the CURRENT working diff.

Approval is recorded as <git-dir>/code-review-ok containing the sha256 of
`git diff HEAD`. The orchestrator writes it after code-reviewer returns APPROVE;
if the diff changes afterward the hash no longer matches and the gate re-fires.
Bypass intentionally by prefixing the commit with SKIP_CODE_REVIEW=1.

Design notes (from review):
- Match ONLY tool_input.command, never the whole payload — otherwise the
  description/cwd/path fields spoof both the trigger and the bypass.
- Fail CLOSED: any git/parse error yields a non-matching hash so the gate denies
  rather than letting an unreviewed commit through.
- Emit JSON via json.dumps so a git-dir path with quotes can't break the output.
"""
import hashlib
import json
import re
import subprocess
import sys


def allow():
    sys.exit(0)


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        # Can't parse the payload — not our place to block.
        allow()

    cmd = ""
    if isinstance(data, dict):
        ti = data.get("tool_input")
        if isinstance(ti, dict):
            cmd = ti.get("command") or ""

    # Only gate the commit-apply step: commit_helper.py invoked with the `apply`
    # subcommand as its own token (not "reapply", not a substring in prose).
    if "commit_helper.py" not in cmd or not re.search(r"(^|\s)apply(\s|$)", cmd):
        allow()

    # Explicit, auditable bypass — matched against the command only.
    if "SKIP_CODE_REVIEW=1" in cmd:
        allow()

    try:
        gitdir = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            capture_output=True, text=True,
        ).stdout.strip() or ".git"
    except Exception:
        gitdir = ".git"
    marker = f"{gitdir}/code-review-ok"

    cur = ""
    try:
        diff = subprocess.run(["git", "diff", "HEAD"], capture_output=True).stdout
        cur = hashlib.sha256(diff).hexdigest()
    except Exception:
        cur = ""

    approved = False
    if cur:
        try:
            with open(marker) as f:
                approved = f.read().strip() == cur
        except Exception:
            approved = False

    if approved:
        allow()

    reason = (
        "code-reviewer has not approved the current diff. Run the code-reviewer "
        "agent on the working diff; after it returns APPROVE, record approval with:  "
        'git diff HEAD | sha256sum | cut -d " " -f1 > "$(git rev-parse --git-dir)/code-review-ok"  '
        "then retry the commit. Bypass intentionally by prefixing the commit "
        "command with SKIP_CODE_REVIEW=1."
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
