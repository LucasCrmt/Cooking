// Sharing a recipe: send it to people in the household (it lands in their "Shared with me", with
// your note), or turn on a public link for anyone else (read-only, no account needed).

import { useState } from "react";
import { api, type Person, type Recipe } from "../lib/api";
import { useApp } from "../lib/app";
import { invalidate, useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { Avatar, CopyButton, Dialog, Spinner, useToast } from "./common";
import { Globe, Share } from "./icons";

export function ShareDialog({ recipe, onClose, onChanged }: { recipe: Recipe; onClose: () => void; onChanged: () => void }) {
  const { t } = useSettings();
  const { reloadRecipes } = useApp();
  const toast = useToast();
  const people = useApi<Person[]>("/app/people");
  const [to, setTo] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"send" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(recipe.shareToken);
  const link = token ? `${location.origin}/s/${token}` : null;

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      await api(`/app/recipes/${recipe.id}/share`, { body: { to: [...to], note } });
      toast(t("shareSent", { n: to.size }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const setLink = async (on: boolean) => {
    setBusy("link");
    setError(null);
    try {
      const res = await api<{ shareToken: string | null }>(`/app/recipes/${recipe.id}/link`, { method: "PUT", body: { on } });
      setToken(res.shareToken);
      invalidate(`/app/recipes/${recipe.id}`);
      onChanged();
      reloadRecipes();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={t("shareRecipe")} onClose={onClose} wide>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (to.size) void send();
        }}
      >
        <section className="share-section">
          <h3>{t("sendTo")}</h3>
          {people.data && people.data.length === 0 ? (
            <p className="muted small">{t("nobodyElse")}</p>
          ) : (
            <div className="share-people">
              {(people.data ?? []).map((p) => (
                <label key={p.id} className={`share-person${to.has(p.id) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    checked={to.has(p.id)}
                    onChange={() => {
                      const next = new Set(to);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      setTo(next);
                    }}
                  />
                  <Avatar name={p.name} size={22} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
          {(people.data?.length ?? 0) > 0 && (
            <>
              <textarea className="text-field share-note" rows={2} maxLength={500} placeholder={t("shareNotePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="dialog-actions">
                <button className="primary-button" disabled={!to.size || !!busy}>
                  {busy === "send" ? <Spinner /> : <Share size={14} />}
                  {t("send")}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="share-section">
          <h3>{t("publicLink")}</h3>
          <p className="muted small">{t("publicLinkHint")}</p>
          {link ? (
            <>
              <div className="mcp-snippet-row">
                <code className="share-link">{link}</code>
                <CopyButton text={link} />
              </div>
              <div className="share-link-actions">
                {"share" in navigator && (
                  <button type="button" className="text-button" onClick={() => void navigator.share({ title: recipe.title, url: link }).catch(() => {})}>
                    <Share size={14} />
                    {t("shareVia")}
                  </button>
                )}
                <button type="button" className="text-button danger" disabled={!!busy} onClick={() => void setLink(false)}>
                  {t("turnOffLink")}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="text-button" disabled={!!busy} onClick={() => void setLink(true)}>
              {busy === "link" ? <Spinner /> : <Globe size={14} />}
              {t("createLink")}
            </button>
          )}
        </section>

        {error && <p className="error-text">{error}</p>}
      </form>
    </Dialog>
  );
}
