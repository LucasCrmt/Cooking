// Free text to a recipe: the caption of an Instagram or TikTok video, a YouTube description, or
// whatever someone pastes. Captions follow loose habits rather than a format ("Ingrédients :",
// bullets or emojis, numbered steps, hashtags at the end), so this reads them the way a person would:
// find the ingredient and step sections, strip the decoration, drop the "follow me" outro.

export type SourceKind = "web" | "instagram" | "tiktok" | "youtube" | "facebook" | "pinterest" | "other";

export interface Source {
  url: string | null;
  name: string;
  kind: SourceKind;
}

/** What kind of source an address is (videos get their own icon and import path). */
export function kindOf(url: string | null): SourceKind {
  if (!url) return "other";
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\.|^m\./, "");
  } catch {
    return "other";
  }
  if (host === "instagram.com" || host === "instagr.am") return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "facebook.com" || host === "fb.watch" || host.endsWith(".facebook.com")) return "facebook";
  if (host === "pinterest.com" || host === "pin.it" || /^pinterest\.[a-z.]+$/.test(host)) return "pinterest";
  return "web";
}

const KIND_NAMES: Partial<Record<SourceKind, string>> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", pinterest: "Pinterest" };

/** "Instagram · @user", "YouTube · Chef Michel", or the site's name. */
export function sourceName(url: string, siteName = "", author = ""): string {
  const kind = kindOf(url);
  const base = KIND_NAMES[kind] ?? (siteName || new URL(url).hostname.replace(/^www\./, ""));
  return author && kind !== "web" ? `${base} · ${author}` : base;
}

/** The address without tracking parameters or fragment. */
export function cleanUrl(raw: string): string {
  const u = new URL(raw.trim());
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|igsh|igshid|si$|is_from_webapp|sender_device|_r$|_t$)/i.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

export interface ParsedCaption {
  title: string;
  description: string;
  ingredients: string[];
  steps: string[];
  tags: string[];
  servings: number | null;
  servingsLabel: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
}

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
const BULLET = /^[\s\-–—•*·▪▫◾◽●○◦‣⁃>→➡✔✅☑✓👉🔸🔹🔶🔷⭐️]+/u;
// "1.", "1)", "1 -", "1/", "①", "1️⃣", "Étape 1 :", "Step 1:"
const NUMBERED = /^(?:(?:[ée]tape|step)\s*\d+\s*[:.)\-–]?|\d{1,2}\s*(?:[.)/\-–]|️?⃣)|[①-⑳])\s*/iu;
const QUANTITY_START = /^(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔]|une?|deux|trois|quatre|cinq|six|a|an|one|two|three|quelques|some|pinch|pincée)\b/iu;
const DIGIT_START = /^(?:\d|[½¼¾⅓⅔])/u;
const ING_HEADING = /^(?:ingr[ée]dients?|ingredients?|ce qu.il (?:vous |te )?faut|il (?:vous |te )?faut|liste de courses|shopping list|you(?:'|’)ll need|what you need)\b\s*(?:\(([^)]*)\))?\s*[:：-]?\s*(.*)$/iu;
const STEP_HEADING = /^(?:pr[ée]paration|[ée]tapes?|instructions?|m[ée]thode|method|directions|steps|recette|la recette|recipe|comment (?:faire|la faire|le faire)|d[ée]roul[ée]|r[ée]alisation|how to(?: make (?:it|them))?)\b\s*[:：-]?\s*$/iu;
const OUTRO = /(abonne|abonnez|subscribe|follow (?:me|us|for)|suivez|n(?:'|’)oublie|n(?:'|’)oubliez|like (?:and|&|et)|lien en bio|link in (?:my )?bio|code promo|promo code|partenariat|sponsoris|collab|enregistre(?:z)? (?:la|cette)|save (?:this|for later)|tag (?:a|un)|identifie|https?:\/\/|www\.)/iu;
const SERVINGS = /(?:pour|serves|for|makes|environ)\s*:?\s*(\d{1,3})(?:\s*(?:à|-|to)\s*\d+)?\s*(personnes?|pers\.?|parts?|portions?|people|persons?|servings?|g[âa]teaux?|pi[èe]ces?|cookies?|cr[êe]pes?|muffins?|verrines?|bols?)?/iu;
const SERVINGS_LINE = new RegExp(`^${SERVINGS.source}\\s*[.!]?$`, "iu");
const TIME_LINE = /^(?:pr[ée]paration|pr[ée]p|prep|cuisson|cook(?:ing)?|temps(?: total)?|total|repos|ready in|pr[êe]te?s? en)\b[^\n\d]{0,20}\d+\s*(?:h|min|mn)/iu;
const TIME = (label: string) => new RegExp(`${label}\\s*[:：-]?\\s*((?:\\d+\\s*h(?:eures?|ours?)?\\s*)?(?:\\d+\\s*(?:min(?:utes?)?|mn))?)`, "iu");

/** "1 h 30", "45 min", "1h" → minutes. */
function parseDuration(s: string | undefined): number | null {
  if (!s) return null;
  const h = /(\d+)\s*h/i.exec(s);
  const m = /(\d+)\s*(?:min|mn)/i.exec(s);
  const total = Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0);
  return total > 0 ? total : null;
}

/** A line without its bullet, numbering, leading emojis or trailing hashtags. */
function strip(line: string): string {
  return line
    .replace(BULLET, "")
    .replace(NUMBERED, "")
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "")
    .replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const isHashtagLine = (l: string) => /^(?:#[\p{L}\p{N}_]+[\s.,]*)+$/u.test(l);
const isHeadingLike = (l: string) => l.length <= 50 && /[:：]$/.test(l) && !QUANTITY_START.test(strip(l));
/** "Pour 4 personnes", "Cuisson : 20 min": facts read separately, not text. */
const isMeta = (l: string) => l.length < 45 && (SERVINGS_LINE.test(l) || TIME_LINE.test(l));
const heading = (l: string) => `# ${l.replace(/[:：]$/, "").trim()}`;

export function parseCaption(text: string, fallbackTitle = ""): ParsedCaption {
  const raw = text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const tags = [...new Set([...raw.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1].toLowerCase()))].slice(0, 6);

  const servingsMatch = SERVINGS.exec(raw);
  const prepMinutes = parseDuration(TIME("(?:pr[ée]paration|pr[ée]p|prep(?:aration)?(?: time)?)").exec(raw)?.[1]);
  const cookMinutes = parseDuration(TIME("(?:cuisson|cook(?:ing)?(?: time)?|bake)").exec(raw)?.[1]);
  const totalMinutes =
    parseDuration(TIME("(?:temps total|total(?: time)?|pr[êe]te?s? en|ready in)").exec(raw)?.[1]) ?? (prepMinutes || cookMinutes ? (prepMinutes ?? 0) + (cookMinutes ?? 0) : null);

  type Mode = "intro" | "ingredients" | "steps" | "outro";
  let mode: Mode = "intro";
  const intro: string[] = [];
  const ingredients: string[] = [];
  const steps: string[] = [];
  const content = () => ingredients.length + steps.length > 0;

  for (const original of raw.split("\n")) {
    const line = original.trim();
    if (!line || isHashtagLine(line) || mode === "outro") continue;
    const bare = strip(line).replace(EMOJI, "").replace(/\s+/g, " ").trim();
    const plain = line.replace(EMOJI, "").replace(BULLET, "").trim();
    if (OUTRO.test(line) && !DIGIT_START.test(bare)) {
      if (content()) mode = "outro";
      continue;
    }

    const ing = ING_HEADING.exec(plain);
    if (ing) {
      mode = "ingredients";
      // "Ingrédients : 200 g de farine, 2 œufs" on one line.
      if (ing[2]) ingredients.push(...ing[2].split(/\s*[,;]\s*/).map(strip).filter(Boolean));
      continue;
    }
    if (STEP_HEADING.test(plain)) {
      mode = "steps";
      continue;
    }
    if (!bare || isMeta(bare)) continue;

    const numbered = NUMBERED.test(line);
    const bulleted = BULLET.test(line) || /^\p{Extended_Pictographic}/u.test(line);

    if (mode === "intro") {
      if (numbered && (ingredients.length > 0 || bare.length > 40)) mode = "steps";
      else if (bulleted || DIGIT_START.test(bare)) mode = "ingredients";
      else {
        // Keep the emojis here: they mark where a title ends ("Tarte tatin 🍎 La meilleure…").
        intro.push(line.replace(BULLET, "").replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, ""));
        continue;
      }
    }

    if (mode === "ingredients") {
      // A numbered sentence, or a long one after the list: the method has started.
      if ((numbered && bare.length > 25) || (ingredients.length > 0 && !bulleted && !QUANTITY_START.test(bare) && bare.length > 80)) {
        mode = "steps";
      } else {
        ingredients.push(isHeadingLike(bare) ? heading(bare) : bare);
        continue;
      }
    }

    steps.push(isHeadingLike(bare) ? heading(bare) : bare);
  }

  // Captions often start "Gratin dauphinois 😍 Le plus crémeux…": the title ends at the emoji or sentence.
  const titleParts = (intro.shift() ?? "")
    .split(/[\p{Extended_Pictographic}️]+|(?<=[.!?])\s+/u)
    .map((p) => p.trim())
    .filter(Boolean);
  const title = (titleParts.shift()?.replace(/[.!:]+$/, "") || fallbackTitle).slice(0, 200);
  if (titleParts.length) intro.unshift(titleParts.join(" "));
  return {
    title,
    description: intro
      .map((l) => l.replace(EMOJI, "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000),
    ingredients: ingredients.slice(0, 200),
    steps: steps.slice(0, 100),
    tags,
    servings: servingsMatch ? Math.min(100, Number(servingsMatch[1])) || null : null,
    servingsLabel: servingsMatch?.[2]?.toLowerCase() ?? "",
    prepMinutes,
    cookMinutes,
    totalMinutes,
  };
}
