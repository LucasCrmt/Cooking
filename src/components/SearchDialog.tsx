// Ctrl+K / "/": the same command palette as Calendar's, Notes' and DevTime's. Jumps to a recipe
// (by title, or by an ingredient: "poireaux"), a list, a category or tag, an action or a settings page.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type SearchHit } from "../lib/api";
import { useApp, type SettingsPage } from "../lib/app";
import { blankRecipe, counts } from "../lib/recipes";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BookOpen, ChefHat, Download, Gear, Heart, Plus, Search, Tag, Utensils } from "./icons";
import { RecipeImage } from "./recipe-bits";

interface Result {
  key: string;
  section: StringKey;
  title: string;
  extra?: string;
  icon: ReactNode;
  run: () => void;
}

const SETTINGS: { id: SettingsPage; label: StringKey }[] = [
  { id: "profile", label: "profile" },
  { id: "preferences", label: "preferences" },
  { id: "security", label: "security" },
  { id: "data", label: "data" },
  { id: "shortcuts", label: "shortcuts" },
  { id: "about", label: "about" },
];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const { recipes, navigate, openSettings, openImport, openEditor } = useApp();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = fold(query.trim());

  // Ingredients, notes and descriptions are searched on the server.
  useEffect(() => {
    if (q.length < 2) return setHits([]);
    const timer = window.setTimeout(() => {
      api<SearchHit[]>(`/app/recipes/search?q=${encodeURIComponent(query.trim())}`).then(setHits, () => setHits([]));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [q, query]);

  const results = useMemo(() => {
    const keep = (title: string) => !q || fold(title).includes(q);
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const all = recipes ?? [];
    const out: Result[] = [];
    const pages: [StringKey, ReactNode, () => void][] = [
      ["allRecipes", <BookOpen size={16} />, () => navigate({ name: "recipes" })],
      ["favorites", <Heart size={16} />, () => navigate({ name: "favorites" })],
      ["untried", <ChefHat size={16} />, () => navigate({ name: "untried" })],
      ["importRecipe", <Download size={16} />, () => openImport()],
      ["newRecipe", <Plus size={16} />, () => openEditor({ initial: blankRecipe() })],
    ];
    for (const [label, icon, run] of pages) if (keep(t(label))) out.push({ key: `page:${label}`, section: "pages", title: t(label), icon, run: done(run) });

    const seen = new Set<string>();
    for (const r of all.filter((r) => keep(r.title)).slice(0, q ? 12 : 6)) {
      seen.add(r.id);
      out.push({
        key: `recipe:${r.id}`,
        section: "recipes",
        title: r.title,
        extra: r.category,
        icon: <RecipeImage recipe={r} className="search-thumb" />,
        run: done(() => navigate({ name: "recipe", id: r.id })),
      });
    }
    for (const h of hits.filter((h) => !seen.has(h.id)).slice(0, 10)) {
      const r = all.find((x) => x.id === h.id);
      out.push({
        key: `hit:${h.id}`,
        section: "recipes",
        title: h.title,
        extra: h.match ?? undefined,
        icon: r ? <RecipeImage recipe={r} className="search-thumb" /> : <BookOpen size={16} />,
        run: done(() => navigate({ name: "recipe", id: h.id })),
      });
    }
    if (q) {
      for (const [c, n] of counts(all, (r) => [r.category]).filter(([c]) => keep(c))) {
        out.push({ key: `cat:${c}`, section: "categories", title: c, extra: t("recipeCount", { n }), icon: <Utensils size={16} />, run: done(() => navigate({ name: "recipes" }, { category: c })) });
      }
      for (const [tag, n] of counts(all, (r) => r.tags).filter(([tag]) => keep(tag)).slice(0, 8)) {
        out.push({ key: `tag:${tag}`, section: "tags", title: `#${tag}`, extra: t("recipeCount", { n }), icon: <Tag size={16} />, run: done(() => navigate({ name: "recipes" }, { tag })) });
      }
      for (const s of SETTINGS.filter((s) => keep(t(s.label)))) {
        out.push({ key: `settings:${s.id}`, section: "settings", title: t(s.label), icon: <Gear size={16} />, run: done(() => openSettings(s.id)) });
      }
    }
    return out;
  }, [q, recipes, hits, t, navigate, openSettings, openImport, openEditor, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: StringKey | null = null;
  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-label={t("search")}>
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) results[active].run();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 && <p className="search-empty">{t("noResults")}</p>}
          {results.map((r, i) => {
            const header = r.section !== lastSection ? <div className="search-section">{t(r.section)}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header}
                <button className={`search-result${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                  <span className="search-result-icon">{r.icon}</span>
                  <span className="search-result-text">
                    <span className="search-result-title">{r.title}</span>
                  </span>
                  {r.extra && <span className="search-result-when">{r.extra}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
