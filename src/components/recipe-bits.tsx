// Small pieces shared by the recipe pages: photo (or its placeholder), stars, times.

import { useState, type CSSProperties } from "react";
import { imageSrc } from "../lib/api";
import { hueOf } from "../lib/recipes";
import { equipmentName, equipmentOrder } from "../lib/equipment";
import { dietName, dietOrder } from "../lib/diets";
import { useSettings } from "../lib/settings";
import type { Source } from "../lib/api";
import { BookOpen, ChefHat, Instagram, LinkIcon, Star, Utensils, Video, Youtube } from "./icons";

/** The icon of a source: Instagram, YouTube, any other video, a web page, or a book/notebook. */
export function SourceIcon({ kind, size = 14 }: { kind: Source["kind"]; size?: number }) {
  if (kind === "instagram") return <Instagram size={size} />;
  if (kind === "youtube") return <Youtube size={size} />;
  if (kind === "tiktok" || kind === "facebook") return <Video size={size} />;
  if (kind === "other") return <BookOpen size={size} />;
  return <LinkIcon size={size} />;
}

/** Every source of a recipe: links open in a new tab; a source without an address is just its name. */
export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ul className="source-list">
      {sources.map((s, i) => (
        <li key={i}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer noopener" className={`source-chip ${s.kind}`} title={s.url}>
              <SourceIcon kind={s.kind} />
              <span>{s.name || new URL(s.url).hostname}</span>
            </a>
          ) : (
            <span className={`source-chip ${s.kind}`}>
              <SourceIcon kind={s.kind} />
              <span>{s.name}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The recipe's photo, or a warm tint with a hat when it has none (or it fails to load). */
export function RecipeImage({
  recipe,
  className = "",
  src,
}: {
  recipe: { id: string; title: string; hasImage: boolean; imageVersion: number };
  className?: string;
  /** Where the photo is, if not at the signed-in address (the public page). */
  src?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (recipe.hasImage && !failed) {
    return <img className={`recipe-image ${className}`} src={src ?? imageSrc(recipe)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <div className={`recipe-image placeholder ${className}`} style={{ "--hue": hueOf(recipe.title) } as CSSProperties} aria-hidden="true">
      <ChefHat size={28} />
    </div>
  );
}

/** Read-only stars, or a picker when `onRate` is given (click the current value again to clear it). */
export function Stars({ value, onRate, size = 14 }: { value: number | null; onRate?: (stars: number | null) => void; size?: number }) {
  const { t, f } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  if (!onRate) {
    if (!value) return null;
    return (
      <span className="stars" title={t("ratingOf", { n: f.decimal(value) })}>
        <Star size={size} filled />
        <span>{f.decimal(value)}</span>
      </span>
    );
  }
  /** The left half of a star is a half point: 3.5 is three stars and the left of the fourth. */
  const at = (e: { clientX: number; currentTarget: HTMLElement }, n: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX - box.left < box.width / 2 ? n - 0.5 : n;
  };
  const rate = (v: number) => onRate(value === v ? null : v);
  return (
    <span
      className="stars picker-stars"
      role="slider"
      tabIndex={0}
      aria-label={t("yourRating")}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value ?? 0}
      aria-valuetext={value ? t("ratingOf", { n: f.decimal(value) }) : t("notRated")}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.5 : 0;
        if (!step) return;
        e.preventDefault();
        const next = Math.min(5, Math.max(0, (value ?? 0) + step));
        onRate(next || null);
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = shown >= n ? "full" : shown >= n - 0.5 ? "half" : "";
        return (
          <button
            key={n}
            type="button"
            tabIndex={-1}
            className={fill ? "on" : ""}
            title={t("ratingOf", { n: f.decimal(hover !== null && Math.ceil(hover) === n ? hover : n) })}
            onPointerMove={(e) => setHover(at(e, n))}
            onClick={(e) => rate(at(e, n))}
          >
            <span className={`star-fill ${fill}`}>
              <Star size={size} />
              <span className="star-fill-on">
                <Star size={size} filled />
              </span>
            </span>
          </button>
        );
      })}
      {value !== null && <span className="star-value tabular">{f.decimal(value)}</span>}
    </span>
  );
}

/** What a recipe needs ("Four · Mixeur"): chips that filter the cookbook when `onPick` is given. */
export function EquipmentList({ keys, onPick }: { keys: string[]; onPick?: (key: string) => void }) {
  const { t, lang } = useSettings();
  const sorted = [...keys].sort((a, b) => equipmentOrder(a) - equipmentOrder(b));
  return (
    <div className="equipment-list" aria-label={t("equipment")}>
      <Utensils size={14} />
      {sorted.map((key) =>
        onPick ? (
          <button key={key} className="equipment-chip" title={t("recipesNeeding", { name: equipmentName(key, lang) })} onClick={() => onPick(key)}>
            {equipmentName(key, lang)}
          </button>
        ) : (
          <span key={key} className="equipment-chip">
            {equipmentName(key, lang)}
          </span>
        ),
      )}
    </div>
  );
}

/** The diets a recipe suits ("Végétarien", "Sans gluten"): labels that filter the cookbook when `onPick` is given. */
export function DietLabels({ keys, onPick, small }: { keys: string[]; onPick?: (key: string) => void; small?: boolean }) {
  const { t, lang } = useSettings();
  if (!keys.length) return null;
  const sorted = [...keys].sort((a, b) => dietOrder(a) - dietOrder(b));
  return (
    <span className={`diet-labels${small ? " small" : ""}`} aria-label={t("diets")}>
      {sorted.map((key) =>
        onPick ? (
          <button key={key} type="button" className={`diet-label ${key}`} title={t("recipesThatAre", { name: dietName(key, lang) })} onClick={() => onPick(key)}>
            {dietName(key, lang)}
          </button>
        ) : (
          <span key={key} className={`diet-label ${key}`}>
            {dietName(key, lang)}
          </span>
        ),
      )}
    </span>
  );
}
