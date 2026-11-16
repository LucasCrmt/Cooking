// "Shared with me": recipes other people in the household sent you, with who and their note.
// New ones are marked until you open them (or mark them all as seen).

import { api, type SharedItem } from "../lib/api";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { useToast } from "./common";
import { Clock, Share, X } from "./icons";
import { RecipeImage } from "./recipe-bits";
import { Toolbar } from "./Toolbar";

export function SharedPage() {
  const { t, f } = useSettings();
  const { shared, reloadShared, navigate } = useApp();
  const toast = useToast();
  const unseen = (shared ?? []).filter((s) => !s.seenAt).length;

  const remove = async (s: SharedItem) => {
    try {
      await api(`/app/shared/${s.id}`, { method: "DELETE" });
      reloadShared();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <Toolbar title={t("sharedWithMe")} loading={!shared}>
        {unseen > 0 && (
          <button
            className="text-button"
            onClick={async () => {
              await api("/app/shared/seen", { body: {} });
              reloadShared();
            }}
          >
            {t("markAllSeen")}
          </button>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          {shared && shared.length === 0 ? (
            <div className="empty-state">
              <Share size={28} />
              <p className="muted">{t("nothingShared")}</p>
            </div>
          ) : (
            <div className="shared-list">
              {(shared ?? []).map((s) => (
                <div key={s.id} className={`shared-row${s.seenAt ? "" : " unseen"}`}>
                  <a
                    href={`/r/${s.recipeId}`}
                    className="shared-row-link"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      navigate({ name: "recipe", id: s.recipeId });
                    }}
                  >
                    <RecipeImage recipe={{ id: s.recipeId, title: s.title, hasImage: s.hasImage, imageVersion: s.imageVersion }} className="thumb" />
                    <span className="shared-row-text">
                      <span className="shared-row-title">
                        {!s.seenAt && <span className="badge good">{t("new")}</span>}
                        {s.title}
                      </span>
                      <span className="muted small">
                        {t("sharedBy", { name: s.fromName ?? t("someone"), when: f.relative(s.createdAt, t) })}
                        {s.totalMinutes !== null && (
                          <>
                            {" · "}
                            <Clock size={11} /> {f.minutes(s.totalMinutes)}
                          </>
                        )}
                      </span>
                      {s.note && <span className="shared-note">“{s.note}”</span>}
                    </span>
                  </a>
                  <button className="icon-button small" title={t("removeFromList")} aria-label={t("removeFromList")} onClick={() => void remove(s)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
