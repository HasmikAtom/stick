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
- **Frontend (dev)** runs Vite on the host (:5173) and proxies `/api` to the dockerized auth-service at `:3000`.
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
make dev-build     # Build and start dev containers (hot reload)
make dev-logs      # Stream dev logs
make dev-down      # Stop dev containers
make prod-build-deploy  # Build and deploy production
make clean-dev     # Remove dev containers, images, volumes
make clean-prod    # Remove prod containers, images, volumes
make auth-dev      # Run auth-service on host (tsx watch)
make auth-shell-db # Open sqlite3 shell against ./data/auth.sqlite
```

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
- **Auth-service env**: Copy `auth-service/.env.example` to `auth-service/.env`. Required: `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`, `PLEX_TOKEN_ENC_KEY` (`openssl rand -hex 32`; encrypts stored Plex tokens at rest). Migrations run programmatically at server boot (no separate CLI step).
- **Package manager**: pnpm only (auth-service and frontend). Never use npm.
- **API proxy**: Dev server proxies `/api` to `VITE_API_TARGET` (default `http://localhost:3000`, the auth-service)
- **SSE endpoints**: `/scrape/piratebay/:name/stream` and `/scrape/rutracker/:name/stream` use Server-Sent Events. EventSource uses cookie auth via Better Auth.
- **Tests**: `auth-service` has node:test coverage for the allowlist hook, reverse proxy header stripping, and admin invite routes. `backend/middleware` has Go tests for `RequireUser`. Frontend has no tests.
