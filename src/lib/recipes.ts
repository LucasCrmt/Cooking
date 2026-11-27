// Recipe helpers: scaling quantities, filtering and sorting the cookbook, blank drafts.

import { dietName, suits } from "./diets";
import type { RecipeFields, RecipeSummary } from "./api";
import type { ListName } from "./router";
import type { Lang } from "./i18n";

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const NICE: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

/** A leading quantity: "2", "1,5", "1.5", "1/2", "½", "1 ½", "2-3", "2 à 3". */
const QUANTITY = /^(\d+(?:[.,]\d+)?\s+[½¼¾⅓⅔⅛]|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])(?:\s*(?:-|–|à|to)\s*(\d+(?:[.,]\d+)?))?/;

function parseNumber(s: string): number {
  s = s.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const withGlyph = /^(\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔⅛])$/.exec(s);
  if (withGlyph) return Number((withGlyph[1] ?? "0").replace(",", ".")) + FRACTIONS[withGlyph[2]];
  return Number(s.replace(",", "."));
}

/** 0.5 → "½", 1.5 → "1 ½", 2.4 → "2,4", 250 → "250". */
export function formatQuantity(n: number, locale: string): string {
  if (n >= 20) return String(Math.round(n));
  const whole = Math.floor(n);
  const rest = n - whole;
  const nice = NICE.find(([v]) => Math.abs(rest - v) < 0.04);
  if (nice && n < 10) return whole ? `${whole} ${nice[1]}` : nice[1];
  if (rest < 0.04) return String(whole);
  if (rest > 0.96) return String(whole + 1);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
}

/** The ingredient line with its leading quantity multiplied ("200 g de farine" × 1.5 → "300 g de farine"). */
export function scaleIngredient(line: string, factor: number, locale: string): { quantity: string | null; rest: string } {
  const m = QUANTITY.exec(line);
  if (!m) return { quantity: null, rest: line };
  const rest = line.slice(m[0].length);
  if (factor === 1) return { quantity: m[0], rest };
  const a = formatQuantity(parseNumber(m[1]) * factor, locale);
  const b = m[2] ? formatQuantity(parseNumber(m[2]) * factor, locale) : null;
  return { quantity: b ? `${a}-${b}` : a, rest };
}

/** Lines starting with "#" are section headings ("# Pour la pâte"). */
export const isHeading = (line: string) => line.startsWith("#");
export const headingText = (line: string) => line.replace(/^#+\s*/, "");

export const blankRecipe = (): RecipeFields => ({
  title: "",
  description: "",
  category: "",
  cuisine: "",
  tags: [],
  servings: 4,
  servingsLabel: "",
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  ingredients: [],
  steps: [],
  notes: "",
  sources: [],
  author: "",
  equipment: [],
  diets: [],
});

export const totalOf = (r: Pick<RecipeSummary, "totalMinutes" | "prepMinutes" | "cookMinutes">) =>
  r.totalMinutes ?? (r.prepMinutes || r.cookMinutes ? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) : null);

export type SortKey = "recent" | "title" | "time" | "rating" | "cooked";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** The recipes a list page shows: its list, then the query's filters, then the sort. */
export function filterRecipes(all: RecipeSummary[], list: ListName, q: Record<string, string>): RecipeSummary[] {
  const text = fold(q.q ?? "");
  const maxTime = Number(q.time) || 0;
  // "with": needs all of these; "without": needs none of these ("sans four").
  const withEq = (q.equipment ?? "").split(",").filter(Boolean);
  const withoutEq = (q.without ?? "").split(",").filter(Boolean);
  const diets = (q.diet ?? "").split(",").filter(Boolean);
  const out = all.filter(
    (r) =>
      (list !== "favorites" || r.favorite) &&
      (list !== "untried" || !r.lastCookedAt) &&
      (list !== "todo" || r.todo) &&
      (!q.category || r.category === q.category) &&
      (!q.tag || r.tags.includes(q.tag)) &&
      (!q.cuisine || r.cuisine === q.cuisine) &&
      (!q.source || r.sources.some((s) => sourceLabel(s) === q.source)) &&
      (!maxTime || ((totalOf(r) ?? Infinity) <= maxTime)) &&
      withEq.every((e) => r.equipment.includes(e)) &&
      !withoutEq.some((e) => r.equipment.includes(e)) &&
      diets.every((d) => suits(r.diets, d)) &&
      (!text || fold(`${r.title} ${r.description} ${r.tags.join(" ")} ${r.category} ${r.cuisine} ${r.diets.map((d) => `${dietName(d, "fr")} ${dietName(d, "en")}`).join(" ")}`).includes(text)),
  );
  const sort = (q.sort as SortKey) || "recent";
  const by: Record<SortKey, (a: RecipeSummary, b: RecipeSummary) => number> = {
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
    title: (a, b) => a.title.localeCompare(b.title),
    time: (a, b) => (totalOf(a) ?? 1e9) - (totalOf(b) ?? 1e9),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    cooked: (a, b) => (b.lastCookedAt ?? "").localeCompare(a.lastCookedAt ?? ""),
  };
  return out.sort((a, b) => by[sort](a, b) || a.title.localeCompare(b.title));
}

/** Values of a field with how many recipes use each, most used first. */
export function counts(all: RecipeSummary[], pick: (r: RecipeSummary) => string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of all) for (const v of pick(r)) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The source without its author ("Instagram · @chef" → "Instagram"), for filters. */
export const sourceLabel = (s: { name: string }) => s.name.split(" · ")[0];

/** A stable hue per recipe, for cards without a photo. */
export function hueOf(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** The usual categories and cuisines, offered by the editor and named in the import template. */
export const CATEGORIES: Record<Lang, string[]> = {
  fr: ["Apéritif", "Entrée", "Plat principal", "Accompagnement", "Soupe", "Salade", "Dessert", "Goûter", "Petit-déjeuner", "Boisson", "Sauce"],
  en: ["Appetizer", "Starter", "Main course", "Side dish", "Soup", "Salad", "Dessert", "Snack", "Breakfast", "Drink", "Sauce"],
};
export const CUISINES: Record<Lang, string[]> = {
  fr: ["Française", "Italienne", "Espagnole", "Grecque", "Méditerranéenne", "Moyen-Orient", "Marocaine", "Indienne", "Chinoise", "Japonaise", "Thaïlandaise", "Coréenne", "Vietnamienne", "Mexicaine", "Américaine"],
  en: ["French", "Italian", "Spanish", "Greek", "Mediterranean", "Middle Eastern", "Moroccan", "Indian", "Chinese", "Japanese", "Thai", "Korean", "Vietnamese", "Mexican", "American"],
};
