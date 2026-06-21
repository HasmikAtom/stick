import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.js";
import { runOwnedMigrations } from "../db.js";

test("runOwnedMigrations creates plex_app and plex_connection tables", () => {
  runOwnedMigrations();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('plex_app','plex_connection')")
    .all()
    .map((r: any) => r.name)
    .sort();
  assert.deepEqual(tables, ["plex_app", "plex_connection"]);
});
