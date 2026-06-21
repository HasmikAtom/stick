# Plex Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each TorrentUI user link their own Plex account via Plex's PIN OAuth flow, store the token encrypted, discover and select a server, and verify the connection end-to-end.

**Architecture:** The auth-service (Node/Hono) owns the Plex auth flow and token storage (SQLite, encrypted), and injects a trusted `X-Plex-Token` + `X-Plex-Server-Url` on every `/api/*` request it proxies to Go — mirroring how it already injects `X-User-*`. The Go backend stays stateless: it reads those headers and makes Plex calls (a reachability probe and a ping). Reachability of candidate server connections is probed from Go's network because Go is what will talk to Plex later.

**Tech Stack:** Node 20 + Hono + better-sqlite3 + node:crypto (auth-service); Go 1.23 + Gin (backend); React + React Router + shadcn/Radix (frontend).

---

## File Structure

**auth-service (Node):**
- `src/plex/crypto.ts` — AES-256-GCM encrypt/decrypt for tokens at rest (new).
- `src/plex/plextv.ts` — thin plex.tv HTTP client: createPin, pollPin, listServers, fetchAccount (new).
- `src/plex/store.ts` — SQLite CRUD for `plex_app` + `plex_connection`, with encryption (new).
- `src/plex-routes.ts` — `/api/plex/*` Hono routes + Go probe helper (new).
- `src/db.ts` — add plex tables to `runOwnedMigrations()` (modify).
- `src/proxy.ts` — inject `X-Plex-*` headers (modify).
- `src/server.ts` — mount plex routes before the proxy catch-all (modify).
- `src/__tests__/plex-*.test.ts` — node:test suites (new).

**backend (Go, package main):**
- `plex.go` — `/plex/ping` + `/plex/probe` handlers and `plexIdentity` helper (new).
- `plex_test.go` — handler/helper tests against an httptest Plex stub (new).
- `main.go` — register the two routes (modify).

**frontend (React):**
- `src/components/PlexSettings.tsx` — per-user link UI (new).
- `src/App.tsx` — add `/plex` route (modify).
- `src/components/AppShell.tsx` — add "Plex" link in the user dropdown (modify).

**config/docs:**
- `auth-service/.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`, `CLAUDE.md` (modify).

---

## Task 1: Plex DB schema + migration

**Files:**
- Modify: `auth-service/src/db.ts` (inside `runOwnedMigrations`)
- Test: `auth-service/src/__tests__/plex-db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// auth-service/src/__tests__/plex-db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-db.test.ts`
Expected: FAIL — tables not found (assert.deepEqual mismatch, gets `[]`).

- [ ] **Step 3: Add the tables to the migration**

In `auth-service/src/db.ts`, extend `runOwnedMigrations()` so its body becomes:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/db.ts auth-service/src/__tests__/plex-db.test.ts
git commit -m "feat(plex): add plex_app and plex_connection tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Token encryption module

**Files:**
- Create: `auth-service/src/plex/crypto.ts`
- Test: `auth-service/src/__tests__/plex-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// auth-service/src/__tests__/plex-crypto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars

const { encrypt, decrypt } = await import("../plex/crypto.js");

test("encrypt/decrypt round-trips", () => {
  const secret = "plex-token-xyz";
  const blob = encrypt(secret);
  assert.notEqual(blob, secret);
  assert.equal(decrypt(blob), secret);
});

test("decrypt rejects tampered ciphertext", () => {
  const blob = encrypt("abc");
  const parts = blob.split(".");
  parts[2] = Buffer.from("zzzz").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && pnpm test -- src/__tests__/plex-crypto.test.ts`
Expected: FAIL — cannot find module `../plex/crypto.js`.

- [ ] **Step 3: Write the module**

```ts
// auth-service/src/plex/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.PLEX_TOKEN_ENC_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("PLEX_TOKEN_ENC_KEY must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

// Format: base64(iv).base64(authTag).base64(ciphertext)
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  const [ivB, tagB, ctB] = blob.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && pnpm test -- src/__tests__/plex-crypto.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/plex/crypto.ts auth-service/src/__tests__/plex-crypto.test.ts
git commit -m "feat(plex): add AES-256-GCM token encryption

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: plex.tv client

**Files:**
- Create: `auth-service/src/plex/plextv.ts`
- Test: `auth-service/src/__tests__/plex-plextv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// auth-service/src/__tests__/plex-plextv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPin, pollPin, listServers, fetchAccount } from "../plex/plextv.js";

function mockFetch(handler: (url: string, init: any) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) =>
    handler(typeof input === "string" ? input : input.url, init)) as any;
  return () => (globalThis.fetch = original);
}

test("createPin returns id and code", async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, "https://plex.tv/api/v2/pins?strong=true");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Plex-Client-Identifier"], "cid-1");
    return new Response(JSON.stringify({ id: 42, code: "ABCD" }), {
      headers: { "content-type": "application/json" },
    });
  });
  const pin = await createPin("cid-1");
  restore();
  assert.deepEqual(pin, { id: 42, code: "ABCD" });
});

test("pollPin returns null token when not yet authorized", async () => {
  const restore = mockFetch(() =>
    new Response(JSON.stringify({ id: 42, authToken: null }), {
      headers: { "content-type": "application/json" },
    }));
  const r = await pollPin("cid-1", 42);
  restore();
  assert.equal(r.authToken, null);
});

test("pollPin returns token once authorized", async () => {
  const restore = mockFetch(() =>
    new Response(JSON.stringify({ id: 42, authToken: "tok-9" }), {
      headers: { "content-type": "application/json" },
    }));
  const r = await pollPin("cid-1", 42);
  restore();
  assert.equal(r.authToken, "tok-9");
});

test("listServers keeps only server devices and maps connections", async () => {
  const restore = mockFetch((url, init) => {
    assert.match(url, /\/api\/v2\/resources/);
    assert.equal(init.headers["X-Plex-Token"], "tok-9");
    return new Response(
      JSON.stringify([
        {
          name: "Living Room",
          clientIdentifier: "machine-1",
          provides: "server,player",
          accessToken: "srv-tok-1",
          connections: [
            { uri: "http://192.168.1.5:32400", local: true, relay: false },
            { uri: "https://plex.example.com", local: false, relay: false },
          ],
        },
        { name: "Phone", clientIdentifier: "machine-2", provides: "player", connections: [] },
      ]),
      { headers: { "content-type": "application/json" } },
    );
  });
  const servers = await listServers("cid-1", "tok-9");
  restore();
  assert.equal(servers.length, 1);
  assert.equal(servers[0].machineId, "machine-1");
  assert.equal(servers[0].accessToken, "srv-tok-1");
  assert.equal(servers[0].connections.length, 2);
});

test("fetchAccount returns username", async () => {
  const restore = mockFetch(() =>
    new Response(JSON.stringify({ username: "dave", title: "Dave" }), {
      headers: { "content-type": "application/json" },
    }));
  const acct = await fetchAccount("cid-1", "tok-9");
  restore();
  assert.equal(acct.username, "dave");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && pnpm test -- src/__tests__/plex-plextv.test.ts`
Expected: FAIL — cannot find module `../plex/plextv.js`.

- [ ] **Step 3: Write the client**

```ts
// auth-service/src/plex/plextv.ts
const PLEXTV = "https://plex.tv";
const PRODUCT = "TorrentUI";
const VERSION = "1.0.0";

export type PlexConnection = { uri: string; local: boolean; relay: boolean };
export type PlexServer = {
  name: string;
  machineId: string;
  accessToken: string;
  connections: PlexConnection[];
};

function headers(clientId: string, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Device": "TorrentUI",
    "X-Plex-Platform": "Web",
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

export async function createPin(clientId: string): Promise<{ id: number; code: string }> {
  const res = await fetch(`${PLEXTV}/api/v2/pins?strong=true`, {
    method: "POST",
    headers: headers(clientId),
  });
  if (!res.ok) throw new Error(`plex pin create failed: ${res.status}`);
  const j = (await res.json()) as { id: number; code: string };
  return { id: j.id, code: j.code };
}

export async function pollPin(
  clientId: string,
  id: number,
): Promise<{ authToken: string | null }> {
  const res = await fetch(`${PLEXTV}/api/v2/pins/${id}`, { headers: headers(clientId) });
  if (res.status === 404) return { authToken: null };
  if (!res.ok) throw new Error(`plex pin poll failed: ${res.status}`);
  const j = (await res.json()) as { authToken?: string | null };
  return { authToken: j.authToken ?? null };
}

export async function listServers(clientId: string, token: string): Promise<PlexServer[]> {
  const res = await fetch(`${PLEXTV}/api/v2/resources?includeHttps=1&includeRelay=1`, {
    headers: headers(clientId, token),
  });
  if (!res.ok) throw new Error(`plex resources failed: ${res.status}`);
  const arr = (await res.json()) as any[];
  return arr
    .filter((d) => String(d.provides ?? "").split(",").includes("server"))
    .map((d) => ({
      name: d.name,
      machineId: d.clientIdentifier,
      accessToken: d.accessToken,
      connections: (d.connections ?? []).map((c: any) => ({
        uri: c.uri,
        local: !!c.local,
        relay: !!c.relay,
      })),
    }));
}

export async function fetchAccount(
  clientId: string,
  token: string,
): Promise<{ username: string }> {
  const res = await fetch(`${PLEXTV}/api/v2/user`, { headers: headers(clientId, token) });
  if (!res.ok) throw new Error(`plex user failed: ${res.status}`);
  const j = (await res.json()) as { username?: string; title?: string };
  return { username: j.username ?? j.title ?? "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && pnpm test -- src/__tests__/plex-plextv.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/plex/plextv.ts auth-service/src/__tests__/plex-plextv.test.ts
git commit -m "feat(plex): add plex.tv client (pin, poll, resources, account)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Connection store

**Files:**
- Create: `auth-service/src/plex/store.ts`
- Test: `auth-service/src/__tests__/plex-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-store.test.ts`
Expected: FAIL — cannot find module `../plex/store.js`.

- [ ] **Step 3: Write the store**

```ts
// auth-service/src/plex/store.ts
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { encrypt, decrypt } from "./crypto.js";

export type Connection = {
  userId: string;
  plexUsername: string | null;
  accountToken: string;
  serverMachineId: string | null;
  serverName: string | null;
  serverUri: string | null;
  serverToken: string | null;
};

export function getOrCreateClientId(): string {
  const row = db.prepare("SELECT client_id FROM plex_app WHERE id = 1").get() as
    | { client_id: string }
    | undefined;
  if (row) return row.client_id;
  const cid = randomUUID();
  db.prepare("INSERT INTO plex_app (id, client_id) VALUES (1, ?)").run(cid);
  return cid;
}

export function saveAccountToken(userId: string, username: string, accountToken: string): void {
  db.prepare(
    `INSERT INTO plex_connection (user_id, plex_username, account_token, updated_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       plex_username = excluded.plex_username,
       account_token = excluded.account_token,
       updated_at    = unixepoch()`,
  ).run(userId, username, encrypt(accountToken));
}

export function saveServer(
  userId: string,
  server: { machineId: string; name: string; uri: string; serverToken: string },
): void {
  db.prepare(
    `UPDATE plex_connection
       SET server_machine_id = ?, server_name = ?, server_uri = ?, server_token = ?, updated_at = unixepoch()
     WHERE user_id = ?`,
  ).run(server.machineId, server.name, server.uri, encrypt(server.serverToken), userId);
}

export function getConnection(userId: string): Connection | null {
  const row = db
    .prepare("SELECT * FROM plex_connection WHERE user_id = ?")
    .get(userId) as any;
  if (!row) return null;
  return {
    userId: row.user_id,
    plexUsername: row.plex_username,
    accountToken: decrypt(row.account_token),
    serverMachineId: row.server_machine_id,
    serverName: row.server_name,
    serverUri: row.server_uri,
    serverToken: row.server_token ? decrypt(row.server_token) : null,
  };
}

export function deleteConnection(userId: string): void {
  db.prepare("DELETE FROM plex_connection WHERE user_id = ?").run(userId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-store.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/plex/store.ts auth-service/src/__tests__/plex-store.test.ts
git commit -m "feat(plex): add encrypted connection store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Plex routes (link/poll/server/status/unlink)

**Files:**
- Create: `auth-service/src/plex-routes.ts`
- Test: `auth-service/src/__tests__/plex-routes.test.ts`

This module uses an in-memory `Map<userId, {id}>` for pending PINs, calls the plex.tv client, persists via the store, and for `POST /api/plex/server` asks the Go backend to probe candidate connection URIs.

- [ ] **Step 1: Write the failing test**

```ts
// auth-service/src/__tests__/plex-routes.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-routes.test.ts`
Expected: FAIL — cannot find module `../plex-routes.js`.

- [ ] **Step 3: Write the routes**

```ts
// auth-service/src/plex-routes.ts
import type { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { createPin, pollPin, listServers, fetchAccount } from "./plex/plextv.js";
import {
  getOrCreateClientId,
  saveAccountToken,
  saveServer,
  getConnection,
  deleteConnection,
} from "./plex/store.js";

const GO_BACKEND = () => process.env.GO_BACKEND_URL ?? "http://backend:8080";

// Short-lived pending PINs, keyed by user id. Lost on restart (user re-clicks Connect).
const pendingPins = new Map<string, { id: number }>();

// Order connections so the backend tries local first, then remote, then relay.
function orderConnections(conns: { uri: string; local: boolean; relay: boolean }[]): string[] {
  const rank = (c: { local: boolean; relay: boolean }) => (c.local ? 0 : c.relay ? 2 : 1);
  return [...conns].sort((a, b) => rank(a) - rank(b)).map((c) => c.uri);
}

async function probeViaGo(
  user: AuthUser,
  token: string,
  uris: string[],
): Promise<{ uri: string } | null> {
  const res = await fetch(`${GO_BACKEND()}/plex/probe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": user.id,
      "x-user-email": user.email,
    },
    body: JSON.stringify({ token, uris }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { uri?: string };
  return j.uri ? { uri: j.uri } : null;
}

export function mountPlexRoutes(app: Hono<any>) {
  app.post("/api/plex/link/start", async (c) => {
    const user = c.get("user") as AuthUser;
    const clientId = getOrCreateClientId();
    const pin = await createPin(clientId);
    pendingPins.set(user.id, { id: pin.id });
    const authUrl =
      `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}` +
      `&code=${encodeURIComponent(pin.code)}` +
      `&context%5Bdevice%5D%5Bproduct%5D=TorrentUI`;
    return c.json({ code: pin.code, authUrl });
  });

  app.get("/api/plex/link/poll", async (c) => {
    const user = c.get("user") as AuthUser;
    const pending = pendingPins.get(user.id);
    if (!pending) return c.json({ status: "expired" });

    const clientId = getOrCreateClientId();
    const { authToken } = await pollPin(clientId, pending.id);
    if (!authToken) return c.json({ status: "pending" });

    pendingPins.delete(user.id);
    const account = await fetchAccount(clientId, authToken);
    saveAccountToken(user.id, account.username, authToken);
    const servers = await listServers(clientId, authToken);
    return c.json({
      status: "linked",
      servers: servers.map((s) => ({ machineId: s.machineId, name: s.name })),
    });
  });

  app.post("/api/plex/server", async (c) => {
    const user = c.get("user") as AuthUser;
    const body = (await c.req.json().catch(() => ({}))) as { machineId?: string };
    const conn = getConnection(user.id);
    if (!conn) return c.json({ error: "not linked" }, 400);

    const clientId = getOrCreateClientId();
    const servers = await listServers(clientId, conn.accountToken);
    const srv = servers.find((s) => s.machineId === body.machineId);
    if (!srv) return c.json({ error: "server not found" }, 404);

    const reachable = await probeViaGo(user, srv.accessToken, orderConnections(srv.connections));
    if (!reachable) {
      return c.json(
        {
          error: "no reachable connection",
          servers: servers.map((s) => ({ machineId: s.machineId, name: s.name })),
        },
        502,
      );
    }

    saveServer(user.id, {
      machineId: srv.machineId,
      name: srv.name,
      uri: reachable.uri,
      serverToken: srv.accessToken,
    });
    return c.json({ status: "linked", serverName: srv.name });
  });

  app.get("/api/plex/status", (c) => {
    const user = c.get("user") as AuthUser;
    const conn = getConnection(user.id);
    if (!conn) return c.json({ linked: false });
    return c.json({
      linked: true,
      plexUsername: conn.plexUsername,
      serverName: conn.serverName,
      serverSelected: !!conn.serverUri,
    });
  });

  app.delete("/api/plex/link", (c) => {
    const user = c.get("user") as AuthUser;
    deleteConnection(user.id);
    return c.body(null, 204);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-routes.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/plex-routes.ts auth-service/src/__tests__/plex-routes.test.ts
git commit -m "feat(plex): add link/poll/server/status/unlink routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Inject Plex headers in the proxy

**Files:**
- Modify: `auth-service/src/proxy.ts`
- Test: `auth-service/src/__tests__/plex-proxy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-proxy.test.ts`
Expected: FAIL — first test gets `null` for `x-plex-token` (injection not implemented; spoofed value also dropped because the current proxy never sets it... it will actually be `"spoofed"` since nothing strips it — assertion `=== "srv-tok"` fails).

- [ ] **Step 3: Add injection to the proxy**

In `auth-service/src/proxy.ts`, add the import and the header logic. The file becomes:

```ts
import type { Context } from "hono";
import type { AuthUser } from "./auth.js";
import { getConnection } from "./plex/store.js";

const GO_BACKEND = () => process.env.GO_BACKEND_URL ?? "http://backend:8080";

export const proxyToGo = async (c: Context) => {
  const user = c.get("user") as AuthUser;
  const url = new URL(c.req.url);
  const target = GO_BACKEND() + url.pathname.replace(/^\/api/, "") + url.search;

  const headers = new Headers(c.req.raw.headers);
  headers.delete("cookie");
  headers.delete("x-user-id");
  headers.delete("x-user-email");
  headers.delete("x-user-role");
  headers.delete("x-plex-token");
  headers.delete("x-plex-server-url");
  headers.set("x-user-id", user.id);
  headers.set("x-user-email", user.email);
  headers.set("x-user-role", (user as any).role ?? "user");

  const conn = getConnection(user.id);
  if (conn?.serverToken && conn.serverUri) {
    headers.set("x-plex-token", conn.serverToken);
    headers.set("x-plex-server-url", conn.serverUri);
  }

  const init: RequestInit = {
    method: c.req.method,
    headers,
    body:
      c.req.method === "GET" || c.req.method === "HEAD"
        ? undefined
        : c.req.raw.body,
    // @ts-expect-error duplex required for streaming bodies in Node fetch
    duplex: "half",
    redirect: "manual",
  };

  return fetch(target, init);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test -- src/__tests__/plex-proxy.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full auth-service suite to confirm no regressions**

Run: `cd auth-service && DATABASE_PATH=:memory: pnpm test`
Expected: PASS — existing proxy/hooks/admin tests plus all new plex tests.

- [ ] **Step 6: Commit**

```bash
git add auth-service/src/proxy.ts auth-service/src/__tests__/plex-proxy.test.ts
git commit -m "feat(plex): inject X-Plex-Token/Server-Url in proxy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire routes + migration + env into the server

**Files:**
- Modify: `auth-service/src/server.ts`
- Modify: `auth-service/.env.example`

- [ ] **Step 1: Mount the plex routes**

In `auth-service/src/server.ts`, add the import near the other route imports:

```ts
import { mountPlexRoutes } from "./plex-routes.js";
```

Then, in the section that currently reads:

```ts
app.use("/api/*", requireAuth);
app.all("/api/*", proxyToGo);
```

change it to:

```ts
app.use("/api/*", requireAuth);
mountPlexRoutes(app);
app.all("/api/*", proxyToGo);
```

(`runOwnedMigrations()` is already called on boot and now creates the plex tables, so no change is needed there. The exact `/api/plex/*` auth routes are registered before the `/api/*` catch-all, so `/api/plex/ping` falls through to `proxyToGo` and reaches Go.)

- [ ] **Step 2: Document the new env var**

Add to `auth-service/.env.example`:

```
# 32-byte hex key for encrypting Plex tokens at rest. Generate with: openssl rand -hex 32
PLEX_TOKEN_ENC_KEY=
```

- [ ] **Step 3: Typecheck**

Run: `cd auth-service && pnpm typecheck`
Expected: No new errors (pre-existing TS2769 warnings in test files are documented and acceptable).

- [ ] **Step 4: Boot smoke test**

Run:
```bash
cd auth-service && PLEX_TOKEN_ENC_KEY=$(openssl rand -hex 32) DATABASE_PATH=:memory: \
  BETTER_AUTH_SECRET=test GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y \
  timeout 4 pnpm dev 2>&1 | head -20
```
Expected: Logs `auth-service listening on :3000` with no migration/throw. (timeout ends it.)

- [ ] **Step 5: Commit**

```bash
git add auth-service/src/server.ts auth-service/.env.example
git commit -m "feat(plex): mount plex routes and document PLEX_TOKEN_ENC_KEY

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Go probe + ping handlers

**Files:**
- Create: `backend/plex.go`
- Create: `backend/plex_test.go`
- Modify: `backend/main.go`

- [ ] **Step 1: Write the failing test**

```go
// backend/plex_test.go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// plexStub returns a fake Plex server that answers /identity with the given machine id.
func plexStub(machineID string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/identity" && r.Header.Get("X-Plex-Token") == "good-tok" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"MediaContainer":{"machineIdentifier":"` + machineID + `"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
}

func TestPlexIdentity_ReachableServer(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	id, ok := plexIdentity(srv.URL, "good-tok")
	if !ok || id != "machine-xyz" {
		t.Fatalf("expected machine-xyz/true, got %q/%v", id, ok)
	}
}

func TestPlexIdentity_BadToken(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	if _, ok := plexIdentity(srv.URL, "bad-tok"); ok {
		t.Fatal("expected unreachable with bad token")
	}
}

func TestHandlePlexProbe_ReturnsFirstReachable(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/plex/probe", handlePlexProbe)

	body := `{"token":"good-tok","uris":["http://127.0.0.1:1/dead","` + srv.URL + `"]}`
	req := httptest.NewRequest(http.MethodPost, "/plex/probe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["uri"] != srv.URL {
		t.Fatalf("expected %s, got %s", srv.URL, resp["uri"])
	}
}

func TestHandlePlexPing_RequiresHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/plex/ping", handlePlexPing)
	req := httptest.NewRequest(http.MethodGet, "/plex/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 without headers, got %d", w.Code)
	}
}

func TestHandlePlexPing_Reachable(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/plex/ping", handlePlexPing)
	req := httptest.NewRequest(http.MethodGet, "/plex/ping", nil)
	req.Header.Set("X-Plex-Token", "good-tok")
	req.Header.Set("X-Plex-Server-Url", srv.URL)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./... -run Plex`
Expected: FAIL to compile — `plexIdentity`, `handlePlexProbe`, `handlePlexPing` undefined.

- [ ] **Step 3: Write the handlers**

```go
// backend/plex.go
package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// plexIdentity GETs <baseURL>/identity with the token and returns the server's
// machineIdentifier. ok=false means the server was unreachable or rejected the token.
func plexIdentity(baseURL, token string) (string, bool) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(baseURL, "/")+"/identity", nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("X-Plex-Token", token)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	var body struct {
		MediaContainer struct {
			MachineIdentifier string `json:"machineIdentifier"`
		} `json:"MediaContainer"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", false
	}
	return body.MediaContainer.MachineIdentifier, true
}

type plexProbeReq struct {
	Token string   `json:"token"`
	URIs  []string `json:"uris"`
}

// handlePlexProbe tries each candidate URI in order and returns the first reachable one.
// Called internally by the auth-service when a user selects a server.
func handlePlexProbe(c *gin.Context) {
	var req plexProbeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	for _, uri := range req.URIs {
		if id, ok := plexIdentity(uri, req.Token); ok {
			c.JSON(http.StatusOK, gin.H{"uri": uri, "machineIdentifier": id})
			return
		}
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": "no reachable connection"})
}

// handlePlexPing verifies the backend can reach the user's selected Plex server,
// using the X-Plex-* headers injected by the auth-service.
func handlePlexPing(c *gin.Context) {
	token := c.GetHeader("X-Plex-Token")
	serverURL := c.GetHeader("X-Plex-Server-Url")
	if token == "" || serverURL == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "plex not linked"})
		return
	}
	id, ok := plexIdentity(serverURL, token)
	if !ok {
		c.JSON(http.StatusBadGateway, gin.H{"reachable": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reachable": true, "machineIdentifier": id})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./... -run Plex`
Expected: PASS (all 5 Plex tests).

- [ ] **Step 5: Register the routes**

In `backend/main.go`, inside the `api := r.Group("/", middleware.RequireUser())` block, add after the `/storage` line:

```go
		api.GET("/plex/ping", handlePlexPing)
		api.POST("/plex/probe", handlePlexProbe)
```

- [ ] **Step 6: Build to verify wiring**

Run: `cd backend && go build ./... && go vet ./...`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend/plex.go backend/plex_test.go backend/main.go
git commit -m "feat(plex): add Go probe and ping handlers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend Plex settings page

**Files:**
- Create: `frontend/src/components/PlexSettings.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

There is no frontend test harness in this repo, so verification is a typecheck/build plus a manual check.

- [ ] **Step 1: Create the settings component**

```tsx
// frontend/src/components/PlexSettings.tsx
import { useEffect, useState } from "react";
import { apiFetch } from "@/services";
import { Button } from "@/components/ui/button";

type Status = {
  linked: boolean;
  plexUsername?: string | null;
  serverName?: string | null;
  serverSelected?: boolean;
};
type Server = { machineId: string; name: string };

export function PlexSettings() {
  const [status, setStatus] = useState<Status>({ linked: false });
  const [code, setCode] = useState<string | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch("/api/plex/status");
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function connect() {
    setError(null);
    setBusy(true);
    const res = await apiFetch("/api/plex/link/start", { method: "POST" });
    if (!res.ok) {
      setError("Could not start Plex link.");
      setBusy(false);
      return;
    }
    const { code, authUrl } = await res.json();
    setCode(code);
    window.open(authUrl, "_blank", "noopener,noreferrer");

    const deadline = Date.now() + 120_000; // 2 min cap
    const poll = async () => {
      const r = await apiFetch("/api/plex/link/poll");
      const body = await r.json();
      if (body.status === "linked") {
        setCode(null);
        setBusy(false);
        if (body.servers.length === 1) {
          await selectServer(body.servers[0].machineId);
        } else {
          setServers(body.servers);
        }
        return;
      }
      if (body.status === "expired" || Date.now() > deadline) {
        setCode(null);
        setBusy(false);
        setError("Link expired. Please try again.");
        return;
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }

  async function selectServer(machineId: string) {
    setBusy(true);
    const res = await apiFetch("/api/plex/server", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machineId }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not reach that Plex server from TorrentUI.");
      return;
    }
    setServers([]);
    await refresh();
  }

  async function testConnection() {
    setError(null);
    const res = await apiFetch("/api/plex/ping");
    setError(res.ok ? "Connection OK." : "Server not reachable.");
  }

  async function unlink() {
    await apiFetch("/api/plex/link", { method: "DELETE" });
    setStatus({ linked: false });
    setServers([]);
    setCode(null);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Plex</h1>

      {error && <p className="text-sm text-muted-foreground">{error}</p>}

      {!status.linked && (
        <Button onClick={connect} disabled={busy}>
          {busy ? "Waiting for Plex…" : "Connect to Plex"}
        </Button>
      )}

      {code && (
        <p className="text-sm">
          A Plex window opened. If it didn’t, your link code is <strong>{code}</strong>.
        </p>
      )}

      {servers.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm">Choose a server:</p>
          {servers.map((s) => (
            <Button key={s.machineId} variant="outline" onClick={() => selectServer(s.machineId)} disabled={busy}>
              {s.name}
            </Button>
          ))}
        </div>
      )}

      {status.linked && (
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm">
            Linked as <strong>{status.plexUsername}</strong>
            {status.serverName ? <> · server <strong>{status.serverName}</strong></> : <> · no server selected</>}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={testConnection}>Test connection</Button>
            <Button variant="destructive" onClick={unlink}>Unlink</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `frontend/src/App.tsx`, add the import:

```tsx
import { PlexSettings } from "@/components/PlexSettings";
```

and add a route inside `<Routes>` (next to the `/admin` route, before the catch-all `<Route path="*" .../>`):

```tsx
          <Route path="/plex" element={<PlexSettings />} />
```

- [ ] **Step 3: Add the dropdown link**

In `frontend/src/components/AppShell.tsx`, the user `<DropdownMenuContent align="end">` currently contains the theme submenu and (for admins) other items. Add a Plex item. First ensure `Link` is imported (it already is at the top: `import { Link } from "react-router-dom";`). Inside `<DropdownMenuContent align="end">`, add as the first child:

```tsx
              <DropdownMenuItem asChild>
                <Link to="/plex">Plex</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
```

(`DropdownMenuItem` and `DropdownMenuSeparator` are already imported in this file.)

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && pnpm build`
Expected: TypeScript check passes and Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PlexSettings.tsx frontend/src/App.tsx frontend/src/components/AppShell.tsx
git commit -m "feat(plex): add Plex settings page and nav entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Config + docs

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Pass the env var to the auth-service container**

In both `docker-compose.yml` and `docker-compose.dev.yml`, find the auth-service service's `environment:` block (the one that already lists `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, etc.) and add:

```yaml
      - PLEX_TOKEN_ENC_KEY=${PLEX_TOKEN_ENC_KEY}
```

- [ ] **Step 2: Document in CLAUDE.md**

In `CLAUDE.md`, in the "Auth-service env" bullet under "Key Technical Details", append to the list of required vars: `PLEX_TOKEN_ENC_KEY` (`openssl rand -hex 32`, encrypts stored Plex tokens). Add a short bullet under "Architecture" noting that the auth-service now also owns per-user Plex account links (PIN OAuth) and injects `X-Plex-Token`/`X-Plex-Server-Url` to the Go backend, which exposes `/plex/ping` and `/plex/probe`.

- [ ] **Step 3: Verify compose files parse**

Run: `docker compose -f docker-compose.dev.yml config >/dev/null && echo OK`
Expected: `OK` (no YAML/interpolation errors).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml CLAUDE.md
git commit -m "docs(plex): wire PLEX_TOKEN_ENC_KEY into compose and CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: End-to-end manual verification

**Files:** none (manual acceptance test — the foundation's real proof).

- [ ] **Step 1: Set up env**

Generate a key and put it in `auth-service/.env`:
```bash
echo "PLEX_TOKEN_ENC_KEY=$(openssl rand -hex 32)" >> auth-service/.env
```

- [ ] **Step 2: Start the stack**

Run: `make dev-build && make dev-logs`
Expected: auth-service and backend boot; no migration errors.

- [ ] **Step 3: Link a real Plex account**

In the browser: sign in → open the user dropdown → **Plex** → **Connect to Plex**. Authorize in the Plex window. Confirm the page shows "Linked as <you>" and a server name (pick one if prompted).

- [ ] **Step 4: Verify the full chain**

Click **Test connection**. Expected: "Connection OK." This proves token stored (encrypted) in auth-service → injected as `X-Plex-Token`/`X-Plex-Server-Url` → Go reached the selected Plex server's `/identity`.

- [ ] **Step 5: Verify encryption at rest**

Run: `make auth-shell-db` then `SELECT account_token, server_token FROM plex_connection;`
Expected: both values are opaque `base64.base64.base64` blobs, not readable tokens.

- [ ] **Step 6: Verify unlink**

Click **Unlink**; confirm the page returns to "Connect to Plex" and the `plex_connection` row is gone (`SELECT count(*) FROM plex_connection;` → 0).

---

## Self-Review Notes

- **Spec coverage:** PIN flow (T3,T5), encrypted storage (T2,T4), client identifier (T4), server discovery + selection with Go-side reachability probe (T5,T8), proxy header injection with client-supplied stripping (T6), `/plex/ping` end-to-end (T8,T11), per-user `requireAuth` routes (T5/T7 wiring), frontend UX states (T9), security/encryption-at-rest (T2,T11 step 5), error/edge handling — pending/expired (T5,T9), no reachable connection (T5,T8), unlinked no-op (T6) — all mapped to tasks. Token-revoked → 401 surfaces via `/plex/ping` returning 502/`reachable:false` and the proxy passing through Plex 401s on future feature calls; the explicit `needs_reconnect` state is a thin UI addition deferred to the first feature spec that makes authenticated Plex calls, since the foundation has only the ping. Noted as an intentional, logged deferral rather than a silent gap.
- **Placeholder scan:** none — every code step contains complete code.
- **Type consistency:** `getConnection`/`saveServer`/`saveAccountToken`/`deleteConnection`/`getOrCreateClientId` names match across store, routes, and proxy; `plexIdentity`/`handlePlexProbe`/`handlePlexPing` match across Go handler and tests; header names `x-plex-token`/`x-plex-server-url` consistent between proxy (T6) and Go handlers (T8).
