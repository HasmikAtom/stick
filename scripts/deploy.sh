#!/usr/bin/env bash
# One-command deploy for the dev or prod stack, with an env preflight check.
#
#   ./scripts/deploy.sh dev            # start dev stack (no rebuild)
#   ./scripts/deploy.sh dev --build    # rebuild images, then start dev stack
#   ./scripts/deploy.sh prod           # start prod stack
#   ./scripts/deploy.sh prod --build   # rebuild images, then start prod stack
#
# Refuses to deploy if required env vars are missing (see scripts/check-env.sh).
# After bringing the stack up it verifies the backend is listening on :8080.

set -euo pipefail

MODE="${1:-}"
BUILD=""
case "${2:-}" in
  "")        ;;
  --build)   BUILD="--build" ;;
  *) echo "unknown flag: ${2:-} (only --build is supported)" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$MODE" == "dev" ]]; then
  PROJECT="torrent-dev";  FILE="docker-compose.dev.yml";  BACKEND="torrent-backend-dev"
elif [[ "$MODE" == "prod" ]]; then
  PROJECT="torrent-prod"; FILE="docker-compose.yml";       BACKEND="torrent-backend-prod"
else
  echo "usage: $0 <dev|prod> [--build]" >&2
  exit 2
fi

if [[ -t 1 ]]; then BLD=$'\033[1m'; GRN=$'\033[32m'; RED=$'\033[31m'; RST=$'\033[0m'; else BLD=''; GRN=''; RED=''; RST=''; fi

# 1) Preflight: env must be valid before we touch docker.
echo "${BLD}== Preflight ==${RST}"
"$ROOT/scripts/check-env.sh" "$MODE"

# 2) Bring the stack up.
echo
echo "${BLD}== Deploying $MODE (project=$PROJECT${BUILD:+, rebuild}) ==${RST}"
docker compose -p "$PROJECT" -f "$FILE" up -d $BUILD

# 3) Verify the backend bound :8080 (the bug class these scripts guard against).
echo
echo "${BLD}== Verifying ==${RST}"
ok=0
for _ in $(seq 1 15); do
  if docker exec "$BACKEND" sh -c '(netstat -tln 2>/dev/null || ss -tln) | grep -q ":8080 "' 2>/dev/null; then
    ok=1; break
  fi
  sleep 1
done

docker compose -p "$PROJECT" -f "$FILE" ps
echo
if [[ "$ok" -eq 1 ]]; then
  echo "${GRN}✓ backend listening on :8080${RST}"
  echo "${GRN}${BLD}$MODE stack is up.${RST}"
else
  echo "${RED}✗ backend did not bind :8080 within 15s — check: docker logs $BACKEND${RST}"
  exit 1
fi
