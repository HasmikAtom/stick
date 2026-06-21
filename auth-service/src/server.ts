import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getMigrations } from "better-auth/db/migration";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { auth } from "./auth.js";
import { runOwnedMigrations, reconcileBootstrapAdmins } from "./db.js";
import { requireAuth, requireAdmin } from "./middleware.js";
import { proxyToGo } from "./proxy.js";
import { mountAdminRoutes } from "./admin-routes.js";
import { mountPlexRoutes } from "./plex-routes.js";

// Migration order matters: Better Auth's own schema first (creates user,
// session, account, verification), then our invited_emails, then reconcile
// bootstrap admins (which UPDATEs the user table that step 1 just created).
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
runOwnedMigrations();
reconcileBootstrapAdmins();

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use("/api/admin/*", requireAuth, requireAdmin);
mountAdminRoutes(app);

app.use("/api/*", requireAuth);
mountPlexRoutes(app);
app.all("/api/*", proxyToGo);

const PUBLIC_DIR = join(process.cwd(), "public");
const indexHtmlPath = join(PUBLIC_DIR, "index.html");

if (existsSync(PUBLIC_DIR)) {
  app.use("/*", serveStatic({ root: "./public" }));
  app.notFound((c) => {
    if (existsSync(indexHtmlPath)) {
      return c.html(readFileSync(indexHtmlPath, "utf8"));
    }
    return c.json({ error: "not found" }, 404);
  });
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`auth-service listening on :${port}`);
