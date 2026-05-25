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

// ErrInvalidLayout is the sentinel wrapped by every Validate failure.
// Callers use errors.Is(err, ErrInvalidLayout) to distinguish bad-input
// (400) from internal failures (500).
var ErrInvalidLayout = errors.New("invalid layout")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalidLayout}, args...)...)
}

// Validate enforces the StoredLayout schema. Every returned error wraps
// ErrInvalidLayout.
func Validate(l StoredLayout) error {
	if l.Version != CurrentVersion {
		return invalid("unsupported version %d (expected %d)", l.Version, CurrentVersion)
	}
	if len(l.Widgets) == 0 || len(l.Widgets) > MaxWidgetsInLayout {
		return invalid("widgets must contain 1..%d entries, got %d", MaxWidgetsInLayout, len(l.Widgets))
	}
	seen := make(map[string]bool, len(l.Widgets))
	for _, w := range l.Widgets {
		spec, ok := KnownWidgets[w.I]
		if !ok {
			return invalid("unknown widget id %q", w.I)
		}
		if seen[w.I] {
			return invalid("duplicate widget id %q", w.I)
		}
		seen[w.I] = true
		if w.X < 0 || w.Y < 0 || w.W <= 0 || w.H <= 0 {
			return invalid("widget %q has non-positive dimensions", w.I)
		}
		if w.X+w.W > GridCols {
			return invalid("widget %q overflows grid: x+w=%d > %d", w.I, w.X+w.W, GridCols)
		}
		if w.W < spec.MinW || w.H < spec.MinH {
			return invalid("widget %q below minimum size (w=%d<%d or h=%d<%d)", w.I, w.W, spec.MinW, w.H, spec.MinH)
		}
	}
	for i := 0; i < len(l.Widgets); i++ {
		for j := i + 1; j < len(l.Widgets); j++ {
			if overlaps(l.Widgets[i], l.Widgets[j]) {
				return invalid("widgets %q and %q overlap", l.Widgets[i].I, l.Widgets[j].I)
			}
		}
	}
	return nil
}

func overlaps(a, b WidgetLayout) bool {
	return a.X < b.X+b.W && b.X < a.X+a.W && a.Y < b.Y+b.H && b.Y < a.Y+a.H
}
