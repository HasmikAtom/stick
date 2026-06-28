# Plex Auth Foundation — Design

**Date:** 2026-06-22
**Status:** Approved (design)
**Scope:** Per-user Plex account linking foundation. Features that consume it are separate follow-on specs.

## Summary

TorrentUI has no Plex API integration today — "Plex integration" currently means downloads land
in `/mediastorage/{Movies,Series,Music}`, which a Plex server happens to watch. There is no Plex
token, API client, or plex.tv contact anywhere in the codebase.

This spec adds a **per-user Plex account link** using Plex's PIN-based OAuth flow (the same flow
Tautulli uses: `POST /api/v2/pins` → user authorizes → poll for `authToken` → discover servers via
`/api/v2/resources`). It establishes token storage, server discovery + selection, and an
end-to-end "test connection" call — the verifiable foundation that later features build on.

### In scope
- Per-user PIN OAuth link flow, owned by the auth-service.
- Encrypted token storage in the auth-service SQLite DB, keyed by `user_id`.
- Server discovery and selection, with reachability probed from the Go backend's network.
- Proxy header injection (`X-Plex-Token`, `X-Plex-Server-Url`) following the existing `X-User-*` pattern.
- A Go `GET /plex/ping` endpoint that proves the full chain works end-to-end.
- Per-user Plex settings UI (`PlexSettings.tsx`).

### Out of scope (separate follow-on specs)
- Scan-on-finalize (trigger a Plex library scan after a download completes).
- Library-state queries (show what's already in Plex; dedupe search results).
- Now-playing / activity monitoring via the Plex notification WebSocket.

## Architecture

Chosen approach: **auth-service owns the Plex auth + token; the Go backend consumes it via injected
headers.** This matches how the codebase already separates "auth-service owns identity/secrets and
injects trusted headers" from "Go does the work." The Go backend stays stateless (no new datastore).

Cost of this approach: a thin plex.tv client lives in Node (PIN + discovery), while media calls live
in Go — two HTTP clients. Accepted as the smallest change that fits the existing trust boundary.

### Components

| Where | What |
|---|---|
| auth-service (Node) | `src/plex/plextv.ts` — thin plex.tv client (create PIN, poll PIN, list resources). `src/plex/store.ts` — SQLite CRUD + encryption. `src/plex-routes.ts` — link/poll/select/status/unlink. Proxy change to inject `X-Plex-*`. |
| Go backend | `plex/` — reads injected headers; `GET /plex/ping` calls the selected server's `/identity`; internal probe endpoint for connection-reachability testing. Seed of the client features will reuse. |
| Frontend | `src/components/PlexSettings.tsx` — per-user link UI, reached from the AppShell user dropdown. |

### Data flow — linking

```
Frontend ──POST /api/plex/link/start──▶ auth-service ──POST plex.tv /api/v2/pins?strong=true──▶ {id, code}
   ◀── {code, authUrl} ──┘   (user opens authUrl, authorizes on plex.tv)
Frontend ──poll GET /api/plex/link/poll──▶ auth-service ──GET plex.tv /api/v2/pins/{id}──▶ authToken
                                              └─ on token: GET /api/v2/resources, store token, return server list
Frontend ──POST /api/plex/server (pick one)──▶ auth-service: Go probes connections, stores {machineId, uri, serverToken}
```

### Data flow — steady state

On every `/api/*` request, the auth-service proxy looks up the requesting user's stored connection
and attaches `X-Plex-Token` + `X-Plex-Server-Url`, after stripping any client-supplied copies (exactly
as it already does for `X-User-Id/Email/Role`). The Go backend reads them off the Gin context. If the
user has no linked connection, no Plex headers are attached and Plex features no-op.

## Storage

### Client identifier

Plex requires a stable `X-Plex-Client-Identifier` that identifies the **app**, not the user. Generate
one UUID on first boot, persist it in a single-row `plex_app` table, and reuse it for all users' PIN
flows. Plex ties each resulting token to whichever account authorized it.

### Schema (auth-service SQLite, alongside Better Auth tables)

```sql
CREATE TABLE plex_app (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  client_id     TEXT NOT NULL          -- generated once
);
CREATE TABLE plex_connection (
  user_id           TEXT PRIMARY KEY,  -- FK → Better Auth user.id
  plex_username     TEXT,              -- for display
  account_token     TEXT NOT NULL,     -- plex.tv account token (encrypted at rest)
  server_machine_id TEXT,              -- null until user picks a server
  server_name       TEXT,
  server_uri        TEXT,              -- chosen connection URI from discovery
  server_token      TEXT,              -- per-server access token (encrypted)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
```

Migrations run programmatically at server boot, consistent with the existing `invited_emails`
migration pattern.

### Token encryption

Tokens are full Plex credentials, so they are **encrypted at rest** with AES-256-GCM. The key is
derived from a dedicated `PLEX_TOKEN_ENC_KEY` env var (`openssl rand -hex 32`). Tokens are decrypted
in-memory only when injecting headers or probing.

### Pending-PIN state

The `{pinId, clientId}` between `link/start` and `link/poll` is kept in an **in-memory Map** keyed by
`user_id`, not the DB — it is short-lived. Trade-off: if the auth-service process restarts mid-link,
the user clicks Connect again. Acceptable for a self-hosted app.

## Endpoints

All under `/api/plex`, all `requireAuth`; a user only ever reads/writes their own row (keyed by session
`user_id`).

| Method + path | Behaviour |
|---|---|
| `POST /link/start` | Create PIN; return `{code, authUrl}`. `authUrl` = `https://app.plex.tv/auth#?clientID=<cid>&code=<code>&context[device][product]=TorrentUI` |
| `GET /link/poll` | Poll plex.tv PIN. Returns `{status:"pending"}`, or on success stores token, runs discovery, returns `{status:"linked", servers:[...]}` |
| `POST /server` | Body `{machineId}`. Go probes that server's connections (local → remote → relay); store the first reachable `{uri, serverToken}` |
| `GET /status` | `{linked, plexUsername, serverName, state}` for rendering current state |
| `DELETE /link` | Delete the connection row (unlink) |

Go backend:

| Method + path | Behaviour |
|---|---|
| `GET /plex/ping` | Use injected headers to `GET <server_uri>/identity`; return `{reachable, machineIdentifier, version}` |
| internal probe | Given candidate connection URIs + token, return the first reachable; used by `POST /server` |

### plex.tv calls (v2 JSON)

- `POST https://plex.tv/api/v2/pins?strong=true` (no token) → `{id, code}`
- `GET https://plex.tv/api/v2/pins/{id}` (no token) → `authToken` populated once authorized
- `GET https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1` (with token) → servers + `connections[]` + per-server `accessToken`

All carry `X-Plex-Client-Identifier` + `X-Plex-Product` / `X-Plex-Version` / `X-Plex-Device` headers.

## Security

- Plex tokens encrypted at rest (AES-256-GCM, `PLEX_TOKEN_ENC_KEY`); decrypted only in-memory.
- Proxy strips any client-supplied `X-Plex-*` before attaching trusted values — same defense as the
  existing `X-User-*` stripping. The browser can never inject its own Plex token.
- No SSRF surface: `server_uri` is never free-form user input; it is chosen only from plex.tv's
  discovery response. The Go backend connects to discovered URIs exclusively.
- All `/api/plex/*` routes require an authenticated session and operate only on the caller's own row.

## Error handling & edge cases

- **PIN not yet authorized** → poll returns `pending`; frontend keeps polling (cap ~2 min, then "expired, try again").
- **PIN expired** → plex.tv 404/empty → surface "link expired," reset to start.
- **Token revoked later** → Plex returns 401 on `/ping` or feature calls → status flips to `needs_reconnect`; UI shows "Reconnect to Plex."
- **No reachable server connection** → `POST /server` probe fails on all candidates → return an error that lists the discovered servers, so the user knows discovery worked but networking did not.
- **Allowlisted user who never linked Plex** → proxy attaches no Plex headers; Plex features no-op. Core torrent app is unaffected.

## Frontend UX (`PlexSettings.tsx`)

- Reached from the AppShell user dropdown ("Plex" item). Per-user.
- States:
  - **Not linked** → "Connect to Plex" button → shows the `code` and opens `authUrl` in a popup, with a polling spinner.
  - **Server picker** → shown only if discovery returns >1 server; auto-select if exactly one.
  - **Linked** → card showing Plex username + server name + "Test connection" + "Unlink."
- Uses the existing `apiFetch` helper (cookie auth, 401 → sign-out) and the shadcn/Radix UI primitives,
  matching `AdminPage.tsx` conventions.

## Testing

- **auth-service (node:test):** mock `fetch` for the plextv client (create/poll/resources); store CRUD
  round-trip including encrypt/decrypt; proxy test asserting Plex headers are attached when linked and
  client-supplied ones stripped. Mirrors the existing `__tests__` patterns.
- **Go:** handler test for `/plex/ping` against an `httptest` Plex stub; middleware test reading
  injected headers.
- **Manual verify:** real link against the owner's actual Plex account, end-to-end — the foundation's
  acceptance test.

## New configuration

- `auth-service`: `PLEX_TOKEN_ENC_KEY` (required; `openssl rand -hex 32`).
- No new Go env vars — the backend receives everything it needs via injected headers.
