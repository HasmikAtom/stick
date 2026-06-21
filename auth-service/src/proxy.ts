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
