// auth-service/src/__tests__/plex-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { runOwnedMigrations, db } = await import("../db.js");
runOwnedMigrations();
db.prepare("DELETE FROM plex_app").run();
db.prepare("DELETE FROM plex_connection").run();

const store = await import("../plex/store.js");

test("getOrCreateClientId is stable across calls", () => {
  const a = store.getOrCreateClientId();
  const b = store.getOrCreateClientId();
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("saveAccountToken then getConnection round-trips and decrypts", () => {
  store.saveAccountToken("user-1", "dave", "acct-tok");
  const conn = store.getConnection("user-1");
  assert.ok(conn);
  assert.equal(conn!.plexUsername, "dave");
  assert.equal(conn!.accountToken, "acct-tok"); // decrypted
  assert.equal(conn!.serverUri, null);
});

test("saveServer attaches server fields", () => {
  store.saveServer("user-1", {
    machineId: "machine-1",
    name: "Living Room",
    uri: "http://192.168.1.5:32400",
    serverToken: "srv-tok",
  });
  const conn = store.getConnection("user-1");
  assert.equal(conn!.serverMachineId, "machine-1");
  assert.equal(conn!.serverUri, "http://192.168.1.5:32400");
  assert.equal(conn!.serverToken, "srv-tok"); // decrypted
});

test("deleteConnection removes the row", () => {
  store.deleteConnection("user-1");
  assert.equal(store.getConnection("user-1"), null);
});
