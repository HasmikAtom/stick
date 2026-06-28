import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { runOwnedMigrations } = await import("../db.js");
runOwnedMigrations();

const { proxyToGo } = await import("../proxy.js");

function makeApp(captured: { headers?: Headers; url?: string }) {
  // mock Go backend with a simple fetch shim
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    captured.url = typeof input === "string" ? input : input.url;
    captured.headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;
  process.env.GO_BACKEND_URL = "http://backend.test";

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "u1", email: "a@x.com", role: "user" } as any);
    await next();
  });
  app.all("/api/*", proxyToGo);

  return { app, restore: () => (globalThis.fetch = originalFetch) };
}

test("proxy strips inbound x-user-* and cookie headers, attaches trusted ones", async () => {
  const captured: any = {};
  const { app, restore } = makeApp(captured);

  const res = await app.request("/api/torrents", {
    method: "GET",
    headers: {
      "cookie": "session=stolen",
      "x-user-id": "spoofed",
      "x-user-email": "spoof@x.com",
      "x-user-role": "admin",
    },
  });

  restore();
  assert.equal(res.status, 200);
  assert.equal(captured.url, "http://backend.test/torrents");
  assert.equal(captured.headers.get("cookie"), null);
  assert.equal(captured.headers.get("x-user-id"), "u1");
  assert.equal(captured.headers.get("x-user-email"), "a@x.com");
  assert.equal(captured.headers.get("x-user-role"), "user");
});

test("proxy strips /api prefix from forwarded path", async () => {
  const captured: any = {};
  const { app, restore } = makeApp(captured);

  await app.request("/api/scrape/piratebay/foo");
  restore();
  assert.equal(captured.url, "http://backend.test/scrape/piratebay/foo");
});

test("proxy preserves query string", async () => {
  const captured: any = {};
  const { app, restore } = makeApp(captured);

  await app.request("/api/torrents?limit=10");
  restore();
  assert.equal(captured.url, "http://backend.test/torrents?limit=10");
});
