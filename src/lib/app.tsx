// What every page of the signed-in app can reach: the user, navigation, the cookbook, the editor.

import { createContext, useContext } from "react";
import type { Me, RecipeFields, RecipeSummary, ServerInfo, SharedItem } from "./api";
import type { Route } from "./router";

export type SettingsPage = "profile" | "preferences" | "security" | "data" | "claude" | "shortcuts" | "users" | "about";

/** What the editor in the side panel is working on. */
export interface EditorState {
  /** Editing this recipe; absent: a new one. */
  id?: string;
  initial: RecipeFields;
  /** An imported photo to copy on save. */
  imageUrl?: string | null;
  /** The recipe's current photo (when editing). */
  currentImage?: string | null;
}

export interface AppContextValue {
  me: Me;
  setMe: (me: Me) => void;
  server: ServerInfo | undefined;
  route: Route;
  query: Record<string, string>;
  navigate: (route: Route, query?: Record<string, string>) => void;
  setQuery: (patch: Record<string, string | undefined>, replace?: boolean) => void;
  /** The whole cookbook, newest first. */
  recipes: RecipeSummary[] | undefined;
  reloadRecipes: () => void;
  /** What others sent you ("Shared with me"), newest first. */
  shared: SharedItem[] | undefined;
  reloadShared: () => void;
  openSettings: (page?: SettingsPage) => void;
  signOut: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /** The side panel on the right: filters, the recipe's details, or the editor. */
  panelVisible: boolean;
  togglePanel: () => void;
  openSearch: () => void;
  openImport: (url?: string, text?: string) => void;
  editor: EditorState | null;
  openEditor: (state: EditorState) => void;
  closeEditor: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside the app");
  return v;
}
