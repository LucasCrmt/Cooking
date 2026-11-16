// The recipe template offered by the import dialog: Markdown with a front matter, where every field
// of a recipe has its place (the server reads it in server/src/template.ts). Fill it in by hand, or
// copy the prompt and give it to an AI with a recipe: its answer pastes straight back in.

import type { Lang } from "./i18n";
import { CATEGORIES, CUISINES } from "./recipes";
import { EQUIPMENT } from "./equipment";

export function recipeTemplate(lang: Lang): string {
  return lang === "fr"
    ? `---
title:
category:
cuisine:
tags: []
servings: 4 personnes
prep_time: 15 min
cook_time: 30 min
total_time:
author:
source:
---

# Titre de la recette

> Une phrase pour décrire le plat.

## Matériel

- Four
- Mixeur

## Ingrédients

### Pour la sauce
- 200 g de …
- 1 c. à soupe de …

## Préparation

1. …
2. …

## Notes

- Astuces, variantes, conservation…
`
    : `---
title:
category:
cuisine:
tags: []
servings: 4 servings
prep_time: 15 min
cook_time: 30 min
total_time:
author:
source:
---

# Recipe title

> One sentence about the dish.

## Equipment

- Oven
- Blender

## Ingredients

### For the sauce
- 200 g …
- 1 tbsp …

## Method

1. …
2. …

## Notes

- Tips, variations, storage…
`;
}

/** Instructions for an AI, followed by the template: its answer goes back into the text box. */
export function aiPrompt(lang: Lang): string {
  const intro =
    lang === "fr"
      ? `Écris la recette ci-dessous (ou celle dont je te parle) en Markdown, exactement dans ce modèle, en français :
- en-tête entre --- : title, category (une parmi : ${CATEGORIES.fr.join(", ")}), cuisine (une parmi : ${CUISINES.fr.join(", ")}, ou autre), tags (3 à 6 mots-clés), servings (nombre et unité), prep_time, cook_time, total_time (en minutes ou heures), author et source si connus ;
- "## Matériel" : une ligne "- " par appareil nécessaire, parmi : ${EQUIPMENT.map((e) => e.fr).join(", ")} (rien d'autre : les ustensiles ordinaires vont dans les notes) ;
- "## Ingrédients" : une ligne "- " par ingrédient avec sa quantité ; des sous-parties "### " si la recette en a ;
- "## Préparation" : étapes numérotées, une action par étape ; des sous-parties "### " si besoin ;
- "## Notes" pour le reste.
Réponds seulement avec la recette, sans commentaire.

Modèle :`
      : `Write the recipe below (or the one I describe) as Markdown, exactly in this template, in English:
- front matter between ---: title, category (one of: ${CATEGORIES.en.join(", ")}), cuisine (one of: ${CUISINES.en.join(", ")}, or another), tags (3 to 6 keywords), servings (number and unit), prep_time, cook_time, total_time (in minutes or hours), author and source if known;
- "## Equipment": one "- " line per appliance needed, from: ${EQUIPMENT.map((e) => e.en).join(", ")} (nothing else: ordinary utensils go in the notes);
- "## Ingredients": one "- " line per ingredient with its quantity; "### " subsections if the recipe has parts;
- "## Method": numbered steps, one action each; "### " subsections if needed;
- "## Notes" for the rest.
Answer with the recipe only, no commentary.

Template:`;
  return `${intro}\n\n${recipeTemplate(lang)}`;
}
