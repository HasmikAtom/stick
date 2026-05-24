# Dashboard Redesign — Design

**Date:** 2026-05-25
**Status:** Spec — pending implementation
**Branch:** `dashboard-redesign`

## Goal

Replace the tab-switcher home page (Download / Pirate Bay / Rutracker) with a customizable widget dashboard. The recent move of navigation into a collapsible sidebar (`sidebar-layout-amoled-theme` branch) freed the top bar; this redesign uses that space for a global search input and restructures the home page around four glanceable widgets: **Active Torrents**, **Quick Add**, **Storage**, **Recent Activity**.

Users get drag-and-resize customization (medium tier) via a toggleable edit mode. Per-user layouts persist in a new SQLite database on the Go backend, which doubles as the foundation for future per-user app data (connector configs, plex preferences, etc.).

## Constraints

- Builds on top of `sidebar-layout-amoled-theme` (top bar replaced with shadcn collapsible sidebar, AMOLED theme). That branch must merge first, or this branch must rebase on it.
- Go backend has no SQLite today; this design introduces it.
- Only torrenting concerns in scope. Plex/Movies/Integrations branches are not assumed to land in this work.
- No frontend test harness exists; not introducing one here.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Dashboard direction | **Multi-panel dashboard**, not a tab switcher | Top-bar freed by sidebar; user wants multiple things visible at once |
| Widgets in v1 | Active Torrents, Quick Add, Storage, Recent Activity | Confirmed scope; search is **not** a widget |
| Search location | **Top bar**, routes to dedicated `/search?q=…` | Global app action, not dashboard-local; results need full-page room for SSE streaming |
| Source selector | **Implicit** — always hit both PirateBay and Rutracker; show source as a per-row badge | Removes a stateful chooser; one fewer thing to remember |
| Default layout | "Hero + utility rail" (Active wide-left, Quick Add / Storage / Recent stacked right) | Active Torrents is the primary thing users look at; utilities glanceable on the right |
| Customization tier | **Medium** — drag + resize on a 12-col snap grid; hide widgets; per-user persistence | Standard dashboard behavior; bigger than "drag only" but bounded |
| Edit mode | **Toggle button** + explicit **Save / Cancel** pills | Prevents accidental layout shifts; lets user back out without persisting |
| Grid library | **`react-grid-layout`** | Battle-tested; drag/resize/snap/collision/responsive out of the box; ~30KB gz is fine for self-hosted |
| Persistence layer | **New SQLite database on the Go backend** | Foundation for future per-user data (connectors/plex); keeps auth-service narrowly scoped to auth |
| SQLite driver | **`modernc.org/sqlite`** (pure Go, no CGO) | Avoids Alpine/CGO build pain; performance is fine for a JSON-blob-per-user table |
| Migration approach | `CREATE TABLE IF NOT EXISTS` from an embedded `schema.sql` | Single table; introducing `golang-migrate`/`goose` is premature |
| Mobile | Below `md` (768px), bypass the grid and render a fixed single-column stack in default order; hide Edit | Mobile drag/resize UX is its own scope problem; don't take it on |
| Auth gating | Reuse existing layers — `useSession` gate on the frontend, `RequireUser` middleware on the Go backend; auth-service strips and re-attaches `X-User-*` headers | No new auth code needed |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite)                                             │
│                                                                     │
│   /          → Dashboard (4 widgets, react-grid-layout)             │
│   /search    → SearchPage (ScraperUI in mode='both')                │
│   /admin     → AdminPage (unchanged)                                │
│                                                                     │
│   AppShell ─ top bar: [SidebarTrigger][TorrentUI][Search…][Edit ✎] │
│            └ sidebar: collapsible (Home, Admin, [user] in footer)   │
│                                                                     │
│   Dashboard reads/writes layout via:                                │
│     GET  /api/user/dashboard                                        │
│     PUT  /api/user/dashboard                                        │
└─────────────────────────────────────────────────────────────────────┘
        │ (cookie auth)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ auth-service (Node + Hono + Better Auth)                            │
│                                                                     │
│   /api/auth/*   → Better Auth                                       │
│   /api/admin/*  → in-process admin routes                           │
│   /api/*        → strip x-user-*/cookie, attach trusted             │
│                   X-User-Id/Email/Role, reverse-proxy to Go         │
│                                                                     │
│   (no new code for dashboard — pass-through)                        │
└─────────────────────────────────────────────────────────────────────┘
        │ (X-User-Id/Email/Role headers)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Backend (Go + Gin)                                                  │
│                                                                     │
│   RequireUser middleware (existing)                                 │
│     │                                                               │
│     ├─ /api/torrents/*   (existing — Transmission RPC)              │
│     ├─ /api/scrape/*     (existing — chromedp scraping)             │
│     └─ /api/user/dashboard  (NEW)                                   │
│                                                                     │
│   New: backend/db (modernc.org/sqlite + embedded schema.sql)        │
│   New: backend/dashboard (repository + handlers)                    │
│                                                                     │
│   /data/backend.sqlite                                              │
│     └─ user_dashboard_layouts(user_id PK, layout, updated_at)       │
└─────────────────────────────────────────────────────────────────────┘
```

## UX

### Top bar (`AppShell`)

| Slot | Today (sidebar branch) | New |
|---|---|---|
| Left | `SidebarTrigger` + `\|` + "TorrentUI" label | unchanged |
| Center | empty | **Global search input** (debounced, `Enter` → `navigate('/search?q=…')`) |
| Right | (none — user menu lives in sidebar footer) | **Edit dashboard** toggle button; when active, **Save / Cancel** pills appear next to it |

`/admin` shows the top bar with no search and no Edit button (those belong to the dashboard).

### Default dashboard layout

12-column grid, row height ~80px:

```
Active Torrents:   x=0, y=0, w=8, h=8   (tall hero, ~⅔ width)
Quick Add:         x=8, y=0, w=4, h=3
Storage:           x=8, y=3, w=4, h=3
Recent Activity:   x=8, y=6, w=4, h=5
```

Applied when no saved layout exists, or when the user clicks "Reset to default" in edit mode.

### Edit mode behaviors

- Toggling Edit copies the persisted layout into a `draftLayout` (component state)
- Drag handles + resize corners + a hide "×" appear on every widget
- An **"+ Add widget ▾"** dropdown and **"Reset to default"** link appear above the grid (only in edit mode)
- **Save** → `PUT /api/user/dashboard` with the draft; on success, draft becomes persisted and edit mode exits
- **Cancel** → discard draft, exit edit mode
- Navigating away while editing → `useBlocker` + `beforeunload` confirm: "Discard unsaved changes?"

## Frontend architecture

### Component tree

```
frontend/src/
├── components/
│   ├── AppShell.tsx                       MODIFIED — adds search + edit-toggle slots
│   ├── Home.tsx                           REWRITTEN — was tabs, now Dashboard host
│   │
│   ├── dashboard/
│   │   ├── Dashboard.tsx                  NEW — orchestrates grid + edit mode
│   │   ├── DashboardGrid.tsx              NEW — wraps react-grid-layout
│   │   ├── DashboardContext.tsx           NEW — { layout, draft, isEditing, ... }
│   │   ├── EditToolbar.tsx                NEW — Add-widget dropdown + Reset
│   │   ├── WidgetFrame.tsx                NEW — title bar + × hide + resize chrome
│   │   ├── defaultLayout.ts               NEW — the JSON shown above
│   │   ├── widgetRegistry.ts              NEW — id → { title, icon, component, minW, minH }
│   │   └── useDashboardLayout.ts          NEW — fetch/save layout to backend
│   │
│   ├── widgets/
│   │   ├── ActiveTorrentsWidget.tsx       NEW — wraps existing TorrentList
│   │   ├── QuickAddWidget.tsx             NEW — wraps existing TorrentDownloader
│   │   ├── StorageWidget.tsx              NEW — wraps existing StorageInfo
│   │   └── RecentActivityWidget.tsx       NEW — new component (data source below)
│   │
│   └── topbar/
│       ├── TopBarSearch.tsx               NEW — input, debounce, route to /search
│       └── EditDashboardToggle.tsx        NEW — toggle + Save/Cancel pills
│
├── pages/
│   └── SearchPage.tsx                     NEW — route /search, hosts ScraperUI
│
├── Scraper/
│   └── ScraperUI.tsx                      MODIFIED — accept `mode: 'both'|'piratebay'|'rutracker'`, render source-badge column
│
└── TorrentList.tsx, TorrentDownloader.tsx, StorageInfo.tsx — internals UNCHANGED,
   wrapped by widget shells. Props-driven so widgets can pass a "compact" hint at narrow widths.
```

### Key contracts

```ts
// widgetRegistry — one place to declare a widget
type WidgetDef = {
  id: 'active' | 'quickAdd' | 'storage' | 'recent';
  title: string;
  icon: LucideIcon;
  component: React.FC;
  defaultW: number; defaultH: number;
  minW: number;     minH: number;
};

// DashboardContext — single source of truth for editing
{
  persistedLayout: WidgetLayout[];   // last-saved
  draftLayout: WidgetLayout[] | null; // non-null iff editing
  isEditing: boolean;
  beginEdit(): void;
  cancelEdit(): void;
  saveEdit(): Promise<void>;
  moveOrResize(id, partial): void;
  hide(id): void;
  add(id): void;
  resetDraft(): void;
}
```

`AppShell` reads `isEditing` from context to show/hide the Save/Cancel pills next to the Edit button. The `EditDashboardToggle` lives in the top bar's right slot.

### Recent Activity data source

`RecentActivityWidget` shows the last N completed torrents — **no new backend endpoint or table**. Derive from Transmission's existing torrent list: filter `percentDone === 1`, sort by `doneDate` desc, take top 5.

To avoid two parallel 3-second polls (one for `ActiveTorrentsWidget`, one for `RecentActivityWidget`), lift the polling into a shared `useTorrents()` hook that both widgets subscribe to. One source of truth, one network call.

### Routing changes

`App.tsx`:
```
/         → Home (Dashboard)
/search   → SearchPage          NEW
/admin    → AdminPage           unchanged
```

The old `Home.tsx` tab structure (and its slide animations) is **deleted**. `ScraperUI` is reused inside `SearchPage` with `mode='both'` — it runs SSE against both sources in parallel and tags each row with a source badge instead of being per-tab.

## Persistence & API

### Schema

```sql
-- backend/db/schema.sql (embedded via //go:embed)
CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  user_id    TEXT PRIMARY KEY,
  layout     TEXT NOT NULL,    -- JSON: StoredLayout
  updated_at INTEGER NOT NULL  -- unix epoch ms
);
```

One row per user. `user_id` is the Better Auth user id. No FK (Better Auth owns the user table; orphan rows are harmless).

### Layout JSON

```ts
type WidgetLayout = {
  i: 'active' | 'quickAdd' | 'storage' | 'recent';
  x: number; y: number;          // 0..11
  w: number; h: number;
};

type StoredLayout = {
  version: 1;                    // forward-compat
  widgets: WidgetLayout[];       // missing widget id ⇒ hidden
};
```

### API

| Method | Path | Body | Response |
|---|---|---|---|
| `GET`  | `/api/user/dashboard` | — | `{ layout: StoredLayout \| null }` (null ⇒ client uses default) |
| `PUT`  | `/api/user/dashboard` | `{ layout: StoredLayout }` | `{ layout: StoredLayout }` |

No `DELETE` — reset is just `PUT defaultLayout`.

Both routes sit behind the existing `RequireUser` middleware. `auth-service` reverse-proxies `/api/user/dashboard` to the Go backend like all other `/api/*` paths — no new auth-service code.

### Validation (server-side, in `backend/dashboard/repository.go`)

- `version === 1`
- `widgets` length 1..4
- Every `i` is a known widget id; no duplicates
- `x, y, w, h` are integers; `x+w ≤ 12`; `w ≥ minW`, `h ≥ minH` per registry
- Pairwise overlap check (at most C(4,2) = 6 comparisons)

Bad payload → `400` with a descriptive message. Frontend keeps the draft, shows a toast, lets the user retry.

### New Go packages

```
backend/
├── db/
│   ├── db.go              NEW — Open(path), Close(), runs embedded schema on boot
│   └── schema.sql         NEW
├── dashboard/
│   ├── repository.go      NEW — Get(userID), Upsert(userID, layout), validation
│   ├── handlers.go        NEW — Gin handlers
│   └── handlers_test.go   NEW
├── main.go                MODIFIED — open DB, defer Close, mount routes
└── config/                MODIFIED — add DEV_DATABASE_PATH / PROD_DATABASE_PATH
```

### Docker / config changes

- `docker-compose.yml` (prod): add `volumes: [./data:/data]` to the `backend` service
- `docker-compose.dev.yml`: same (currently mounts `./backend:/app` and `/:/hostfs:ro`; add `./data:/data` explicitly)
- `backend/.env.example`: add `DEV_DATABASE_PATH=./data-dev/backend.sqlite` and `PROD_DATABASE_PATH=/data/backend.sqlite`
- `.gitignore`: explicit `data/backend.sqlite*` entry (covered today by untracked but worth being explicit)

## Auth, mobile, errors

### Auth (explicit)

Two layers already in place — no new auth code:

1. **Frontend gate** (`App.tsx`): `useSession()` from Better Auth wraps the router. While unauthenticated, only `LoginScreen` renders. The dashboard at `/`, `/search`, and `/admin` are all behind this gate.
2. **Backend gate** (`/api/user/dashboard`): auth-service strips client-supplied `X-User-*` and `cookie` headers, validates the session cookie, and re-attaches trusted `X-User-Id/Email/Role` headers before forwarding. The Go backend's `RequireUser` middleware rejects with `401` if `X-User-Id` is missing.

### Mobile

Below `md` (768px):
- Bypass `react-grid-layout` entirely; render widgets as a fixed single-column stack in default order (Active → Quick Add → Storage → Recent)
- Edit button hidden; no edit mode on mobile
- Persisted desktop layout is **untouched** — switch back to desktop and your custom layout reappears
- Search input compresses to an icon-only button that opens a search overlay

### Error handling

| Failure | Behavior |
|---|---|
| `GET /api/user/dashboard` fails (network / 5xx) | Fall back to `defaultLayout`; toast "Couldn't load saved layout — using default". Retry on next mount. |
| `GET` returns malformed JSON (corrupt row) | Fall back to `defaultLayout`; toast "Saved layout was invalid — using default". Don't auto-overwrite. |
| `PUT` fails (network / 5xx) | Stay in edit mode, keep the draft, toast "Save failed — retry". |
| `PUT` returns 400 (validation) | Toast the specific error from the response; stay in edit mode. Log to console (indicates client bug). |
| User navigates away mid-edit | Confirm: "Discard unsaved changes?" via `useBlocker` + `beforeunload` |
| Server adds an unknown widget id later | Filter unknown ids out of the GET response client-side; console warning. Don't crash. |

## Testing

| Layer | Framework | Coverage |
|---|---|---|
| Go backend | Go `testing` (in-memory SQLite) | Repo CRUD; handler validation (version, unknown id, overlap, bounds, missing fields); per-user isolation (insert two users, verify rows don't bleed); `RequireUser` rejection (401 with no `X-User-Id`) |
| auth-service | `node:test` | Add a case to `proxy.test.ts` asserting `/api/user/dashboard` strips a forged `X-User-Id` and re-attaches the session user's id |
| Frontend | none | Matches project convention. Natural future seams: `useDashboardLayout` (Vitest + msw), `DashboardContext` reducer (pure state). |

## Out of scope (YAGNI)

Explicitly **not** implemented in v1:

- Multiple instances of the same widget
- Per-widget settings (e.g., "Recent: show 5 vs. 10")
- Named "views" / multiple saved layouts per user
- Drag/resize/edit on mobile
- Real-time layout sync across browser tabs (last-PUT-wins is fine)
- `DELETE` endpoint (use `PUT defaultLayout` for reset)
- Migration library on the Go backend
- The old slide-animation tab system (deleted along with the tab structure)
- The PirateBay vs. Rutracker source picker UI (source becomes a per-row badge instead)
- Frontend test harness

## Open questions

None at spec time. Implementation may surface:
- Whether `useTorrents()` lifts cleanly out of `TorrentList` without behavior changes
- Whether `react-grid-layout`'s built-in collision check matches the server-side validator exactly (if not, document the difference)
