// The MCP server: lets Claude (Claude.ai, Claude Desktop, Claude Code) or any MCP client search the
// cookbook, read recipes, import them from a link or text, and add or change them.
//
// Streamable HTTP transport, stateless: every request is one JSON-RPC message (or a batch) POSTed
// to /mcp, answered with JSON. No sessions, no server-sent events: nothing here needs to stream.
//
// Each person makes an access token in Settings → Claude. It goes in the Authorization header
// (Claude Code, Claude Desktop) or in the address itself, /mcp/<token>, for clients that only
// take a URL (Claude.ai custom connectors). Recipes are added in that person's name.

import { Hono, type Context } from "hono";
import { sql } from "./db.ts";
import { APP_VERSION, IMPORT_ENABLED, PUBLIC_URL } from "./config.ts";
import { sha256 } from "./crypto.ts";
import { HttpError, rateLimit } from "./http.ts";
import { canEdit, createRecipe, imageInput, recipeInput, saveImage, type RecipeRow } from "./api.ts";
import { importRecipe, importText } from "./importer.ts";
import { EQUIPMENT } from "./equipment.ts";
import { DIETS } from "./diets.ts";
import { MEALS, createPlan, deletePlan, listPlans } from "./plans.ts";
import { getUser, type User } from "./users.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Cooking is a household cookbook. Use search_recipes to find recipes (by title, ingredient, tag, category), get_recipe to read one in full.
To add a recipe: if the person gives a link or a pasted text, call import_recipe first (it reads recipe sites, YouTube descriptions and captions) and then create_recipe with the draft, completed or corrected; otherwise write the recipe yourself and call create_recipe.
To plan when to make a recipe, use plan_recipe (list_plans shows the calendar and today's date: use it to turn "jeudi soir" into a date).
Ingredients and steps are lists of lines; a line starting with "# " is a section heading ("# Pour la sauce"). Write recipes in the language the person uses. Always tell the person the link to the recipe you added.`;

// --- Tool definitions ---

const recipeProps = {
  title: { type: "string", description: "Name of the dish" },
  description: { type: "string", description: "One or two sentences about the dish" },
  category: { type: "string", description: "e.g. Entrée, Plat principal, Dessert, Apéritif, Soupe, Salade, Accompagnement, Sauce, Boisson, Petit-déjeuner, Goûter (or Starter, Main course… in English)" },
  cuisine: { type: "string", description: "e.g. Française, Italienne, Japonaise…" },
  tags: { type: "array", items: { type: "string" }, description: "3 to 6 lowercase keywords" },
  servings: { type: "integer", minimum: 1, maximum: 100 },
  servingsLabel: { type: "string", description: 'What a serving is: "personnes", "parts", "cookies"…' },
  prepMinutes: { type: "integer", minimum: 0 },
  cookMinutes: { type: "integer", minimum: 0 },
  totalMinutes: { type: "integer", minimum: 0 },
  ingredients: { type: "array", items: { type: "string" }, description: 'One ingredient per line with its quantity ("200 g de farine"); "# Section" lines for groups' },
  steps: { type: "array", items: { type: "string" }, description: 'One step per line, without numbering; "# Section" lines for groups' },
  notes: { type: "string", description: "Tips, variations, equipment, storage" },
  author: { type: "string", description: "Who created the recipe (chef, site, person)" },
  equipment: {
    type: "array",
    items: { type: "string", enum: [...EQUIPMENT] },
    description: "The appliances the recipe needs (to filter by): oven, microwave, stovetop, blender, hand-blender, food-processor, stand-mixer, hand-mixer, airfryer, cooking-robot (Thermomix, Cookeo), pressure-cooker, slow-cooker, steamer, barbecue, fryer, waffle-iron, crepe-maker, ice-cream-maker, bread-machine",
  },
  diets: {
    type: "array",
    items: { type: "string", enum: [...DIETS] },
    description: "The diets it suits (shown on the recipe and to filter by): vegetarian, vegan, pescatarian, gluten-free, lactose-free, nut-free. Vegan recipes need only \"vegan\"",
  },
  sources: {
    type: "array",
    items: { type: "object", properties: { url: { type: "string" }, name: { type: "string" } } },
    description: "Where it comes from: web addresses (site, video) and/or names (a book, a person)",
  },
  imageUrl: { type: "string", description: "Address of a photo of the dish (copied to the cookbook)" },
} as const;

const TOOLS = [
  {
    name: "search_recipes",
    title: "Search recipes",
    description: "Searches the cookbook by title, ingredient, tag, category, cuisine or notes. Without a query, lists the latest recipes. Returns ids, titles and a summary.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Words to look for ("poireaux", "gratin", "dessert")' },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_recipe",
    title: "Read a recipe",
    description: "Returns a recipe in full: ingredients, steps, notes, times, sources, ratings.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The recipe id" } }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "import_recipe",
    title: "Read a recipe from a link or text",
    description:
      "Reads a recipe from a web page (recipe sites, YouTube) or from pasted text (a caption, a message, Markdown) and returns a draft. Nothing is saved: pass the draft (completed if needed) to create_recipe. Also says if the cookbook already has a recipe from that address.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Address of the recipe or video" },
        text: { type: "string", description: "The recipe text, if the person pasted it" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "create_recipe",
    title: "Add a recipe",
    description: "Adds a recipe to the cookbook, in the name of the person who connected. Returns its id and link.",
    inputSchema: { type: "object", properties: recipeProps, required: ["title"] },
  },
  {
    name: "update_recipe",
    title: "Change a recipe",
    description: "Changes a recipe: only the fields given are replaced (lists are replaced whole). Only whoever added it, or an admin, can change it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The recipe id" }, ...recipeProps, removeImage: { type: "boolean" } },
      required: ["id"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "list_plans",
    title: "Read the calendar",
    description: "Your planned recipes between two days (default: today and the next 13 days). Plans are private: only yours. Also returns today's date.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD (default today)" },
        to: { type: "string", description: "Last day, YYYY-MM-DD (default from + 13 days)" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "plan_recipe",
    title: "Plan a recipe",
    description: "Puts a recipe in your plans on a day (and optionally a meal). Plans are private and show up in your own calendar app.",
    inputSchema: {
      type: "object",
      properties: {
        recipeId: { type: "string", description: "The recipe id (search_recipes finds it)" },
        day: { type: "string", description: "YYYY-MM-DD" },
        meal: { type: "string", enum: [...MEALS], description: "Optional: breakfast, lunch, snack or dinner" },
        note: { type: "string", description: "Optional: for how many, with whom…" },
      },
      required: ["recipeId", "day"],
    },
  },
  {
    name: "unplan_recipe",
    title: "Remove a plan",
    description: "Removes one of your plans (its id comes from list_plans).",
    inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
    annotations: { destructiveHint: true },
  },
];

// --- Tools ---

class ToolError extends Error {}

const recipeUrl = (id: string) => `${PUBLIC_URL}/r/${id}`;

async function recipeById(id: unknown): Promise<RecipeRow> {
  const s = String(id ?? "").trim();
  if (!/^\d{1,18}$/.test(s)) throw new ToolError(`No recipe with id ${JSON.stringify(s)}`);
  const [r] = await sql<RecipeRow[]>`SELECT * FROM recipes WHERE id = ${s}`;
  if (!r) throw new ToolError(`No recipe with id ${s}`);
  return r;
}

const minutes = (n: number | null) => (n === null ? undefined : n);

async function callTool(user: User, name: string, a: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_recipes": {
      const q = typeof a.query === "string" ? a.query.trim().slice(0, 100) : "";
      const limit = Math.min(100, Math.max(1, Number(a.limit) || 20));
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const rows = await sql<{ id: string; title: string; category: string; cuisine: string; tags: string[]; equipment: string[]; diets: string[]; totalMinutes: number | null; servings: number | null; match: string | null }[]>`
        SELECT id, title, category, cuisine, tags, equipment, diets, total_minutes, servings,
          ${q ? sql`(SELECT i FROM unnest(ingredients) i WHERE i ILIKE ${like} LIMIT 1)` : sql`NULL`} AS match
        FROM recipes
        ${
          q
            ? sql`WHERE title ILIKE ${like} OR description ILIKE ${like} OR array_to_string(ingredients, ' ') ILIKE ${like}
                OR array_to_string(tags, ' ') ILIKE ${like} OR category ILIKE ${like} OR cuisine ILIKE ${like} OR notes ILIKE ${like}`
            : sql``
        }
        ORDER BY ${q ? sql`(title ILIKE ${like}) DESC,` : sql``} created_at DESC
        LIMIT ${limit}`;
      return {
        count: rows.length,
        recipes: rows.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category || undefined,
          cuisine: r.cuisine || undefined,
          tags: r.tags.length ? r.tags : undefined,
          equipment: r.equipment.length ? r.equipment : undefined,
          diets: r.diets.length ? r.diets : undefined,
          totalMinutes: minutes(r.totalMinutes),
          servings: r.servings ?? undefined,
          matchingIngredient: r.match ?? undefined,
          url: recipeUrl(r.id),
        })),
      };
    }

    case "get_recipe": {
      const r = await recipeById(a.id);
      const [extra] = await sql<{ rating: number | null; cookedCount: number; wantedBy: string[]; addedBy: string | null }[]>`
        SELECT (SELECT round(avg(stars)::numeric, 1)::float FROM ratings WHERE recipe_id = ${r.id}) AS rating,
               (SELECT count(*)::int FROM cooked WHERE recipe_id = ${r.id}) AS cooked_count,
               (SELECT coalesce(array_agg(coalesce(nullif(u.name, ''), u.id)), '{}') FROM todo t JOIN users u ON u.id = t.user_id WHERE t.recipe_id = ${r.id}) AS wanted_by,
               (SELECT coalesce(nullif(name, ''), id) FROM users WHERE id = ${r.userId}) AS added_by`;
      return {
        id: r.id,
        url: recipeUrl(r.id),
        title: r.title,
        description: r.description,
        category: r.category,
        cuisine: r.cuisine,
        tags: r.tags,
        servings: r.servings,
        servingsLabel: r.servingsLabel,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        totalMinutes: r.totalMinutes,
        ingredients: r.ingredients,
        steps: r.steps,
        notes: r.notes,
        equipment: r.equipment,
        diets: r.diets,
        author: r.author,
        sources: r.sources,
        hasPhoto: r.hasImage,
        rating: extra.rating,
        cookedByPeople: extra.cookedCount,
        wantToMakeIt: extra.wantedBy,
        addedBy: extra.addedBy,
        canEdit: canEdit(user, r),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }

    case "import_recipe": {
      if (!IMPORT_ENABLED) throw new ToolError("Importing is turned off on this server");
      const raw = typeof a.url === "string" ? a.url.trim().slice(0, 2000) : "";
      const url = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
      const text = typeof a.text === "string" ? a.text.trim().slice(0, 20_000) : "";
      if (!url && !text) throw new ToolError("Give the url of a recipe, or its text");
      const { draft, partial } = text ? await importText(text, url) : await importRecipe(url!);
      const first = draft.sources.find((s) => s.url)?.url;
      const [existing] = first ? await sql<{ id: string }[]>`SELECT id FROM recipes WHERE sources @> ${sql.json([{ url: first }])} LIMIT 1` : [];
      return {
        draft,
        partial,
        note: partial ? "Some parts (ingredients or steps) were not found: complete them before saving." : undefined,
        alreadyInCookbook: existing ? { id: existing.id, url: recipeUrl(existing.id) } : undefined,
      };
    }

    case "list_plans": {
      const today = new Date().toISOString().slice(0, 10);
      const from = typeof a.from === "string" && a.from ? a.from : today;
      const to = typeof a.to === "string" && a.to ? a.to : new Date(Date.parse(from) + 13 * 86_400_000).toISOString().slice(0, 10);
      const plans = await listPlans(user.id, from, to);
      return {
        today,
        from,
        to,
        plans: plans.map((p) => ({ id: p.id, day: p.day, meal: p.meal || undefined, recipeId: p.recipeId, title: p.title, note: p.note || undefined, url: recipeUrl(p.recipeId) })),
      };
    }

    case "plan_recipe": {
      const r = await recipeById(a.recipeId);
      const { id } = await createPlan(user, { recipeId: r.id, day: a.day, meal: a.meal ?? "", note: a.note ?? "" });
      return { planId: id, day: a.day, meal: a.meal || undefined, title: r.title, url: recipeUrl(r.id) };
    }

    case "unplan_recipe":
      await deletePlan(user, String(a.planId ?? ""));
      return { removed: true };

    case "create_recipe": {
      const { id, warning } = await createRecipe(user, a);
      return { id, url: recipeUrl(id), warning };
    }

    case "update_recipe": {
      const r = await recipeById(a.id);
      if (!canEdit(user, r)) throw new ToolError("Only whoever added this recipe (or an admin) can change it");
      const { id: _id, ...patch } = a;
      const current: Record<string, unknown> = {
        title: r.title,
        description: r.description,
        category: r.category,
        cuisine: r.cuisine,
        tags: r.tags,
        servings: r.servings,
        servingsLabel: r.servingsLabel,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        totalMinutes: r.totalMinutes,
        ingredients: r.ingredients,
        steps: r.steps,
        notes: r.notes,
        sources: r.sources,
        author: r.author,
        equipment: r.equipment,
        diets: r.diets,
      };
      const merged = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      const input = recipeInput(merged);
      const image = await imageInput(merged);
      await sql`UPDATE recipes SET ${sql({ ...input, updatedAt: new Date() })} WHERE id = ${r.id}`;
      if (image !== undefined) await saveImage(r.id, image);
      return { id: r.id, url: recipeUrl(r.id), updated: Object.keys(patch) };
    }
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

// --- JSON-RPC ---

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function handle(user: User, msg: RpcMessage): Promise<object | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  try {
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") throw new RpcError(-32600, "Invalid request");
    let result: unknown;
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "cooking", title: "Cooking", version: APP_VERSION },
          instructions: INSTRUCTIONS,
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (!TOOLS.some((t) => t.name === name)) throw new RpcError(-32602, `Unknown tool: ${name}`);
        try {
          const out = await callTool(user, name, args);
          result = { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out };
        } catch (e) {
          // Tool failures go back to the model as results it can read and act on.
          if (e instanceof ToolError || e instanceof HttpError) result = { content: [{ type: "text", text: e.message }], isError: true };
          else throw e;
        }
        break;
      }
      default:
        if (msg.method.startsWith("notifications/")) return null;
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
    return isRequest ? { jsonrpc: "2.0", id: msg.id, result } : null;
  } catch (e) {
    if (!(e instanceof RpcError)) console.error("MCP:", e);
    const error = e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: "Internal error" };
    return isRequest ? { jsonrpc: "2.0", id: msg.id ?? null, error } : null;
  }
}

// --- HTTP ---

async function tokenUser(c: Context, pathToken?: string): Promise<User> {
  const header = c.req.header("Authorization");
  const token = pathToken ?? (/^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] || undefined);
  if (!token) {
    rateLimit(c, "mcp-auth", 60, 10 * 60_000);
    throw new HttpError(401, "Missing access token: create one in Cooking → Settings → Claude");
  }
  const [row] = await sql<{ id: string; userId: string; lastUsedAt: Date | null }[]>`SELECT id, user_id, last_used_at FROM api_tokens WHERE id = ${sha256(token)}`;
  const user = row ? await getUser(row.userId) : undefined;
  if (!row || !user) {
    rateLimit(c, "mcp-auth", 60, 10 * 60_000);
    throw new HttpError(401, "Invalid or revoked access token");
  }
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await sql`UPDATE api_tokens SET last_used_at = now() WHERE id = ${row.id}`;
  return user;
}

export const mcp = new Hono();

const post = async (c: Context, pathToken?: string) => {
  let user: User;
  try {
    user = await tokenUser(c, pathToken);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      c.header("WWW-Authenticate", 'Bearer realm="cooking"');
      return c.json({ error: e.message }, 401);
    }
    throw e;
  }
  rateLimit(c, `mcp:${user.id}`, 300, 60_000);
  const payload = await c.req.json().catch(() => undefined);
  if (payload === undefined) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.slice(0, 50).map((m) => handle(user, m as RpcMessage)))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const out = await handle(user, payload as RpcMessage);
  return out ? c.json(out) : c.body(null, 202);
};

// No server-initiated messages and no sessions: GET (the event stream) and DELETE aren't offered.
const notAllowed = (c: Context) => {
  c.header("Allow", "POST");
  return c.json({ error: "Method not allowed" }, 405);
};

mcp.post("/", (c) => post(c));
mcp.post("/:token", (c) => post(c, c.req.param("token")));
mcp.on(["GET", "DELETE"], ["/", "/:token"], notAllowed);
