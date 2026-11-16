// Small pieces shared by the recipe pages: photo (or its placeholder), stars, times.

import { useState, type CSSProperties } from "react";
import { imageSrc } from "../lib/api";
import { hueOf } from "../lib/recipes";
import { useSettings } from "../lib/settings";
import type { Source } from "../lib/api";
import { BookOpen, ChefHat, Instagram, LinkIcon, Star, Video, Youtube } from "./icons";

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
  const { t } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  if (!onRate) {
    if (!value) return null;
    return (
      <span className="stars" title={t("ratingOf", { n: value })}>
        <Star size={size} filled />
        <span>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
      </span>
    );
  }
  return (
    <span className="stars picker-stars" role="radiogroup" aria-label={t("yourRating")} onPointerLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={n <= shown ? "on" : ""}
          title={t("ratingOf", { n })}
          onPointerEnter={() => setHover(n)}
          onClick={() => onRate(value === n ? null : n)}
        >
          <Star size={size} filled={n <= shown} />
        </button>
      ))}
    </span>
  );
}
