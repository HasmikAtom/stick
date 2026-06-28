// auth-service/src/__tests__/plex-proxy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { runOwnedMigrations, db } = await import("../db.js");
runOwnedMigrations();
db.prepare("DELETE FROM plex_connection").run();

const store = await import("../plex/store.js");
const { proxyToGo } = await import("../proxy.js");

function makeApp(captured: { headers?: Headers }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init: any) => {
    captured.headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;
  process.env.GO_BACKEND_URL = "http://backend.test";
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1", email: "u@x.com", role: "user" } as any);
    await next();
  });
  app.all("/api/*", proxyToGo);
  return { app, restore: () => (globalThis.fetch = original) };
}

test("attaches X-Plex headers when the user has a selected server", async () => {
  store.saveAccountToken("user-1", "dave", "acct");
  store.saveServer("user-1", {
    machineId: "m1",
    name: "Living Room",
    uri: "http://10.0.0.5:32400",
    serverToken: "srv-tok",
  });
  const captured: any = {};
  const { app, restore } = makeApp(captured);
  await app.request("/api/plex/ping", {
    method: "GET",
    headers: { "x-plex-token": "spoofed", "x-plex-server-url": "http://evil" },
  });
  restore();
  assert.equal(captured.headers.get("x-plex-token"), "srv-tok");
  assert.equal(captured.headers.get("x-plex-server-url"), "http://10.0.0.5:32400");
});

test("omits X-Plex headers when the user has no connection", async () => {
  store.deleteConnection("user-1");
  const captured: any = {};
  const { app, restore } = makeApp(captured);
  await app.request("/api/torrents", { method: "GET" });
  restore();
  assert.equal(captured.headers.get("x-plex-token"), null);
  assert.equal(captured.headers.get("x-plex-server-url"), null);
});
