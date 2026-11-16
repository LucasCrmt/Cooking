// The equipment a recipe can need, by key (the server stores keys: see server/src/equipment.ts),
// with its name in each language. A value that isn't a key (typed by hand) shows as written.

import type { Lang } from "./i18n";

export const EQUIPMENT: { key: string; fr: string; en: string }[] = [
  { key: "oven", fr: "Four", en: "Oven" },
  { key: "stovetop", fr: "Plaque de cuisson", en: "Stovetop" },
  { key: "microwave", fr: "Micro-ondes", en: "Microwave" },
  { key: "blender", fr: "Mixeur / blender", en: "Blender" },
  { key: "hand-blender", fr: "Mixeur plongeant", en: "Hand blender" },
  { key: "food-processor", fr: "Robot / hachoir", en: "Food processor" },
  { key: "stand-mixer", fr: "Robot pâtissier", en: "Stand mixer" },
  { key: "hand-mixer", fr: "Batteur électrique", en: "Hand mixer" },
  { key: "airfryer", fr: "Airfryer", en: "Air fryer" },
  { key: "cooking-robot", fr: "Robot cuiseur (Thermomix, Cookeo…)", en: "Cooking robot (Thermomix…)" },
  { key: "pressure-cooker", fr: "Autocuiseur", en: "Pressure cooker" },
  { key: "slow-cooker", fr: "Mijoteuse", en: "Slow cooker" },
  { key: "steamer", fr: "Cuit-vapeur", en: "Steamer" },
  { key: "barbecue", fr: "Barbecue / plancha", en: "Barbecue / griddle" },
  { key: "fryer", fr: "Friteuse", en: "Deep fryer" },
  { key: "waffle-iron", fr: "Gaufrier", en: "Waffle iron" },
  { key: "crepe-maker", fr: "Crêpière", en: "Crêpe maker" },
  { key: "ice-cream-maker", fr: "Sorbetière", en: "Ice cream maker" },
  { key: "bread-machine", fr: "Machine à pain", en: "Bread machine" },
];

const BY_KEY = new Map(EQUIPMENT.map((e) => [e.key, e]));

/** "oven" → "Four"; anything else as written. */
export const equipmentName = (key: string, lang: Lang) => BY_KEY.get(key)?.[lang] ?? key;

/** The list's order (the presets), then any other value. */
export const equipmentOrder = (key: string) => {
  const i = EQUIPMENT.findIndex((e) => e.key === key);
  return i < 0 ? EQUIPMENT.length : i;
};
