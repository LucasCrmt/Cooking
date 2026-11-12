import { useEffect, useRef, useState } from "react";
import { api, type Session } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings, type Settings, type Theme } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { ConfirmDialog, useToast } from "../common";
import { BookOpen, Download } from "../icons";
import { PageHeader, Row, Switch, useSaveProfile } from "./common";

// --- Profile ---

export function ProfilePage() {
  const { t } = useSettings();
  const { me, signOut, server } = useApp();
  const { save, busy } = useSaveProfile();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? "");
  const [deleting, setDeleting] = useState(false);
  // The provider owns SSO identities: only admins edit them (Settings → Users for others).
  const locked = me.ssoLinked && !me.isAdmin;

  return (
    <>
      <PageHeader title={t("profile")} hint={t("profileHint", { name: server?.oidc?.name ?? "SSO" })} />
      <section className="settings-rows">
        <Row label={t("username")}>
          <span className="muted">{me.id}</span>
        </Row>
        {locked ? (
          <>
            <Row label={t("nameLabel")} hint={t("identityLocked", { name: server?.oidc?.name ?? "SSO" })}>
              <span className="muted">{me.name}</span>
            </Row>
            <Row label={t("emailLabel")}>
              <span className="muted">{me.email ?? "—"}</span>
            </Row>
          </>
        ) : (
          <>
            <Row label={t("nameLabel")}>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ name });
                }}
              >
                <input className="text-field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                <button className="primary-button" disabled={busy || name.trim() === me.name}>
                  {t("save")}
                </button>
              </form>
            </Row>
            <Row label={t("emailLabel")}>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ email });
                }}
              >
                <input className="text-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button className="primary-button" disabled={busy || email.trim() === (me.email ?? "")}>
                  {t("save")}
                </button>
              </form>
            </Row>
          </>
        )}
      </section>
      <section className="settings-rows">
        <Row label={t("deleteAccount")} hint={t("deleteAccountHint")}>
          <button className="text-button danger" onClick={() => setDeleting(true)}>
            {t("deleteAccount")}
          </button>
        </Row>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteAccount")}
          text={t("deleteAccountHint")}
          word={me.id}
          action={t("deleteAccount")}
          onConfirm={async () => {
            await api("/app/profile/delete-account", { body: { confirm: me.id } });
            toast(t("saved"));
            signOut();
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// --- Preferences ---

const THEMES: { id: Theme; label: StringKey }[] = [
  { id: "system", label: "themeSystem" },
  { id: "light", label: "themeLight" },
  { id: "dark", label: "themeDark" },
  { id: "rosepine", label: "themeRosepine" },
  { id: "rosepine-dawn", label: "themeRosepineDawn" },
];

export function PreferencesPage() {
  const { t, settings, update } = useSettings();
  const select = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <select
      value={String(settings[key])}
      onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}
    >
      {options.map(([value, label]) => (
        <option key={String(value)} value={String(value)}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title={t("preferences")} hint={t("preferencesHint")} />
      <section>
        <h3>{t("appearance")}</h3>
        <div className="theme-picker">
          {THEMES.map(({ id, label }) => (
            <button key={id} className={`theme-card${settings.theme === id ? " active" : ""}`} onClick={() => update({ theme: id })}>
              <span className={`theme-preview ${id}`}>
                <span />
                <span />
                <span />
              </span>
              {t(label)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-rows">
        <Row label={t("languageLabel")}>
          {select("language", [
            ["auto", t("automatic")],
            ["fr", "Français"],
            ["en", "English"],
          ])}
        </Row>
        <Row label={t("view")}>
          {select("view", [
            ["grid", t("viewGrid")],
            ["list", t("viewList")],
          ])}
        </Row>
      </section>
      <section className="settings-rows">
        <h3>{t("inTheKitchen")}</h3>
        <Row label={t("keepAwake")} hint={t("keepAwakeHint")}>
          <Switch checked={settings.keepAwake} onChange={(keepAwake) => update({ keepAwake })} label={t("keepAwake")} />
        </Row>
        <Row label={t("checklists")} hint={t("checklistsHint")}>
          <Switch checked={settings.checklists} onChange={(checklists) => update({ checklists })} label={t("checklists")} />
        </Row>
      </section>
    </>
  );
}

// --- Security ---

export function SecurityPage() {
  const { t, f } = useSettings();
  const { server } = useApp();
  const sessions = useApi<Session[]>("/app/sessions");
  const sso = server?.oidc?.name ?? "SSO";
  const reload = () => {
    invalidate("/app/sessions");
    sessions.reload();
  };

  return (
    <>
      <PageHeader title={t("security")} hint={t("securityHint", { name: sso })} />
      <section>
        <h3>{t("sessions")}</h3>
        <div className="settings-list">
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {describeAgent(s.userAgent)}
                  {s.current && <span className="badge good">{t("thisDevice")}</span>}
                </span>
                <span className="small muted">
                  {t("lastActiveAt", { when: f.relative(s.lastSeenAt, t) })} · {s.ip}
                </span>
              </div>
              {!s.current && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api(`/app/sessions/${s.id}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  {t("signOutDevice")}
                </button>
              )}
            </div>
          ))}
        </div>
        {(sessions.data?.length ?? 0) > 1 && (
          <button
            className="text-button"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await api("/app/sessions/revoke-others", { method: "POST" });
              reload();
            }}
          >
            {t("signOutOthers")}
          </button>
        )}
      </section>
    </>
  );
}

/** "Chrome · Windows" from a user agent, roughly. */
function describeAgent(ua: string): string {
  const browser = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : ua.split(" ")[0] || "?";
  const os = /windows/i.test(ua) ? "Windows" : /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iOS" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

// --- Data ---

/**
 * Runs on the page you're reading, in your own browser (signed in to Instagram if you are), and
 * opens Cooking with its address. It also sends text along: what you selected, or on Instagram,
 * TikTok and Facebook the caption it finds on the page (those sites don't show it to the server).
 * The text travels in the fragment (#text=…), which browsers never send to a server.
 */
function bookmarkletCode(origin: string): string {
  return `(function(){
var s=String(getSelection()||"").trim(),t=s,h=location.hostname;
if(!t&&/instagram|tiktok|facebook/.test(h)){
var pick=function(q){return [].slice.call(document.querySelectorAll(q)).map(function(e){return (e.innerText||"").trim()}).filter(function(x){return x.length>40&&x.length<8000}).sort(function(a,b){return b.length-a.length})[0]};
t=pick("h1")||pick("[data-e2e=browse-video-desc],[data-e2e=video-desc]")||pick("span[dir=auto]")||((document.querySelector("meta[property='og:description']")||{}).content||"");
}
location.href=${JSON.stringify(`${origin}/?import=`)}+encodeURIComponent(location.href)+(t?"#text="+encodeURIComponent(t.slice(0,8000)):"");
})()`.replace(/\n/g, "");
}

export function DataPage() {
  const { t } = useSettings();
  const { recipes, me } = useApp();
  const mine = (recipes ?? []).filter((r) => r.userId === me.id).length;
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: links in JSX; the bookmarklet is set on the element directly.
  useEffect(() => {
    bookmarklet.current?.setAttribute("href", `javascript:${encodeURIComponent(bookmarkletCode(location.origin))}`);
  }, []);

  return (
    <>
      <PageHeader title={t("data")} hint={t("dataHint")} />
      <section className="settings-rows">
        <h3>{t("importFromSites")}</h3>
        <Row label={t("bookmarklet")} hint={t("bookmarkletHint")}>
          <a ref={bookmarklet} className="text-button bookmarklet" onClick={(e) => e.preventDefault()} draggable>
            <BookOpen size={14} />
            {t("bookmarkletName")}
          </a>
        </Row>
        <Row label={t("pasteToImport")} hint={t("pasteToImportHint")} />
      </section>
      <section className="settings-rows">
        <h3>{t("export")}</h3>
        <Row label={t("exportAll")} hint={t("exportHint", { n: recipes?.length ?? 0 })}>
          <a className="text-button" href="/api/app/export" download>
            <Download size={14} />
            JSON
          </a>
        </Row>
        <Row label={t("exportMine")} hint={t("exportHint", { n: mine })}>
          <a className="text-button" href="/api/app/export?mine=1" download>
            <Download size={14} />
            JSON
          </a>
        </Row>
      </section>
    </>
  );
}
