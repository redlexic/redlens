import { useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useSearch } from "./useSearch";
import { useUrlState, urlString } from "./useUrlState";
import { ROUTES, type SearchScope } from "../lib/routes";

const queryCodec = urlString(null);

export function useSearchInput(location: string, navigate: (to: string) => void, scope: SearchScope) {
  const { state, search, ready } = useSearch();
  // Search query lives in the URL as ?q=… so it's shareable and back/forward
  // restore the active search alongside the page.
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
    search(deferredQuery);
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
      // query, so we don't pollute the source URL with ?q first.
      if (scope === "atlas" && location !== ROUTES.HOME) {
        navigate(q ? `${ROUTES.HOME}?q=${encodeURIComponent(q)}` : ROUTES.HOME);
        return;
      }
      setQueryParam(q || null);
    },
    [location, navigate, scope, setQueryParam],
  );

  const handleHintClick = useCallback(
    (q: string) => setQueryParam(q || null),
    [setQueryParam],
  );
  return { query, inputRef, handleChange, state, ready, handleHintClick };
}
