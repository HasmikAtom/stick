import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.DATABASE_PATH ?? "./data/auth.sqlite";

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const bootstrapAdmins = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function runOwnedMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invited_emails (
      email      TEXT PRIMARY KEY,
      invited_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS plex_app (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      client_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plex_connection (
      user_id           TEXT PRIMARY KEY,
      plex_username     TEXT,
      account_token     TEXT NOT NULL,
      server_machine_id TEXT,
      server_name       TEXT,
      server_uri        TEXT,
      server_token      TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function reconcileBootstrapAdmins() {
  const stmt = db.prepare(
    "UPDATE user SET role = 'admin' WHERE lower(email) = ?"
  );
  for (const email of bootstrapAdmins) {
    try {
      stmt.run(email);
    } catch {
      // user table may not exist yet on very first boot before migrate ran
    }
  }
}
