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
