// Settings → Data → Calendar: the planned recipes go to Google Calendar (or Apple Calendar,
// Outlook), either as a file imported once or through a private address the calendar app follows.

import { useState } from "react";
import { api } from "../../lib/api";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { CopyButton, Spinner, useToast } from "../common";
import { Download, Globe } from "../icons";
import { Row } from "./common";

export function CalendarFeed() {
  const { t, lang } = useSettings();
  const toast = useToast();
  const req = useApi<{ token: string | null }>("/app/calendar-feed");
  const [busy, setBusy] = useState(false);
  const token = req.data?.token ?? null;
  const params = `lang=${lang}`;
  const url = token ? `${location.origin}/api/public/calendar/${token}.ics?${params}` : null;

  const call = async (method: "POST" | "DELETE") => {
    setBusy(true);
    try {
      await api("/app/calendar-feed", { method });
      invalidate("/app/calendar-feed");
      req.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-rows" id="calendar">
      <h3>{t("calendar")}</h3>
      <Row label={t("subscribeCalendar")} hint={t("feedHint")} stack>
        {url ? (
          <div className="feed-controls">
            <div className="mcp-snippet-row">
              <code className="share-link">{url}</code>
              <CopyButton text={url} />
            </div>
            <div className="share-link-actions">
              <button className="text-button" disabled={busy} title={t("feedRenewHint")} onClick={() => void call("POST")}>
                {t("feedRenew")}
              </button>
              <button className="text-button danger" disabled={busy} onClick={() => void call("DELETE")}>
                {t("feedOff")}
              </button>
            </div>
          </div>
        ) : (
          <button className="primary-button" disabled={busy || req.loading} onClick={() => void call("POST")}>
            {busy ? <Spinner /> : <Globe size={14} />}
            {t("feedCreate")}
          </button>
        )}
      </Row>
      <Row label={t("downloadIcs")} hint={t("downloadIcsHint")}>
        <a className="text-button" href={`/api/app/plans.ics?${params}`} download>
          <Download size={14} />
          .ics
        </a>
      </Row>
      <p className="settings-hint">{t("feedPublicNote")}</p>
    </section>
  );
}
