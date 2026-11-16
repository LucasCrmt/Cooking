// The side panel on the right (like Calendar's event panel). It shows one of three things:
// the editor (adding or changing a recipe), the filters (on a list), or a recipe's details.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Recipe, type RecipeFields } from "../lib/api";
import { useApp, type EditorState } from "../lib/app";
import { useApi } from "../lib/hooks";
import { CATEGORIES, CUISINES, counts, sourceLabel, type SortKey } from "../lib/recipes";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { useToast } from "./common";
import { Check, ChevronDown, ImageIcon, Plus, Trash, Upload, X } from "./icons";
import { SourceIcon, SourceList } from "./recipe-bits";

export function RecipePanel() {
  const { editor, route } = useApp();
  if (editor) return <RecipeEditor key={editor.id ?? "new"} state={editor} />;
  return route.name === "recipe" ? <DetailsPanel id={route.id} /> : <FiltersPanel />;
}

function PanelShell({ title, children, actions, wide }: { title: string; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const { t } = useSettings();
  const { togglePanel } = useApp();
  return (
    <aside className={`panel${wide ? " wide" : ""}`}>
      <div className="panel-header">
        <span className="panel-label">{title}</span>
        <div className="toolbar-spacer" />
        {actions}
        <button className="icon-button" aria-label={t("close")} title={`${t("close")} (Esc)`} onClick={togglePanel}>
          <X />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

// --- Filters ---

const SORTS: [SortKey, StringKey][] = [
  ["recent", "sortRecent"],
  ["title", "sortTitle"],
  ["time", "sortTime"],
  ["rating", "sortRating"],
  ["cooked", "sortCooked"],
];
const TIMES = ["15", "30", "45", "60", "120"];

function FiltersPanel() {
  const { t, f } = useSettings();
  const { recipes, query, setQuery } = useApp();
  const all = recipes ?? [];
  const categories = useMemo(() => counts(all, (r) => [r.category]), [all]);
  const cuisines = useMemo(() => counts(all, (r) => [r.cuisine]), [all]);
  const tags = useMemo(() => counts(all, (r) => r.tags), [all]);
  const sources = useMemo(() => counts(all, (r) => [...new Set(r.sources.map(sourceLabel))]), [all]);
  const active = ["category", "cuisine", "tag", "time", "source"].filter((k) => query[k]);

  const options = (key: string, values: [string, number][], label?: (v: string) => string) => (
    <div className="filter-options">
      {values.map(([v, n]) => (
        <button key={v} className={`filter-option${query[key] === v ? " active" : ""}`} onClick={() => setQuery({ [key]: query[key] === v ? undefined : v })}>
          <span className="filter-check">{query[key] === v && <Check size={12} />}</span>
          <span className="filter-name">{label ? label(v) : v}</span>
          {n > 0 && <span className="filter-time">{n}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <PanelShell
      title={t("filters")}
      actions={
        active.length > 0 && (
          <button className="link-button" onClick={() => setQuery(Object.fromEntries(active.map((k) => [k, undefined])))}>
            {t("clearFilters")}
          </button>
        )
      }
    >
      <section className="panel-section">
        <span className="panel-subtitle">{t("sortBy")}</span>
        <select value={query.sort ?? "recent"} onChange={(e) => setQuery({ sort: e.target.value === "recent" ? undefined : e.target.value })}>
          {SORTS.map(([k, label]) => (
            <option key={k} value={k}>
              {t(label)}
            </option>
          ))}
        </select>
      </section>
      <section className="panel-section">
        <span className="panel-subtitle">{t("readyIn")}</span>
        {options(
          "time",
          TIMES.map((m) => [m, 0]),
          (m) => t("underMinutes", { n: f.minutes(Number(m)) }),
        )}
      </section>
      {categories.length > 0 && (
        <section className="panel-section">
          <span className="panel-subtitle">{t("categories")}</span>
          {options("category", categories)}
        </section>
      )}
      {cuisines.length > 0 && (
        <section className="panel-section">
          <span className="panel-subtitle">{t("cuisines")}</span>
          {options("cuisine", cuisines)}
        </section>
      )}
      {sources.length > 0 && (
        <section className="panel-section">
          <span className="panel-subtitle">{t("sources")}</span>
          {options("source", sources)}
        </section>
      )}
      {tags.length > 0 && (
        <section className="panel-section">
          <span className="panel-subtitle">{t("tags")}</span>
          {options("tag", tags)}
        </section>
      )}
    </PanelShell>
  );
}

// --- Details ---

function DetailsPanel({ id }: { id: string }) {
  const { t, f } = useSettings();
  const r = useApi<Recipe>(`/app/recipes/${id}`).data;
  const row = (label: StringKey, value: ReactNode) =>
    value ? (
      <div className="detail-row">
        <span className="muted">{t(label)}</span>
        <span>{value}</span>
      </div>
    ) : null;
  return (
    <PanelShell title={t("details")}>
      {!r ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <section className="panel-section details">
          {row("category", r.category)}
          {row("cuisine", r.cuisine)}
          {row("prep", r.prepMinutes ? f.minutes(r.prepMinutes) : null)}
          {row("cook", r.cookMinutes ? f.minutes(r.cookMinutes) : null)}
          {row("total", r.totalMinutes ? f.minutes(r.totalMinutes) : null)}
          {row("servings", r.servings ? `${r.servings} ${r.servingsLabel}` : null)}
          {r.sources.length > 0 && row("sources", <SourceList sources={r.sources} />)}
          {row("author", r.author)}
          {row("addedByLabel", r.addedBy)}
          {row("created", f.mediumDateTime(r.createdAt))}
          {row("updated", r.updatedAt !== r.createdAt ? f.mediumDateTime(r.updatedAt) : null)}
          {row("cookedLabel", r.cookedCount ? t("cookedTimes", { n: r.cookedCount }) : null)}
        </section>
      )}
    </PanelShell>
  );
}

// --- Editor ---

const toText = (lines: string[]) => lines.join("\n");
const toLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const toInt = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))) || null);

/** Phone photos are huge: scale to 1600 px on the long side, as JPEG. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** The presets in their order, then the cookbook's own values (most used first) that aren't presets. */
const withPresets = (presets: string[], used: [string, number][]) => [...presets, ...used.map(([v]) => v).filter((v) => !presets.some((p) => p.toLowerCase() === v.toLowerCase()))];

/** A dropdown of `options`, with "None" and "Other…" (a text field, for anything not listed). */
function ChoiceSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  const { t } = useSettings();
  const listed = !value || options.includes(value);
  const [custom, setCustom] = useState(!listed);
  if (custom) {
    return (
      <span className="choice-custom">
        <input className="text-field" value={value} maxLength={60} placeholder={t("otherPlaceholder")} onChange={(e) => onChange(e.target.value)} autoFocus={listed} />
        <button
          type="button"
          className="icon-button small"
          title={t("backToList")}
          aria-label={t("backToList")}
          onClick={() => {
            setCustom(false);
            if (!options.includes(value)) onChange("");
          }}
        >
          <ChevronDown size={14} />
        </button>
      </span>
    );
  }
  return (
    <select
      className="choice-select"
      value={value}
      onChange={(e) => {
        if (e.target.value === "\u0000other") {
          setCustom(true);
          onChange("");
        } else onChange(e.target.value);
      }}
    >
      <option value="">{t("noneChoice")}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={"\u0000other"}>{t("otherChoice")}</option>
    </select>
  );
}

function RecipeEditor({ state }: { state: EditorState }) {
  const { t, lang } = useSettings();
  const { closeEditor, reloadRecipes, navigate, recipes } = useApp();
  const toast = useToast();
  const init = state.initial;
  const [form, setForm] = useState({
    title: init.title,
    description: init.description,
    category: init.category,
    cuisine: init.cuisine,
    tags: init.tags.join(", "),
    servings: init.servings?.toString() ?? "",
    servingsLabel: init.servingsLabel,
    prepMinutes: init.prepMinutes?.toString() ?? "",
    cookMinutes: init.cookMinutes?.toString() ?? "",
    totalMinutes: init.totalMinutes?.toString() ?? "",
    ingredients: toText(init.ingredients),
    steps: toText(init.steps),
    notes: init.notes,
  });
  // The photo: keep it, copy an imported one, use an upload, or remove it.
  const [photo, setPhoto] = useState<{ kind: "keep" | "remote" | "upload" | "none"; src: string | null }>(
    state.imageUrl ? { kind: "remote", src: state.imageUrl } : state.currentImage ? { kind: "keep", src: state.currentImage } : { kind: "none", src: null },
  );
  // Sources: each a link and/or a name ("Le carnet de mamie"); the kind is worked out by the server.
  const [sources, setSources] = useState(init.sources.map((x) => ({ url: x.url ?? "", name: x.name, kind: x.kind })));
  const setSource = (i: number, patch: Partial<(typeof sources)[number]>) => setSources((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  // The usual choices, then whatever the cookbook already uses (imports bring their own words).
  const categories = useMemo(() => withPresets(CATEGORIES[lang], counts(recipes ?? [], (r) => [r.category])), [recipes, lang]);
  const cuisines = useMemo(() => withPresets(CUISINES[lang], counts(recipes ?? [], (r) => [r.cuisine])), [recipes, lang]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const prep = toInt(form.prepMinutes);
    const cook = toInt(form.cookMinutes);
    const fields: RecipeFields = {
      title: form.title,
      description: form.description,
      category: form.category,
      cuisine: form.cuisine,
      tags: form.tags
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean),
      servings: toInt(form.servings),
      servingsLabel: form.servingsLabel,
      prepMinutes: prep,
      cookMinutes: cook,
      totalMinutes: toInt(form.totalMinutes) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
      ingredients: toLines(form.ingredients),
      steps: toLines(form.steps),
      notes: form.notes,
      sources: sources.filter((x) => x.url.trim() || x.name.trim()).map((x) => ({ url: x.url.trim() || null, name: x.name.trim(), kind: x.kind })),
      author: init.author,
    };
    const image =
      photo.kind === "remote"
        ? { imageUrl: photo.src }
        : photo.kind === "upload"
          ? { imageData: photo.src }
          : photo.kind === "none" && state.currentImage
            ? { removeImage: true }
            : {};
    try {
      const res = state.id
        ? await api<{ id: string; warning?: string }>(`/app/recipes/${state.id}`, { method: "PUT", body: { ...fields, ...image } })
        : await api<{ id: string; warning?: string }>("/app/recipes", { body: { ...fields, ...image } });
      reloadRecipes();
      closeEditor();
      toast(res.warning ?? t(state.id ? "saved" : "recipeAdded"), res.warning ? "error" : "info");
      if (!state.id) navigate({ name: "recipe", id: res.id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const field = (label: StringKey, input: ReactNode, hint?: string) => (
    <label className="field">
      <span>{t(label)}</span>
      {input}
      {hint && <span className="settings-hint">{hint}</span>}
    </label>
  );

  return (
    <PanelShell
      wide
      title={state.id ? t("editRecipe") : t("newRecipe")}
      actions={
        <button className="primary-button" disabled={busy || !form.title.trim()} onClick={() => void save()}>
          {t("save")}
        </button>
      }
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
      >
        {field("title", <input className="text-field" value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} autoFocus={!state.id} required />)}

        <div className="field">
          <span>{t("photo")}</span>
          <div className="photo-field">
            {photo.kind === "keep" || photo.kind === "upload" ? (
              <img src={photo.src!} alt="" />
            ) : photo.kind === "remote" ? (
              <div className="photo-remote muted small">
                <ImageIcon size={18} />
                {t("photoFrom", { host: hostOf(photo.src!) })}
              </div>
            ) : (
              <div className="photo-remote muted small">
                <ImageIcon size={18} />
                {t("noPhoto")}
              </div>
            )}
            <div className="photo-actions">
              <button type="button" className="text-button" onClick={() => file.current?.click()}>
                <Upload size={14} />
                {t("choosePhoto")}
              </button>
              {photo.kind !== "none" && (
                <button type="button" className="icon-button small" aria-label={t("removePhoto")} title={t("removePhoto")} onClick={() => setPhoto({ kind: "none", src: null })}>
                  <Trash size={14} />
                </button>
              )}
            </div>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setPhoto({ kind: "upload", src: await downscale(f) });
                } catch {
                  toast(t("photoUnreadable"), "error");
                }
              }}
            />
          </div>
        </div>

        {field("description", <textarea className="text-field" rows={2} value={form.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />)}

        <div className="field-row">
          {field("category", <ChoiceSelect value={form.category} options={categories} onChange={(category) => set({ category })} />)}
          {field("cuisine", <ChoiceSelect value={form.cuisine} options={cuisines} onChange={(cuisine) => set({ cuisine })} />)}
        </div>

        {field("tags", <input className="text-field" value={form.tags} placeholder={t("tagsPlaceholder")} onChange={(e) => set({ tags: e.target.value })} />)}

        <div className="field-row">
          {field("servings", <input className="text-field" type="number" min={1} max={100} value={form.servings} onChange={(e) => set({ servings: e.target.value })} />)}
          {field("servingsUnit", <input className="text-field" value={form.servingsLabel} placeholder={t("servingsUnitPlaceholder")} maxLength={40} onChange={(e) => set({ servingsLabel: e.target.value })} />)}
        </div>
        <div className="field-row three">
          {field("prepMin", <input className="text-field" type="number" min={0} value={form.prepMinutes} onChange={(e) => set({ prepMinutes: e.target.value })} />)}
          {field("cookMin", <input className="text-field" type="number" min={0} value={form.cookMinutes} onChange={(e) => set({ cookMinutes: e.target.value })} />)}
          {field("totalMin", <input className="text-field" type="number" min={0} value={form.totalMinutes} placeholder={String((toInt(form.prepMinutes) ?? 0) + (toInt(form.cookMinutes) ?? 0) || "")} onChange={(e) => set({ totalMinutes: e.target.value })} />)}
        </div>

        {field("ingredients", <textarea className="text-field mono" rows={8} value={form.ingredients} placeholder={t("ingredientsPlaceholder")} onChange={(e) => set({ ingredients: e.target.value })} />, t("ingredientsHint"))}
        {field("steps", <textarea className="text-field" rows={10} value={form.steps} placeholder={t("stepsPlaceholder")} onChange={(e) => set({ steps: e.target.value })} />, t("stepsHint"))}
        {field("notes", <textarea className="text-field" rows={3} value={form.notes} maxLength={5000} onChange={(e) => set({ notes: e.target.value })} />)}

        <div className="field">
          <span>{t("sources")}</span>
          {sources.map((x, i) => (
            <div key={i} className="source-edit">
              <SourceIcon kind={x.url ? x.kind : "other"} />
              <input className="text-field" type="url" value={x.url} placeholder="https://" aria-label={t("sourceLink")} onChange={(e) => setSource(i, { url: e.target.value, kind: "web" })} />
              <input className="text-field" value={x.name} placeholder={t("sourceNamePlaceholder")} aria-label={t("sourceName")} maxLength={100} onChange={(e) => setSource(i, { name: e.target.value })} />
              <button type="button" className="icon-button small" aria-label={t("removeSource")} title={t("removeSource")} onClick={() => setSources(sources.filter((_, j) => j !== i))}>
                <Trash size={14} />
              </button>
            </div>
          ))}
          {sources.length < 12 && (
            <button type="button" className="link-button small add-source" onClick={() => setSources([...sources, { url: "", name: "", kind: "web" }])}>
              <Plus size={13} />
              {t("addSource")}
            </button>
          )}
          <span className="settings-hint">{t("sourcesHint")}</span>
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={closeEditor}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy || !form.title.trim()}>
            {t("save")}
          </button>
        </div>
      </form>
    </PanelShell>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
