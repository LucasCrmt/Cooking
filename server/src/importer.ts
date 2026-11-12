// Imports a recipe from another site (Marmiton, 750g, Cuisine AZ, BBC Good Food, NYT Cooking…),
// from a video (YouTube, TikTok, Instagram: the recipe is in its description), or from pasted text.
//
// Nearly every recipe site publishes its recipes as schema.org/Recipe data for search engines,
// usually as JSON-LD (<script type="application/ld+json">), sometimes as microdata. That is what
// we read: no per-site scraping rules to keep up to date. Pages without it fall back to their
// Open Graph title, description and photo, and the rest is typed in.
//
// The server fetches the page, so it refuses anything that resolves to a private or local
// address (the importer must not become a way to reach the host's network).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { IMAGE_MAX_BYTES } from "./config.ts";
import { HttpError, bad } from "./http.ts";
import { cleanUrl, kindOf, parseCaption, sourceName, type Source } from "./caption.ts";

export interface RecipeDraft {
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
  imageUrl: string | null;
}

const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
// Many recipe sites sit behind bot protection that turns away unknown clients; a browser's
// headers get the same page a visitor would.
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
};

// --- Fetching, safely ---

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad("That doesn't look like a web address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw bad("Only http and https addresses can be imported");
  if (url.username || url.password) throw bad("Addresses with credentials can't be imported");
  if (url.port && url.port !== "80" && url.port !== "443") throw bad("Only standard web ports can be imported");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw bad(`Couldn't find ${host}`);
  if (addresses.some(privateAddress)) throw bad("That address points to a private network");
  return url;
}

/** GETs a public URL (following redirects, each one checked), up to `maxBytes`. */
async function safeFetch(raw: string, maxBytes: number, accept: string): Promise<{ url: URL; type: string; body: Buffer }> {
  let url = await checkUrl(raw);
  for (let hop = 0; hop < 6; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { ...HEADERS, accept }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new HttpError(502, `Couldn't reach ${url.hostname} (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message})`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await checkUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new HttpError(502, `${url.hostname} answered ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new HttpError(413, "That file is too large");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) throw new HttpError(413, "That file is too large");
      chunks.push(Buffer.from(chunk));
    }
    return { url, type: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  throw new HttpError(502, "Too many redirects");
}

// --- Images ---

/** The image type from its first bytes (never trust the declared type; SVG is refused: it can carry scripts). */
export function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (b.subarray(4, 12).toString("ascii") === "ftypavif") return "image/avif";
  return null;
}

export async function fetchImage(url: string): Promise<{ mime: string; data: Buffer }> {
  const res = await safeFetch(url, IMAGE_MAX_BYTES, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
  const mime = sniffImage(res.body);
  if (!mime) throw bad("That isn't a photo (JPEG, PNG, WebP, GIF or AVIF)");
  return { mime, data: res.body };
}

// --- Reading the page ---

function decodePage(body: Buffer, type: string): string {
  const head = body.subarray(0, 4096).toString("latin1");
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset.toLowerCase()).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ocirc: "ô", ecirc: "ê", icirc: "î", ucirc: "û", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", oelig: "œ", rsquo: "’", lsquo: "‘", hellip: "…", ndash: "–", mdash: "—" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text: tags dropped, entities decoded, whitespace collapsed. */
function clean(s: unknown, max = 3000): string {
  if (typeof s !== "string" && typeof s !== "number") return "";
  return decodeEntities(
    String(s)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const typeOf = (o: Record<string, unknown>) => asArray(o["@type"]).map((t) => String(t).replace(/^.*[/#]/, "").toLowerCase());

/** Every JSON-LD block of the page, parsed (broken ones skipped). */
function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = m[1].trim().replace(/^<!--|-->$/g, "");
    try {
      out.push(JSON.parse(text));
    } catch {
      try {
        // Some sites leave raw control characters (newlines in strings) in their JSON.
        out.push(JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")));
      } catch {
        // Not usable.
      }
    }
  }
  return out;
}

/** The first schema.org Recipe in the JSON-LD (inside @graph, arrays or mainEntity too). */
function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  if (typeOf(o).includes("recipe")) return o;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(o[key], depth + 1);
    if (r) return r;
  }
  return null;
}

/** ISO 8601 durations ("PT1H30M", "P0DT0H20M") as minutes; also "20 min" or a bare number. */
export function minutes(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== "string" || !v.trim()) return null;
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v.trim());
  if (iso) {
    const [, d, h, m, s] = iso.map((x) => Number(x ?? 0));
    const total = Math.round(d * 1440 + h * 60 + m + s / 60);
    return total > 0 ? total : null;
  }
  const hm = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m)\b)?/i.exec(v);
  const total = Number(hm?.[1] ?? 0) * 60 + Number(hm?.[2] ?? 0);
  if (total > 0) return total;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "4 personnes", 4, ["4", "4 servings"] → 4 and its label. */
function servings(v: unknown): { servings: number | null; label: string } {
  for (const item of asArray(v)) {
    const text = clean(item, 80);
    const n = /\d+/.exec(text);
    if (n) return { servings: Math.min(100, Number(n[0])) || null, label: text.replace(n[0], "").trim().slice(0, 40) };
  }
  return { servings: null, label: "" };
}

function imageUrl(v: unknown, base: URL): string | null {
  const candidates: { url: string; width: number }[] = [];
  for (const item of asArray(v)) {
    if (typeof item === "string") candidates.push({ url: item, width: 0 });
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url : typeof o.contentUrl === "string" ? o.contentUrl : typeof o["@id"] === "string" ? o["@id"] : null;
      if (url) candidates.push({ url, width: Number(o.width) || 0 });
    }
  }
  // Sites often list several crops: the widest one makes the best header.
  const best = candidates.sort((a, b) => b.width - a.width)[0];
  if (!best) return null;
  try {
    return new URL(decodeEntities(best.url), base).toString();
  } catch {
    return null;
  }
}

function names(v: unknown): string {
  return asArray(v)
    .map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? (a as Record<string, unknown>).name : ""))
    .map((a) => clean(a, 100))
    .filter(Boolean)
    .join(", ")
    .slice(0, 100);
}

/** Instructions come as text, a list of strings, HowToStep objects or HowToSection groups. */
function instructions(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  for (const item of asArray(v)) {
    if (typeof item === "string") {
      // One long text: split it into its lines or numbered steps.
      const parts = item
        .replace(/<\/(p|li)>/gi, "\n")
        .split(/\n+|(?:^|\s)(?=\d+[.)]\s)/)
        .map((s) => clean(s).replace(/^\d+[.)]\s*/, ""))
        .filter(Boolean);
      out.push(...parts);
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const types = typeOf(o);
      if (types.includes("howtosection") || (o.itemListElement && !o.text)) {
        const name = clean(o.name, 200);
        if (name) out.push(`# ${name}`);
        instructions(o.itemListElement, out, depth + 1);
      } else {
        const text = clean(o.text ?? o.description ?? o.name);
        if (text) out.push(text);
      }
    }
  }
  return out.slice(0, 100);
}

function keywords(v: unknown, exclude: string[]): string[] {
  const words = asArray(v)
    .flatMap((k) => (typeof k === "string" ? k.split(",") : []))
    .map((k) => clean(k, 40).toLowerCase())
    .filter((k) => k && k.length <= 30 && !exclude.includes(k));
  return [...new Set(words)].slice(0, 6);
}

function meta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? clean(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "", 2000) : "";
}

/** Microdata (itemprop="recipeIngredient" …), for the few sites without JSON-LD. */
function microdata(html: string, prop: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(\\w+)[^>]*itemprop=["'][^"']*\\b${prop}\\b[^"']*["'][^>]*>`, "gi");
  for (const m of html.matchAll(re)) {
    const content = /content=["']([^"']*)["']/i.exec(m[0])?.[1];
    if (content !== undefined) {
      out.push(clean(content));
      continue;
    }
    const rest = html.slice(m.index! + m[0].length);
    const end = rest.search(new RegExp(`</${m[1]}>`, "i"));
    out.push(clean(rest.slice(0, end < 0 ? 2000 : end)));
  }
  return out.filter(Boolean);
}

const siteName = (url: URL, html: string) => meta(html, "og:site_name") || url.hostname.replace(/^www\./, "");

const absolute = (src: string, base: URL) => {
  try {
    return new URL(decodeEntities(src), base).toString();
  } catch {
    return null;
  }
};

/** A JSON string literal's content found by `key` in a page's inline data ("shortDescription":"…"). */
function jsonString(html: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(html);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

/** The recipe from a caption or description, with the video as its source. */
function fromCaption(text: string, opts: { url: string | null; fallbackTitle?: string; author?: string; site?: string; imageUrl?: string | null }) {
  const c = parseCaption(text, opts.fallbackTitle);
  const draft: RecipeDraft = {
    title: c.title,
    description: c.description,
    category: "",
    cuisine: "",
    tags: c.tags,
    servings: c.servings,
    servingsLabel: c.servingsLabel,
    prepMinutes: c.prepMinutes,
    cookMinutes: c.cookMinutes,
    totalMinutes: c.totalMinutes,
    ingredients: c.ingredients,
    steps: c.steps,
    notes: "",
    sources: opts.url ? [{ url: opts.url, name: sourceName(opts.url, opts.site, opts.author), kind: kindOf(opts.url) }] : [],
    author: opts.author ?? "",
    imageUrl: opts.imageUrl ?? null,
  };
  return { draft, partial: c.ingredients.length === 0 || c.steps.length === 0 };
}

/**
 * Social networks only show captions to signed-in people. The page then asks for the text instead
 * (pasted, or sent by the bookmarklet from the person's own browser).
 */
const needsText = (kind: string) =>
  new HttpError(422, `${kind} doesn't show the caption to the server. Copy the video's description and paste it here, or use the bookmarklet from the video's page.`, "needs_text");

/** A draft recipe from the page at `raw`. Throws when the page holds no recipe at all. */
export async function importRecipe(raw: string): Promise<{ draft: RecipeDraft; partial: boolean }> {
  const source = cleanUrl(raw);
  const kind = kindOf(source);
  let page: Awaited<ReturnType<typeof safeFetch>>;
  try {
    page = await safeFetch(raw.trim(), PAGE_MAX_BYTES, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
  } catch (e) {
    if (kind === "instagram" || kind === "tiktok" || kind === "facebook") throw needsText(sourceName(source));
    throw e;
  }
  const html = decodePage(page.body, page.type);
  const url = page.url;
  const og = meta(html, "og:image");
  const ogImage = og ? absolute(og, url) : null;

  // YouTube puts the whole description in the page's player data.
  if (kind === "youtube") {
    const description = jsonString(html, "shortDescription") ?? meta(html, "og:description");
    const title = jsonString(html, "title") ?? meta(html, "og:title");
    const author = jsonString(html, "ownerChannelName") ?? jsonString(html, "author") ?? "";
    if (!description) throw new HttpError(422, "No description found on that video");
    return fromCaption(description, { url: source, fallbackTitle: title, author, imageUrl: ogImage });
  }
  // TikTok: the caption is the "desc" of the video in the page's state, when it's served.
  if (kind === "tiktok") {
    const description = jsonString(html, "desc") || meta(html, "og:description");
    if (!description) throw needsText("TikTok");
    const author = jsonString(html, "uniqueId");
    return fromCaption(description, { url: source, author: author ? `@${author}` : "", imageUrl: ogImage });
  }
  // Instagram: the caption only comes with the page's description for some posts.
  if (kind === "instagram" || kind === "facebook") {
    const description = meta(html, "og:description") || meta(html, "description");
    // "1,234 likes, 56 comments - user on March 3, 2025: "caption…"."
    const m = /^(?:[\s\S]*?)(?:-\s*([\w.]+)\s+on\s+[^:]+:\s*)?["“]([\s\S]+)["”]\.?\s*$/.exec(description);
    if (!m || m[2].length < 40) throw needsText(sourceName(source));
    return fromCaption(m[2], { url: source, author: m[1] ? `@${m[1]}` : "", imageUrl: ogImage });
  }

  const recipe = findRecipe(jsonLd(html));
  if (recipe) {
    const y = servings(recipe.recipeYield ?? recipe.yield);
    const category = clean(asArray(recipe.recipeCategory)[0], 60).split(",")[0].trim();
    const cuisine = clean(asArray(recipe.recipeCuisine)[0], 60).split(",")[0].trim();
    const publisher = recipe.publisher && typeof recipe.publisher === "object" ? clean((recipe.publisher as Record<string, unknown>).name, 100) : "";
    const ingredients = asArray(recipe.recipeIngredient ?? recipe.ingredients)
      .map((i) => clean(i, 300))
      .filter(Boolean)
      .slice(0, 200);
    const draft: RecipeDraft = {
      title: clean(recipe.name, 200) || meta(html, "og:title"),
      description: clean(recipe.description, 2000),
      category,
      cuisine,
      tags: keywords(recipe.keywords, [category.toLowerCase(), cuisine.toLowerCase()]),
      servings: y.servings,
      servingsLabel: y.label,
      prepMinutes: minutes(recipe.prepTime),
      cookMinutes: minutes(recipe.cookTime),
      totalMinutes: minutes(recipe.totalTime),
      ingredients,
      steps: instructions(recipe.recipeInstructions),
      notes: "",
      sources: [{ url: source, name: publisher || siteName(url, html), kind }],
      author: names(recipe.author),
      imageUrl: imageUrl(recipe.image, url) ?? ogImage,
    };
    if (!draft.totalMinutes && (draft.prepMinutes || draft.cookMinutes)) draft.totalMinutes = (draft.prepMinutes ?? 0) + (draft.cookMinutes ?? 0);
    return { draft, partial: ingredients.length === 0 || draft.steps.length === 0 };
  }

  // No JSON-LD: microdata, then whatever the page says about itself.
  const ingredients = [...microdata(html, "recipeIngredient"), ...microdata(html, "ingredients")].slice(0, 200);
  const steps = microdata(html, "recipeInstructions").slice(0, 100);
  const title = microdata(html, "name")[0] || meta(html, "og:title") || clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  if (!title) throw new HttpError(422, "No recipe found on that page");
  return {
    draft: {
      title: title.slice(0, 200),
      description: meta(html, "og:description") || meta(html, "description"),
      category: "",
      cuisine: "",
      tags: [],
      servings: null,
      servingsLabel: "",
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      ingredients,
      steps,
      notes: "",
      sources: [{ url: source, name: siteName(url, html), kind }],
      author: "",
      imageUrl: ogImage,
    },
    partial: true,
  };
}

/**
 * A draft from text someone pasted (an Instagram caption, a message from a friend), with the
 * address it came from if given. The page's preview photo is used when the site shares one.
 */
export async function importText(text: string, rawUrl: string | null): Promise<{ draft: RecipeDraft; partial: boolean }> {
  const url = rawUrl ? cleanUrl(rawUrl) : null;
  let imageUrl: string | null = null;
  let site = "";
  if (url) {
    try {
      const page = await safeFetch(url, PAGE_MAX_BYTES, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
      const html = decodePage(page.body, page.type);
      const og = meta(html, "og:image");
      imageUrl = og ? absolute(og, page.url) : null;
      site = meta(html, "og:site_name");
    } catch {
      // The text is what matters; a missing photo is fine.
    }
  }
  return fromCaption(text, { url, site, imageUrl });
}

