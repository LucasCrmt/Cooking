// Public recipe links (/s/<token>): a recipe someone chose to show outside the household,
// read-only and without an account. Only what's needed to cook it is sent: no ratings, no
// account names, no ids of the people who added it.

import { Hono, type Context } from "hono";
import { sql } from "./db.ts";
import { HttpError, rateLimit } from "./http.ts";
import { exportPlans } from "./plans.ts";
import { icsCalendar } from "./ics.ts";

export const publicRoutes = new Hono();

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

async function byToken(c: Context) {
  const token = c.req.param("token") ?? "";
  rateLimit(c, "public", 300, 10 * 60_000);
  if (!TOKEN.test(token)) throw new HttpError(404, "This link doesn't work anymore");
  const [r] = await sql<Record<string, unknown>[]>`
    SELECT id, title, description, category, cuisine, tags, servings, servings_label, prep_minutes, cook_minutes,
           total_minutes, ingredients, steps, notes, equipment, sources, author, has_image, image_version, updated_at
    FROM recipes WHERE share_token = ${token}`;
  if (!r) throw new HttpError(404, "This link doesn't work anymore");
  return r;
}

publicRoutes.get("/recipes/:token", async (c) => {
  const { id: _id, ...r } = await byToken(c);
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  return c.json(r);
});

publicRoutes.get("/recipes/:token/image", async (c) => {
  const r = await byToken(c);
  const [img] = await sql<{ mime: string; data: Buffer }[]>`SELECT mime, data FROM recipe_images WHERE recipe_id = ${r.id as string}`;
  if (!img) throw new HttpError(404, "Not found");
  // Not cached for long: turning the link off must stop the photo too.
  return c.body(new Uint8Array(img.data), 200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=300" });
});

/** A person's calendar address, with their plans only: /api/public/calendar/<token>.ics (?lang=en). */
publicRoutes.get("/calendar/:file", async (c) => {
  rateLimit(c, "calendar-feed", 120, 10 * 60_000);
  const token = /^([A-Za-z0-9_-]{24,64})\.ics$/.exec(c.req.param("file") ?? "")?.[1];
  const [u] = token ? await sql<{ id: string }[]>`SELECT id FROM users WHERE calendar_token = ${token}` : [];
  if (!u) throw new HttpError(404, "This calendar address doesn't work anymore");
  const ics = icsCalendar(await exportPlans(u.id), { name: "Cooking", lang: c.req.query("lang") ?? "fr" });
  return c.body(ics, 200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
});
