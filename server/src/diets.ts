// Diets a recipe suits (vegetarian, vegan, gluten-free…), stored as stable keys so the labels and
// the filters work whatever the language. Only these keys are kept.
//
// Imports read them from schema.org's suitableForDiet and from tags that name one ("végétarien",
// "#vegan", "sans gluten"): those tags become the diet label instead.

export const DIETS = ["vegetarian", "vegan", "pescatarian", "gluten-free", "lactose-free", "nut-free"] as const;

export type DietKey = (typeof DIETS)[number];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Names of each diet, in French and English (accents, case and dashes aside). */
const NAMES: Record<string, DietKey> = {};
const add = (key: DietKey, names: string[]) => names.forEach((n) => (NAMES[fold(n)] = key));
add("vegetarian", ["vegetarian", "végétarien", "végétarienne", "vegetarien", "veggie", "végé", "vege", "vegetarian diet", "lacto ovo vegetarian"]);
add("vegan", ["vegan", "végan", "végane", "vegane", "végétalien", "végétalienne", "vegetalien", "plant based", "vegan diet", "100% végétal"]);
add("pescatarian", ["pescatarian", "pescetarian", "pescétarien", "pescetarien", "pesco végétarien"]);
add("gluten-free", ["gluten free", "gluten-free", "sans gluten", "gluten free diet", "glutenfree", "sansgluten"]);
add("lactose-free", ["lactose free", "dairy free", "sans lactose", "sans lait", "sans produits laitiers", "low lactose", "dairyfree", "sanslactose"]);
add("nut-free", ["nut free", "sans noix", "sans fruits à coque", "sans arachide", "nut-free"]);

/** A diet by key or name ("végétarien", "#vegan", "https://schema.org/GlutenFreeDiet") → its key. */
export function dietKey(name: string): DietKey | null {
  const s = name.trim();
  if ((DIETS as readonly string[]).includes(s)) return s as DietKey;
  // schema.org: "VeganDiet", "https://schema.org/GlutenFreeDiet".
  const schema = /(?:^|\/)(\w+)Diet$/.exec(s);
  const words = schema ? schema[1].replace(/([a-z])([A-Z])/g, "$1 $2") : s;
  return NAMES[fold(words)] ?? null;
}

/** Diets from a form or an API: known keys (or names), the rest dropped. */
export function dietsInput(v: unknown): DietKey[] {
  const out = new Set<DietKey>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (typeof raw !== "string") continue;
    const k = dietKey(raw.slice(0, 60));
    if (k) out.add(k);
  }
  return DIETS.filter((k) => out.has(k));
}

/** Splits tags into the diets they name and the other tags. */
export function dietsFromTags(tags: string[]): { diets: DietKey[]; tags: string[] } {
  const diets: string[] = [];
  const rest: string[] = [];
  for (const t of tags) (dietKey(t) ? diets : rest).push(t);
  return { diets: dietsInput(diets), tags: rest };
}
