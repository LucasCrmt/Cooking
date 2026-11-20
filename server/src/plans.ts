// Planned recipes: when someone means to make which recipe. Plans are private: each person only
// ever sees, changes or exports their own (to their calendar app, through the .ics address).
// Someone else's plan is "not found", for admins too.
//
// Days are plain dates ("2026-11-26"), no time zone: a dinner is planned for a day, not an instant.

import { sql } from "./db.ts";
import { HttpError, bad, isDate, str } from "./http.ts";
import type { User } from "./users.ts";

export const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;

export interface Plan {
  id: string;
  recipeId: string;
  day: string;
  meal: string;
  note: string;
  title: string;
  hasImage: boolean;
  imageVersion: number;
  totalMinutes: number | null;
  category: string;
}

const meal = (v: unknown): string => {
  const m = str(v, 20);
  if (m && !(MEALS as readonly string[]).includes(m)) throw bad(`The meal is one of ${MEALS.join(", ")}, or empty`);
  return m;
};

const day = (v: unknown): string => {
  if (!isDate(v)) throw bad("The day is a date like 2026-11-26");
  return v;
};

/** A person's plans from `from` to `to` (inclusive), in day and meal order. */
export async function listPlans(userId: string, from: string, to: string, maxDays = 120): Promise<Plan[]> {
  if (!isDate(from) || !isDate(to)) throw bad("Give the days as dates like 2026-11-26");
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (span < 0 || span > maxDays) throw bad(`Ask for ${maxDays} days at most`);
  return sql<Plan[]>`
    SELECT p.id, p.recipe_id, p.day::text AS day, p.meal, p.note,
           r.title, r.has_image, r.image_version, r.total_minutes, r.category
    FROM plans p
    JOIN recipes r ON r.id = p.recipe_id
    WHERE p.user_id = ${userId} AND p.day BETWEEN ${from}::date AND ${to}::date
    ORDER BY p.day, array_position(ARRAY['breakfast', 'lunch', 'snack', 'dinner', ''], p.meal), p.created_at`;
}

/** A person's plans of one recipe, from today on, for its page. */
export async function upcomingPlans(userId: string, recipeId: string): Promise<{ id: string; day: string; meal: string; note: string }[]> {
  return sql`
    SELECT id, day::text AS day, meal, note
    FROM plans
    WHERE user_id = ${userId} AND recipe_id = ${recipeId} AND day >= current_date
    ORDER BY day, created_at
    LIMIT 20`;
}

export async function createPlan(user: User, b: Record<string, unknown>): Promise<{ id: string }> {
  const recipeId = String(b.recipeId ?? "");
  if (!/^\d{1,18}$/.test(recipeId)) throw bad("Which recipe?");
  const [recipe] = await sql`SELECT 1 FROM recipes WHERE id = ${recipeId}`;
  if (!recipe) throw new HttpError(404, "Recipe not found");
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM plans WHERE user_id = ${user.id} AND day >= current_date`;
  if (count >= 500) throw bad("That's a lot of plans ahead: remove some first");
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO plans (user_id, recipe_id, day, meal, note)
    VALUES (${user.id}, ${recipeId}, ${day(b.day)}, ${meal(b.meal)}, ${str(b.note, 300)})
    RETURNING id`;
  return { id };
}

/** The plan, if it's this person's; otherwise "not found" (nobody learns that it exists). */
async function ownPlan(user: User, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(404, "Plan not found");
  const [p] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE id = ${id} AND user_id = ${user.id}`;
  if (!p) throw new HttpError(404, "Plan not found");
  return p;
}

/** Moves a plan (another day, another meal) or changes its note. */
export async function updatePlan(user: User, id: string, b: Record<string, unknown>) {
  await ownPlan(user, id);
  const patch: Record<string, string> = {};
  if (b.day !== undefined) patch.day = day(b.day);
  if (b.meal !== undefined) patch.meal = meal(b.meal);
  if (b.note !== undefined) patch.note = str(b.note, 300);
  if (Object.keys(patch).length) await sql`UPDATE plans SET ${sql(patch)} WHERE id = ${id} AND user_id = ${user.id}`;
}

export async function deletePlan(user: User, id: string) {
  await ownPlan(user, id);
  await sql`DELETE FROM plans WHERE id = ${id} AND user_id = ${user.id}`;
}

/** What a person's export holds: their plans from 3 months ago to a year ahead. */
export function exportPlans(userId: string): Promise<Plan[]> {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  return listPlans(userId, day(-92), day(366), 460);
}
