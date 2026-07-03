#!/usr/bin/env bash
# Dev database helper: ./scripts/db.sh up|down|reset|seed
set -euo pipefail

cd "$(dirname "$0")/.."

case "${1:-}" in
  up)
    docker compose up -d --wait
    echo "postgres:5432 and mongo:27017 are up."
    ;;
  down)
    docker compose down
    ;;
  reset)
    docker compose down -v
    docker compose up -d --wait
    echo "Databases reset (volumes wiped)."
    ;;
  seed)
    npx ts-node scripts/seed.ts
    ;;
  *)
    echo "Usage: $0 {up|down|reset|seed}" >&2
    exit 1
    ;;
esac
