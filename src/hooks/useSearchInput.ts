import { useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useSearch } from "./useSearch";
import { useUrlState, urlString } from "./useUrlState";
import { ROUTES, type SearchScope } from "../lib/routes";

const queryCodec = urlString(null);

export type SearchMode = "broad" | "phrase" | "strict" | "fuzzy";

const FUZZY_SUFFIX_RE = /~\d+$/;

export function detectMode(q: string): SearchMode {
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) return "phrase";
  if (q.length >= 2 && q.startsWith("'") && q.endsWith("'")) return "strict";
  if (FUZZY_SUFFIX_RE.test(q)) return "fuzzy";
  return "broad";
}

function rawContent(q: string, mode: SearchMode): string {
  if (mode === "phrase" || mode === "strict") return q.slice(1, -1);
  if (mode === "fuzzy") return q.replace(FUZZY_SUFFIX_RE, "");
  return q;
}

function cycleWrap(q: string): string {
  const mode = detectMode(q);
  const raw = rawContent(q, mode);
  if (mode === "broad")   return `"${raw}"`;
  if (mode === "phrase")  return `'${raw}'`;
  if (mode === "strict")  return `${raw}~2`;
  return raw; // fuzzy → broad
}

export function useSearchInput(location: string, navigate: (to: string) => void, scope: SearchScope) {
  const { state, search, ready } = useSearch();
  const [queryParam, setQueryParam] = useUrlState("q", queryCodec);
  const query = queryParam ?? "";
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location === ROUTES.HOME) inputRef.current?.focus();
  }, [location]);

  useEffect(() => {
    if (location !== ROUTES.HOME) {
      search("");
      return;
    }
    if (deferredQuery.startsWith("/")) {
      search("");
      return;
    }
    const mode = detectMode(deferredQuery);
    const inner = mode === "broad" ? deferredQuery : deferredQuery.slice(1, -1);
    search(inner.trim() ? deferredQuery : "");
  }, [deferredQuery, location, search]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      if (q === "/reports") {
        navigate(ROUTES.REPORTS);
        return;
      }
      if (q === "/radar") {
        navigate(ROUTES.RADAR);
        return;
      }
      if (q === "/hints") {
        navigate(ROUTES.SEARCH_HINTS);
        return;
      }
      // Typing on a non-home atlas-scope page should jump to home WITH the
      // query, so we don't pollute the source URL with ?q first. Carry ?split
      // along so a comparison pane opened in atlas survives the search detour.
      if (scope === "atlas" && location !== ROUTES.HOME) {
        const np = new URLSearchParams();
        if (q) np.set("q", q);
        const split = new URLSearchParams(window.location.search).get("split");
        if (split) np.set("split", split);
        const qs = np.toString();
        navigate(qs ? `${ROUTES.HOME}?${qs}` : ROUTES.HOME);
        return;
      }
      setQueryParam(q || null);
    },
    [location, navigate, scope, setQueryParam],
  );

  const handleHintClick = useCallback(
    (q: string) => {
      if (q === "/reports") { navigate(ROUTES.REPORTS); return; }
      if (q === "/radar") { navigate(ROUTES.RADAR); return; }
      if (q === "/hints") { navigate(ROUTES.SEARCH_HINTS); return; }
      setQueryParam(q || null);
    },
    [navigate, setQueryParam],
  );

  const clearQuery = useCallback(() => {
    setQueryParam(null);
    inputRef.current?.focus();
  }, [setQueryParam]);

  const cycleMode = useCallback(() => {
    setQueryParam((q) => cycleWrap(q ?? ""));
    inputRef.current?.focus();
  }, [setQueryParam]);

  return { query, inputRef, handleChange, clearQuery, cycleMode, state, ready, handleHintClick };
}
