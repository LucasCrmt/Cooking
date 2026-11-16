// Talking to the Cooking server (same origin; Vite proxies /api in development).

export class ApiError extends Error {
  status: number;
  /** The server's machine-readable reason, e.g. "needs_text". */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("cooking:signed-out"));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// --- Types (mirroring the server) ---

export interface Me {
  id: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
  ssoLinked: boolean;
  createdAt: string;
}

export interface AuthConfig {
  oidc: { name: string } | null;
  /** Local development sign-in (DEV_LOGIN_USER). */
  dev: boolean;
}

/** GET /app/updates: whether a newer release is out on GitHub. */
export interface UpdateStatus {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string | null;
  /** UPDATE_CHECK=false on the server. */
  disabled?: boolean;
  error?: string;
}

export interface ServerInfo {
  oidc: { name: string } | null;
  version: string;
  importEnabled: boolean;
}

export type SourceKind = "web" | "instagram" | "tiktok" | "youtube" | "facebook" | "pinterest" | "other";

/** Where a recipe comes from: a page, a video, a book (no address). */
export interface Source {
  url: string | null;
  name: string;
  kind: SourceKind;
}

/** The fields a recipe is written with (the form, an import, the API). */
export interface RecipeFields {
  title: string;
  description: string;
  category: string;
  cuisine: string;
  tags: string[];
  servings: number | null;
  servingsLabel: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
  sources: Source[];
  author: string;
  /** What it needs: keys such as "oven" (see lib/equipment.ts). */
  equipment: string[];
}

/** One row of GET /app/recipes. */
export interface RecipeSummary {
  id: string;
  userId: string | null;
  title: string;
  description: string;
  category: string;
  cuisine: string;
  tags: string[];
  equipment: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sources: Source[];
  hasImage: boolean;
  imageVersion: number;
  ingredientCount: number;
  favorite: boolean;
  myRating: number | null;
  rating: number | null;
  lastCookedAt: string | null;
  cookedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe extends RecipeFields {
  id: string;
  userId: string | null;
  hasImage: boolean;
  imageVersion: number;
  favorite: boolean;
  myRating: number | null;
  rating: number | null;
  ratingCount: number;
  /** How many people marked it as cooked (each person once). */
  cookedCount: number;
  /** Their names, first one first. */
  cookedBy: string[];
  /** When you marked it as cooked; null: you haven't. */
  lastCookedAt: string | null;
  addedBy: string | null;
  canEdit: boolean;
  /** The public link's token (/s/<token>), when it's on. */
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Someone in the household, to send a recipe to. */
export interface Person {
  id: string;
  name: string;
}

/** A recipe someone sent you (GET /app/shared). */
export interface SharedItem {
  id: string;
  recipeId: string;
  title: string;
  hasImage: boolean;
  imageVersion: number;
  category: string;
  totalMinutes: number | null;
  fromName: string | null;
  note: string;
  createdAt: string;
  seenAt: string | null;
}

/** A recipe as its public link shows it (GET /public/recipes/:token). */
export interface PublicRecipe extends RecipeFields {
  hasImage: boolean;
  imageVersion: number;
  updatedAt: string;
}

export interface ImportResult {
  draft: RecipeFields & { imageUrl: string | null };
  /** Ingredients or steps are missing: worth a look before saving. */
  partial: boolean;
  /** The same address is already in the cookbook. */
  existingId: string | null;
}

export interface SearchHit {
  id: string;
  title: string;
  /** The ingredient line that matched, if any. */
  match: string | null;
}

export interface Session {
  id: string;
  method: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
  ssoLinked: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  recipes: number;
}

export const imageSrc = (r: { id: string; imageVersion: number }) => `/api/app/recipes/${r.id}/image?v=${r.imageVersion}`;
