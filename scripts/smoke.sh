#!/usr/bin/env bash
# Smoke test: start the app, poll /health until both DBs report up, exit 0/1.
# Assumes databases are running (./scripts/db.sh up) and .env is configured.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
TIMEOUT_S="${SMOKE_TIMEOUT:-60}"

npm run start >/tmp/memoflow-smoke.log 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 "$TIMEOUT_S"); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo "smoke: /health OK"
    exit 0
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "smoke: app process died — last log lines:" >&2
    tail -20 /tmp/memoflow-smoke.log >&2
    exit 1
  fi
  sleep 1
done

echo "smoke: /health not healthy after ${TIMEOUT_S}s — last log lines:" >&2
tail -20 /tmp/memoflow-smoke.log >&2
exit 1
