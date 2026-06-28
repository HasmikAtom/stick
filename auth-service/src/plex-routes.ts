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
    if (!body.machineId) return c.json({ error: "machineId required" }, 400);
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

  app.get("/api/plex/servers", async (c) => {
    const user = c.get("user") as AuthUser;
    const conn = getConnection(user.id);
    if (!conn) return c.json({ error: "not linked" }, 400);
    const clientId = getOrCreateClientId();
    const servers = await listServers(clientId, conn.accountToken);
    return c.json({
      servers: servers.map((s) => ({ machineId: s.machineId, name: s.name })),
    });
  });

  app.delete("/api/plex/link", (c) => {
    const user = c.get("user") as AuthUser;
    deleteConnection(user.id);
    return c.body(null, 204);
  });
}
