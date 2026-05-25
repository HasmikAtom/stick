import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { proxyToGo } from "../proxy.js";

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

test("proxy strips forged x-user-id on /api/user/dashboard", async () => {
  const captured: any = {};
  const { app, restore } = makeApp(captured);

  const res = await app.request("/api/user/dashboard", {
    method: "GET",
    headers: {
      "x-user-id": "attacker",
      "x-user-email": "attacker@x.com",
      "x-user-role": "admin",
    },
  });
  restore();
  assert.equal(res.status, 200);
  assert.equal(captured.url, "http://backend.test/user/dashboard");
  assert.equal(captured.headers.get("x-user-id"), "u1");
  assert.equal(captured.headers.get("x-user-email"), "a@x.com");
  assert.equal(captured.headers.get("x-user-role"), "user");
});

test("proxy forwards PUT body on /api/user/dashboard", async () => {
  const captured: any = {};
  // capture body too
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    captured.url = typeof input === "string" ? input : input.url;
    captured.headers = new Headers(init?.headers);
    captured.body = init?.body;
    captured.method = init?.method;
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as any;
  process.env.GO_BACKEND_URL = "http://backend.test";

  const { Hono } = await import("hono");
  const { proxyToGo } = await import("../proxy.js");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "u1", email: "a@x.com", role: "user" } as any);
    await next();
  });
  app.all("/api/*", proxyToGo);

  await app.request("/api/user/dashboard", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ layout: { version: 1, widgets: [] } }),
  });
  globalThis.fetch = originalFetch;
  assert.equal(captured.method, "PUT");
  assert.ok(captured.body, "expected body to be forwarded");
});
