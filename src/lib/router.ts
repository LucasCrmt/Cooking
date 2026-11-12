// Address-bar routing: the path picks the page, the query string holds the filters,
// so every view can be bookmarked and shared.

import { useCallback, useEffect, useState } from "react";

export type ListName = "recipes" | "favorites" | "untried";

export type Route = { name: ListName } | { name: "recipe"; id: string };

export function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  if (parts[0] === "r" && parts[1] && /^\d+$/.test(parts[1])) return { name: "recipe", id: parts[1] };
  if (parts[0] === "favorites") return { name: "favorites" };
  if (parts[0] === "untried") return { name: "untried" };
  return { name: "recipes" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "recipe":
      return `/r/${r.id}`;
    case "favorites":
      return "/favorites";
    case "untried":
      return "/untried";
    default:
      return "/";
  }
}

const readQuery = () => Object.fromEntries(new URLSearchParams(location.search));

export function useRouter() {
  const [state, setState] = useState(() => ({ route: parseRoute(location.pathname), query: readQuery() }));

  useEffect(() => {
    const onPop = () => setState({ route: parseRoute(location.pathname), query: readQuery() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Goes to a page, with its own query (filters don't follow you into a recipe). */
  const navigate = useCallback((route: Route, query: Record<string, string> = {}) => {
    setState(() => {
      const search = new URLSearchParams(query).toString();
      history.pushState(null, "", routePath(route) + (search ? `?${search}` : ""));
      return { route, query };
    });
    document.querySelector(".content")?.scrollTo(0, 0);
  }, []);

  /** Changes the query string of the current page without a new history entry per keystroke. */
  const setQuery = useCallback((patch: Record<string, string | undefined>, replace = false) => {
    setState((s) => {
      const q = { ...s.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") delete q[k];
        else q[k] = v;
      }
      const search = new URLSearchParams(q).toString();
      history[replace ? "replaceState" : "pushState"](null, "", location.pathname + (search ? `?${search}` : ""));
      return { ...s, query: q };
    });
  }, []);

  return { route: state.route, query: state.query, navigate, setQuery };
}
