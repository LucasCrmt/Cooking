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
// "1.", "1)", "1 -", "1/", "①", "1️⃣", "Étape 1 :", "Step 1:" — but not "1/2 pot", "1.5 kg" or "1-2 gousses".
const NUMBERED = /^(?:(?:[ée]tape|step)\s*\d+\s*[:.)\-–]?|\d{1,2}\s*(?:[.)](?!\d)|[/\-–](?!\s*\d)|️?⃣)|[①-⑳])\s*/iu;
const QUANTITY_START = /^(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔]|une?|deux|trois|quatre|cinq|six|a|an|one|two|three|quelques|some|pinch|pincée)\b/iu;
const DIGIT_START = /^(?:\d|[½¼¾⅓⅔])/u;
const ING_HEADING = /^(?:(?:la )?liste des ingr[ée]dients?|(?:les |vos )?ingr[ée]dients?|ingredients?|ce qu.il (?:vous |te )?faut|il (?:vous |te )?faut|liste de courses|shopping list|you(?:'|’)ll need|what you need)\b\s*(?:\(([^)]*)\))?\s*[:：-]?\s*(.*)$/iu;
const STEP_HEADING = /^(?:pr[ée]paration|[ée]tapes?|instructions?|m[ée]thode|method|directions|steps|recette|la recette|recipe|comment (?:faire|la faire|le faire)|d[ée]roul[ée]|r[ée]alisation|how to(?: make (?:it|them))?)\b\s*[:：-]?\s*$/iu;
const OUTRO = /(abonne|abonnez|subscribe|en commentaire|dans les commentaires|in the comments|comment below|follow (?:me|us|for)|suivez|n(?:'|’)oublie|n(?:'|’)oubliez|like (?:and|&|et)|lien en bio|link in (?:my )?bio|code promo|promo code|partenariat|sponsoris|collab|enregistre(?:z)? (?:la|cette)|save (?:this|for later)|tag (?:a|un)|identifie|https?:\/\/|www\.)/iu;
/** A web address without "https://" ("boutique-site.com/xyz", "bit.ly/abc"): a link, never an ingredient. */
const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|net|org|io|co|be|ch|ca|ly|gl|me|tv|to|shop|store|eu|uk|de|link|page)\/\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|net|org|io|shop|store)\b/iu;
/** "⏱️ Chapitres", "Timestamps:": the list of a video's chapters follows. */
const CHAPTERS_HEADING = /^(?:chapitres?|chapters?|timestamps?|sommaire|timecodes?)\s*[:：]?$/iu;
/** "Coucou !", "Hello," at the start of a message. */
const GREETING = /^(?:coucou|salut|hello|hi|hey|bonjour|bonsoir|yo)\b[\s!,.:]*(?:\S+[\s!,.]*)?$/iu;
/** "Bisous", "Bon appétit !" at the end of a message. */
const SIGN_OFF = /^(?:bisous|bises|gros bisous|biz|xoxo|bon app[ée]tit|enjoy|à bient[ôo]t|a\+|ciao)\b[\s!.❤️💛😘]*$/iu;
/** "______", "-----", "=====": the lines videos put between blocks of links. */
const SEPARATOR = /^[\s_\-=—–~*•·.+#]{3,}$/u;
/** "0:00 Intro", "(12:34) La pâte": a video's chapters. */
const CHAPTER = /^\(?\d{1,2}:\d{2}(?::\d{2})?\)?(?:\s|$)/u;
/** The shop, the book, the gear, the credits: around the recipe, not in it. */
const PROMO = /(boutique|\bshop\b|amazon|affili|\bmon livre\b|\blivre\s*["«“]|my (?:new )?(?:cook)?book|mat[ée]riel que j|mon mat[ée]riel|mat[ée]riel utilis|equipment i use|my gear|my kit|remerciements|cr[ée]dits\b|\bcredits\b|musique|\bmusic\b|retrouvez-moi|find me on)/iu;
/** Where a web page's recipe ends: comments, suggestions, sharing buttons. */
const PAGE_END = /^(?:\d*\s*commentaires?|\d*\s*comments?|laisse[rz]? un commentaire|leave a (?:comment|reply)|vous aimerez (?:peut-être )?aussi|à (?:lire|découvrir) aussi|(?:you )?(?:may|might) also like|related (?:recipes|posts)|more recipes|partage[rz]?(?: cette recette)?|share (?:this|on)|ils l.ont (?:fait|test[ée])|vos r[ée]alisations|vous l.avez (?:fait|test[ée])|i made (?:it|this)|made (?:it|this)\?|newsletter|tags?\s*:|[ée]tiquettes?\s*:)\b/iu;
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
const isMeta = (l: string) => {
  // "(pour 6 personnes) :" counts too.
  const s = l.replace(/^\((.*)\)\s*[:：]?$/, "$1").replace(/\s*[:：]$/, "");
  return s.length < 45 && (SERVINGS_LINE.test(s) || TIME_LINE.test(s));
};
const heading = (l: string) => `# ${l.replace(/[:：]$/, "").trim()}`;

/**
 * `page`: the text of a web page rather than a caption. Menus and article text come before the
 * recipe, so only an "Ingrédients" or "Préparation" heading starts it, and comments end it.
 */
export function parseCaption(text: string, fallbackTitle = "", opts: { page?: boolean } = {}): ParsedCaption {
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
    if (opts.page && PAGE_END.test(bare)) {
      if (content()) mode = "outro";
      continue;
    }
    // After the method, a separator starts the links and credits a video puts below its recipe.
    if (SEPARATOR.test(line) && mode === "steps" && steps.length > 0) {
      mode = "outro";
      continue;
    }
    // Separators, chapters, bare links, the shop and the credits: skipped wherever they are.
    if (SEPARATOR.test(line) || CHAPTER.test(line) || CHAPTERS_HEADING.test(bare) || ((DOMAIN.test(line) || PROMO.test(line)) && !DIGIT_START.test(bare))) continue;
    if (SIGN_OFF.test(bare)) {
      if (content()) mode = "outro";
      continue;
    }
    if (mode === "intro" && GREETING.test(bare)) continue;

    const ing = ING_HEADING.exec(plain);
    if (ing) {
      mode = "ingredients";
      // "Ingrédients : 200 g de farine, 2 œufs" on one line.
      if (ing[2]) ingredients.push(...ing[2].split(/\s*[,;]\s*/).map((i) => strip(i).replace(/(?<!\.)\.$/, "")).filter(Boolean));
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
      if (opts.page) continue;
      if (numbered && (ingredients.length > 0 || bare.length > 40)) mode = "steps";
      else if (bulleted || DIGIT_START.test(bare)) mode = "ingredients";
      else {
        // Keep the emojis here: they mark where a title ends ("Tarte tatin 🍎 La meilleure…").
        intro.push(line.replace(BULLET, "").replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, ""));
        continue;
      }
    }

    if (mode === "ingredients") {
      // A numbered line that isn't a quantity ("1️⃣ Cuire les pâtes"), or a sentence after the list
      // ("Tu bats les oeufs avec le sucre."): the method has started.
      const sentence = !bulleted && !QUANTITY_START.test(bare) && (bare.length > 80 || (/[.!]$/.test(bare) && bare.split(" ").length >= 6));
      if ((numbered && (bare.length > 25 || !QUANTITY_START.test(bare))) || (ingredients.length > 0 && sentence)) {
        mode = "steps";
      } else {
        // "25 cl de lait." → "25 cl de lait"
        ingredients.push(isHeadingLike(bare) ? heading(bare) : bare.replace(/(?<!\.)\.$/, ""));
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
  // "Coucou ! Voilà la recette du clafoutis de mamie :" → "Clafoutis de mamie"
  while (titleParts.length > 1 && GREETING.test(titleParts[0])) titleParts.shift();
  const named = titleParts
    .shift()
    ?.replace(/[.!:：]+$/, "")
    .replace(/^(?:voici|voil[àa]|here(?:'|’)?s|here is)\s+(?:la |ma |notre |the |my |our )?(?:recette |recipe )?(?:du |de la |des |de |d(?:'|’)|for |of )?/iu, "")
    .trim();
  const title = (named ? named[0].toUpperCase() + named.slice(1) : fallbackTitle).slice(0, 200);
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
