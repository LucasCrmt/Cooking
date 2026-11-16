// Getting a recipe in: from a link (a recipe site reads its schema.org data; a YouTube video its
// description) or from text (an Instagram or TikTok caption, a message from a friend), which the
// server splits into ingredients and steps. Either way you get a draft to save as is or check first.

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ImportResult } from "../lib/api";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { recipeTemplate, aiPrompt } from "../lib/template";
import { Dialog, Spinner, useToast } from "./common";
import { Clock, Copy, Download, FileText, ImageIcon, Info, LinkIcon, Users } from "./icons";
import { SourceIcon } from "./recipe-bits";

type Mode = "link" | "text";

const hostOf = (address: string) => {
  try {
    return new URL(/^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`).hostname.replace(/^www\./, "");
  } catch {
    return address;
  }
};

export function ImportDialog({ initialUrl, initialText, initialLd, onClose }: { initialUrl: string; initialText?: string; initialLd?: string; onClose: () => void }) {
  const { t, f, lang } = useSettings();
  const { navigate, openEditor, reloadRecipes } = useApp();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(initialText ? "text" : "link");
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when a social network kept the caption to itself: the text box explains what to do.
  const [needsText, setNeedsText] = useState<string | null>(null);
  const started = useRef(false);

  const read = async (m: Mode = mode, address = url, body = text, ld?: string) => {
    if (m === "link" ? !address.trim() : !body.trim()) return;
    setBusy("read");
    setError(null);
    setResult(null);
    try {
      const payload = ld ? { url: address.trim(), ld } : m === "link" ? { url: address.trim() } : { url: address.trim() || undefined, text: body };
      setResult(await api<ImportResult>("/app/import", { body: payload }));
    } catch (e) {
      // The site keeps the recipe from the server: ask for the text (or the bookmarklet) instead.
      if (e instanceof ApiError && (e.code === "needs_text" || e.code === "blocked")) {
        setMode("text");
        setNeedsText(e.code === "blocked" ? t("blockedHint", { site: hostOf(address) }) : t("needsTextHint"));
      } else setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Opened with an address or text (pasted on the page, or from the bookmarklet): read it straight away.
  useEffect(() => {
    if ((initialUrl || initialText) && !started.current) {
      started.current = true;
      // The bookmarklet's recipe data wins: it's the page as you see it.
      void read(initialText && !initialLd ? "text" : "link", initialUrl, initialText ?? "", initialLd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveNow = async () => {
    if (!result) return;
    setBusy("save");
    try {
      const { imageUrl, ...fields } = result.draft;
      const res = await api<{ id: string; warning?: string }>("/app/recipes", { body: { ...fields, imageUrl } });
      reloadRecipes();
      toast(res.warning ?? t("recipeImported"), res.warning ? "error" : "info");
      onClose();
      navigate({ name: "recipe", id: res.id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const review = () => {
    if (!result) return;
    const { imageUrl, ...fields } = result.draft;
    onClose();
    openEditor({ initial: fields, imageUrl });
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setResult(null);
    setError(null);
  };

  const d = result?.draft;
  const canRead = mode === "link" ? !!url.trim() : !!text.trim();
  return (
    <Dialog title={t("importRecipe")} onClose={onClose} wide>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (result && !busy) void saveNow();
          else void read();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (result) void saveNow();
            else void read();
          }
        }}
      >
        <div className="segmented import-modes" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "link"} className={mode === "link" ? "active" : ""} onClick={() => switchTo("link")}>
            <LinkIcon size={13} />
            {t("fromLink")}
          </button>
          <button type="button" role="tab" aria-selected={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => switchTo("text")}>
            <FileText size={13} />
            {t("fromText")}
          </button>
        </div>

        {mode === "link" ? (
          <>
            <p className="dialog-text">{t("importHint")}</p>
            <input
              className="text-field"
              type="url"
              inputMode="url"
              placeholder="https://www.marmiton.org/recettes/…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setResult(null);
              }}
              autoFocus
            />
          </>
        ) : (
          <>
            {needsText ? (
              <p className="notice small">
                <Info size={14} />
                <span>{needsText}</span>
              </p>
            ) : (
              <p className="dialog-text">{t("importTextHint")}</p>
            )}
            <div className="import-template">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setText(recipeTemplate(lang));
                  setResult(null);
                }}
              >
                <FileText size={13} />
                {t("useTemplate")}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  void navigator.clipboard.writeText(aiPrompt(lang)).then(() => toast(t("aiPromptCopied")));
                }}
              >
                <Copy size={13} />
                {t("copyAiPrompt")}
              </button>
              <span className="small muted">{t("templateHint")}</span>
            </div>
            <textarea
              className="text-field import-text"
              rows={9}
              placeholder={t("importTextPlaceholder")}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              autoFocus
            />
            <input
              className="text-field"
              type="url"
              inputMode="url"
              placeholder={t("importTextUrl")}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setResult(null);
              }}
            />
          </>
        )}

        {d && (
          <div className="import-preview">
            <div className="import-preview-head">
              {d.sources[0] ? <SourceIcon kind={d.sources[0].kind} size={18} /> : <ImageIcon size={18} />}
              <div>
                <b>{d.title || t("untitled")}</b>
                <div className="muted small">
                  {[d.sources[0]?.name, d.author && !d.sources[0]?.name.includes(d.author) ? d.author : ""].filter(Boolean).join(" · ")}
                  {d.imageUrl ? ` · ${t("withPhoto")}` : ""}
                </div>
              </div>
            </div>
            <div className="recipe-meta">
              {d.totalMinutes !== null && (
                <span>
                  <Clock size={13} />
                  {f.minutes(d.totalMinutes)}
                </span>
              )}
              {d.servings !== null && (
                <span>
                  <Users size={13} />
                  {d.servings} {d.servingsLabel}
                </span>
              )}
              <span>{t("ingredientCount", { n: d.ingredients.length })}</span>
              <span>{t("stepCount", { n: d.steps.length })}</span>
            </div>
            {d.ingredients.length > 0 && (
              <p className="small muted import-sample">
                {d.ingredients
                  .filter((l) => !l.startsWith("#"))
                  .slice(0, 4)
                  .join(" · ")}
                {d.ingredients.length > 4 ? " …" : ""}
              </p>
            )}
            {result.partial && (
              <p className="notice small">
                <Info size={14} />
                {t("importPartial")}
              </p>
            )}
            {result.existingId && (
              <p className="notice small">
                <Info size={14} />
                <span>
                  {t("importDuplicate")}{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      onClose();
                      navigate({ name: "recipe", id: result.existingId! });
                    }}
                  >
                    {t("openIt")}
                  </button>
                </span>
              </p>
            )}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          {result ? (
            <>
              <button type="button" className="text-button" disabled={!!busy} onClick={review}>
                {t("reviewFirst")}
              </button>
              <button className="primary-button" disabled={!!busy}>
                {busy === "save" && <Spinner />}
                {t("saveRecipe")}
              </button>
            </>
          ) : (
            <button className="primary-button" disabled={!!busy || !canRead}>
              {busy === "read" ? <Spinner /> : <Download size={14} />}
              {t("read")}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
