import { useState, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useSearch } from "./useSearch";
import { ROUTES } from "../lib/routes";

export function useSearchInput(location: string, navigate: (to: string) => void) {
  const { state, search, ready } = useSearch();
  const [query, setQuery] = useState("");
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

  const clearSearch = useCallback(() => {
    setQuery("");
    search("");
  }, [search]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      if (q === "/reports") {
        navigate(ROUTES.REPORTS);
        setQuery("");
        return;
      }
      if (q === "/radar") {
        navigate(ROUTES.RADAR);
        setQuery("");
        return;
      }
      if (q === "/hints") {
        navigate(ROUTES.SEARCH_HINTS);
        setQuery("");
        return;
      }
      setQuery(q);
      if (location === ROUTES.CONSTELLATIONS || location.startsWith(ROUTES.RADAR)) return;
      if (location !== ROUTES.HOME) navigate(ROUTES.HOME);
    },
    [location, navigate],
  );

  const handleHintClick = useCallback((q: string) => setQuery(q), []);
  return { query, setQuery, inputRef, handleChange, state, ready, clearSearch, handleHintClick };
}
