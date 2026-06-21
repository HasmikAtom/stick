import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GO_BACKEND_URL = "http://backend.test";

const { runOwnedMigrations, db } = await import("../db.js");
runOwnedMigrations();
db.prepare("DELETE FROM plex_app").run();
db.prepare("DELETE FROM plex_connection").run();

const { mountPlexRoutes } = await import("../plex-routes.js");

function makeApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1", email: "u@x.com", role: "user" } as any);
    await next();
  });
  mountPlexRoutes(app);
  return app;
}

function mockFetch(handler: (url: string, init: any) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) =>
    handler(typeof input === "string" ? input : input.url, init)) as any;
  return () => (globalThis.fetch = original);
}

test("POST /api/plex/link/start returns code + authUrl", async () => {
  const restore = mockFetch(() =>
    new Response(JSON.stringify({ id: 7, code: "WXYZ" }), {
      headers: { "content-type": "application/json" },
    }));
  const res = await makeApp().request("/api/plex/link/start", { method: "POST" });
  const body = await res.json();
  restore();
  assert.equal(res.status, 200);
  assert.equal(body.code, "WXYZ");
  assert.match(body.authUrl, /app\.plex\.tv\/auth.*code=WXYZ/);
});

test("GET /api/plex/link/poll returns pending when no token yet", async () => {
  const restore = mockFetch(() =>
    new Response(JSON.stringify({ authToken: null }), {
      headers: { "content-type": "application/json" },
    }));
  const res = await makeApp().request("/api/plex/link/poll");
  const body = await res.json();
  restore();
  assert.equal(body.status, "pending");
});

test("poll stores token + returns servers once authorized", async () => {
  // start to register a pending pin for user-1
  const startRestore = mockFetch(() =>
    new Response(JSON.stringify({ id: 7, code: "WXYZ" }), {
      headers: { "content-type": "application/json" },
    }));
  const app = makeApp();
  await app.request("/api/plex/link/start", { method: "POST" });
  startRestore();

  const restore = mockFetch((url) => {
    if (url.includes("/api/v2/pins/"))
      return new Response(JSON.stringify({ authToken: "tok-9" }), {
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/api/v2/user"))
      return new Response(JSON.stringify({ username: "dave" }), {
        headers: { "content-type": "application/json" },
      });
    // resources
    return new Response(
      JSON.stringify([
        {
          name: "Living Room",
          clientIdentifier: "machine-1",
          provides: "server",
          accessToken: "srv-tok",
          connections: [{ uri: "http://10.0.0.5:32400", local: true, relay: false }],
        },
      ]),
      { headers: { "content-type": "application/json" } },
    );
  });
  const res = await app.request("/api/plex/link/poll");
  const body = await res.json();
  restore();
  assert.equal(body.status, "linked");
  assert.deepEqual(body.servers, [{ machineId: "machine-1", name: "Living Room" }]);
});

test("GET /api/plex/status reflects linked account", async () => {
  const res = await makeApp().request("/api/plex/status");
  const body = await res.json();
  assert.equal(body.linked, true);
  assert.equal(body.plexUsername, "dave");
});

test("POST /api/plex/server probes via Go and stores the reachable uri", async () => {
  const restore = mockFetch((url, init) => {
    if (url.includes("/api/v2/resources"))
      return new Response(
        JSON.stringify([
          {
            name: "Living Room",
            clientIdentifier: "machine-1",
            provides: "server",
            accessToken: "srv-tok",
            connections: [{ uri: "http://10.0.0.5:32400", local: true, relay: false }],
          },
        ]),
        { headers: { "content-type": "application/json" } },
      );
    // Go probe
    assert.equal(url, "http://backend.test/plex/probe");
    assert.equal(init.headers["x-user-id"], "user-1");
    return new Response(JSON.stringify({ uri: "http://10.0.0.5:32400" }), {
      headers: { "content-type": "application/json" },
    });
  });
  const res = await makeApp().request("/api/plex/server", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineId: "machine-1" }),
  });
  const body = await res.json();
  restore();
  assert.equal(res.status, 200);
  assert.equal(body.serverName, "Living Room");
});

test("DELETE /api/plex/link unlinks", async () => {
  const res = await makeApp().request("/api/plex/link", { method: "DELETE" });
  assert.equal(res.status, 204);
  const status = await (await makeApp().request("/api/plex/status")).json();
  assert.equal(status.linked, false);
});
