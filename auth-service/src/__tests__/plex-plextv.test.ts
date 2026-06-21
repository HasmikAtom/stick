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
