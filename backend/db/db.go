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
