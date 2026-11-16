import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { blankRecipe, counts } from "../lib/recipes";
import type { ListName } from "../lib/router";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BookOpen, ChefHat, Heart, PanelLeft, Plus, Search, Share, Tag, Utensils } from "./icons";


const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 248;

/** Same layout as Calendar's, Notes' and DevTime's sidebars: toggle and search on top, then the lists. */
export function Sidebar() {
  const { t, settings } = useSettings();
  const { route, query, navigate, recipes, shared, toggleSidebar, openSearch, openEditor } = useApp();
  const newShared = (shared ?? []).filter((s) => !s.seenAt).length;
  const all = recipes ?? [];
  const categories = useMemo(() => counts(all, (r) => [r.category]), [all]);
  const tags = useMemo(() => counts(all, (r) => r.tags).slice(0, 20), [all]);
  const list = route.name === "recipe" || route.name === "shared" ? null : route.name;

  const nav: [ListName, StringKey, ReactNode, number][] = [
    ["recipes", "allRecipes", <BookOpen />, all.length],
    ["favorites", "favorites", <Heart />, all.filter((r) => r.favorite).length],
    ["untried", "untried", <ChefHat />, all.filter((r) => !r.lastCookedAt).length],
  ];
  const filterActive = !!(query.category || query.tag);

  return (
    <aside className="sidebar" style={{ "--sidebar-w": `${settings.sidebarWidth}px` } as CSSProperties}>
      <ResizeHandle />
      <div className="sidebar-top">
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
        <div className="toolbar-spacer" />
        <button className="icon-button" title={`${t("newRecipe")} (N)`} aria-label={t("newRecipe")} onClick={() => openEditor({ initial: blankRecipe() })}>
          <Plus />
        </button>
        <button className="icon-button" title={`${t("search")} (Ctrl+K)`} aria-label={t("search")} onClick={openSearch}>
          <Search />
        </button>
      </div>

      <nav className="sidebar-nav">
        {nav.map(([name, label, icon, n]) => (
          <button key={name} className={`sidebar-row${list === name && !filterActive ? " active" : ""}`} onClick={() => navigate({ name })}>
            {icon}
            <span className="row-label">{t(label)}</span>
            <span className="row-meta">{recipes ? n : ""}</span>
          </button>
        ))}
        <button className={`sidebar-row${route.name === "shared" ? " active" : ""}`} onClick={() => navigate({ name: "shared" })}>
          <Share />
          <span className="row-label">{t("sharedWithMe")}</span>
          {newShared > 0 ? <span className="row-badge">{newShared}</span> : <span className="row-meta">{shared?.length || ""}</span>}
        </button>
      </nav>

      {/* Only the categories and tags scroll; the header and lists stay put. */}
      <div className="sidebar-scroll">
        {categories.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("categories")}</div>
            {categories.map(([c, n]) => (
              <button
                key={c}
                className={`sidebar-row${list && query.category === c ? " active" : ""}`}
                onClick={() => navigate({ name: list ?? "recipes" }, { category: c })}
                title={c}
              >
                <Utensils />
                <span className="row-label">{c}</span>
                <span className="row-meta">{n}</span>
              </button>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("tags")}</div>
            {tags.map(([tag, n]) => (
              <button
                key={tag}
                className={`sidebar-row${list && query.tag === tag ? " active" : ""}`}
                onClick={() => navigate({ name: list ?? "recipes" }, { tag })}
                title={tag}
              >
                <Tag />
                <span className="row-label">{tag}</span>
                <span className="row-meta">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Drag the right edge to resize; double-click to reset. */
function ResizeHandle() {
  const { update } = useSettings();
  const drag = useRef<{ x: number; w: number; aside: HTMLElement } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const aside = e.currentTarget.parentElement!;
        drag.current = { x: e.clientX, w: aside.getBoundingClientRect().width, aside };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing-sidebar");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) d.aside.style.setProperty("--sidebar-w", `${clamp(d.w + e.clientX - d.x)}px`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        document.documentElement.classList.remove("resizing-sidebar");
        update({ sidebarWidth: clamp(d.w + e.clientX - d.x) });
      }}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_W })}
    />
  );
}
