// The equipment a recipe needs (oven, blender, stand mixer…), stored as stable keys so the
// filters work whatever the language. The app shows each key's name; anything else someone
// types is kept as written.
//
// Imports guess it from the words of the recipe ("préchauffer le four", "mixez", "airfryer"):
// the editor shows the guess, ticked, to correct before saving.

export const EQUIPMENT = [
  "oven",
  "microwave",
  "stovetop",
  "blender",
  "hand-blender",
  "food-processor",
  "stand-mixer",
  "hand-mixer",
  "airfryer",
  "cooking-robot",
  "pressure-cooker",
  "slow-cooker",
  "steamer",
  "barbecue",
  "fryer",
  "waffle-iron",
  "crepe-maker",
  "ice-cream-maker",
  "bread-machine",
] as const;

export type EquipmentKey = (typeof EQUIPMENT)[number];

/** Words that name each piece of equipment, in French and English (accents and case aside). */
const WORDS: Record<EquipmentKey, RegExp> = {
  // "four" alone is also the English number: only "au four", "le four", "four à 180", "enfourner"…
  oven: /\b((?:au|le|du|un|votre|ton|en) four|four (?:[àa] |chaud|ventil)|enfourn\w*|pr[ée]chauff\w*|oven|preheat\w*|bake[ds]?(?! (?:powder|soda))|baking (?:sheet|tray|dish|pan|tin)|roast(?:ed|ing)?)\b/,
  microwave: /\b(micro[- ]?ondes?|microwave\w*)\b/,
  stovetop: /\b(plaque (?:de cuisson|chauffante|[àa] induction)|feu (?:doux|moyen|vif)|[àa] feu|po[êe]le|casserole|sauteuse|faitout|wok|stove|hob|stovetop|burner|over (?:low|medium|high) heat|frying pan|saucepan|skillet)\b/,
  blender: /\b(blender|mixeur(?! plongeant)|mix(?:ez|er|e) (?:le tout|finement|jusqu)|blend(?:ed)? until smooth)\b/,
  "hand-blender": /\b(mixeur plongeant|plongeant|immersion blender|stick blender|hand blender)\b/,
  "food-processor": /\b(robot(?: multifonction| m[ée]nager)?(?! p[âa]tissier| cuiseur)|hachoir|hache-?l[ée]gumes|food processor|chopper)\b/,
  "stand-mixer": /\b(robot p[âa]tissier|kitchenaid|kenwood|stand mixer|p[ée]trin|crochet p[ée]trisseur|dough hook)\b/,
  "hand-mixer": /\b(batteur(?: [ée]lectrique)?|fouet [ée]lectrique|hand mixer|electric (?:whisk|mixer)|beaters?)\b/,
  airfryer: /\b(air ?fryer|friteuse sans huile|airfryer)\b/,
  "cooking-robot": /\b(thermomix|cookeo|monsieur cuisine|companion|robot cuiseur|i-?companion|vorwerk)\b/,
  "pressure-cooker": /\b(cocotte[- ]minute|autocuiseur|pressure cooker|instant ?pot|seb clipso)\b/,
  "slow-cooker": /\b(mijoteuse|slow ?cooker|crock ?pot)\b/,
  steamer: /\b(cuit[- ]vapeur|steamer|panier vapeur|steaming basket)\b/,
  barbecue: /\b(barbecue|bbq|plancha|grill(?!\w))\b/,
  fryer: /\b(friteuse(?! sans huile)|deep[- ]fr\w*|bain de friture|deep fryer)\b/,
  "waffle-iron": /\b(gaufrier|waffle (?:iron|maker))\b/,
  "crepe-maker": /\b(cr[êe]pi[èe]re|crepe maker|crêpe maker)\b/,
  "ice-cream-maker": /\b(sorbeti[èe]re|turbine [àa] glace|ice[- ]cream maker|churn)\b/,
  "bread-machine": /\b(machine [àa] pain|bread (?:machine|maker))\b/,
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const WORDS_FOLDED = Object.fromEntries(Object.entries(WORDS).map(([k, re]) => [k, new RegExp(fold(re.source), "i")])) as Record<EquipmentKey, RegExp>;

/** The equipment named in a recipe's text (steps, ingredients, notes). */
export function detectEquipment(text: string): EquipmentKey[] {
  const t = fold(text);
  const found = EQUIPMENT.filter((k) => WORDS_FOLDED[k].test(t));
  // The specific one wins: a hand blender is not also a blender, an airfryer not also a fryer.
  return found.filter((k) => !(k === "blender" && found.includes("hand-blender")) && !(k === "fryer" && found.includes("airfryer")) && !(k === "food-processor" && (found.includes("stand-mixer") || found.includes("cooking-robot"))));
}

/** Names that are a piece of equipment on their own (a list item "Four", "Plaque"). */
const NAMES: Record<string, EquipmentKey> = {
  four: "oven",
  "four ventile": "oven",
  oven: "oven",
  plaque: "stovetop",
  plaques: "stovetop",
  "plaque de cuisson": "stovetop",
  feu: "stovetop",
  gaz: "stovetop",
  induction: "stovetop",
  mixeur: "blender",
  robot: "food-processor",
  grill: "barbecue",
  plancha: "barbecue",
};

/** One piece of equipment by its name ("Four", "Robot pâtissier", "KitchenAid") → its key, if known. */
export function equipmentKey(name: string): EquipmentKey | null {
  const s = name.trim();
  if ((EQUIPMENT as readonly string[]).includes(s)) return s as EquipmentKey;
  const exact = NAMES[fold(s).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()];
  return exact ?? detectEquipment(s)[0] ?? null;
}

/** Equipment from a form or an API: known keys, names mapped to keys, other values kept as written. */
export function equipmentInput(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().slice(0, 40);
    if (!s) continue;
    out.push(equipmentKey(s) ?? s);
  }
  return [...new Set(out)].slice(0, 20);
}
