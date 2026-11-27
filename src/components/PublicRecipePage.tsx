// A recipe opened from its public link (/s/<token>): read-only, no account, no app around it.
// Servings still rescale the quantities and the checklists still work: it's for cooking.

import { useEffect, useState } from "react";
import { api, type PublicRecipe } from "../lib/api";
import { headingText, isHeading, totalOf } from "../lib/recipes";
import { useSettings } from "../lib/settings";
import { ChefHat, Clock, Minus, Plus, Users } from "./icons";
import { DietLabels, EquipmentList, RecipeImage, SourceList } from "./recipe-bits";
import { Ingredient, StepList, toggle } from "./RecipePage";

export function PublicRecipePage({ token }: { token: string }) {
  const { t, f, settings } = useSettings();
  const [r, setR] = useState<PublicRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());

  useEffect(() => {
    api<PublicRecipe>(`/public/recipes/${encodeURIComponent(token)}`).then(
      (recipe) => {
        setR(recipe);
        setServings(recipe.servings);
        document.title = `${recipe.title} · Cooking`;
      },
      (e) => setError((e as Error).message),
    );
  }, [token]);

  if (error) {
    return (
      <div className="public-page">
        <div className="empty-state">
          <ChefHat size={32} />
          <p className="muted">{t("linkGone")}</p>
          <a className="text-button" href="/">
            {t("openCooking")}
          </a>
        </div>
      </div>
    );
  }
  if (!r) return <div className="splash" />;

  const factor = r.servings && servings ? servings / r.servings : 1;
  const total = totalOf(r);
  const image = `/api/public/recipes/${encodeURIComponent(token)}/image?v=${r.imageVersion}`;

  return (
    <div className="public-page">
      <div className="page recipe-page">
        <header className="recipe-hero">
          <RecipeImage recipe={{ id: token, title: r.title, hasImage: r.hasImage, imageVersion: r.imageVersion }} src={image} className="hero" />
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
            </div>
            <DietLabels keys={r.diets ?? []} />
            {r.equipment.length > 0 && <EquipmentList keys={r.equipment} />}
            {r.tags.length > 0 && (
              <div className="tag-list">
                {r.tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {r.sources.length > 0 && (
              <div className="recipe-sources">
                <SourceList sources={r.sources} />
              </div>
            )}
          </div>
        </header>

        <div className="recipe-body">
          <section className="recipe-ingredients">
            <h2>{t("ingredients")}</h2>
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
                    <Ingredient key={i} line={line} factor={factor} checked={checked.has(i)} checkable={settings.checklists} onToggle={() => setChecked(toggle(checked, i))} />
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
          <span>{t("sharedFromCooking")}</span>
        </footer>
      </div>
    </div>
  );
}
