// The cookbook: every recipe of a list (all, favourites, to do, not cooked yet), filtered by the query
// string (search, category, tag, time) and shown as photo cards or a compact list.

import { useMemo, type MouseEvent } from "react";
import { api, type RecipeSummary } from "../lib/api";
import { useApp } from "../lib/app";
import { blankRecipe, filterRecipes, totalOf } from "../lib/recipes";
import type { ListName } from "../lib/router";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { useToast } from "./common";
import { BookOpen, Clock, Download, Heart, LayoutGrid, ListIcon, Plus, Search, X } from "./icons";
import { RecipeImage, Stars } from "./recipe-bits";
import { Toolbar } from "./Toolbar";

const TITLES: Record<ListName, StringKey> = { recipes: "allRecipes", favorites: "favorites", todo: "todoList", untried: "untried" };

export function RecipesPage({ list }: { list: ListName }) {
  const { t, settings, update } = useSettings();
  const { recipes, query, setQuery, openImport, openEditor, server } = useApp();
  const shown = useMemo(() => (recipes ? filterRecipes(recipes, list, query) : undefined), [recipes, list, query]);
  const chips: [string, string][] = [
    ["category", query.category],
    ["tag", query.tag],
    ["cuisine", query.cuisine],
    ["time", query.time && t("underMinutes", { n: query.time })],
  ].filter((c): c is [string, string] => !!c[1]);

  return (
    <>
      <Toolbar title={query.category || (query.tag ? `#${query.tag}` : t(TITLES[list]))} loading={!recipes}>
        <div className="search-field">
          <Search size={14} />
          <input
            className="text-field"
            placeholder={t("filterRecipes")}
            value={query.q ?? ""}
            onChange={(e) => setQuery({ q: e.target.value }, true)}
            aria-label={t("filterRecipes")}
          />
        </div>
        <div className="segmented hide-mobile" role="group" aria-label={t("view")}>
          <button className={settings.view === "grid" ? "active" : ""} title={t("viewGrid")} aria-label={t("viewGrid")} onClick={() => update({ view: "grid" })}>
            <LayoutGrid size={14} />
          </button>
          <button className={settings.view === "list" ? "active" : ""} title={t("viewList")} aria-label={t("viewList")} onClick={() => update({ view: "list" })}>
            <ListIcon size={14} />
          </button>
        </div>
      </Toolbar>
      <div className="content">
        <div className="page">
          {chips.length > 0 && (
            <div className="filter-bar">
              {chips.map(([k, label]) => (
                <span key={k} className="filter-chip">
                  {label}
                  <button className="icon-button small" aria-label={t("clearFilter")} onClick={() => setQuery({ [k]: undefined })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <span className="muted small">{t("recipeCount", { n: shown?.length ?? 0 })}</span>
            </div>
          )}
          {!shown ? (
            <div className="recipe-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 240 }} />
              ))}
            </div>
          ) : recipes!.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={32} />
              <h2>{t("emptyCookbook")}</h2>
              <p className="muted">{t("emptyCookbookHint")}</p>
              <div className="empty-actions">
                {server?.importEnabled !== false && (
                  <button className="primary-button" onClick={() => openImport()}>
                    <Download size={15} />
                    {t("importRecipe")}
                  </button>
                )}
                <button className="text-button" onClick={() => openEditor({ initial: blankRecipe() })}>
                  <Plus size={15} />
                  {t("newRecipe")}
                </button>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state">
              <Search size={32} />
              <p className="muted">{t("noMatch")}</p>
            </div>
          ) : settings.view === "list" ? (
            <div className="recipe-list">
              {shown.map((r) => (
                <RecipeRow key={r.id} recipe={r} />
              ))}
            </div>
          ) : (
            <div className="recipe-grid">
              {shown.map((r) => (
                <RecipeCard key={r.id} recipe={r} />
              ))}
            </div>
          )}
          {shown && shown.length > 0 && <p className="muted small list-count">{t("recipeCount", { n: shown.length })}</p>}
        </div>
      </div>
    </>
  );
}

/** Plain links (open in a new tab works); a normal click stays in the app. */
function useOpenRecipe() {
  const { navigate } = useApp();
  return (e: MouseEvent<HTMLAnchorElement>, r: RecipeSummary) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate({ name: "recipe", id: r.id });
  };
}

function RecipeCard({ recipe: r }: { recipe: RecipeSummary }) {
  const { f } = useSettings();
  const open = useOpenRecipe();
  const total = totalOf(r);
  return (
    <article className="recipe-card">
      <a href={"/r/" + r.id} className="recipe-card-link" onClick={(e) => open(e, r)}>
        <RecipeImage recipe={r} />
        <div className="recipe-card-body">
          <h3>{r.title}</h3>
          <div className="recipe-meta">
            {total !== null && (
              <span>
                <Clock size={13} />
                {f.minutes(total)}
              </span>
            )}
            {r.category && <span>{r.category}</span>}
            <Stars value={r.rating} size={12} />
          </div>
        </div>
      </a>
      <FavoriteButton recipe={r} className="recipe-card-fav" />
    </article>
  );
}

function RecipeRow({ recipe: r }: { recipe: RecipeSummary }) {
  const { f } = useSettings();
  const open = useOpenRecipe();
  const total = totalOf(r);
  return (
    <div className="recipe-row">
      <a href={"/r/" + r.id} className="recipe-row-link" onClick={(e) => open(e, r)}>
        <RecipeImage recipe={r} className="thumb" />
        <span className="recipe-row-title">
          <span>{r.title}</span>
          <span className="muted small">{[r.category, r.sources[0]?.name].filter(Boolean).join(" · ")}</span>
        </span>
        <Stars value={r.rating} size={12} />
        <span className="muted small tabular hide-mobile">{total !== null ? f.minutes(total) : ""}</span>
      </a>
      <FavoriteButton recipe={r} />
    </div>
  );
}

export function FavoriteButton({ recipe, className = "" }: { recipe: { id: string; favorite: boolean }; className?: string }) {
  const { t } = useSettings();
  const { reloadRecipes } = useApp();
  const toast = useToast();
  return (
    <button
      className={`icon-button fav-button${recipe.favorite ? " on" : ""} ${className}`}
      aria-pressed={recipe.favorite}
      title={recipe.favorite ? t("unfavorite") : t("favorite")}
      aria-label={recipe.favorite ? t("unfavorite") : t("favorite")}
      onClick={async () => {
        try {
          await api(`/app/recipes/${recipe.id}/favorite`, { method: "PUT", body: { on: !recipe.favorite } });
          reloadRecipes();
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }}
    >
      <Heart filled={recipe.favorite} />
    </button>
  );
}
