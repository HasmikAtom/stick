# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home tab-switcher with a customizable widget dashboard, move search to the top bar, and add per-user SQLite-backed persistence in the Go backend.

**Architecture:** React + `react-grid-layout` on a 12-col snap grid for the customizable dashboard; per-user layout persisted via a new `/api/user/dashboard` endpoint on the Go backend backed by `modernc.org/sqlite` (pure-Go, no CGO). Auth-service unchanged — proxies the new route. Search becomes a top-bar input that routes to a dedicated `/search` page that hits both PirateBay and Rutracker in parallel.

**Tech Stack:** Go 1.23, Gin, `modernc.org/sqlite`, React 18, TypeScript, Vite, `react-grid-layout` 1.5+, react-router-dom 6.30, Hono (auth-service, unchanged), Better Auth.

---

## Spec reference

Spec: `docs/superpowers/specs/2026-05-25-dashboard-redesign-design.md`

## Prerequisites

- Branch `dashboard-redesign` must exist (created off `main` during brainstorming).
- Branch `sidebar-layout-amoled-theme` must be reachable locally. Task 1 merges it in before frontend work begins.
- `pnpm` installed (project standard — never `npm`).
- Go ≥ 1.23.
- Docker + docker-compose available for end-to-end smoke tests at the end.

## File map (what gets created or modified)

**Backend (Go) — new packages:**
- `backend/db/db.go` — open SQLite, run embedded schema on boot, expose `Close()`
- `backend/db/schema.sql` — single-table CREATE statement
- `backend/dashboard/repository.go` — `Get(userID)`, `Upsert(userID, layout)`, server-side validation
- `backend/dashboard/handlers.go` — Gin handlers `GET /user/dashboard`, `PUT /user/dashboard`
- `backend/dashboard/handlers_test.go` — handler validation + per-user isolation
- `backend/dashboard/types.go` — `StoredLayout`, `WidgetLayout`, `WidgetSpec` (server-side validation table)

**Backend (Go) — modified:**
- `backend/models.go` — add `DoneDate` field to `TorrentStatus`
- `backend/handlers.go` — request `doneDate` field from Transmission in `listTorrents`
- `backend/utils.go` — populate `DoneDate` in `parseTorrent` (or wherever Transmission→model conversion happens)
- `backend/main.go` — open DB on boot, mount dashboard routes, defer Close on shutdown
- `backend/models.go` (Config struct) — add `DatabasePath`
- `backend/utils.go` (SetConfigs) — read `*_DATABASE_PATH` env var
- `backend/go.mod` / `backend/go.sum` — add `modernc.org/sqlite`
- `backend/.env.example` — add `DEV_DATABASE_PATH` and `PROD_DATABASE_PATH`

**Auth-service — modified:**
- `auth-service/src/__tests__/proxy.test.ts` — add a case asserting `/api/user/dashboard` strips forged `X-User-Id`

**Frontend — new files:**
- `frontend/src/components/dashboard/types.ts` — `WidgetId`, `WidgetLayout`, `StoredLayout`
- `frontend/src/components/dashboard/widgetRegistry.ts` — id → component, defaults, mins
- `frontend/src/components/dashboard/defaultLayout.ts` — default `StoredLayout`
- `frontend/src/components/dashboard/useDashboardLayout.ts` — fetch/save layout
- `frontend/src/components/dashboard/DashboardContext.tsx` — provider + edit-state reducer
- `frontend/src/components/dashboard/WidgetFrame.tsx` — title bar, hide button, resize chrome
- `frontend/src/components/dashboard/EditToolbar.tsx` — Add-widget dropdown + Reset
- `frontend/src/components/dashboard/DashboardGrid.tsx` — `react-grid-layout` wrapper
- `frontend/src/components/dashboard/Dashboard.tsx` — orchestrator, mobile/desktop branch
- `frontend/src/components/dashboard/index.ts` — barrel export
- `frontend/src/components/widgets/ActiveTorrentsWidget.tsx`
- `frontend/src/components/widgets/QuickAddWidget.tsx`
- `frontend/src/components/widgets/StorageWidget.tsx`
- `frontend/src/components/widgets/RecentActivityWidget.tsx`
- `frontend/src/components/topbar/TopBarSearch.tsx`
- `frontend/src/components/topbar/EditDashboardToggle.tsx`
- `frontend/src/pages/SearchPage.tsx`
- `frontend/src/hooks/useTorrents.ts` — shared polling hook lifted from `TorrentList`

**Frontend — modified:**
- `frontend/package.json` / `pnpm-lock.yaml` — add `react-grid-layout`, `@types/react-grid-layout`
- `frontend/src/App.tsx` — add `/search` route, wrap with `DashboardProvider`
- `frontend/src/components/Home.tsx` — replace tabs with `<Dashboard />`
- `frontend/src/components/AppShell.tsx` — add `TopBarSearch` + `EditDashboardToggle` slots
- `frontend/src/Scraper/ScraperUI.tsx` — accept `mode: 'piratebay' | 'rutracker' | 'both'`; in `both`, run both SSE streams and tag each row with a source badge
- `frontend/src/TorrentList.tsx` — switch to `useTorrents()` hook (no behavior change)
- `frontend/src/Models.tsx` — add `doneDate` to `TorrentStatus`
- `frontend/src/index.css` — import `react-grid-layout/css/styles.css` and `react-resizable/css/styles.css`; minor theme overrides for dark-mode handle visibility

**Infrastructure — modified:**
- `docker-compose.yml` — add `volumes: [./data:/data]` and `DATABASE_PATH=/data/backend.sqlite` env to `backend`
- `docker-compose.dev.yml` — same as above for `backend-dev`
- `.gitignore` — explicit `data/backend.sqlite*` line

---

## Task 1: Rebase / merge sidebar branch into dashboard-redesign

**Files:** none directly — git operation only.

**Rationale:** The frontend changes assume the sidebar exists (`app-sidebar/*`, the rewritten `AppShell`). Bring those into this branch before touching the frontend.

- [ ] **Step 1: Confirm clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean` on branch `dashboard-redesign`. If unrelated untracked files exist (e.g., `.claude/`, `data/backend.sqlite*`), leave them — they're ignored.

- [ ] **Step 2: Merge sidebar branch**

```bash
git merge --no-ff sidebar-layout-amoled-theme -m "Merge sidebar-layout-amoled-theme into dashboard-redesign"
```
Expected: clean merge (no conflicts — sidebar branch only touches `frontend/src/components/AppShell.tsx`, `frontend/src/components/app-sidebar/*`, `frontend/src/components/ui/*`, `frontend/tailwind.config.js`, `frontend/src/index.css`, `frontend/package.json`, `frontend/pnpm-lock.yaml`; spec touches `docs/`).

If conflicts appear in `frontend/package.json` or `pnpm-lock.yaml`, resolve by taking the sidebar branch's versions; this branch hasn't touched frontend yet.

- [ ] **Step 3: Verify the merge by running frontend type check**

```bash
cd frontend && pnpm install --frozen-lockfile && ./node_modules/.bin/tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Verify backend still builds**

```bash
cd backend && go build ./...
```
Expected: exit 0.

No commit — the merge commit is the commit.

---

## Task 2: Add `modernc.org/sqlite` to go.mod and create empty `db` package

**Files:**
- Modify: `backend/go.mod` (via `go get`)
- Create: `backend/db/db.go`

- [ ] **Step 1: Add the dependency**

```bash
cd backend && go get modernc.org/sqlite@latest
```
Expected: `go.mod` updated; `go.sum` populated.

- [ ] **Step 2: Create the package skeleton**

Write `backend/db/db.go`:

```go
package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

// Open opens (or creates) a SQLite database at path and verifies connectivity.
// Callers must call Close() during shutdown.
func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}
```

- [ ] **Step 3: Verify compile**

```bash
cd backend && go build ./...
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/go.mod backend/go.sum backend/db/db.go
git commit -m "$(cat <<'EOF'
backend: add modernc.org/sqlite + db.Open skeleton

Pure-Go SQLite driver (no CGO). Used by the upcoming dashboard
persistence layer. db.Open verifies connectivity with Ping().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add embedded schema + Migrate()

**Files:**
- Create: `backend/db/schema.sql`
- Modify: `backend/db/db.go`
- Create: `backend/db/db_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/db/db_test.go`:

```go
package db

import (
	"testing"
)

func TestOpenAndMigrate_CreatesTable(t *testing.T) {
	d, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer d.Close()

	if err := Migrate(d); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	row := d.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='user_dashboard_layouts'")
	var name string
	if err := row.Scan(&name); err != nil {
		t.Fatalf("table not created: %v", err)
	}
	if name != "user_dashboard_layouts" {
		t.Fatalf("expected user_dashboard_layouts, got %s", name)
	}
}

func TestMigrate_Idempotent(t *testing.T) {
	d, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer d.Close()

	if err := Migrate(d); err != nil {
		t.Fatalf("first Migrate failed: %v", err)
	}
	if err := Migrate(d); err != nil {
		t.Fatalf("second Migrate failed: %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && go test ./db/ -run TestOpenAndMigrate -v
```
Expected: FAIL with `undefined: Migrate`.

- [ ] **Step 3: Create schema.sql**

Create `backend/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  user_id    TEXT PRIMARY KEY,
  layout     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Implement Migrate**

Replace `backend/db/db.go` with:

```go
package db

import (
	"database/sql"
	_ "embed"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Open opens (or creates) a SQLite database at path and verifies connectivity.
// Callers must call Close() during shutdown.
func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

// Migrate applies the embedded schema. Safe to call multiple times.
func Migrate(d *sql.DB) error {
	_, err := d.Exec(schemaSQL)
	return err
}
```

- [ ] **Step 5: Run tests**

```bash
cd backend && go test ./db/ -v
```
Expected: PASS, both tests.

- [ ] **Step 6: Commit**

```bash
git add backend/db/schema.sql backend/db/db.go backend/db/db_test.go
git commit -m "$(cat <<'EOF'
backend/db: add embedded schema + idempotent Migrate

Single-table schema for user dashboard layouts. Embedded via go:embed
so the binary carries it; no migration library needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `DatabasePath` to Config and wire DB lifecycle into `main.go`

**Files:**
- Modify: `backend/models.go`
- Modify: `backend/utils.go`
- Modify: `backend/main.go`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add field to Config**

Open `backend/models.go`. Find the `Config` struct and add a `DatabasePath` field:

```go
type Config struct {
	AppPort              string
	TransmissionHost     string
	TransmissionPort     string
	TransmissionUsername string
	TransmissionPassword string
	RutrackerUrl         string
	ThepiratebayURL      string
	RutrackerUsername    string
	RutrackerPassword    string
	DatabasePath         string
}
```

- [ ] **Step 2: Populate from env in SetConfigs**

Open `backend/utils.go`. In `SetConfigs()`, add the database path read. The full block becomes:

```go
return &Config{
	AppPort:              os.Getenv(fmt.Sprintf("%s_APP_PORT", envPrefix)),
	TransmissionHost:     os.Getenv(fmt.Sprintf("%s_TRANSMISSION_HOST", envPrefix)),
	TransmissionPort:     os.Getenv(fmt.Sprintf("%s_TRANSMISSION_PORT", envPrefix)),
	TransmissionUsername: os.Getenv(fmt.Sprintf("%s_TRANSMISSION_USERNAME", envPrefix)),
	TransmissionPassword: os.Getenv(fmt.Sprintf("%s_TRANSMISSION_PASSWORD", envPrefix)),
	RutrackerUsername:    os.Getenv(fmt.Sprintf("%s_RUTRACKER_USERNAME", envPrefix)),
	RutrackerPassword:    os.Getenv(fmt.Sprintf("%s_RUTRACKER_PASSWORD", envPrefix)),
	DatabasePath:         os.Getenv(fmt.Sprintf("%s_DATABASE_PATH", envPrefix)),
}
```

- [ ] **Step 3: Open DB in main.go and defer Close**

Open `backend/main.go`. Add the import:

```go
"github.com/hasmikatom/torrent/db"
```

In `main()`, immediately after `r := gin.Default()`, add:

```go
// Open and migrate the SQLite database
dbPath := c.DatabasePath
if dbPath == "" {
	dbPath = "./data/backend.sqlite"
}
sqlDB, err := db.Open(dbPath)
if err != nil {
	log.Fatalf("Failed to open database at %s: %v", dbPath, err)
}
defer sqlDB.Close()

if err := db.Migrate(sqlDB); err != nil {
	log.Fatalf("Failed to run migrations: %v", err)
}
log.Printf("Database ready at %s", dbPath)
```

- [ ] **Step 4: Add env example entries**

If `backend/.env.example` doesn't exist, create it. Otherwise append:

```
DEV_DATABASE_PATH=./data-dev/backend.sqlite
PROD_DATABASE_PATH=/data/backend.sqlite
```

- [ ] **Step 5: Verify it builds and starts**

```bash
cd backend && go build ./... && go vet ./...
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/models.go backend/utils.go backend/main.go backend/.env.example
git commit -m "$(cat <<'EOF'
backend: open & migrate SQLite on boot

Reads {DEV,PROD}_DATABASE_PATH env. Defaults to ./data/backend.sqlite
if unset. db.Close() is deferred from main() so shutdown closes cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mount `./data` volume in docker-compose + gitignore the db files

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Inspect current backend service blocks**

```bash
grep -n -A 20 "^\s*backend:" docker-compose.yml docker-compose.dev.yml
```
Note the existing `volumes:` blocks (if any) and `environment:` blocks for the `backend` and `backend-dev` services.

- [ ] **Step 2: Add `./data:/data` volume + `PROD_DATABASE_PATH` env in prod compose**

In `docker-compose.yml`, under the `backend:` service, add the env var alongside the existing `environment:` entries:

```yaml
      - PROD_DATABASE_PATH=/data/backend.sqlite
```

And add a `volumes:` block (or extend the existing one) under the `backend:` service:

```yaml
    volumes:
      - ./data:/data
```

- [ ] **Step 3: Same for dev compose**

In `docker-compose.dev.yml`, under the `backend-dev:` (or whatever the dev service is called) service's `environment:`:

```yaml
      - DEV_DATABASE_PATH=/data/backend.sqlite
```

And extend its `volumes:` block to include:

```yaml
      - ./data-dev:/data
```

(Dev uses `./data-dev` so the bind mount doesn't fight with the host-local DB at `./data/backend.sqlite`.)

- [ ] **Step 4: Gitignore the runtime DB files**

Append to `.gitignore`:

```
# Backend SQLite runtime files
data/backend.sqlite
data/backend.sqlite-shm
data/backend.sqlite-wal
data-dev/
```

- [ ] **Step 5: Verify compose files parse**

```bash
docker compose -f docker-compose.yml config > /dev/null
docker compose -f docker-compose.dev.yml config > /dev/null
```
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml .gitignore
git commit -m "$(cat <<'EOF'
docker: mount ./data into backend container for SQLite

Adds {DEV,PROD}_DATABASE_PATH env vars and ./data (or ./data-dev) bind
mount so the backend SQLite survives container restarts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Define `dashboard` types and `WidgetSpec` table

**Files:**
- Create: `backend/dashboard/types.go`

- [ ] **Step 1: Write the type definitions**

Create `backend/dashboard/types.go`:

```go
package dashboard

// WidgetLayout is one widget's position in the 12-col grid.
type WidgetLayout struct {
	I string `json:"i"`
	X int    `json:"x"`
	Y int    `json:"y"`
	W int    `json:"w"`
	H int    `json:"h"`
}

// StoredLayout is the JSON blob persisted per user.
type StoredLayout struct {
	Version int            `json:"version"`
	Widgets []WidgetLayout `json:"widgets"`
}

// WidgetSpec is the server-side registry entry for a widget id.
// minW/minH match the frontend widgetRegistry to keep client/server in sync.
type WidgetSpec struct {
	MinW int
	MinH int
}

// KnownWidgets maps widget id → constraints. Update both this and the
// frontend widgetRegistry when adding a widget.
var KnownWidgets = map[string]WidgetSpec{
	"active":   {MinW: 4, MinH: 4},
	"quickAdd": {MinW: 3, MinH: 3},
	"storage":  {MinW: 3, MinH: 3},
	"recent":   {MinW: 3, MinH: 4},
}

const (
	GridCols          = 12
	CurrentVersion    = 1
	MaxWidgetsInLayout = 4
)
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend && go build ./dashboard/
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/dashboard/types.go
git commit -m "$(cat <<'EOF'
backend/dashboard: types + known-widget registry

Defines the layout JSON shape and server-side widget constraints.
KnownWidgets must stay in sync with frontend widgetRegistry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Implement `Repository` with validation

**Files:**
- Create: `backend/dashboard/repository.go`
- Create: `backend/dashboard/repository_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/dashboard/repository_test.go`:

```go
package dashboard

import (
	"testing"

	"github.com/hasmikatom/torrent/db"
)

func newRepo(t *testing.T) *Repository {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return NewRepository(d)
}

func validLayout() StoredLayout {
	return StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "quickAdd", X: 8, Y: 0, W: 4, H: 3},
		},
	}
}

func TestGet_ReturnsNilForUnknownUser(t *testing.T) {
	r := newRepo(t)
	got, err := r.Get("u-missing")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for unknown user, got %+v", got)
	}
}

func TestUpsertThenGet_RoundTrip(t *testing.T) {
	r := newRepo(t)
	want := validLayout()
	if err := r.Upsert("u1", want); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	got, err := r.Get("u1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("expected layout, got nil")
	}
	if got.Version != want.Version || len(got.Widgets) != len(want.Widgets) {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, want)
	}
	if got.Widgets[0].I != "active" || got.Widgets[0].W != 8 {
		t.Fatalf("widget mismatch: got %+v", got.Widgets[0])
	}
}

func TestUpsert_IsolatedPerUser(t *testing.T) {
	r := newRepo(t)
	a := validLayout()
	b := StoredLayout{Version: 1, Widgets: []WidgetLayout{{I: "storage", X: 0, Y: 0, W: 4, H: 4}}}
	if err := r.Upsert("user-a", a); err != nil {
		t.Fatal(err)
	}
	if err := r.Upsert("user-b", b); err != nil {
		t.Fatal(err)
	}
	gotA, _ := r.Get("user-a")
	gotB, _ := r.Get("user-b")
	if len(gotA.Widgets) != 2 {
		t.Fatalf("user-a clobbered: %+v", gotA)
	}
	if len(gotB.Widgets) != 1 || gotB.Widgets[0].I != "storage" {
		t.Fatalf("user-b wrong: %+v", gotB)
	}
}

func TestValidate_RejectsBadVersion(t *testing.T) {
	bad := validLayout()
	bad.Version = 2
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for version=2")
	}
}

func TestValidate_RejectsUnknownWidget(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].I = "bogus"
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for unknown widget id")
	}
}

func TestValidate_RejectsDuplicateWidget(t *testing.T) {
	bad := StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "active", X: 0, Y: 8, W: 8, H: 8},
		},
	}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for duplicate widget id")
	}
}

func TestValidate_RejectsOverflowX(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].W = 13
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for x+w > 12")
	}
}

func TestValidate_RejectsUndersizedWidget(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].W = 1 // active minW is 4
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for w < minW")
	}
}

func TestValidate_RejectsOverlap(t *testing.T) {
	bad := StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "quickAdd", X: 5, Y: 5, W: 4, H: 3},
		},
	}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for overlapping widgets")
	}
}

func TestValidate_RejectsEmptyWidgets(t *testing.T) {
	bad := StoredLayout{Version: 1, Widgets: nil}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for empty widgets")
	}
}

func TestUpsert_RejectsInvalidLayout(t *testing.T) {
	r := newRepo(t)
	bad := validLayout()
	bad.Version = 99
	if err := r.Upsert("u1", bad); err == nil {
		t.Fatal("expected Upsert to reject invalid layout")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && go test ./dashboard/ -v
```
Expected: FAIL with `undefined: Repository`, `undefined: NewRepository`, `undefined: Validate`.

- [ ] **Step 3: Implement the repository**

Create `backend/dashboard/repository.go`:

```go
package dashboard

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Get returns the stored layout for a user, or nil if the user has none.
func (r *Repository) Get(userID string) (*StoredLayout, error) {
	row := r.db.QueryRow("SELECT layout FROM user_dashboard_layouts WHERE user_id = ?", userID)
	var raw string
	if err := row.Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var layout StoredLayout
	if err := json.Unmarshal([]byte(raw), &layout); err != nil {
		return nil, fmt.Errorf("corrupt layout for user %s: %w", userID, err)
	}
	return &layout, nil
}

// Upsert validates and persists a layout for a user.
func (r *Repository) Upsert(userID string, layout StoredLayout) error {
	if err := Validate(layout); err != nil {
		return err
	}
	raw, err := json.Marshal(layout)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(
		`INSERT INTO user_dashboard_layouts (user_id, layout, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`,
		userID, string(raw), time.Now().UnixMilli(),
	)
	return err
}

// Validate enforces the StoredLayout schema.
func Validate(l StoredLayout) error {
	if l.Version != CurrentVersion {
		return fmt.Errorf("unsupported layout version %d (expected %d)", l.Version, CurrentVersion)
	}
	if len(l.Widgets) == 0 || len(l.Widgets) > MaxWidgetsInLayout {
		return fmt.Errorf("widgets must contain 1..%d entries, got %d", MaxWidgetsInLayout, len(l.Widgets))
	}
	seen := make(map[string]bool, len(l.Widgets))
	for _, w := range l.Widgets {
		spec, ok := KnownWidgets[w.I]
		if !ok {
			return fmt.Errorf("unknown widget id %q", w.I)
		}
		if seen[w.I] {
			return fmt.Errorf("duplicate widget id %q", w.I)
		}
		seen[w.I] = true
		if w.X < 0 || w.Y < 0 || w.W <= 0 || w.H <= 0 {
			return fmt.Errorf("widget %q has non-positive dimensions", w.I)
		}
		if w.X+w.W > GridCols {
			return fmt.Errorf("widget %q overflows grid: x+w=%d > %d", w.I, w.X+w.W, GridCols)
		}
		if w.W < spec.MinW || w.H < spec.MinH {
			return fmt.Errorf("widget %q below minimum size (w=%d<%d or h=%d<%d)", w.I, w.W, spec.MinW, w.H, spec.MinH)
		}
	}
	// pairwise overlap check
	for i := 0; i < len(l.Widgets); i++ {
		for j := i + 1; j < len(l.Widgets); j++ {
			if overlaps(l.Widgets[i], l.Widgets[j]) {
				return fmt.Errorf("widgets %q and %q overlap", l.Widgets[i].I, l.Widgets[j].I)
			}
		}
	}
	return nil
}

func overlaps(a, b WidgetLayout) bool {
	return a.X < b.X+b.W && b.X < a.X+a.W && a.Y < b.Y+b.H && b.Y < a.Y+a.H
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && go test ./dashboard/ -v
```
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/dashboard/repository.go backend/dashboard/repository_test.go
git commit -m "$(cat <<'EOF'
backend/dashboard: repository with full server-side validation

Validate() enforces version, widget ids, sizes, grid bounds, and
pairwise non-overlap. Repository.Get returns nil for unknown users;
Upsert is INSERT OR REPLACE keyed by user_id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Implement Gin handlers for `/user/dashboard`

**Files:**
- Create: `backend/dashboard/handlers.go`
- Create: `backend/dashboard/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/dashboard/handlers_test.go`:

```go
package dashboard

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hasmikatom/torrent/db"
	"github.com/hasmikatom/torrent/middleware"
)

func newTestRouter(t *testing.T) (*gin.Engine, *Repository) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })

	repo := NewRepository(d)
	h := NewHandlers(repo)
	r := gin.New()
	api := r.Group("/", middleware.RequireUser())
	api.GET("/user/dashboard", h.Get)
	api.PUT("/user/dashboard", h.Put)
	return r, repo
}

func doReq(r *gin.Engine, method, path string, userID string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if userID != "" {
		req.Header.Set("X-User-Id", userID)
		req.Header.Set("X-User-Email", userID+"@x.com")
	}
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestGet_NoUserHeader_401(t *testing.T) {
	r, _ := newTestRouter(t)
	w := doReq(r, "GET", "/user/dashboard", "", nil)
	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGet_NoSavedLayout_ReturnsNull(t *testing.T) {
	r, _ := newTestRouter(t)
	w := doReq(r, "GET", "/user/dashboard", "u1", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got["layout"] != nil {
		t.Fatalf("expected layout=null, got %v", got["layout"])
	}
}

func TestPut_RoundTripsThroughGet(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{
				{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8},
				{"i": "quickAdd", "x": 8, "y": 0, "w": 4, "h": 3},
			},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 200 {
		t.Fatalf("PUT expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	w2 := doReq(r, "GET", "/user/dashboard", "u1", nil)
	if w2.Code != 200 {
		t.Fatalf("GET expected 200, got %d", w2.Code)
	}
	var resp struct {
		Layout *StoredLayout `json:"layout"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Layout == nil || len(resp.Layout.Widgets) != 2 {
		t.Fatalf("round trip lost data: %+v", resp.Layout)
	}
}

func TestPut_RejectsBadVersion(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 99,
			"widgets": []map[string]any{{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8}},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestPut_RejectsUnknownWidget(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "bogus", "x": 0, "y": 0, "w": 4, "h": 4}},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPut_RejectsOverlap(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{
				{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8},
				{"i": "quickAdd", "x": 5, "y": 5, "w": 4, "h": 3},
			},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPut_PerUserIsolation(t *testing.T) {
	r, _ := newTestRouter(t)
	bodyA := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8}},
		},
	}
	bodyB := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "storage", "x": 0, "y": 0, "w": 4, "h": 4}},
		},
	}
	if w := doReq(r, "PUT", "/user/dashboard", "alice", bodyA); w.Code != 200 {
		t.Fatalf("alice PUT: %d", w.Code)
	}
	if w := doReq(r, "PUT", "/user/dashboard", "bob", bodyB); w.Code != 200 {
		t.Fatalf("bob PUT: %d", w.Code)
	}
	wA := doReq(r, "GET", "/user/dashboard", "alice", nil)
	wB := doReq(r, "GET", "/user/dashboard", "bob", nil)
	if !bytes.Contains(wA.Body.Bytes(), []byte(`"i":"active"`)) {
		t.Fatalf("alice not isolated: %s", wA.Body.String())
	}
	if !bytes.Contains(wB.Body.Bytes(), []byte(`"i":"storage"`)) {
		t.Fatalf("bob not isolated: %s", wB.Body.String())
	}
}

func TestPut_MalformedJSON(t *testing.T) {
	r, _ := newTestRouter(t)
	req := httptest.NewRequest("PUT", "/user/dashboard", bytes.NewBufferString("not json"))
	req.Header.Set("X-User-Id", "u1")
	req.Header.Set("X-User-Email", "u1@x.com")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && go test ./dashboard/ -run TestGet_NoUserHeader_401 -v
```
Expected: FAIL with `undefined: NewHandlers`.

- [ ] **Step 3: Implement handlers**

Create `backend/dashboard/handlers.go`:

```go
package dashboard

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handlers struct {
	repo *Repository
}

func NewHandlers(repo *Repository) *Handlers {
	return &Handlers{repo: repo}
}

// Get returns the user's saved layout (or null).
func (h *Handlers) Get(c *gin.Context) {
	userID := c.GetString("userId")
	layout, err := h.repo.Get(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"layout": layout})
}

type putBody struct {
	Layout StoredLayout `json:"layout"`
}

// Put validates and saves the user's layout.
func (h *Handlers) Put(c *gin.Context) {
	userID := c.GetString("userId")
	var body putBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON: " + err.Error()})
		return
	}
	if err := h.repo.Upsert(userID, body.Layout); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"layout": body.Layout})
}
```

- [ ] **Step 4: Run all dashboard tests**

```bash
cd backend && go test ./dashboard/ -v
```
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add backend/dashboard/handlers.go backend/dashboard/handlers_test.go
git commit -m "$(cat <<'EOF'
backend/dashboard: GET/PUT handlers with per-user isolation

Handlers read X-User-Id from context (set by RequireUser middleware),
delegate to the repository, and return 400 on validation failures.
Tests cover: 401 without header, null layout for new user, round-trip,
bad version, unknown widget, overlap, per-user isolation, malformed JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mount dashboard routes in `main.go`

**Files:**
- Modify: `backend/main.go`

- [ ] **Step 1: Wire the handlers into the api group**

Open `backend/main.go`. Add the import:

```go
"github.com/hasmikatom/torrent/dashboard"
```

In `main()`, after `db.Migrate(sqlDB)`, instantiate the repo and handlers:

```go
dashRepo := dashboard.NewRepository(sqlDB)
dashHandlers := dashboard.NewHandlers(dashRepo)
```

Inside the `api := r.Group(...)` block, append the dashboard routes (alongside existing routes):

```go
		api.GET("/user/dashboard", dashHandlers.Get)
		api.PUT("/user/dashboard", dashHandlers.Put)
```

- [ ] **Step 2: Verify build**

```bash
cd backend && go build ./...
```
Expected: exit 0.

- [ ] **Step 3: Verify end-to-end via curl (manual smoke)**

In one terminal:
```bash
cd backend && DEV_APP_PORT=8085 DEV_DATABASE_PATH=./data-dev/backend.sqlite go run .
```

In another:
```bash
# 401 without headers
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8085/user/dashboard
# Expected: 401

# 200 / null layout for new user
curl -s -H "X-User-Id: smoke" -H "X-User-Email: smoke@x.com" \
  http://localhost:8085/user/dashboard
# Expected: {"layout":null}

# PUT a layout
curl -s -X PUT -H "X-User-Id: smoke" -H "X-User-Email: smoke@x.com" \
  -H "Content-Type: application/json" \
  -d '{"layout":{"version":1,"widgets":[{"i":"active","x":0,"y":0,"w":8,"h":8}]}}' \
  http://localhost:8085/user/dashboard
# Expected: {"layout":{"version":1,"widgets":[...]}}

# GET it back
curl -s -H "X-User-Id: smoke" -H "X-User-Email: smoke@x.com" \
  http://localhost:8085/user/dashboard
# Expected: same {"layout":...}
```

Stop the server with `Ctrl-C`.

- [ ] **Step 4: Commit**

```bash
git add backend/main.go
git commit -m "$(cat <<'EOF'
backend: mount /user/dashboard routes

GET and PUT both behind RequireUser middleware. Repository and handlers
constructed once at boot, share the single sql.DB handle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add `DoneDate` to `TorrentStatus` (backend + frontend type)

**Files:**
- Modify: `backend/models.go`
- Modify: `backend/utils.go`
- Modify: `backend/handlers.go`
- Modify: `frontend/src/Models.tsx`

**Why:** `RecentActivityWidget` needs to sort completed torrents by their completion time, not their add time. Transmission's RPC supports `doneDate`; we just need to fetch and expose it.

- [ ] **Step 1: Add field to backend struct**

In `backend/models.go`, add to `TorrentStatus`:

```go
type TorrentStatus struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	PercentDone  float64 `json:"percentDone"`
	RateDownload int64   `json:"rateDownload"`
	TotalSize    int64   `json:"totalSize"`
	AddedDate    int64   `json:"addedDate"`
	DoneDate     int64   `json:"doneDate"`
	Status       string  `json:"status"`
	Error        int     `json:"error"`
	ErrorString  string  `json:"errorString"`
}
```

- [ ] **Step 2: Request `doneDate` from Transmission**

In `backend/handlers.go`, find the two places where the `"fields"` array is sent to Transmission (search for `"percentDone"` — there should be two occurrences around lines 162 and 202). Add `"doneDate"` next to each existing `"addedDate"` entry. The full field array becomes:

```go
[]string{
    "id", "name", "percentDone", "rateDownload", "totalSize",
    "addedDate", "doneDate", "status", "error", "errorString",
}
```

(Add `"doneDate"` after `"addedDate"` in both places.)

- [ ] **Step 3: Populate `DoneDate` in `parseTorrent`**

In `backend/utils.go`, find the function that builds `TorrentStatus` from Transmission's raw map (search for `AddedDate` near line 264-280). After `AddedDate:`, add:

```go
doneDate, _ := GetInt64(torrent, "doneDate")
```

at the top of the construction block (alongside other helper calls), and add to the struct literal:

```go
DoneDate: doneDate,
```

(If the existing code uses `GetFloat64` and casts, follow the same pattern; the helper name may differ.)

- [ ] **Step 4: Update frontend type**

In `frontend/src/Models.tsx`, add to `TorrentStatus`:

```ts
export interface TorrentStatus {
  id: number;
  name: string;
  percentDone: number;
  rateDownload: number;
  totalSize: number;
  addedDate: number;
  doneDate: number;
  status: string;
}
```

- [ ] **Step 5: Verify both compile**

```bash
cd backend && go build ./... && cd ../frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add backend/models.go backend/utils.go backend/handlers.go frontend/src/Models.tsx
git commit -m "$(cat <<'EOF'
expose doneDate on TorrentStatus

Transmission already tracks doneDate; we just hadn't been requesting it.
Needed by the upcoming RecentActivityWidget which sorts completed
torrents by completion time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Add auth-service proxy test for `/api/user/dashboard`

**Files:**
- Modify: `auth-service/src/__tests__/proxy.test.ts`

- [ ] **Step 1: Add the test case**

Open `auth-service/src/__tests__/proxy.test.ts`. Append a new test at the end:

```ts
test("proxy strips forged x-user-id on /api/user/dashboard", async () => {
  const captured: any = {};
  const { app, restore } = makeApp(captured);

  const res = await app.request("/api/user/dashboard", {
    method: "GET",
    headers: {
      "x-user-id": "attacker",
      "x-user-email": "attacker@x.com",
      "x-user-role": "admin",
    },
  });
  restore();
  assert.equal(res.status, 200);
  assert.equal(captured.url, "http://backend.test/user/dashboard");
  assert.equal(captured.headers.get("x-user-id"), "u1");
  assert.equal(captured.headers.get("x-user-email"), "a@x.com");
  assert.equal(captured.headers.get("x-user-role"), "user");
});

test("proxy forwards PUT body on /api/user/dashboard", async () => {
  const captured: any = {};
  // capture body too
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    captured.url = typeof input === "string" ? input : input.url;
    captured.headers = new Headers(init?.headers);
    captured.body = init?.body;
    captured.method = init?.method;
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as any;
  process.env.GO_BACKEND_URL = "http://backend.test";

  const { Hono } = await import("hono");
  const { proxyToGo } = await import("../proxy.js");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "u1", email: "a@x.com", role: "user" } as any);
    await next();
  });
  app.all("/api/*", proxyToGo);

  await app.request("/api/user/dashboard", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ layout: { version: 1, widgets: [] } }),
  });
  globalThis.fetch = originalFetch;
  assert.equal(captured.method, "PUT");
  assert.ok(captured.body, "expected body to be forwarded");
});
```

- [ ] **Step 2: Run the auth-service tests**

```bash
cd auth-service && pnpm test
```
Expected: PASS, including the two new tests.

- [ ] **Step 3: Commit**

```bash
git add auth-service/src/__tests__/proxy.test.ts
git commit -m "$(cat <<'EOF'
auth-service: test proxy strips forged headers on /api/user/dashboard

Asserts the new dashboard route gets the same header-strip/replace
treatment as other /api/* paths. Adds a PUT-body forwarding check too.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Install `react-grid-layout` and types

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add the dep**

```bash
cd frontend && pnpm add react-grid-layout && pnpm add -D @types/react-grid-layout
```
Expected: both installed; lockfile updated.

- [ ] **Step 2: Import the required stylesheets**

Open `frontend/src/index.css`. At the very top, before existing `@tailwind` directives, add:

```css
@import "react-grid-layout/css/styles.css";
@import "react-resizable/css/styles.css";
```

- [ ] **Step 3: Quick smoke import in code is unnecessary — just confirm type imports resolve**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/index.css
git commit -m "$(cat <<'EOF'
frontend: add react-grid-layout + bundle its CSS

Required by the upcoming customizable dashboard. CSS for the grid item
chrome (resize handles, drag preview) is imported globally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Create dashboard types + widget registry + default layout

**Files:**
- Create: `frontend/src/components/dashboard/types.ts`
- Create: `frontend/src/components/dashboard/widgetRegistry.ts`
- Create: `frontend/src/components/dashboard/defaultLayout.ts`

- [ ] **Step 1: Define types**

Create `frontend/src/components/dashboard/types.ts`:

```ts
export type WidgetId = 'active' | 'quickAdd' | 'storage' | 'recent';

export interface WidgetLayout {
  i: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredLayout {
  version: 1;
  widgets: WidgetLayout[];
}

export const GRID_COLS = 12;
export const ROW_HEIGHT = 80;
export const MOBILE_BREAKPOINT_PX = 768;
```

- [ ] **Step 2: Create the registry (stub component refs for now)**

Create `frontend/src/components/dashboard/widgetRegistry.ts`. Each widget will be filled in by Task 20; for now we wire placeholders so the type system is satisfied:

```ts
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, Plus, HardDrive, Clock } from 'lucide-react';
import type { WidgetId } from './types';

import { ActiveTorrentsWidget } from '@/components/widgets/ActiveTorrentsWidget';
import { QuickAddWidget } from '@/components/widgets/QuickAddWidget';
import { StorageWidget } from '@/components/widgets/StorageWidget';
import { RecentActivityWidget } from '@/components/widgets/RecentActivityWidget';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  icon: LucideIcon;
  component: ComponentType;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
}

export const widgetRegistry: Record<WidgetId, WidgetDef> = {
  active: {
    id: 'active',
    title: 'Active Torrents',
    icon: Download,
    component: ActiveTorrentsWidget,
    defaultW: 8, defaultH: 8,
    minW: 4,    minH: 4,
  },
  quickAdd: {
    id: 'quickAdd',
    title: 'Quick Add',
    icon: Plus,
    component: QuickAddWidget,
    defaultW: 4, defaultH: 3,
    minW: 3,    minH: 3,
  },
  storage: {
    id: 'storage',
    title: 'Storage',
    icon: HardDrive,
    component: StorageWidget,
    defaultW: 4, defaultH: 3,
    minW: 3,    minH: 3,
  },
  recent: {
    id: 'recent',
    title: 'Recent Activity',
    icon: Clock,
    component: RecentActivityWidget,
    defaultW: 4, defaultH: 5,
    minW: 3,    minH: 4,
  },
};

export const WIDGET_ORDER: WidgetId[] = ['active', 'quickAdd', 'storage', 'recent'];
```

> Note: the imports for the four widget components will fail typecheck until Task 20 creates them. That's expected — we'll create them after the dependent infrastructure. If a stricter ordering is preferred, leave the registry stubbed with `() => null` components until Task 20, then swap them.

- [ ] **Step 3: Create the default layout**

Create `frontend/src/components/dashboard/defaultLayout.ts`:

```ts
import type { StoredLayout } from './types';

export const defaultLayout: StoredLayout = {
  version: 1,
  widgets: [
    { i: 'active',   x: 0, y: 0, w: 8, h: 8 },
    { i: 'quickAdd', x: 8, y: 0, w: 4, h: 3 },
    { i: 'storage',  x: 8, y: 3, w: 4, h: 3 },
    { i: 'recent',   x: 8, y: 6, w: 4, h: 5 },
  ],
};
```

- [ ] **Step 4: Skip typecheck for now** (widget components don't exist yet — typecheck after Task 20)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/types.ts frontend/src/components/dashboard/widgetRegistry.ts frontend/src/components/dashboard/defaultLayout.ts
git commit -m "$(cat <<'EOF'
frontend/dashboard: types, registry, default layout

WidgetId is the single source of truth for known widget ids and stays in
sync with backend KnownWidgets. defaultLayout matches the spec's Hero +
utility rail arrangement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Extract `useTorrents` shared polling hook

**Files:**
- Create: `frontend/src/hooks/useTorrents.ts`
- Modify: `frontend/src/TorrentList.tsx`

**Why:** Two widgets (Active + Recent) need the torrent list. Without sharing, we'd have two parallel 3-second polls. Lift it into a hook with a tiny pub/sub so multiple subscribers share one interval.

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useTorrents.ts`:

```ts
import { useEffect, useState } from 'react';
import { apiFetch } from '@/services';
import type { TorrentStatus } from '@/Models';

const POLL_INTERVAL = 3000;

let cache: TorrentStatus[] | null = null;
let subscribers = new Set<(t: TorrentStatus[] | null) => void>();
let intervalId: number | null = null;
let inflight: Promise<void> | null = null;

async function fetchOnce() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await apiFetch('/api/torrents');
      if (!res.ok) return;
      const data = (await res.json()) as TorrentStatus[];
      cache = data;
      subscribers.forEach(cb => cb(cache));
    } catch {
      // swallow; subscribers will see the stale cache
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensurePolling() {
  if (intervalId !== null || subscribers.size === 0) return;
  intervalId = window.setInterval(fetchOnce, POLL_INTERVAL);

  // Page Visibility: pause polling when hidden, refresh + resume on visible
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    fetchOnce();
    ensurePolling();
  }
}

export interface UseTorrentsResult {
  torrents: TorrentStatus[] | null;
  refresh: () => Promise<void>;
}

export function useTorrents(): UseTorrentsResult {
  const [torrents, setTorrents] = useState<TorrentStatus[] | null>(cache);

  useEffect(() => {
    subscribers.add(setTorrents);
    fetchOnce();
    ensurePolling();
    return () => {
      subscribers.delete(setTorrents);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return { torrents, refresh: fetchOnce };
}
```

- [ ] **Step 2: Refactor TorrentList to use it**

Open `frontend/src/TorrentList.tsx`. Replace the body of the component up to (but not including) the `handleManualRefresh` declaration. Specifically:

Remove:
- The `POLL_INTERVAL` constant near the top of the file
- The `torrents` and `setTorrents` state
- The `intervalRef`
- The `fetchTorrents` `useCallback`
- The `startPolling` / `stopPolling` callbacks
- The `useEffect` that calls `fetchTorrents` and `startPolling`

Replace with a single `useTorrents()` call at the top of the component:

```ts
import { useTorrents } from '@/hooks/useTorrents';

// inside the component body:
const { torrents, refresh: fetchTorrents } = useTorrents();
```

Update `handleManualRefresh` to use the new `fetchTorrents`:

```ts
const handleManualRefresh = async () => {
  setIsRefreshing(true);
  await fetchTorrents();
  setIsRefreshing(false);
};
```

Keep the `useEffect` that responds to `refreshTrigger` but switch it to call `fetchTorrents()`:

```ts
useEffect(() => {
  if (refreshTrigger !== undefined) {
    fetchTorrents();
  }
}, [refreshTrigger, fetchTorrents]);
```

After delete/rename actions, replace `await fetchTorrents()` calls with `await fetchTorrents()` (the new function is named the same). No change needed at call sites except removing the now-unused `showError` argument: change `await fetchTorrents(true)` → `await fetchTorrents()` and `await fetchTorrents()` stays the same.

(The toast on fetch error is dropped by this refactor — the shared hook swallows fetch errors silently. The render path already handles `torrents === null` with an empty state.)

- [ ] **Step 3: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

Note: this may still flag `widgetRegistry.ts` imports — those errors will resolve in Task 20. Confirm only those errors exist; if there are new errors in `TorrentList.tsx` or `useTorrents.ts`, fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useTorrents.ts frontend/src/TorrentList.tsx
git commit -m "$(cat <<'EOF'
frontend: lift torrent polling into shared useTorrents hook

Single interval + cache + subscriber set. Multiple components subscribed
to useTorrents share one network request per 3s. TorrentList refactored
to consume it with no UX change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Create `useDashboardLayout` fetch/save hook

**Files:**
- Create: `frontend/src/components/dashboard/useDashboardLayout.ts`

- [ ] **Step 1: Implement**

Create `frontend/src/components/dashboard/useDashboardLayout.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/services';
import { defaultLayout } from './defaultLayout';
import type { StoredLayout, WidgetLayout, WidgetId } from './types';
import { widgetRegistry } from './widgetRegistry';

type Status = 'loading' | 'ready' | 'error';

function isKnownWidget(id: string): id is WidgetId {
  return id in widgetRegistry;
}

function sanitize(layout: StoredLayout): StoredLayout {
  if (layout.version !== 1) return defaultLayout;
  const widgets = layout.widgets.filter(w => isKnownWidget(w.i)) as WidgetLayout[];
  if (widgets.length === 0) return defaultLayout;
  return { version: 1, widgets };
}

export function useDashboardLayout() {
  const [layout, setLayoutState] = useState<StoredLayout>(defaultLayout);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/user/dashboard');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { layout: StoredLayout | null };
        if (cancelled) return;
        setLayoutState(body.layout ? sanitize(body.layout) : defaultLayout);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setLayoutState(defaultLayout);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: StoredLayout) => {
    const res = await apiFetch('/api/user/dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'save failed' }));
      throw new Error(body.error ?? 'save failed');
    }
    setLayoutState(next);
  }, []);

  return { layout, status, save };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/dashboard/useDashboardLayout.ts
git commit -m "$(cat <<'EOF'
frontend/dashboard: useDashboardLayout fetch + save hook

Fetches on mount, sanitizes the result (drops unknown widget ids,
falls back to defaultLayout on bad version), exposes a save() that PUTs
and updates local state on 200.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Create `DashboardContext` with edit-state reducer

**Files:**
- Create: `frontend/src/components/dashboard/DashboardContext.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/dashboard/DashboardContext.tsx`:

```tsx
import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import type { ReactNode } from 'react';
import { defaultLayout } from './defaultLayout';
import { useDashboardLayout } from './useDashboardLayout';
import { widgetRegistry } from './widgetRegistry';
import type { StoredLayout, WidgetId, WidgetLayout } from './types';

interface DashboardContextValue {
  persistedLayout: StoredLayout;
  draftLayout: StoredLayout | null;
  isEditing: boolean;
  isLoading: boolean;
  beginEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => Promise<void>;
  applyDraft: (next: StoredLayout) => void;  // called by react-grid-layout onLayoutChange
  hide: (id: WidgetId) => void;
  add: (id: WidgetId) => void;
  resetDraft: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function firstFreeSlot(widgets: WidgetLayout[], w: number, h: number): { x: number; y: number } {
  // Naive: stack a new widget at y = max(y+h) over all existing widgets, x=0.
  // The user can drag it where they want.
  const maxY = widgets.reduce((m, wt) => Math.max(m, wt.y + wt.h), 0);
  void w; void h;
  return { x: 0, y: maxY };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { layout: persistedLayout, status, save } = useDashboardLayout();
  const [draftLayout, setDraftLayout] = useState<StoredLayout | null>(null);
  const isEditing = draftLayout !== null;

  const beginEdit = useCallback(() => setDraftLayout(persistedLayout), [persistedLayout]);
  const cancelEdit = useCallback(() => setDraftLayout(null), []);

  const saveEdit = useCallback(async () => {
    if (!draftLayout) return;
    await save(draftLayout);
    setDraftLayout(null);
  }, [draftLayout, save]);

  const applyDraft = useCallback((next: StoredLayout) => {
    setDraftLayout(next);
  }, []);

  const hide = useCallback((id: WidgetId) => {
    setDraftLayout(prev => {
      const base = prev ?? persistedLayout;
      return { ...base, widgets: base.widgets.filter(w => w.i !== id) };
    });
  }, [persistedLayout]);

  const add = useCallback((id: WidgetId) => {
    setDraftLayout(prev => {
      const base = prev ?? persistedLayout;
      if (base.widgets.some(w => w.i === id)) return base;
      const def = widgetRegistry[id];
      const { x, y } = firstFreeSlot(base.widgets, def.defaultW, def.defaultH);
      const next: WidgetLayout = { i: id, x, y, w: def.defaultW, h: def.defaultH };
      return { ...base, widgets: [...base.widgets, next] };
    });
  }, [persistedLayout]);

  const resetDraft = useCallback(() => setDraftLayout(defaultLayout), []);

  const value = useMemo<DashboardContextValue>(() => ({
    persistedLayout,
    draftLayout,
    isEditing,
    isLoading: status === 'loading',
    beginEdit, cancelEdit, saveEdit, applyDraft, hide, add, resetDraft,
  }), [persistedLayout, draftLayout, isEditing, status, beginEdit, cancelEdit, saveEdit, applyDraft, hide, add, resetDraft]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/dashboard/DashboardContext.tsx
git commit -m "$(cat <<'EOF'
frontend/dashboard: DashboardProvider + useDashboard

Single source of truth for edit state. draftLayout is non-null iff
isEditing. add()/hide()/resetDraft() all mutate the draft, never the
persisted layout, until saveEdit() PUTs and swaps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Create `WidgetFrame` component

**Files:**
- Create: `frontend/src/components/dashboard/WidgetFrame.tsx`

The `WidgetFrame` wraps each widget with a title bar (icon + name) and, in edit mode, a hide button + drag handle area. The react-grid-layout drag handle is the title bar (set via the `.widget-drag-handle` className).

- [ ] **Step 1: Implement**

Create `frontend/src/components/dashboard/WidgetFrame.tsx`:

```tsx
import { X } from 'lucide-react';
import type { LucideIcon, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useDashboard } from './DashboardContext';
import type { WidgetId } from './types';

interface Props {
  id: WidgetId;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}

export function WidgetFrame({ id, title, icon: Icon, children }: Props) {
  const { isEditing, hide } = useDashboard();

  return (
    <div className="h-full flex flex-col rounded-lg border bg-card overflow-hidden">
      <div
        className={`widget-drag-handle flex items-center justify-between px-3 py-2 border-b ${
          isEditing ? 'cursor-move bg-muted/40' : ''
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{title}</span>
        </div>
        {isEditing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => hide(id)}
            aria-label={`Hide ${title} widget`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/dashboard/WidgetFrame.tsx
git commit -m "$(cat <<'EOF'
frontend/dashboard: WidgetFrame with title bar and hide button

Title bar doubles as the react-grid-layout drag handle
(.widget-drag-handle). The X hide button only appears in edit mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Create the four widget components

**Files:**
- Create: `frontend/src/components/widgets/ActiveTorrentsWidget.tsx`
- Create: `frontend/src/components/widgets/QuickAddWidget.tsx`
- Create: `frontend/src/components/widgets/StorageWidget.tsx`
- Create: `frontend/src/components/widgets/RecentActivityWidget.tsx`

These wrap the existing `TorrentList` / `TorrentDownloader` / `StorageInfo` components inside `WidgetFrame`. `RecentActivityWidget` is the only one with new logic.

- [ ] **Step 1: ActiveTorrentsWidget**

Create `frontend/src/components/widgets/ActiveTorrentsWidget.tsx`:

```tsx
import { Download } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { TorrentList } from '@/TorrentList';

export function ActiveTorrentsWidget() {
  return (
    <WidgetFrame id="active" title="Active Torrents" icon={Download}>
      <TorrentList />
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: QuickAddWidget**

Create `frontend/src/components/widgets/QuickAddWidget.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { TorrentDownloader } from '@/TorrentDownloader';

export function QuickAddWidget() {
  return (
    <WidgetFrame id="quickAdd" title="Quick Add" icon={Plus}>
      <TorrentDownloader />
    </WidgetFrame>
  );
}
```

- [ ] **Step 3: StorageWidget**

Create `frontend/src/components/widgets/StorageWidget.tsx`:

```tsx
import { HardDrive } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { StorageInfo } from '@/StorageInfo';

export function StorageWidget() {
  return (
    <WidgetFrame id="storage" title="Storage" icon={HardDrive}>
      <StorageInfo />
    </WidgetFrame>
  );
}
```

- [ ] **Step 4: RecentActivityWidget**

Create `frontend/src/components/widgets/RecentActivityWidget.tsx`:

```tsx
import { Clock } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { useTorrents } from '@/hooks/useTorrents';
import type { TorrentStatus } from '@/Models';

const COMPLETE_PCT = 100; // backend multiplies percentDone by 100
const TAKE = 5;

function formatRelative(epochSeconds: number): string {
  const secs = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function RecentActivityWidget() {
  const { torrents } = useTorrents();

  const recent = (torrents ?? [])
    .filter((t: TorrentStatus) => t.percentDone >= COMPLETE_PCT && t.doneDate > 0)
    .sort((a, b) => b.doneDate - a.doneDate)
    .slice(0, TAKE);

  return (
    <WidgetFrame id="recent" title="Recent Activity" icon={Clock}>
      {torrents === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed downloads yet.</p>
      ) : (
        <ul className="divide-y">
          {recent.map(t => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-2 min-w-0">
              <span className="truncate text-sm" title={t.name}>{t.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatRelative(t.doneDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: exit 0 (the registry imports now resolve too).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/widgets/
git commit -m "$(cat <<'EOF'
frontend: four dashboard widget components

ActiveTorrents/QuickAdd/Storage wrap existing components in WidgetFrame.
RecentActivity is new: filters completed torrents from useTorrents,
sorts by doneDate desc, takes the top 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Create `EditToolbar` component

**Files:**
- Create: `frontend/src/components/dashboard/EditToolbar.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/dashboard/EditToolbar.tsx`:

```tsx
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Plus, RotateCcw } from 'lucide-react';
import { useDashboard } from './DashboardContext';
import { WIDGET_ORDER, widgetRegistry } from './widgetRegistry';
import type { WidgetId } from './types';

export function EditToolbar() {
  const { isEditing, draftLayout, persistedLayout, add, resetDraft } = useDashboard();
  if (!isEditing) return null;

  const current = draftLayout ?? persistedLayout;
  const presentIds = new Set(current.widgets.map(w => w.i));
  const hiddenIds = WIDGET_ORDER.filter((id: WidgetId) => !presentIds.has(id));

  return (
    <div className="flex items-center gap-3 mb-3 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={hiddenIds.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Add widget
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {hiddenIds.length === 0 ? (
            <DropdownMenuItem disabled>All widgets shown</DropdownMenuItem>
          ) : (
            hiddenIds.map((id) => {
              const def = widgetRegistry[id];
              const Icon = def.icon;
              return (
                <DropdownMenuItem key={id} onSelect={() => add(id)}>
                  <Icon className="h-4 w-4 mr-2" />
                  {def.title}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={resetDraft}>
        <RotateCcw className="h-4 w-4 mr-1" />
        Reset to default
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/dashboard/EditToolbar.tsx
git commit -m "$(cat <<'EOF'
frontend/dashboard: EditToolbar with Add-widget + Reset

Only renders in edit mode. Add-widget dropdown lists any widget not
currently in the draft layout; Reset replaces the draft with the
default layout (no network until Save).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Create `DashboardGrid` wrapper around react-grid-layout

**Files:**
- Create: `frontend/src/components/dashboard/DashboardGrid.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/dashboard/DashboardGrid.tsx`:

```tsx
import { useMemo } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import { useDashboard } from './DashboardContext';
import { widgetRegistry } from './widgetRegistry';
import { GRID_COLS, ROW_HEIGHT, type WidgetId } from './types';

interface Props {
  width: number;
}

export function DashboardGrid({ width }: Props) {
  const { persistedLayout, draftLayout, isEditing, applyDraft } = useDashboard();
  const current = draftLayout ?? persistedLayout;

  const rglLayout: Layout[] = useMemo(
    () =>
      current.widgets.map(w => {
        const def = widgetRegistry[w.i];
        return {
          i: w.i,
          x: w.x, y: w.y, w: w.w, h: w.h,
          minW: def.minW, minH: def.minH,
        };
      }),
    [current],
  );

  const onLayoutChange = (next: Layout[]) => {
    if (!isEditing) return;
    applyDraft({
      version: 1,
      widgets: next.map(l => ({
        i: l.i as WidgetId,
        x: l.x, y: l.y, w: l.w, h: l.h,
      })),
    });
  };

  return (
    <GridLayout
      className="layout"
      layout={rglLayout}
      cols={GRID_COLS}
      rowHeight={ROW_HEIGHT}
      width={width}
      isDraggable={isEditing}
      isResizable={isEditing}
      draggableHandle=".widget-drag-handle"
      onLayoutChange={onLayoutChange}
      compactType="vertical"
      preventCollision={false}
      margin={[12, 12]}
    >
      {current.widgets.map(w => {
        const def = widgetRegistry[w.i];
        const Comp = def.component;
        return (
          <div key={w.i}>
            <Comp />
          </div>
        );
      })}
    </GridLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/dashboard/DashboardGrid.tsx
git commit -m "$(cat <<'EOF'
frontend/dashboard: DashboardGrid wrapping react-grid-layout

Drag/resize only enabled when isEditing. Drag handle is .widget-drag-handle
(the title bar). onLayoutChange writes to draft only — never to persisted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Create `Dashboard` orchestrator (desktop + mobile)

**Files:**
- Create: `frontend/src/components/dashboard/Dashboard.tsx`
- Create: `frontend/src/components/dashboard/index.ts`

`useIsMobile` already exists in the sidebar branch at `frontend/src/hooks/use-mobile.tsx` — reuse it.

- [ ] **Step 1: Implement Dashboard**

Create `frontend/src/components/dashboard/Dashboard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDashboard } from './DashboardContext';
import { DashboardGrid } from './DashboardGrid';
import { EditToolbar } from './EditToolbar';
import { widgetRegistry, WIDGET_ORDER } from './widgetRegistry';

export function Dashboard() {
  const { isLoading } = useDashboard();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current || isMobile) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [isMobile]);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading dashboard…</div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3 py-3">
        {WIDGET_ORDER.map(id => {
          const Comp = widgetRegistry[id].component;
          return <Comp key={id} />;
        })}
      </div>
    );
  }

  return (
    <div className="py-3" ref={containerRef}>
      <EditToolbar />
      {width > 0 && <DashboardGrid width={width} />}
    </div>
  );
}
```

- [ ] **Step 2: Barrel export**

Create `frontend/src/components/dashboard/index.ts`:

```ts
export { Dashboard } from './Dashboard';
export { DashboardProvider, useDashboard } from './DashboardContext';
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/Dashboard.tsx frontend/src/components/dashboard/index.ts
git commit -m "$(cat <<'EOF'
frontend/dashboard: Dashboard orchestrator with mobile branch

Below the md breakpoint, renders widgets as a fixed single-column stack
in default order (bypasses react-grid-layout). Desktop uses ResizeObserver
to feed the grid its container width.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Refactor `ScraperUI` to support `mode='both'` + source badge

**Files:**
- Modify: `frontend/src/Scraper/ScraperUI.tsx`
- Modify: `frontend/src/Scraper/ScrapedTorrents.tsx` (add a source badge column)

- [ ] **Step 1: Add `source` to scraped results**

Open `frontend/src/Models.tsx`. Add to `ScrapedTorrents`:

```ts
export interface ScrapedTorrents {
  id:          string;
  title:       string;
  category:    string;
  uploader:    string;
  size:        string;
  upload_date:  string;
  se:     number;
  le:    number;
  description_url: string;

  magnet:      string;
  download_url: string;

  downloads: string;

  source?: 'piratebay' | 'rutracker';
}
```

- [ ] **Step 2: Change ScraperUI's `type` prop to `mode` and accept `'both'`**

Open `frontend/src/Scraper/ScraperUI.tsx`. Change the `Props` interface and the function signature:

```tsx
interface Props {
  mode: 'piratebay' | 'rutracker' | 'both';
  // switchTab is no longer needed — the dashboard owns navigation.
  // Remove the prop and any internal calls to it.
}

export const ScraperUI: React.FC<Props> = ({ mode }) => {
```

Replace the existing single-stream search (`handleScrapeSearch`) with one that branches on `mode`. When `mode === 'both'`:
- Open two `EventSource`s in parallel (one per source)
- Tag each scraped item's `source` before appending to `foundTorrents`
- Treat the search as "complete" when both streams emit `complete` or `error`

The implementation:

```tsx
const sources: Array<'piratebay' | 'rutracker'> = mode === 'both'
  ? ['piratebay', 'rutracker']
  : [mode];

const eventSourceRefs = useRef<EventSource[]>([]);

useEffect(() => () => {
  eventSourceRefs.current.forEach(es => es.close());
  eventSourceRefs.current = [];
}, []);

const handleScrapeSearch = async () => {
  eventSourceRefs.current.forEach(es => es.close());
  eventSourceRefs.current = [];
  setSearchLoading(true);
  setFoundTorrents([]);

  let completed = 0;
  const total = sources.length;

  sources.forEach((source) => {
    const cfg = ScraperConfig[source];
    const url = `${cfg.scrapeStreamEndpoint}${encodeURIComponent(torrentName)}/stream`;
    const es = new EventSource(url);
    eventSourceRefs.current.push(es);

    es.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        if (data.type === 'success' && Array.isArray(data.data)) {
          const tagged: ScrapedTorrents[] = (data.data as ScrapedTorrents[])
            .map(t => ({ ...t, source }));
          setFoundTorrents(prev => [...(prev ?? []), ...tagged]);
        } else if (data.type === 'error') {
          toast({
            variant: 'destructive',
            title: `${source} search failed`,
            description: data.message,
          });
        } else if (data.type === 'complete') {
          es.close();
          completed += 1;
          if (completed === total) setSearchLoading(false);
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };

    es.onerror = () => {
      es.close();
      completed += 1;
      if (completed === total) setSearchLoading(false);
    };
  });
};
```

> The exact existing `SSEEvent` shape (which `type` values exist, where rows live in `data`) is in the unmodified file — preserve those fields, just multiplex across `sources`. If the existing code stores `foundTorrents` differently (e.g., per-source), adapt accordingly while preserving the `mode === 'both'` semantics.

- [ ] **Step 3: Add source badge column in results**

Open `frontend/src/Scraper/ScrapedTorrents.tsx`. Find the row rendering. Next to the title (or as a new column near the uploader/size badges), add:

```tsx
{torrent.source && (
  <span className={`rounded-md px-2 py-0.5 text-xs ${
    torrent.source === 'piratebay'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
  }`}>
    {torrent.source === 'piratebay' ? 'PirateBay' : 'Rutracker'}
  </span>
)}
```

- [ ] **Step 4: Remove old `type` and `switchTab` references**

Search the codebase for `switchTab` and `type=` on `<ScraperUI`:

```bash
grep -rn "switchTab\|<ScraperUI" frontend/src/
```

The old `Home.tsx` is the only consumer; that file is being rewritten in Task 26. The grep should show only `frontend/src/components/Home.tsx`. Leave those references alone — Task 26 deletes them.

- [ ] **Step 5: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: errors only in `Home.tsx` (still using the old API). That's fine — Task 26 fixes it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Scraper/ScraperUI.tsx frontend/src/Scraper/ScrapedTorrents.tsx frontend/src/Models.tsx
git commit -m "$(cat <<'EOF'
frontend/Scraper: support mode='both' + source badge per row

ScraperUI now takes a mode prop. In 'both', opens two EventSources in
parallel, tags each scraped row with its source, and shows a colored
source badge in the results card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Create `SearchPage`

**Files:**
- Create: `frontend/src/pages/SearchPage.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/pages/SearchPage.tsx`:

```tsx
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScraperUI } from '@/Scraper/ScraperUI';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  useEffect(() => {
    document.title = q ? `Search · ${q}` : 'Search';
    return () => { document.title = 'TorrentUI'; };
  }, [q]);

  return (
    <div className="py-4">
      {/* ScraperUI internally manages its own search input, but we seed it
          via key so changes to the URL query trigger a fresh search. */}
      <ScraperUI key={q} mode="both" />
      {/* setParams unused intentionally — kept for future URL-driven search */}
      <span hidden>{String(setParams).length > 0}</span>
    </div>
  );
}
```

> If `ScraperUI` exposes a `defaultQuery` prop, prefer passing the query in directly. The above uses `key={q}` to force a remount on URL change as a simple, robust fallback. If you'd rather wire it cleanly, add a `defaultQuery` prop to `ScraperUI` and consume it in its `useState(torrentName, ...)` initializer.

- [ ] **Step 2: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: errors only in `Home.tsx` (still old).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx
git commit -m "$(cat <<'EOF'
frontend: SearchPage hosts ScraperUI in mode='both'

Reads ?q= from the URL and seeds the scraper. Sets document.title.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Create `TopBarSearch` component

**Files:**
- Create: `frontend/src/components/topbar/TopBarSearch.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/topbar/TopBarSearch.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';

export function TopBarSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex-1 max-w-xl">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search torrents…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-8 h-8"
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/topbar/TopBarSearch.tsx
git commit -m "$(cat <<'EOF'
frontend/topbar: TopBarSearch input

Enter routes to /search?q=…. Search icon, max-w-xl so it doesn't dominate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Create `EditDashboardToggle` component

**Files:**
- Create: `frontend/src/components/topbar/EditDashboardToggle.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/topbar/EditDashboardToggle.tsx`:

```tsx
import { useLocation } from 'react-router-dom';
import { Pencil, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useDashboard } from '@/components/dashboard';

export function EditDashboardToggle() {
  const { pathname } = useLocation();
  const { isEditing, beginEdit, cancelEdit, saveEdit } = useDashboard();
  const { toast } = useToast();

  // Only relevant on the home/dashboard route.
  if (pathname !== '/') return null;

  const onSave = async () => {
    try {
      await saveEdit();
      toast({ title: 'Dashboard saved' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  if (!isEditing) {
    return (
      <Button variant="ghost" size="sm" onClick={beginEdit}>
        <Pencil className="h-4 w-4 mr-1" />
        Edit
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={cancelEdit}>
        <X className="h-4 w-4 mr-1" />
        Cancel
      </Button>
      <Button size="sm" onClick={onSave}>
        <Save className="h-4 w-4 mr-1" />
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/topbar/EditDashboardToggle.tsx
git commit -m "$(cat <<'EOF'
frontend/topbar: EditDashboardToggle

Renders only on the '/' route. Toggles edit mode via DashboardContext.
While editing, replaces the Edit button with Cancel + Save pills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Update `AppShell` to slot in search + edit toggle, rewrite `Home.tsx`

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/components/Home.tsx`

- [ ] **Step 1: AppShell**

Open `frontend/src/components/AppShell.tsx` (post-merge from sidebar branch). The current shape is:

```tsx
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
// ...
<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
  <SidebarTrigger className="-ml-1" />
  <Separator orientation="vertical" className="mr-2 !h-4" />
  <span className="text-sm text-muted-foreground">TorrentUI</span>
</header>
```

Add the search + edit toggle. The full new file:

```tsx
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { TopBarSearch } from "@/components/topbar/TopBarSearch";
import { EditDashboardToggle } from "@/components/topbar/EditDashboardToggle";

type User = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
};

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 !h-4" />
          <span className="text-sm text-muted-foreground hidden sm:inline">TorrentUI</span>
          <TopBarSearch />
          <EditDashboardToggle />
        </header>
        <main className="flex-1 px-4 md:px-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Rewrite Home.tsx**

Replace the entire contents of `frontend/src/components/Home.tsx` with:

```tsx
import { Dashboard } from '@/components/dashboard';
import { Toaster } from '@/components/ui/toaster';

export function Home() {
  return (
    <>
      <Dashboard />
      <Toaster />
    </>
  );
}
```

(Note the change from the old default export — App.tsx already uses the named `Home`. If your local App.tsx uses default-export style, adjust either the import or the export to match.)

- [ ] **Step 3: Verify imports**

```bash
grep -n "export.*Home\|import.*Home" frontend/src/components/Home.tsx frontend/src/App.tsx
```
Ensure App.tsx imports `Home` as a named import (`import { Home } from "@/components/Home";`). If it uses default, change either side to match.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/Home.tsx
git commit -m "$(cat <<'EOF'
frontend: top-bar search + edit toggle, Home becomes Dashboard host

AppShell's h-12 header gains TopBarSearch and EditDashboardToggle.
Home is now a thin wrapper around <Dashboard />; the old tab structure
and slide animations are gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27: Add `/search` route + wrap router in `DashboardProvider`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Wrap and add route**

Replace `frontend/src/App.tsx` with:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import { LoginScreen } from "@/components/LoginScreen";
import { AppShell } from "@/components/AppShell";
import { Home } from "@/components/Home";
import { AdminPage } from "@/components/AdminPage";
import { SearchPage } from "@/pages/SearchPage";
import { DashboardProvider } from "@/components/dashboard";

export default function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  return (
    <BrowserRouter>
      <DashboardProvider>
        <AppShell user={session.user as any}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route
              path="/admin"
              element={
                (session.user as any).role === "admin"
                  ? <AdminPage />
                  : <Navigate to="/" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </DashboardProvider>
    </BrowserRouter>
  );
}
```

> `DashboardProvider` wraps `AppShell` (not just `Home`) because `EditDashboardToggle` lives in the AppShell's header but reads from the dashboard context.

- [ ] **Step 2: Full typecheck and lint**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit && pnpm lint
```
Expected: exit 0 for both. Fix any lingering issues.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
frontend: add /search route, wrap shell in DashboardProvider

DashboardProvider must wrap AppShell because the EditDashboardToggle in
the header reads dashboard context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 28: Add navigation guard for unsaved edits

**Files:**
- Modify: `frontend/src/components/dashboard/Dashboard.tsx`

The spec calls for a confirm prompt when navigating away mid-edit. `react-router-dom` 6.30 supports `useBlocker` for in-app navigation; `beforeunload` covers tab close/refresh.

- [ ] **Step 1: Add the guard inside Dashboard**

Open `frontend/src/components/dashboard/Dashboard.tsx`. At the top of the component (after `const { isLoading } = useDashboard();`), add:

```tsx
import { useBlocker } from 'react-router-dom';
// ... inside component:
const { isLoading, isEditing } = useDashboard();

useEffect(() => {
  if (!isEditing) return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = ''; // Chrome requires this
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [isEditing]);

const blocker = useBlocker(
  ({ currentLocation, nextLocation }) =>
    isEditing && currentLocation.pathname !== nextLocation.pathname
);

useEffect(() => {
  if (blocker.state === 'blocked') {
    const ok = window.confirm('Discard unsaved dashboard changes?');
    if (ok) blocker.proceed();
    else blocker.reset();
  }
}, [blocker]);
```

Be sure `useEffect` is in the import list at the top of the file.

- [ ] **Step 2: Typecheck**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/Dashboard.tsx
git commit -m "$(cat <<'EOF'
frontend/dashboard: confirm navigation away while editing

useBlocker for in-app navigation, beforeunload for tab close. Confirm
dialog "Discard unsaved dashboard changes?" — proceed or stay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 29: End-to-end verification

**Files:** none — manual smoke + automated checks.

- [ ] **Step 1: Full build, lint, typecheck**

```bash
cd backend && go test ./... && go build ./... && go vet ./...
cd ../auth-service && pnpm test && pnpm typecheck && pnpm build
cd ../frontend && ./node_modules/.bin/tsc --noEmit && pnpm lint && pnpm build
```
Expected: every command exits 0.

- [ ] **Step 2: Bring up the dev stack**

```bash
make dev-build
make dev-logs
```

Wait for backend log: `Database ready at /data/backend.sqlite` (or your dev path), and frontend HMR ready.

- [ ] **Step 3: Manual smoke — dashboard default state**

1. Open the app in a browser and sign in.
2. Land on `/`. Confirm the dashboard renders with Active Torrents (wide), Quick Add, Storage, Recent Activity.
3. Confirm the top bar shows: sidebar trigger, "TorrentUI" label (md+), search input, "Edit" button.
4. Resize to mobile width (devtools). Confirm widgets stack in a single column; Edit button hides.

- [ ] **Step 4: Manual smoke — edit mode**

1. Click "Edit". Confirm:
   - Title bars become draggable (cursor change)
   - Each widget shows an X (hide) button
   - "Save" and "Cancel" appear next to "Editing"
   - "+ Add widget" and "Reset to default" appear above the grid
2. Hide a widget; confirm it disappears and shows up in the "Add widget" dropdown.
3. Drag a widget to a new position.
4. Click "Save". Confirm toast "Dashboard saved" and Edit pill returns.
5. Refresh the page. Confirm the new layout persists.
6. Click "Edit", make a change, click "Cancel". Confirm the layout reverts.
7. Click "Edit", make a change, navigate to `/admin`. Confirm the "Discard unsaved changes?" prompt fires.

- [ ] **Step 5: Manual smoke — search**

1. Type "ubuntu" into the top-bar search and press Enter.
2. Confirm navigation to `/search?q=ubuntu`.
3. Confirm both PirateBay and Rutracker results appear over time, each tagged with a source badge.
4. Click the sidebar Home link or trigger to return.

- [ ] **Step 6: Tear down**

```bash
make dev-down
```

- [ ] **Step 7: Final commit (if any uncommitted fixes from smoke testing)**

If smoke testing surfaced fixes, commit them with descriptive messages. Then mark the plan complete.

- [ ] **Step 8: Push the branch**

```bash
git push -u origin dashboard-redesign
```

---

## Out of scope (mirrors the spec)

Do **not** implement these even if it feels natural during the work:
- Multiple instances of the same widget
- Per-widget settings (e.g., "Recent: show 5 vs. 10")
- Named "views" / multiple saved layouts per user
- Drag/resize/edit on mobile
- Real-time layout sync across browser tabs
- `DELETE /api/user/dashboard` endpoint
- Migration library on the Go backend
- Frontend test harness
- The PirateBay vs. Rutracker source picker UI
