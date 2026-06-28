# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TorrentUI is a self-hosted web app for managing torrent downloads with Plex integration. It has a React frontend and Go backend that communicates with a Transmission BitTorrent daemon. Users can paste magnet links, upload .torrent files, or search ThePirateBay/RuTracker directly from the UI.

## Hosting & Authentication

The app is hosted on a personal server and exposed to the internet via a Cloudflare Tunnel. Authentication is Google OAuth via Better Auth, gated by an admin-managed email allowlist. Cloudflare Tunnel still terminates TLS but Cloudflare Access is no longer in front of the app.

## Architecture

```
Frontend (React+Vite, :5173 dev / served by auth-service in prod)
  → /api proxy →
Auth-service (Node+Hono+Better Auth, :3000)
  ├── /api/auth/*       → Better Auth handler (Google OAuth, sessions, admin plugin)
  ├── /api/admin/*      → Allowlist CRUD (requireAuth + requireAdmin)
  ├── /api/*            → reverse-proxy to Go backend (with X-User-Id/Email/Role headers)
  └── (prod) serves the React static bundle
       ↓
Backend (Go+Gin, :8085 dev / :8080 internal in prod, no public port)
  → Transmission RPC (:9091)
  → Chromedp headless browser (scraping TPB/RuTracker)
  → /mediastorage/{Movies,Series,Music} → Plex
```

- **auth-service** is the only public surface in prod. It owns sessions (SQLite via better-sqlite3), enforces the email allowlist, and reverse-proxies authenticated `/api/*` traffic to the Go backend after stripping any client-supplied `X-User-*` and `cookie` headers and re-attaching trusted ones from the validated session.
- **Plex account linking**: the auth-service also owns per-user Plex integration via Plex's PIN-based OAuth flow. Routes live under `/api/plex/*` (`link/start`, `link/poll`, `server`, `servers`, `status`, and `DELETE link`). It stores per-user Plex tokens encrypted at rest in SQLite (AES-256-GCM, key from `PLEX_TOKEN_ENC_KEY`) and injects a trusted `X-Plex-Token` + `X-Plex-Server-Url` header (resolved per user) onto proxied `/api/*` requests — the same trusted-header pattern used for `X-User-*`. The Go backend consumes those headers and exposes `/plex/ping` (verify the linked server is reachable) and `/plex/probe` (internal: pick the first reachable server connection URL).
- **Frontend (dev)** runs as the `torrent-frontend-dev` container (Vite with `--host 0.0.0.0`, the only dev service published to the host — on `:5173`) and proxies `/api` to the `auth-service` container at `:3000` over the Docker network. (A contributor with Node installed can alternatively run `pnpm dev` on the host.)
- **Backend** uses Chromedp browser pool (singleton via `sync.Once`) for scraping, with SSE streaming for real-time search results. All routes except `/health` require `X-User-Id`/`X-User-Email` headers (set only by auth-service).
- **Prepare-Edit-Finalize flow**: Torrents go through prepare → poll metadata → user edits name → finalize before downloading

## Development Commands

### Frontend (`cd frontend`)
```bash
pnpm dev           # Vite dev server on :5173 with HMR (proxies /api to auth-service on :3000)
pnpm build         # TypeScript check + Vite production build
pnpm lint          # ESLint
pnpm preview       # Serve production build on :3000
```

### Auth-service (`cd auth-service`)
```bash
pnpm dev           # tsx watch on :3000 (hot reload)
pnpm build         # tsc -p tsconfig.build.json (excludes tests)
pnpm test          # node:test suite (hooks, proxy, admin-routes)
pnpm typecheck     # tsc --noEmit (covers tests; pre-existing TS2769 warnings in test files are documented)
```

### Backend (`cd backend`)
```bash
go run .           # Run directly
air                # Hot reload (configured via .air.toml)
go test ./...      # Run middleware tests
```

### Docker (from project root)
```bash
make dev-build     # Build + start dev stack, foreground (hot reload)
make dev-build-deploy  # Same, detached (-d)
make dev-logs      # Stream dev logs
make dev-down      # Stop dev containers
make prod-build-deploy  # Build and deploy production
make clean-dev     # Remove dev containers, images, volumes
make clean-prod    # Remove prod containers, images, volumes
make auth-dev      # Run auth-service on host (tsx watch)
make auth-shell-db # Open sqlite3 shell against ./data/auth.sqlite
```

### Running the dev stack (primary way to run the app)

`make dev-build` (compose project `torrent-dev`, file `docker-compose.dev.yml`) builds and starts **all three services as containers** — no Node/Go needed on the host:
- `torrent-frontend-dev` — Vite, **published on host `:5173`** (the only dev port exposed to the host)
- `torrent-auth-dev` — auth-service, internal `:3000` (`expose` only, not published)
- `torrent-backend-dev` — Go backend, internal `:8080` (`expose` only)

The dev stack **coexists with the prod stack** (`torrent-prod` project): only the frontend publishes a host port, so there's no `:3000` clash with `torrent-auth-prod`.

**Env:** Compose auto-loads a repo-root `.env`. Minimum to boot cleanly: `PLEX_TOKEN_ENC_KEY` (`openssl rand -hex 32`) — without it the auth-service throws on Plex routes. To actually **log in**, also set `DEV_GOOGLE_CLIENT_ID`, `DEV_GOOGLE_CLIENT_SECRET`, and `BOOTSTRAP_ADMIN_EMAILS` (the app is gated behind Google OAuth + allowlist; other vars have working dev defaults in the compose file).

**Per-stack Google OAuth (important).** Dev and prod read **separate** OAuth vars from the one `.env`, so deploying one stack never clobbers the other's login config (the failure mode that used to break OAuth on every deploy):
- dev  → `DEV_GOOGLE_CLIENT_ID` / `DEV_GOOGLE_CLIENT_SECRET` / `DEV_BETTER_AUTH_URL` (defaults to `http://localhost:5173`)
- prod → `PROD_GOOGLE_CLIENT_ID` / `PROD_GOOGLE_CLIENT_SECRET` / `PROD_BETTER_AUTH_URL`

Better Auth derives the Google callback as `${BETTER_AUTH_URL}/api/auth/callback/google`, so each stack's origin must be registered as an Authorized redirect URI on its Google client (dev: `http://localhost:5173/api/auth/callback/google`; prod: `https://<host>/api/auth/callback/google`). A single Google client may serve both if it lists both redirect URIs. The shared `.env` keys (`BOOTSTRAP_ADMIN_EMAILS`, `PLEX_TOKEN_ENC_KEY`, `BETTER_AUTH_SECRET`) are common to both stacks, which share the same `./data/auth.sqlite`.

**pnpm is pinned** via the `packageManager` field (`pnpm@9.15.4`) in `auth-service/package.json` and `frontend/package.json` so corepack uses a Node-20-compatible pnpm in the `node:20-alpine` images. Do not remove it — without the pin, corepack pulls the latest pnpm (which requires Node 22) and the image builds fail with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`.

**Accessing the dev app** (the box is a LAN server; `DEV_BETTER_AUTH_URL=http://localhost:5173` ties Better Auth cookies + the Google OAuth redirect to the `localhost:5173` origin):
- **For login** — use an SSH tunnel so the browser origin stays `localhost`: from your machine `ssh -L 5173:localhost:5173 <user>@<server-ip>`, then open `http://localhost:5173`.
- **For a quick look only** (login will fail due to origin mismatch) — browse directly to `http://<server-ip>:5173` from any machine on the LAN (or the Tailscale IP from the tailnet).

### Deploying (single script)

`scripts/deploy.sh <dev|prod> [--build]` is the canonical one-command deploy, meant to be run on the server. It:
1. **Preflights env** via `scripts/check-env.sh <mode>` — refuses to deploy if required vars are missing (catches the missing-`.env`-key class of bug).
2. **Brings the stack up** (`docker compose -p torrent-<mode> -f <compose> up -d [--build]`).
3. **Verifies the backend** bound `:8080`.
4. **Verifies Google OAuth wiring** — asks the auth-service to build a Google sign-in URL and asserts its `redirect_uri` origin matches this stack's `BETTER_AUTH_URL` and that a `client_id` is present. A mismatch (the dev/prod origin-collision bug) fails the deploy with a clear message.

```bash
./scripts/deploy.sh dev          # or: --build to rebuild images first
./scripts/deploy.sh prod --build
```

The `make dev-build` / `make prod-build-deploy` targets still exist but call `docker compose` directly (no preflight/OAuth verification) — prefer `deploy.sh` for real deploys.

## Project Structure

```
auth-service/             # Node+Hono+Better Auth sidecar (pnpm)
  src/
    auth.ts               # betterAuth() config: Google OAuth, allowlist hook, admin plugin, self-modify guard
    db.ts                 # better-sqlite3 + invited_emails migration + bootstrap admin reconciliation
    middleware.ts         # requireAuth, requireAdmin (Hono)
    proxy.ts              # proxyToGo: strips x-user-*/cookie, attaches trusted headers, forwards /api/*
    admin-routes.ts       # /api/admin/invites GET/POST/DELETE
    server.ts             # Hono entry point: migrations on boot, route wiring, static SPA
    __tests__/            # node:test suite (hooks, proxy, admin-routes)

backend/
  main.go                 # Entry point: routes, Transmission client init, graceful shutdown
  config/                 # Environment-based config (DEV_* / PROD_* prefixed vars)
  middleware/auth.go      # RequireUser() Gin middleware reading X-User-Id/Email/Role
  transmission/           # Transmission RPC client implementation
  scraper/                # Chromedp browser pool, piratebay.go, rutracker.go, auth.go

frontend/
  src/
    App.tsx               # Router shell: useSession gating, BrowserRouter + Routes for /, /admin
    services.tsx          # apiFetch helper: credentials:'include' + 401 sign-out
    lib/auth-client.ts    # Better Auth React client (signIn, signOut, useSession)
    components/
      LoginScreen.tsx     # Google sign-in + allowlist error banner
      AppShell.tsx        # Header + admin link + user dropdown
      Home.tsx            # Tabbed interface (Download, PirateBay, RuTracker)
      AdminPage.tsx       # Allowlist + Users sections (gated to role=admin)
      TorrentDownloader.tsx  # Magnet/file upload with prepare-edit-finalize flow
      TorrentList.tsx        # Active torrents with 3s polling, rename/delete
      ScraperUI.tsx          # Search interface with SSE streaming progress
      ScrapedTorrents.tsx    # Search results with batch selection
      StorageInfo.tsx        # Storage usage visualization (30s polling)
      ui/                    # Radix-based shadcn-style primitives

data/                     # SQLite volume (auth.sqlite gitignored, bind-mounted into auth-service)
```

## Key Technical Details

- **Path alias**: `@/` maps to `frontend/src/` (configured in vite.config.ts and tsconfig)
- **Styling**: Tailwind CSS with CSS variables for theming (dark/light mode), custom slide animations
- **UI library**: shadcn-style components built on Radix UI primitives in `frontend/src/components/ui/`
- **Backend env**: Copy `backend/.env.example` to `backend/.env`; uses `DEV_` prefix for local dev, `PROD_` for Docker
- **Auth-service env**: the dockerized stacks read the repo-root `.env` (per-stack `DEV_*/PROD_*` Google OAuth + `BETTER_AUTH_URL`, plus shared `BETTER_AUTH_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`, `PLEX_TOKEN_ENC_KEY`) — see the dev-stack Env notes above and `.env.example`. For running auth-service standalone on the host, copy `auth-service/.env.example` to `auth-service/.env` (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`, `PLEX_TOKEN_ENC_KEY`). Migrations run programmatically at server boot (no separate CLI step).
- **Package manager**: pnpm only (auth-service and frontend). Never use npm.
- **API proxy**: Dev server proxies `/api` to `VITE_API_TARGET` (default `http://localhost:3000`, the auth-service)
- **SSE endpoints**: `/scrape/piratebay/:name/stream` and `/scrape/rutracker/:name/stream` use Server-Sent Events. EventSource uses cookie auth via Better Auth.
- **Tests**: `auth-service` has node:test coverage for the allowlist hook, reverse proxy header stripping, and admin invite routes. `backend/middleware` has Go tests for `RequireUser`. Frontend has no tests.
