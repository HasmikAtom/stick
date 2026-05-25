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
