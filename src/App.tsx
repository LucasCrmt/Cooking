import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type RecipeSummary, type ServerInfo, type SharedItem } from "./lib/api";
import { AppContext, type AppContextValue, type EditorState, type SettingsPage } from "./lib/app";
import { MOBILE_QUERY, invalidate, useApi, useMediaQuery } from "./lib/hooks";
import { blankRecipe } from "./lib/recipes";
import { useRouter } from "./lib/router";
import { SettingsProvider, useSettings } from "./lib/settings";
import { ToastProvider } from "./components/common";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { RecipesPage } from "./components/RecipesPage";
import { RecipePage } from "./components/RecipePage";
import { RecipePanel } from "./components/RecipePanel";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { SearchDialog } from "./components/SearchDialog";
import { SharedPage } from "./components/SharedPage";
import { PublicRecipePage } from "./components/PublicRecipePage";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </SettingsProvider>
  );
}

function Root() {
  // A public link (/s/<token>) shows the recipe to anyone, signed in or not.
  const publicToken = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1];
  if (publicToken) return <PublicRecipePage token={publicToken} />;
  return <SignedInRoot />;
}

function SignedInRoot() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Set by the server when single sign-on fails (it redirects back with ?signin_error=…).
  const [signinError] = useState(() => new URLSearchParams(location.search).get("signin_error"));

  const loadMe = useCallback(() => {
    api<Me>("/auth/me").then(setMe, (e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)));
  }, []);

  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (signinError) router.setQuery({ signin_error: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any API call answering 401 means the session ended (expired, signed out elsewhere).
  useEffect(() => {
    const onSignedOut = () => setMe(null);
    window.addEventListener("cooking:signed-out", onSignedOut);
    return () => window.removeEventListener("cooking:signed-out", onSignedOut);
  }, []);

  if (me === undefined) return <div className="splash" />;
  if (me === null) return <SignIn error={signinError} onSignedIn={loadMe} />;
  return <Shell me={me} setMe={setMe} router={router} onSignedOut={() => setMe(null)} />;
}

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+$/i.test(s.trim());

function Shell({ me, setMe, router, onSignedOut }: { me: Me; setMe: (me: Me) => void; router: ReturnType<typeof useRouter>; onSignedOut: () => void }) {
  const { settings, update } = useSettings();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [drawer, setDrawer] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The bookmarklet (Settings → Data) opens the app with ?import=<the page you were on>, and the
  // caption it read there in the fragment (#text=…), which never reaches the server logs.
  const [importing, setImporting] = useState<{ url: string; text?: string } | null>(() => {
    const url = new URLSearchParams(location.search).get("import");
    const text = new URLSearchParams(location.hash.slice(1)).get("text") ?? undefined;
    return url || text ? { url: url ?? "", text } : null;
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(() => {
    const p = new URLSearchParams(location.search).get("settings");
    return p ? (p as SettingsPage) : null;
  });
  const server = useApi<ServerInfo>("/app/server").data;
  const recipesReq = useApi<RecipeSummary[]>("/app/recipes", true);
  const sharedReq = useApi<SharedItem[]>("/app/shared", true);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has("settings") || q.has("import") || location.hash) router.setQuery({ settings: undefined, import: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the drawers when navigating on phones.
  useEffect(() => {
    setDrawer(false);
    setMobilePanel(false);
  }, [router.route]);

  const r = router.route;
  const sidebarVisible = mobile ? drawer : settings.sidebar;
  const panelVisible = !!editor || (mobile ? mobilePanel : settings.panel);
  const toggleSidebar = () => (mobile ? setDrawer((d) => !d) : update({ sidebar: !settings.sidebar }));
  const togglePanel = () => {
    if (editor) return setEditor(null);
    if (mobile) setMobilePanel((p) => !p);
    else update({ panel: !settings.panel });
  };

  const value: AppContextValue = {
    me,
    setMe,
    server,
    route: r,
    query: router.query,
    navigate: router.navigate,
    setQuery: router.setQuery,
    recipes: recipesReq.data,
    reloadRecipes: () => {
      invalidate("/app/recipes");
      recipesReq.reload();
      window.dispatchEvent(new Event("cooking:changed"));
    },
    shared: sharedReq.data,
    reloadShared: () => {
      invalidate("/app/shared");
      sharedReq.reload();
    },
    openSettings: (page) => setSettingsPage(page ?? "profile"),
    signOut: () => {
      void api("/auth/logout", { method: "POST" }).finally(() => {
        invalidate();
        onSignedOut();
      });
    },
    sidebarVisible,
    toggleSidebar,
    panelVisible,
    togglePanel,
    openSearch: () => setSearchOpen(true),
    openImport: (url, text) => setImporting({ url: url ?? "", text }),
    editor,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
  };

  // Paste a recipe's address anywhere (outside a field) to import it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.("input, textarea, [contenteditable]") || document.querySelector(".dialog-backdrop")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (isUrl(text)) {
        e.preventDefault();
        setImporting({ url: text.trim() });
      } else if (text.trim().split("\n").length >= 3) {
        // A copied caption or recipe text.
        e.preventDefault();
        setImporting({ url: "", text: text.trim() });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // The same keys as Calendar, Notes and DevTime, plus the cookbook's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = !!target.closest?.("input, textarea, select, [contenteditable]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.altKey && !e.shiftKey && (k === "b" || k === "\\")) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (ctrl && !e.altKey && k === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (ctrl && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsPage((p) => p ?? "profile");
        return;
      }

      // Single keys: not while typing, in a dialog, or with modifiers.
      if (ctrl || e.altKey || inField || settingsPage || searchOpen || importing) return;
      if (document.querySelector(".dialog-backdrop, .picker")) return;

      if (k === "\\") toggleSidebar();
      else if (k === "/") setSearchOpen(true);
      else if (k === ".") togglePanel();
      else if (k === "i") setImporting({ url: "" });
      else if (k === "n") setEditor({ initial: blankRecipe() });
      else if (k === "escape" && editor) setEditor(null);
      else if (k === "escape" && mobile && (drawer || mobilePanel)) {
        setDrawer(false);
        setMobilePanel(false);
      } else if (k === "escape" && r.name === "recipe") router.navigate({ name: "recipes" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {sidebarVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
            <Sidebar />
          </>
        )}
        <main className="main">
          {r.name === "recipe" ? <RecipePage key={r.id} id={r.id} /> : r.name === "shared" ? <SharedPage /> : <RecipesPage list={r.name} />}
        </main>
        {panelVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={togglePanel} />}
            <RecipePanel />
          </>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {importing && <ImportDialog initialUrl={importing.url} initialText={importing.text} onClose={() => setImporting(null)} />}
      {settingsPage && <SettingsDialog page={settingsPage} onClose={() => setSettingsPage(null)} />}
    </AppContext.Provider>
  );
}
