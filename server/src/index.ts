// Cooking server: the web app, its API and the recipe importer.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEV_LOGIN_USER, DIST_DIR, IMAGE_MAX_BYTES, IMPORT_ENABLED, PORT, PUBLIC_URL, oidc } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { api } from "./api.ts";
import { mcp } from "./mcp.ts";
import { publicRoutes } from "./public.ts";
import { authRoutes, sameOrigin } from "./auth.ts";
import { HttpError } from "./http.ts";

await migrate();

const indexPath = resolve(DIST_DIR, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
// index.html applies the theme in a tiny inline script before the bundle loads (no flash of the
// wrong theme). The policy allows exactly that script, by hash.
const inlineScripts = [...(indexHtml ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScripts],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Recipe photos are copied to the server on import, so they come from here too.
      imgSrc: ["'self'", "data:", "blob:"],
      // prefs.bayfield.dev: the preferences shared with the other apps.
      connectSrc: ["'self'", "https://prefs.bayfield.dev"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);
// A photo upload travels as base64 inside JSON (a third larger than the file).
app.use("/api/*", bodyLimit({ maxSize: Math.ceil(IMAGE_MAX_BYTES * 1.4) + 256 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
app.use("/api/*", sameOrigin);

app.get("/api/health", async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

app.route("/api/auth", authRoutes);
app.route("/api/app", api);
app.route("/api/public", publicRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// The MCP server, for Claude: token-authenticated, so it skips the cookie checks above.
app.use("/mcp/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
app.use("/mcp", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
app.route("/mcp", mcp);

if (indexHtml) {
  const index = indexHtml;
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/*", serveStatic({ root: relative(process.cwd(), DIST_DIR) }));
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(index);
  });
} else {
  console.warn(`No web build at ${DIST_DIR}; only the API is served. Run \`npm run build\` in the project root.`);
}

// Expired sessions and sign-in attempts, once an hour.
setInterval(
  () => {
    void sql`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
    void sql`DELETE FROM oidc_states WHERE expires_at < now()`.catch(() => {});
  },
  60 * 60_000,
);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`Cooking on http://localhost:${port} (public URL ${PUBLIC_URL})`);
  console.log(`  sign-in: ${[oidc && `SSO (${oidc.name})`, DEV_LOGIN_USER && `development sign-in as ${DEV_LOGIN_USER}`].filter(Boolean).join(", ")}`);
  console.log(`  recipe import: ${IMPORT_ENABLED ? "on" : "off (IMPORT_ENABLED=false)"}`);
  console.log(`  MCP server for Claude: ${PUBLIC_URL}/mcp`);
});
