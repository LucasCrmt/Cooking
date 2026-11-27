// The diets a recipe can suit, by key (the server stores keys: see server/src/diets.ts), with their
// names in each language.

import type { Lang } from "./i18n";

export const DIETS: { key: string; fr: string; en: string }[] = [
  { key: "vegetarian", fr: "Végétarien", en: "Vegetarian" },
  { key: "vegan", fr: "Vegan", en: "Vegan" },
  { key: "pescatarian", fr: "Pescétarien", en: "Pescatarian" },
  { key: "gluten-free", fr: "Sans gluten", en: "Gluten-free" },
  { key: "lactose-free", fr: "Sans lactose", en: "Lactose-free" },
  { key: "nut-free", fr: "Sans fruits à coque", en: "Nut-free" },
];

const BY_KEY = new Map(DIETS.map((d) => [d.key, d]));

export const dietName = (key: string, lang: Lang) => BY_KEY.get(key)?.[lang] ?? key;

export const dietOrder = (key: string) => {
  const i = DIETS.findIndex((d) => d.key === key);
  return i < 0 ? DIETS.length : i;
};

/**
 * Whether a recipe with these labels suits the diet: a vegan recipe is vegetarian (and without
 * lactose), a vegetarian one is pescatarian too.
 */
export function suits(diets: string[], want: string): boolean {
  if (diets.includes(want)) return true;
  if (want === "vegetarian" || want === "lactose-free") return diets.includes("vegan");
  if (want === "pescatarian") return diets.includes("vegetarian") || diets.includes("vegan");
  return false;
}
