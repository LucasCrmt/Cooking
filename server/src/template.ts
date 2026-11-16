// The recipe template: Markdown with a front matter, the format the import dialog offers (and the
// one an AI writes when asked for it). Every field of a recipe has its place, so nothing is guessed:
//
//   ---
//   title: Gratin dauphinois
//   category: Plat
//   cuisine: Française
//   tags: [gratin, pommes de terre]
//   servings: 4 personnes
//   prep_time: 20 min
//   cook_time: 1 h
//   author: Grand-mère
//   source: https://…
//   ---
//
//   # Gratin dauphinois
//   > A short description.
//
//   ## Ingrédients
//   ### Pour la sauce          (a section: becomes "# Pour la sauce")
//   - 1 kg de pommes de terre
//
//   ## Préparation
//   1. Éplucher…
//
//   ## Notes                   (any other section — Matériel, Astuces… — goes to the notes)
//
// Keys and section names are read in French or English, accents and case aside.

export interface TemplateRecipe {
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
  author: string;
  /** The "## Matériel" section and the front matter's "equipment", as written. */
  equipment: string[];
  sourceUrls: string[];
  sourceNames: string[];
  imageUrl: string | null;
}

/** "Préparation", "prep_time" → "preparation", "prep time". */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const KEYS: Record<string, keyof TemplateRecipe | "servings" | "source" | "image" | "equipment"> = {
  title: "title",
  titre: "title",
  nom: "title",
  name: "title",
  description: "description",
  resume: "description",
  summary: "description",
  category: "category",
  categorie: "category",
  type: "category",
  course: "category",
  cuisine: "cuisine",
  origine: "cuisine",
  tags: "tags",
  tag: "tags",
  keywords: "tags",
  "mots cles": "tags",
  servings: "servings",
  serves: "servings",
  portions: "servings",
  parts: "servings",
  personnes: "servings",
  pour: "servings",
  yield: "servings",
  rendement: "servings",
  "servings label": "servingsLabel",
  "prep time": "prepMinutes",
  prep: "prepMinutes",
  preparation: "prepMinutes",
  "temps de preparation": "prepMinutes",
  "cook time": "cookMinutes",
  cook: "cookMinutes",
  cuisson: "cookMinutes",
  "temps de cuisson": "cookMinutes",
  "total time": "totalMinutes",
  total: "totalMinutes",
  "temps total": "totalMinutes",
  author: "author",
  auteur: "author",
  chef: "author",
  by: "author",
  par: "author",
  source: "source",
  sources: "source",
  url: "source",
  lien: "source",
  link: "source",
  image: "image",
  photo: "image",
  "image url": "image",
  notes: "notes",
  note: "notes",
  equipment: "equipment",
  materiel: "equipment",
  ustensiles: "equipment",
  tools: "equipment",
};

type Section = "ingredients" | "steps" | "notes" | "description" | "equipment" | "other";

function sectionOf(heading: string): Section {
  const h = norm(heading);
  if (/^(ingredients?|ce quil (vous |te )?faut|liste de courses|shopping list)\b/.test(h)) return "ingredients";
  if (/^(preparation|etapes?|instructions?|methode|method|directions|steps|recette|realisation|deroule|how to)\b/.test(h)) return "steps";
  if (/^(notes?|astuces?|conseils?|tips?|remarques?)\b/.test(h)) return "notes";
  if (/^(materiel|ustensiles?|equipment|equipement|tools|you will need)\b/.test(h)) return "equipment";
  if (/^(description|resume|summary|introduction|intro)\b/.test(h)) return "description";
  return "other";
}

/** "1 h 30", "45 min", "PT1H30M", "90" → minutes. */
export function duration(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(s);
  if (iso) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) || null;
  const h = /(\d+(?:[.,]\d+)?)\s*h(?:eures?|ours?|rs?)?\s*(\d+)?/i.exec(s);
  const m = /(\d+)\s*(?:min|mn|m\b)/i.exec(s);
  if (h || m) {
    const hours = h ? Number(h[1].replace(",", ".")) * 60 + Number(h[2] ?? 0) : 0;
    const total = Math.round(hours + (h?.[2] ? 0 : Number(m?.[1] ?? 0)));
    return total > 0 ? total : null;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A YAML-ish scalar: quotes dropped. */
const scalar = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** "[a, b]", "a, b", "#a #b" → ["a", "b"]. */
const listOf = (v: string) =>
  v
    .replace(/^\[|\]$/g, "")
    .split(/[,;]|\s(?=#)/)
    .map((t) => scalar(t).replace(/^#/, "").trim())
    .filter(Boolean);

/** Markdown emphasis and links dropped: the app shows plain text. */
const plain = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** A list item without its bullet or number; null when the line isn't one. */
function item(line: string): string | null {
  const m = /^\s*(?:[-*+•]|\d{1,3}[.)]|\[[ x]\])\s+(.*)$/i.exec(line);
  return m ? m[1] : null;
}

/**
 * Markdown copied out of a rich-text editor (Notes, Notion, Word, some chat apps) comes escaped:
 * "\# Titre\", "\- 200 g\", "1\. Mélanger\": a backslash before every Markdown sign and a "\" hard
 * line break at the end of each line. When the text looks like that, the escapes are undone.
 */
export function unescapeMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const escaped = lines.filter((l) => /\\\s*$/.test(l) || /^\s*(?:\\[-#>*+_`]|\d+\\[.)])/.test(l)).length;
  if (escaped < Math.max(2, lines.filter((l) => l.trim()).length / 4)) return text;
  return lines
    .map((l) =>
      l
        .replace(/\\\s*$/, "")
        .replace(/\\([!-/:-@[-`{-~])/g, "$1")
        .replace(/\s+$/, ""),
    )
    .join("\n");
}

/** Whether the text is written in the template (a front matter, or Markdown sections for ingredients). */
export function looksLikeTemplate(text: string): boolean {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/^---\s*\n[\s\S]*?\n---\s*(\n|$)/.test(t)) return true;
  return /^#{2,3}\s+\S/m.test(t) && /^#{1,3}\s+(ingr[ée]dients?|ingredients?)\b/im.test(t);
}

export function parseTemplate(text: string): TemplateRecipe {
  let t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  // AIs often wrap their answer in a code block.
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fenced) t = fenced[1].trim();

  const r: TemplateRecipe = {
    title: "",
    description: "",
    category: "",
    cuisine: "",
    tags: [],
    servings: null,
    servingsLabel: "",
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    ingredients: [],
    steps: [],
    notes: "",
    author: "",
    equipment: [],
    sourceUrls: [],
    sourceNames: [],
    imageUrl: null,
  };

  const addSource = (v: string) => {
    for (const part of v.split(/\s*[,;]\s*|\s+(?=https?:)/)) {
      const s = scalar(part);
      if (!s) continue;
      if (/^https?:\/\//i.test(s)) r.sourceUrls.push(s);
      else r.sourceNames.push(s);
    }
  };

  // --- Front matter ---
  const fm = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(t);
  if (fm) {
    t = t.slice(fm[0].length);
    let listKey: string | null = null;
    for (const line of fm[1].split("\n")) {
      const listItem = /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null);
      if (listItem && listKey) {
        const v = scalar(listItem[1]);
        if (listKey === "tags") r.tags.push(v.replace(/^#/, ""));
        else if (listKey === "source") addSource(v);
        else if (listKey === "equipment") r.equipment.push(v);
        continue;
      }
      const kv = /^([^:#][^:]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const key = KEYS[norm(kv[1])];
      const v = scalar(kv[2]);
      listKey = !v && (key === "tags" || key === "source" || key === "equipment") ? key : null;
      if (!key || !v) continue;
      switch (key) {
        case "tags":
          r.tags.push(...listOf(v));
          break;
        case "equipment":
          r.equipment.push(...listOf(v));
          break;
        case "servings": {
          const n = /\d+/.exec(v);
          if (n) {
            r.servings = Math.min(100, Number(n[0])) || null;
            const label = v.replace(/^\D*\d+(?:\s*(?:à|-|to)\s*\d+)?/, "").trim();
            if (label && !r.servingsLabel) r.servingsLabel = label;
          }
          break;
        }
        case "servingsLabel":
          r.servingsLabel = v;
          break;
        case "prepMinutes":
        case "cookMinutes":
        case "totalMinutes":
          r[key] = duration(v);
          break;
        case "source":
          addSource(v);
          break;
        case "image":
          if (/^https?:\/\//i.test(v)) r.imageUrl = v;
          break;
        case "title":
        case "description":
        case "category":
        case "cuisine":
        case "author":
        case "notes":
          r[key] = v;
          break;
      }
    }
  }

  // --- Body ---
  let section: Section | "intro" = "intro";
  const intro: string[] = [];
  const description: string[] = [];
  const notes: string[] = [];
  let paragraph: string[] = [];
  const flushStep = () => {
    if (paragraph.length) r.steps.push(plain(paragraph.join(" ")));
    paragraph = [];
  };

  for (const raw of t.split("\n")) {
    const line = raw.trimEnd();
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^#{3,6}\s+(.+)$/.exec(line);
    if (h1 && section === "intro") {
      if (!r.title) r.title = plain(h1[1]);
      continue;
    }
    if (h2 || (h1 && section !== "intro")) {
      flushStep();
      const name = plain((h2 ?? h1)![1]);
      section = sectionOf(name);
      // Notes keep the name of each section they gather ("Matériel", "Astuces"…), except "Notes" itself.
      if ((section === "other" || section === "notes") && !/^notes?$/.test(norm(name))) notes.push(`${notes.length ? "\n" : ""}${name}`);
      continue;
    }
    if (h3) {
      flushStep();
      const name = plain(h3[1]).replace(/[:：]$/, "");
      if (section === "ingredients") r.ingredients.push(`# ${name}`);
      else if (section === "steps") r.steps.push(`# ${name}`);
      else if (section === "notes" || section === "other") notes.push(`${notes.length ? "\n" : ""}${name}`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) continue;

    const quote = /^>\s?(.*)$/.exec(line);
    const li = item(line);
    switch (section) {
      case "intro":
        if (quote) description.push(quote[1]);
        else if (line.trim()) intro.push(line.trim());
        break;
      case "description":
        if (line.trim()) description.push((quote?.[1] ?? line).trim());
        break;
      case "ingredients":
        if (li !== null) r.ingredients.push(plain(li));
        else if (line.trim() && !quote) {
          // "Pour la pâte :" as plain text is a section too.
          const p = plain(line);
          r.ingredients.push(/[:：]$/.test(p) && p.length < 60 ? `# ${p.replace(/[:：]$/, "")}` : p);
        }
        break;
      case "steps":
        if (li !== null) {
          flushStep();
          paragraph.push(li);
        } else if (!line.trim()) flushStep();
        else paragraph.push(line.trim());
        break;
      case "equipment":
        if (li !== null) r.equipment.push(plain(li));
        else if (line.trim() && !quote) r.equipment.push(...plain(line).split(/\s*[,;]\s*/).filter(Boolean));
        break;
      case "notes":
      case "other":
        if (li !== null) notes.push(`- ${plain(li)}`);
        else if (line.trim()) notes.push(plain((quote?.[1] ?? line).trim()));
        break;
    }
  }
  flushStep();

  if (!r.description) r.description = plain([...description, ...intro].join(" "));
  const bodyNotes = notes.join("\n").trim();
  if (bodyNotes) r.notes = r.notes ? `${r.notes}\n\n${bodyNotes}` : bodyNotes;
  r.tags = [...new Set(r.tags.map((x) => x.toLowerCase().trim()).filter((x) => x && x.length <= 40))].slice(0, 20);
  if (!r.totalMinutes && (r.prepMinutes || r.cookMinutes)) r.totalMinutes = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
  r.title = r.title.slice(0, 200);
  r.description = r.description.slice(0, 2000);
  r.notes = r.notes.slice(0, 5000);
  r.ingredients = r.ingredients.filter(Boolean).slice(0, 200);
  r.steps = r.steps.filter(Boolean).slice(0, 100);
  return r;
}
