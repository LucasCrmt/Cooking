// Planning a recipe: which day, which meal, a note (and which recipe, when none is given).
// Also changes or removes an existing plan (plans are private: always your own).

import { useMemo, useState } from "react";
import { api, type Plan } from "../lib/api";
import { useApp } from "../lib/app";
import { isDay, today } from "../lib/dates";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Dialog, Spinner, useToast } from "./common";
import { RecipeImage } from "./recipe-bits";

export const MEALS: [string, StringKey][] = [
  ["", "mealAny"],
  ["breakfast", "mealBreakfast"],
  ["lunch", "mealLunch"],
  ["snack", "mealSnack"],
  ["dinner", "mealDinner"],
];

export const mealKey = (meal: string): StringKey | null => MEALS.find(([m]) => m === meal && m)?.[1] ?? null;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function PlanDialog({
  day,
  recipe,
  plan,
  onClose,
  onSaved,
}: {
  /** The day to start from. */
  day?: string;
  /** The recipe, when planning from its page. */
  recipe?: { id: string; title: string };
  /** An existing plan to change. */
  plan?: Plan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useSettings();
  const { recipes } = useApp();
  const toast = useToast();
  const [recipeId, setRecipeId] = useState(plan?.recipeId ?? recipe?.id ?? "");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(plan?.day ?? day ?? today());
  const [meal, setMeal] = useState(plan?.meal ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plans are private: a plan you can open is yours to change.
  const canChange = true;
  const choosing = !plan && !recipe;

  const matches = useMemo(() => {
    const q = fold(search.trim());
    return (recipes ?? []).filter((r) => !q || fold(`${r.title} ${r.category} ${r.tags.join(" ")}`).includes(q)).slice(0, 8);
  }, [recipes, search]);
  const chosen = (recipes ?? []).find((r) => r.id === recipeId);

  const save = async () => {
    if (!recipeId || !isDay(date)) return;
    setBusy(true);
    setError(null);
    try {
      if (plan) await api(`/app/plans/${plan.id}`, { method: "PATCH", body: { day: date, meal, note } });
      else {
        await api("/app/plans", { body: { recipeId, day: date, meal, note } });
        toast(t("plannedToast"));
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await api(`/app/plans/${plan.id}`, { method: "DELETE" });
      toast(t("planRemoved"));
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={plan ? plan.title : recipe ? t("planThis", { title: recipe.title }) : t("planRecipe")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canChange) void save();
        }}
      >

        {choosing && (
          <div className="field">
            <span>{t("recipe")}</span>
            <input className="text-field" value={search} placeholder={t("filterRecipes")} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <div className="plan-recipes" role="listbox" aria-label={t("recipe")}>
              {matches.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={r.id === recipeId}
                  className={`plan-recipe${r.id === recipeId ? " active" : ""}`}
                  onClick={() => setRecipeId(r.id)}
                >
                  <RecipeImage recipe={r} className="thumb" />
                  <span>{r.title}</span>
                </button>
              ))}
              {matches.length === 0 && <p className="muted small">{t("noRecipeFound")}</p>}
            </div>
            {chosen && !matches.includes(chosen) && <span className="settings-hint">{t("chosenRecipe", { title: chosen.title })}</span>}
          </div>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t("day")}</span>
            <input type="date" className="text-field" value={date} disabled={!canChange} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t("meal")}</span>
            <select value={meal} disabled={!canChange} onChange={(e) => setMeal(e.target.value)}>
              {MEALS.map(([m, label]) => (
                <option key={m} value={m}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{t("planNote")}</span>
          <input className="text-field" value={note} maxLength={300} disabled={!canChange} placeholder={t("planNotePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          {plan && canChange && (
            <button type="button" className="text-button danger" disabled={busy} onClick={() => void remove()}>
              {t("removePlan")}
            </button>
          )}
          <div className="toolbar-spacer" />
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          {canChange && (
            <button className="primary-button" disabled={busy || !recipeId || !isDay(date)}>
              {busy && <Spinner />}
              {plan ? t("save") : t("planIt")}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
