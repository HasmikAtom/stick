#!/usr/bin/env bash
# Validate that the repo-root .env has everything a given stack needs before deploying.
#
#   ./scripts/check-env.sh dev    # vars needed to boot + log in to the dev stack
#   ./scripts/check-env.sh prod   # vars needed to boot the prod stack
#
# Exits non-zero if any REQUIRED var is missing/invalid. Optional vars only warn.
# Reads values from the current shell environment first, then the .env file
# (the same precedence docker compose uses), so it never executes the .env.

set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "usage: $0 <dev|prod>" >&2
  exit 2
fi

# Resolve repo root from this script's location so it works from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# ---- colors (disabled when not a tty) ----
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
else
  RED=''; GRN=''; YEL=''; BLD=''; RST=''
fi

fail=0
warn=0

# get_env KEY -> prints the effective value (shell env wins over .env file).
get_env() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return
  fi
  [[ -f "$ENV_FILE" ]] || return 0
  # last matching assignment wins; keep everything after the first '='.
  # `|| true` so a not-found key (grep exit 1) doesn't trip set -e/pipefail.
  { grep -E "^[[:space:]]*${key}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2-
}

require() { # require KEY "human description"
  local key="$1" desc="$2" val
  val="$(get_env "$key")"
  if [[ -z "$val" ]]; then
    echo "  ${RED}✗ MISSING${RST} ${BLD}$key${RST} — $desc"
    fail=1
  else
    echo "  ${GRN}✓${RST} $key"
  fi
}

optional() { # optional KEY "human description"
  local key="$1" desc="$2" val
  val="$(get_env "$key")"
  if [[ -z "$val" ]]; then
    echo "  ${YEL}• unset${RST}  ${BLD}$key${RST} — $desc (optional)"
    warn=1
  else
    echo "  ${GRN}✓${RST} $key"
  fi
}

echo "${BLD}Checking env for: $MODE${RST}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "  ${YEL}note${RST}: no $ENV_FILE found — relying on shell environment only"
fi

# ---- vars required by BOTH stacks (allowlist + Plex; same ./data/auth.sqlite) ----
# NB: Google OAuth client + BETTER_AUTH_URL are per-stack (DEV_*/PROD_*) below,
# because dev and prod need different redirect URIs / clients.
require BOOTSTRAP_ADMIN_EMAILS "comma-separated admin allowlist; without it nobody can log in"
require PLEX_TOKEN_ENC_KEY     "AES key for Plex tokens at rest"

# PLEX_TOKEN_ENC_KEY must be exactly 64 hex chars (auth-service/src/plex/crypto.ts).
plexkey="$(get_env PLEX_TOKEN_ENC_KEY)"
if [[ -n "$plexkey" ]]; then
  if [[ ! "$plexkey" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "  ${RED}✗ INVALID${RST} ${BLD}PLEX_TOKEN_ENC_KEY${RST} — must be 64 hex chars (got ${#plexkey}); generate with: openssl rand -hex 32"
    fail=1
  fi
fi

if [[ "$MODE" == "prod" ]]; then
  # ---- prod compose has NO defaults; these must be set explicitly ----
  require PROD_GOOGLE_CLIENT_ID     "Google OAuth client id (prod client; redirect https://<host>/api/auth/callback/google)"
  require PROD_GOOGLE_CLIENT_SECRET "Google OAuth client secret (prod client)"
  require BETTER_AUTH_SECRET      "session/cookie signing secret; openssl rand -hex 32"
  require PROD_BETTER_AUTH_URL    "public origin, e.g. https://torrents.example.com (binds cookies + OAuth redirect)"
  require PROD_TRANSMISSION_HOST  "Transmission RPC host"
  require PROD_TRANSMISSION_PORT  "Transmission RPC port (usually 9091)"
  optional PROD_TRANSMISSION_USERNAME "Transmission RPC user (only if RPC auth is enabled)"
  optional PROD_TRANSMISSION_PASSWORD "Transmission RPC password (only if RPC auth is enabled)"

  # Safety nits specific to a public deployment.
  secret="$(get_env BETTER_AUTH_SECRET)"
  if [[ "$secret" == "dev-only-secret-change-me-dev-only-secret" ]]; then
    echo "  ${RED}✗${RST} BETTER_AUTH_SECRET is the dev placeholder — set a real one for prod"
    fail=1
  elif [[ -n "$secret" && ${#secret} -lt 32 ]]; then
    echo "  ${YEL}!${RST} BETTER_AUTH_SECRET is short (${#secret} chars); 32+ recommended"
    warn=1
  fi
  url="$(get_env PROD_BETTER_AUTH_URL)"
  if [[ -n "$url" && "$url" != https://* ]]; then
    echo "  ${YEL}!${RST} PROD_BETTER_AUTH_URL is not https:// ($url) — Google OAuth + secure cookies expect a public https origin"
    warn=1
  fi
else
  # ---- dev: most vars have working defaults in docker-compose.dev.yml ----
  require DEV_GOOGLE_CLIENT_ID     "Google OAuth client id (dev client; redirect http://localhost:5173/api/auth/callback/google)"
  require DEV_GOOGLE_CLIENT_SECRET "Google OAuth client secret (dev client)"
  optional BETTER_AUTH_SECRET     "has a dev default; fine to leave unset locally"
  optional DEV_BETTER_AUTH_URL    "defaults to http://localhost:5173"
  optional DEV_TRANSMISSION_HOST  "defaults to host.docker.internal"
  optional DEV_TRANSMISSION_PORT  "defaults to 9091"
fi

echo
if [[ "$fail" -ne 0 ]]; then
  echo "${RED}${BLD}FAIL${RST} — required variables are missing or invalid (see above)."
  exit 1
fi
if [[ "$warn" -ne 0 ]]; then
  echo "${GRN}${BLD}OK${RST} — required variables present. ${YEL}(some optional vars unset)${RST}"
else
  echo "${GRN}${BLD}OK${RST} — all variables present."
fi
