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
else
  echo "${RED}✗ backend did not bind :8080 within 15s — check: docker logs $BACKEND${RST}"
  exit 1
fi

# 4) Verify Google OAuth wiring: the redirect_uri the auth-service will hand to
#    Google must use THIS stack's own origin. A mismatch here is exactly what
#    broke login on every deploy (dev/prod sharing one BETTER_AUTH_URL/client).
AUTH="torrent-auth-$MODE"
# Wait for the auth-service to actually be listening before probing it
# (a freshly recreated container isn't up the instant `up -d` returns).
for _ in $(seq 1 15); do
  if docker exec "$AUTH" sh -c '(netstat -tln 2>/dev/null || ss -tln) | grep -q ":3000 "' 2>/dev/null; then
    break
  fi
  sleep 1
done
origin_expected="$(docker exec "$AUTH" sh -c 'printf %s "$BETTER_AUTH_URL"' 2>/dev/null || true)"
oauth="$(docker exec "$AUTH" node -e '
fetch("http://localhost:3000/api/auth/sign-in/social",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:"google",callbackURL:"/"})})
 .then(r=>r.json())
 .then(j=>{const u=new URL(j.url);const ru=u.searchParams.get("redirect_uri");const cid=u.searchParams.get("client_id");process.stdout.write((ru?new URL(ru).origin:"NO_REDIRECT")+" "+(cid?"client_set":"NO_CLIENT"));})
 .catch(e=>process.stdout.write("ERR "+e.message));' 2>/dev/null || true)"
origin_actual="${oauth%% *}"; client_state="${oauth#* }"
MODEUP="$(printf '%s' "$MODE" | tr '[:lower:]' '[:upper:]')"
if [[ "$origin_actual" == "$origin_expected" && "$client_state" == "client_set" ]]; then
  echo "${GRN}✓ Google OAuth wired for ${origin_expected} (redirect_uri + client_id set)${RST}"
elif [[ "$client_state" != "client_set" ]]; then
  echo "${RED}✗ Google OAuth: auth-service produced no client_id — set ${MODEUP}_GOOGLE_CLIENT_ID/SECRET in .env${RST}"
  echo "${RED}  (auth-service response: ${oauth:-<none>})${RST}"
  exit 1
else
  echo "${RED}✗ Google OAuth origin mismatch: auth-service emits '${origin_actual}' but this stack's origin is '${origin_expected}'.${RST}"
  echo "${RED}  Google will reject login (redirect_uri_mismatch). Fix ${MODEUP}_BETTER_AUTH_URL in .env.${RST}"
  exit 1
fi

echo "${GRN}${BLD}$MODE stack is up.${RST}"
