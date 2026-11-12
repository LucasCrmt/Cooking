// The signed-in app's API: recipes, the importer, profile, sessions, admin.

import { Hono, type Context } from "hono";
import { sql } from "./db.ts";
import { APP_VERSION, IMAGE_MAX_BYTES, IMPORT_ENABLED, UPDATE_CHECK, oidc } from "./config.ts";
import { requireAdmin, requireUser, signOutEverywhere, type AppEnv } from "./auth.ts";
import { sha256 } from "./crypto.ts";
import { HttpError, bad, body, rateLimit, str } from "./http.ts";
import { fetchImage, importRecipe, importText, sniffImage } from "./importer.ts";
import { cleanUrl, kindOf, sourceName, type Source } from "./caption.ts";
import { RELEASES_URL, updateStatus } from "./updates.ts";
import { USERNAME, getUser, meView, type User } from "./users.ts";

export const api = new Hono<AppEnv>();
api.use("*", requireUser);

// --- Recipes ---

interface RecipeRow {
  id: string;
  userId: string | null;
  title: string;
  description: string;
  category: string;
  cuisine: string;
  tags: string[];
  servings: number | null;
  servingsLabel: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
  sources: Source[];
  author: string;
  hasImage: boolean;
  imageVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const canEdit = (user: User, r: Pick<RecipeRow, "userId">) => user.isAdmin || r.userId === user.id || r.userId === null;

/** A recipe id from the path, or 404. */
async function recipeOr404(c: Context<AppEnv>): Promise<RecipeRow> {
  const id = c.req.param("id") ?? "";
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(404, "Recipe not found");
  const [r] = await sql<RecipeRow[]>`SELECT * FROM recipes WHERE id = ${id}`;
  if (!r) throw new HttpError(404, "Recipe not found");
  return r;
}

const int = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`Expected a number from ${min} to ${max}`);
  return n;
};

const lines = (v: unknown, maxLines: number, maxLen: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((l) => str(l, maxLen))
    .filter(Boolean)
    .slice(0, maxLines);

/** The editable fields of a recipe, checked. */
function recipeInput(b: Record<string, unknown>) {
  const title = str(b.title, 200);
  if (!title) throw bad("A recipe needs a title");
  const tags = [...new Set(lines(b.tags, 20, 40).map((t) => t.toLowerCase()))];
  return {
    title,
    description: str(b.description, 2000),
    category: str(b.category, 60),
    cuisine: str(b.cuisine, 60),
    tags,
    servings: int(b.servings, 1, 100),
    servingsLabel: str(b.servingsLabel, 40),
    prepMinutes: int(b.prepMinutes, 0, 100_000),
    cookMinutes: int(b.cookMinutes, 0, 100_000),
    totalMinutes: int(b.totalMinutes, 0, 100_000),
    ingredients: lines(b.ingredients, 200, 300),
    steps: lines(b.steps, 100, 3000),
    notes: str(b.notes, 5000),
    sources: sql.json((Array.isArray(b.sources) ? b.sources : []).slice(0, 12).map(sourceInput).filter((s): s is Source => !!s) as never),
    author: str(b.author, 100),
  };
}

/** One source: a web address (a site, a video) and/or a name ("Grandma's notebook", "Ottolenghi, Simple p. 42"). */
function sourceInput(v: unknown): Source | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  let url: string | null = str(o.url, 2000) || null;
  if (url) {
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      url = cleanUrl(url);
    } catch {
      throw bad("A source must be a web address");
    }
  }
  const name = str(o.name, 100) || (url ? sourceName(url) : "");
  if (!url && !name) return null;
  return { url, name, kind: kindOf(url) };
}

/**
 * The photo part of a create/update: `imageUrl` (fetched now, e.g. from an import),
 * `imageData` (a data: URL from an upload) or `removeImage`. Undefined: leave it as is.
 */
async function imageInput(b: Record<string, unknown>): Promise<{ mime: string; data: Buffer } | null | undefined> {
  if (b.removeImage === true) return null;
  if (typeof b.imageData === "string" && b.imageData) {
    const m = /^data:[\w/+.-]+;base64,(.+)$/s.exec(b.imageData);
    if (!m) throw bad("Unreadable photo");
    const data = Buffer.from(m[1], "base64");
    if (data.length > IMAGE_MAX_BYTES) throw new HttpError(413, "That photo is too large");
    const mime = sniffImage(data);
    if (!mime) throw bad("That isn't a photo (JPEG, PNG, WebP, GIF or AVIF)");
    return { mime, data };
  }
  if (typeof b.imageUrl === "string" && b.imageUrl) {
    if (!IMPORT_ENABLED) throw new HttpError(503, "Fetching from other sites is turned off on this server");
    return fetchImage(b.imageUrl);
  }
  return undefined;
}

async function saveImage(recipeId: string, image: { mime: string; data: Buffer } | null) {
  if (image === null) {
    await sql`DELETE FROM recipe_images WHERE recipe_id = ${recipeId}`;
    await sql`UPDATE recipes SET has_image = false, image_version = image_version + 1 WHERE id = ${recipeId}`;
  } else {
    await sql`
      INSERT INTO recipe_images (recipe_id, mime, data) VALUES (${recipeId}, ${image.mime}, ${image.data})
      ON CONFLICT (recipe_id) DO UPDATE SET mime = excluded.mime, data = excluded.data`;
    await sql`UPDATE recipes SET has_image = true, image_version = image_version + 1 WHERE id = ${recipeId}`;
  }
}

/** Everything the list and the sidebar need, for every recipe (a household cookbook stays small). */
api.get("/recipes", async (c) => {
  const user = c.get("user");
  const rows = await sql`
    SELECT r.id, r.user_id, r.title, r.description, r.category, r.cuisine, r.tags, r.servings, r.prep_minutes,
           r.cook_minutes, r.total_minutes, r.sources, r.has_image, r.image_version, r.created_at, r.updated_at,
           cardinality(r.ingredients)::int AS ingredient_count,
           (f.user_id IS NOT NULL) AS favorite,
           my.stars AS my_rating,
           (SELECT round(avg(stars)::numeric, 1)::float FROM ratings WHERE recipe_id = r.id) AS rating,
           (SELECT max(cooked_at) FROM cooked WHERE recipe_id = r.id AND user_id = ${user.id}) AS last_cooked_at,
           (SELECT count(*)::int FROM cooked WHERE recipe_id = r.id) AS cooked_count
    FROM recipes r
    LEFT JOIN favorites f ON f.recipe_id = r.id AND f.user_id = ${user.id}
    LEFT JOIN ratings my ON my.recipe_id = r.id AND my.user_id = ${user.id}
    ORDER BY r.created_at DESC`;
  return c.json(rows);
});

/** Title, ingredients, tags, notes: for the search dialog ("what can I make with leeks?"). */
api.get("/recipes/search", async (c) => {
  const q = str(c.req.query("q"), 100);
  if (!q) return c.json([]);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await sql<{ id: string; title: string; match: string | null }[]>`
    SELECT id, title,
      (SELECT i FROM unnest(ingredients) i WHERE i ILIKE ${like} LIMIT 1) AS match
    FROM recipes
    WHERE title ILIKE ${like} OR description ILIKE ${like} OR array_to_string(ingredients, ' ') ILIKE ${like}
       OR array_to_string(tags, ' ') ILIKE ${like} OR category ILIKE ${like} OR notes ILIKE ${like} OR sources::text ILIKE ${like}
    ORDER BY (title ILIKE ${like}) DESC, created_at DESC
    LIMIT 30`;
  return c.json(rows);
});

api.get("/recipes/:id", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  const [extra] = await sql<Record<string, unknown>[]>`
    SELECT
      EXISTS (SELECT 1 FROM favorites WHERE recipe_id = ${r.id} AND user_id = ${user.id}) AS favorite,
      (SELECT stars FROM ratings WHERE recipe_id = ${r.id} AND user_id = ${user.id}) AS my_rating,
      (SELECT round(avg(stars)::numeric, 1)::float FROM ratings WHERE recipe_id = ${r.id}) AS rating,
      (SELECT count(*)::int FROM ratings WHERE recipe_id = ${r.id}) AS rating_count,
      (SELECT count(*)::int FROM cooked WHERE recipe_id = ${r.id}) AS cooked_count,
      (SELECT max(cooked_at) FROM cooked WHERE recipe_id = ${r.id} AND user_id = ${user.id}) AS last_cooked_at,
      (SELECT coalesce(nullif(name, ''), id) FROM users WHERE id = ${r.userId}) AS added_by`;
  return c.json({ ...r, ...extra, canEdit: canEdit(user, r) });
});

api.post("/recipes", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const input = recipeInput(b);
  // A photo that can't be fetched shouldn't lose the recipe: save it and say so.
  let warning: string | undefined;
  let image: Awaited<ReturnType<typeof imageInput>>;
  try {
    image = await imageInput(b);
  } catch (e) {
    if (typeof b.imageUrl !== "string") throw e;
    warning = `The photo couldn't be copied: ${(e as Error).message}`;
  }
  const [{ id }] = await sql<{ id: string }[]>`INSERT INTO recipes ${sql({ ...input, userId: user.id })} RETURNING id`;
  if (image) await saveImage(id, image);
  return c.json({ id, warning });
});

api.put("/recipes/:id", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  if (!canEdit(user, r)) throw new HttpError(403, "Only whoever added this recipe (or an admin) can change it");
  const b = await body(c);
  const input = recipeInput(b);
  const image = await imageInput(b);
  await sql`UPDATE recipes SET ${sql({ ...input, updatedAt: new Date() })} WHERE id = ${r.id}`;
  if (image !== undefined) await saveImage(r.id, image);
  return c.json({ id: r.id });
});

api.delete("/recipes/:id", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  if (!canEdit(user, r)) throw new HttpError(403, "Only whoever added this recipe (or an admin) can delete it");
  await sql`DELETE FROM recipes WHERE id = ${r.id}`;
  return c.json({ ok: true });
});

api.put("/recipes/:id/favorite", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  if ((await body(c)).on === true) await sql`INSERT INTO favorites (user_id, recipe_id) VALUES (${user.id}, ${r.id}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM favorites WHERE user_id = ${user.id} AND recipe_id = ${r.id}`;
  return c.json({ ok: true });
});

api.put("/recipes/:id/rating", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  const stars = int((await body(c)).stars, 1, 5);
  if (stars === null) await sql`DELETE FROM ratings WHERE user_id = ${user.id} AND recipe_id = ${r.id}`;
  else
    await sql`
      INSERT INTO ratings (user_id, recipe_id, stars) VALUES (${user.id}, ${r.id}, ${stars})
      ON CONFLICT (user_id, recipe_id) DO UPDATE SET stars = excluded.stars`;
  return c.json({ ok: true });
});

api.post("/recipes/:id/cooked", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  await sql`INSERT INTO cooked (user_id, recipe_id) VALUES (${user.id}, ${r.id})`;
  return c.json({ ok: true });
});

api.get("/recipes/:id/image", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(404, "Not found");
  const [img] = await sql<{ mime: string; data: Buffer }[]>`SELECT mime, data FROM recipe_images WHERE recipe_id = ${id}`;
  if (!img) throw new HttpError(404, "Not found");
  // The page asks for ?v=<image version>, so a cached copy never goes stale.
  return c.body(new Uint8Array(img.data), 200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=31536000, immutable" });
});

// --- Import from another site ---

api.post("/import", async (c) => {
  if (!IMPORT_ENABLED) throw new HttpError(503, "Importing is turned off on this server (IMPORT_ENABLED)");
  rateLimit(c, "import", 30, 10 * 60_000);
  const b = await body(c);
  const raw = str(b.url, 2000);
  const url = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
  // Pasted text (a caption, a message) wins over fetching: it's what the person sees.
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 20_000) : "";
  if (!url && !text) throw bad("Paste the address of a recipe, or its text");
  const { draft, partial } = text ? await importText(text, url) : await importRecipe(url!);
  const first = draft.sources.find((s) => s.url)?.url;
  const [existing] = first ? await sql<{ id: string }[]>`SELECT id FROM recipes WHERE sources @> ${sql.json([{ url: first }])} LIMIT 1` : [];
  return c.json({ draft, partial, existingId: existing?.id ?? null });
});

/** Adds a source to a recipe (the video you found it in, the book it's from). */
api.post("/recipes/:id/sources", async (c) => {
  const user = c.get("user");
  const r = await recipeOr404(c);
  if (!canEdit(user, r)) throw new HttpError(403, "Only whoever added this recipe (or an admin) can change it");
  const source = sourceInput(await body(c));
  if (!source) throw bad("Give an address or a name");
  if (r.sources.some((s) => s.url && s.url === source.url)) throw new HttpError(409, "That source is already listed");
  if (r.sources.length >= 12) throw bad("That's enough sources for one recipe");
  await sql`UPDATE recipes SET sources = ${sql.json([...r.sources, source] as never)}, updated_at = now() WHERE id = ${r.id}`;
  return c.json({ ok: true });
});

// --- Profile & preferences ---

/** Name and email from a request body, checked: for the profile and for admins. */
async function identityPatch(b: Record<string, unknown>, userId: string) {
  const patch: { name?: string; email?: string | null } = {};
  if (b.name !== undefined) patch.name = str(b.name, 100);
  if (b.email !== undefined) {
    const email = str(b.email, 255).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("That email doesn't look right");
    if (email) {
      const [taken] = await sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND id <> ${userId}`;
      if (taken) throw new HttpError(409, "Another account uses that email");
    }
    patch.email = email || null;
  }
  return patch;
}

api.patch("/profile", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (b.name === undefined && b.email === undefined) return c.json(meView(user));
  // The provider owns the identity of SSO accounts: only an admin changes it.
  if (user.oidcSub && !user.isAdmin) throw new HttpError(403, "Your name and email come from single sign-on. Ask an admin to change them.");
  const patch = await identityPatch(b, user.id);
  if (Object.keys(patch).length) await sql`UPDATE users SET ${sql(patch)} WHERE id = ${user.id}`;
  return c.json(meView((await getUser(user.id))!));
});

api.post("/profile/delete-account", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (str(b.confirm) !== user.id) throw bad("Type your username to confirm");
  if (user.isAdmin) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE is_admin AND id <> ${user.id}`;
    if (count === 0) throw bad("You're the only admin. Make someone else an admin first.");
  }
  // Their recipes stay in the household cookbook (user_id becomes NULL), unless asked otherwise.
  if (b.deleteRecipes === true) await sql`DELETE FROM recipes WHERE user_id = ${user.id}`;
  await sql`DELETE FROM users WHERE id = ${user.id}`;
  return c.json({ ok: true });
});

/** Every recipe (or only yours) as JSON, photos left out. */
api.get("/export", async (c) => {
  const user = c.get("user");
  const mine = c.req.query("mine") === "1";
  const recipes = await sql`
    SELECT title, description, category, cuisine, tags, servings, servings_label, prep_minutes, cook_minutes, total_minutes,
           ingredients, steps, notes, sources, author, created_at, updated_at
    FROM recipes ${mine ? sql`WHERE user_id = ${user.id}` : sql``} ORDER BY created_at`;
  c.header("Content-Disposition", `attachment; filename="recipes-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json({ app: "cooking.bayfield.dev", version: APP_VERSION, exportedAt: new Date(), recipes });
});

// --- Sessions ---

api.get("/sessions", async (c) => {
  const current = c.get("session").id;
  const rows = await sql<{ id: string; method: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date }[]>`
    SELECT id, method, user_agent, ip, created_at, last_seen_at FROM sessions
    WHERE user_id = ${c.get("user").id} AND expires_at > now()
    ORDER BY last_seen_at DESC`;
  // The id is the token's hash; hash it again so the page never sees anything a cookie could be checked against.
  return c.json(rows.map((r) => ({ ...r, id: sha256(r.id).slice(0, 24), current: r.id === current })));
});

api.delete("/sessions/:id", async (c) => {
  const user = c.get("user");
  const rows = await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${user.id}`;
  const target = rows.find((r) => sha256(r.id).slice(0, 24) === c.req.param("id"));
  if (target) await sql`DELETE FROM sessions WHERE id = ${target.id}`;
  return c.json({ ok: true });
});

api.post("/sessions/revoke-others", async (c) => {
  await signOutEverywhere(c.get("user").id, c.get("session").id);
  return c.json({ ok: true });
});

// --- Server ---

api.get("/server", (c) => c.json({ oidc: oidc ? { name: oidc.name } : null, version: APP_VERSION, importEnabled: IMPORT_ENABLED }));

/** Whether a newer release is out. `?refresh=1` skips the cache (the "Check for updates" button). */
api.get("/updates", async (c) => {
  if (!UPDATE_CHECK) {
    return c.json({ current: APP_VERSION, latest: null, available: false, releasesUrl: RELEASES_URL, checkedAt: null, disabled: true });
  }
  const refresh = c.req.query("refresh") === "1";
  if (refresh) rateLimit(c, "update-check", 10, 60 * 60_000);
  return c.json(await updateStatus(refresh));
});

// --- Admin ---

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

admin.get("/users", async (c) =>
  c.json(
    await sql`
      SELECT u.id, u.name, u.email, u.is_admin, (u.oidc_sub IS NOT NULL) AS sso_linked, u.created_at, u.last_seen_at,
             (SELECT count(*)::int FROM recipes WHERE user_id = u.id) AS recipes
      FROM users u ORDER BY u.created_at`,
  ),
);

admin.post("/users", async (c) => {
  const b = await body(c);
  const id = str(b.username, 63);
  if (!USERNAME.test(id)) throw bad("Use letters, numbers, dots, dashes and underscores");
  const [taken] = await sql`SELECT 1 FROM users WHERE lower(id) = lower(${id})`;
  if (taken) throw new HttpError(409, "That username is taken");
  const identity = await identityPatch(b, id);
  await sql`
    INSERT INTO users (id, name, email, is_admin)
    VALUES (${id}, ${identity.name ?? ""}, ${identity.email ?? null}, ${b.isAdmin === true})`;
  return c.json({ ok: true });
});

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(c);
  if (!(await getUser(id))) throw new HttpError(404, "No such user");
  if (typeof b.isAdmin === "boolean") {
    if (!b.isAdmin && id === c.get("user").id) throw bad("You can't remove your own admin rights");
    await sql`UPDATE users SET is_admin = ${b.isAdmin} WHERE id = ${id}`;
  }
  if (b.signOut === true) await signOutEverywhere(id);
  const identity = await identityPatch(b, id);
  if (Object.keys(identity).length) await sql`UPDATE users SET ${sql(identity)} WHERE id = ${id}`;
  return c.json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("user").id) throw bad("Delete your own account from Settings → Profile");
  await sql`DELETE FROM users WHERE id = ${id}`;
  return c.json({ ok: true });
});

api.route("/admin", admin);
