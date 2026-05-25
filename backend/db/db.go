package db

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Open opens (or creates) a SQLite database at path and verifies connectivity.
// Caller owns Close.
func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", path, err)
	}
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("db: ping %s: %w", path, err)
	}
	return d, nil
}

// Migrate applies the embedded schema. Safe to call multiple times.
func Migrate(d *sql.DB) error {
	if _, err := d.Exec(schemaSQL); err != nil {
		return fmt.Errorf("db: apply schema: %w", err)
	}
	return nil
}
