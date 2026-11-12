// One recipe, laid out for cooking: photo and facts on top, then ingredients (scaled to the
// servings you pick, ticked off as you go) beside the steps. The screen stays on while it's open.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, imageSrc, type Recipe } from "../lib/api";
import { useApp } from "../lib/app";
import { useApi } from "../lib/hooks";
import { headingText, isHeading, scaleIngredient, totalOf } from "../lib/recipes";
import { useSettings } from "../lib/settings";
import { ConfirmDialog, Dialog, useToast } from "./common";
import { Dropdown as Floating } from "./pickers";
import { CircleCheck, Clock, ExternalLink, Flame, Minus, MoreHorizontal, Pencil, Plus, Printer, Trash, Users } from "./icons";
import { FavoriteButton } from "./RecipesPage";
import { RecipeImage, SourceIcon, SourceList, Stars } from "./recipe-bits";
import { Toolbar } from "./Toolbar";

export function RecipePage({ id }: { id: string }) {
  const { t, f, settings } = useSettings();
  const { navigate, openEditor, reloadRecipes } = useApp();
  const toast = useToast();
  const req = useApi<Recipe>(`/app/recipes/${id}`);
  const r = req.data;
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [addingSource, setAddingSource] = useState(false);

  // The editor (side panel) and the list's buttons announce changes.
  useEffect(() => {
    const onChange = () => req.reload();
    window.addEventListener("cooking:changed", onChange);
    return () => window.removeEventListener("cooking:changed", onChange);
  }, [req.reload]);

  useEffect(() => {
    if (r && servings === null) setServings(r.servings);
  }, [r, servings]);

  useWakeLock(settings.keepAwake && !!r);

  const edit = () =>
    r?.canEdit &&
    openEditor({
      id: r.id,
      initial: {
        title: r.title,
        description: r.description,
        category: r.category,
        cuisine: r.cuisine,
        tags: r.tags,
        servings: r.servings,
        servingsLabel: r.servingsLabel,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        totalMinutes: r.totalMinutes,
        ingredients: r.ingredients,
        steps: r.steps,
        notes: r.notes,
        sources: r.sources,
        author: r.author,
      },
      currentImage: r.hasImage ? imageSrc(r) : null,
    });

  const act = async (path: string, method: string, body: unknown, message?: string) => {
    try {
      await api(`/app/recipes/${id}${path}`, { method, body });
      reloadRecipes();
      if (message) toast(message);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  // E edits, F (un)favourites, C marks it cooked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !r) return;
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".dialog-backdrop, .picker, .settings-modal")) return;
      const k = e.key.toLowerCase();
      if (k === "e" && r.canEdit) edit();
      else if (k === "f") void act("/favorite", "PUT", { on: !r.favorite });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (req.error && !r) {
    return (
      <>
        <Toolbar title={t("recipes")} />
        <div className="content">
          <div className="page">
            <div className="empty-state">
              <p className="muted">{req.error}</p>
              <button className="text-button" onClick={() => navigate({ name: "recipes" })}>
                {t("backToRecipes")}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const factor = r?.servings && servings ? servings / r.servings : 1;
  const total = r ? totalOf(r) : null;

  return (
    <>
      <Toolbar
        loading={req.loading && !r}
        title={
          <>
            <button className="crumb" onClick={() => navigate({ name: "recipes" })}>
              {t("recipes")}
            </button>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{r?.title ?? ""}</span>
          </>
        }
      >
        {r && (
          <>
            <FavoriteButton recipe={r} />
            {r.canEdit && (
              <button className="text-button" title={`${t("edit")} (E)`} onClick={edit}>
                <Pencil size={14} />
                <span className="hide-mobile">{t("edit")}</span>
              </button>
            )}
            <MoreMenu recipe={r} onDelete={() => setDeleting(true)} />
          </>
        )}
      </Toolbar>
      <div className="content">
        {!r ? (
          <div className="page">
            <div className="skeleton" style={{ height: 320 }} />
          </div>
        ) : (
          <div className="page recipe-page">
            <header className="recipe-hero">
              <RecipeImage recipe={r} className="hero" />
              <div className="recipe-hero-text">
                {(r.category || r.cuisine) && <div className="recipe-kicker">{[r.category, r.cuisine].filter(Boolean).join(" · ")}</div>}
                <h1>{r.title}</h1>
                {r.description && <p className="recipe-description">{r.description}</p>}
                <div className="recipe-facts">
                  {total !== null && (
                    <span className="fact">
                      <Clock size={15} />
                      <span>
                        <b>{f.minutes(total)}</b>
                        {(r.prepMinutes || r.cookMinutes) && (
                          <span className="muted small">
                            {[r.prepMinutes && `${t("prep")} ${f.minutes(r.prepMinutes)}`, r.cookMinutes && `${t("cook")} ${f.minutes(r.cookMinutes)}`].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
                  )}
                  {r.servings && servings && (
                    <span className="fact">
                      <Users size={15} />
                      <span className="servings">
                        <button className="icon-button small" aria-label={t("fewer")} disabled={servings <= 1} onClick={() => setServings(servings - 1)}>
                          <Minus size={14} />
                        </button>
                        <b className="tabular">{servings}</b>
                        <button className="icon-button small" aria-label={t("more")} disabled={servings >= 100} onClick={() => setServings(servings + 1)}>
                          <Plus size={14} />
                        </button>
                        <span className="muted small">{r.servingsLabel || t("servings")}</span>
                      </span>
                    </span>
                  )}
                  {r.cookedCount > 0 && (
                    <span className="fact">
                      <Flame size={15} />
                      <span className="muted small">
                        {t("cookedTimes", { n: r.cookedCount })}
                        {r.lastCookedAt && ` · ${t("lastTime", { when: f.relative(r.lastCookedAt, t) })}`}
                      </span>
                    </span>
                  )}
                </div>
                <div className="recipe-actions">
                  <Stars value={r.myRating} size={18} onRate={(stars) => void act("/rating", "PUT", { stars })} />
                  {r.ratingCount > 1 && r.rating && <span className="muted small">{t("averageOf", { avg: f.decimal(r.rating), n: r.ratingCount })}</span>}
                  <div className="toolbar-spacer" />
                  <button className="text-button" onClick={() => void act("/cooked", "POST", {}, t("cookedSaved"))}>
                    <CircleCheck size={15} />
                    {t("iCookedIt")}
                  </button>
                </div>
                {r.tags.length > 0 && (
                  <div className="tag-list">
                    {r.tags.map((tag) => (
                      <button key={tag} className="tag" onClick={() => navigate({ name: "recipes" }, { tag })}>
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
                {(r.sources.length > 0 || r.canEdit) && (
                  <div className="recipe-sources">
                    <SourceList sources={r.sources} />
                    {r.canEdit && (
                      <button className="link-button small" onClick={() => setAddingSource(true)}>
                        <Plus size={13} />
                        {t("addSource")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </header>

            <div className="recipe-body">
              <section className="recipe-ingredients">
                <h2>
                  {t("ingredients")}
                  {factor !== 1 && (
                    <button className="link-button small" onClick={() => setServings(r.servings)}>
                      {t("resetServings")}
                    </button>
                  )}
                </h2>
                {r.ingredients.length === 0 ? (
                  <p className="muted small">{t("noIngredients")}</p>
                ) : (
                  <ul className="ingredient-list">
                    {r.ingredients.map((line, i) =>
                      isHeading(line) ? (
                        <li key={i} className="list-heading">
                          {headingText(line)}
                        </li>
                      ) : (
                        <Ingredient
                          key={i}
                          line={line}
                          factor={factor}
                          checked={checked.has(i)}
                          checkable={settings.checklists}
                          onToggle={() => setChecked(toggle(checked, i))}
                        />
                      ),
                    )}
                  </ul>
                )}
              </section>

              <section className="recipe-steps">
                <h2>{t("steps")}</h2>
                {r.steps.length === 0 ? (
                  <p className="muted small">{t("noSteps")}</p>
                ) : (
                  <StepList steps={r.steps} done={done} checkable={settings.checklists} onToggle={(i) => setDone(toggle(done, i))} />
                )}
                {r.notes && (
                  <div className="recipe-notes">
                    <h3>{t("notes")}</h3>
                    <p>{r.notes}</p>
                  </div>
                )}
              </section>
            </div>

            <footer className="recipe-footer muted small">
              {r.author && <span>{t("byAuthor", { name: r.author })}</span>}
              <span>
                {r.addedBy ? t("addedBy", { name: r.addedBy, when: f.relative(r.createdAt, t) }) : t("addedOn", { when: f.relative(r.createdAt, t) })}
              </span>
            </footer>
          </div>
        )}
      </div>
      {addingSource && r && <AddSourceDialog id={r.id} onClose={() => setAddingSource(false)} />}
      {deleting && r && (
        <ConfirmDialog
          title={t("deleteRecipe")}
          text={t("deleteRecipeConfirm", { title: r.title })}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/recipes/${r.id}`, { method: "DELETE" });
            reloadRecipes();
            toast(t("recipeDeleted"));
            navigate({ name: "recipes" });
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

const toggle = (s: Set<number>, i: number) => {
  const next = new Set(s);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  return next;
};

function Ingredient({ line, factor, checked, checkable, onToggle }: { line: string; factor: number; checked: boolean; checkable: boolean; onToggle: () => void }) {
  const { f } = useSettings();
  const { quantity, rest } = useMemo(() => scaleIngredient(line, factor, f.locale), [line, factor, f.locale]);
  const text = (
    <span className="ingredient-text">
      {quantity && <b className={factor !== 1 ? "scaled" : ""}>{quantity}</b>}
      {rest}
    </span>
  );
  if (!checkable) return <li className="ingredient">{text}</li>;
  return (
    <li className={`ingredient${checked ? " checked" : ""}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {text}
      </label>
    </li>
  );
}

/** Numbered steps; "#" lines are section headings and restart nothing (the numbering runs on). */
function StepList({ steps, done, checkable, onToggle }: { steps: string[]; done: Set<number>; checkable: boolean; onToggle: (i: number) => void }) {
  let n = 0;
  // The first step not done yet is the one you're on.
  const current = checkable ? steps.findIndex((s, i) => !isHeading(s) && !done.has(i)) : -1;
  return (
    <ol className="step-list">
      {steps.map((s, i) => {
        if (isHeading(s)) {
          return (
            <li key={i} className="list-heading">
              {headingText(s)}
            </li>
          );
        }
        n++;
        return (
          <li
            key={i}
            className={`step${done.has(i) ? " done" : ""}${i === current && done.size > 0 ? " current" : ""}${checkable ? " checkable" : ""}`}
            onClick={checkable ? () => !window.getSelection()?.toString() && onToggle(i) : undefined}
          >
            <span className="step-number">{n}</span>
            <p>{s}</p>
          </li>
        );
      })}
    </ol>
  );
}

function MoreMenu({ recipe: r, onDelete }: { recipe: Recipe; onDelete: () => void }) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="menu-anchor">
      <button ref={anchor} className="icon-button" aria-label={t("more")} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <MoreHorizontal />
      </button>
      {open && (
        <Floating anchor={anchor} onClose={() => setOpen(false)} className="menu-floating">
          <div className="menu" role="menu">
            {r.sources
              .filter((s) => s.url)
              .map((s, i) => (
                <a key={i} className="menu-link" href={s.url!} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}>
                  {i === 0 ? <ExternalLink size={14} /> : <SourceIcon kind={s.kind} />}
                  <span>{t("openSourceNamed", { name: s.name })}</span>
                </a>
              ))}
            <button
              onClick={() => {
                setOpen(false);
                window.print();
              }}
            >
              <Printer size={14} />
              <span>{t("print")}</span>
            </button>
            {r.canEdit && (
              <>
                <div className="menu-separator" />
                <button
                  className="danger"
                  onClick={() => {
                    setOpen(false);
                    onDelete();
                  }}
                >
                  <Trash size={14} />
                  <span>{t("deleteRecipe")}</span>
                </button>
              </>
            )}
          </div>
        </Floating>
      )}
    </div>
  );
}

/** Keeps the screen on while `on` (and the page is visible): no unlocking with floury hands. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => {
          if (active) lock = l;
          else void l.release();
        },
        () => {},
      );
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, [on]);
}

/** Adds where else this recipe lives: the video, a book, a friend's message. */
function AddSourceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useSettings();
  const { reloadRecipes } = useApp();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={t("addSource")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/app/recipes/" + id + "/sources", { body: { url, name } });
            reloadRecipes();
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="dialog-text">{t("addSourceHint")}</p>
        <label className="field">
          {t("sourceLink")}
          <input className="text-field" type="url" placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
        </label>
        <label className="field">
          {t("sourceName")}
          <input className="text-field" placeholder={t("sourceNamePlaceholder")} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy || (!url.trim() && !name.trim())}>
            {t("add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
