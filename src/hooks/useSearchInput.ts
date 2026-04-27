import { useState, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useSearch } from "./useSearch";

export function useSearchInput(location: string, navigate: (to: string) => void) {
  const { state, search, ready } = useSearch();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location === "/") inputRef.current?.focus();
  }, [location]);

  useEffect(() => {
    if (location !== "/") { search(""); return; }
    if (deferredQuery.startsWith("/")) { search(""); return; }
    search(deferredQuery);
  }, [deferredQuery, location, search]);

  const clearSearch = useCallback(() => { setQuery(""); search(""); }, [search]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    if (q === "/reports") { navigate("/reports"); setQuery(""); return; }
    if (q === "/radar")   { navigate("/radar");   setQuery(""); return; }
    if (q === "/hints")   { navigate("/search-hints"); setQuery(""); return; }
    setQuery(q);
    if (location === "/constellations" || location.startsWith("/radar")) return;
    if (location !== "/") navigate("/");
  }, [location, navigate]);

  const handleHintClick = useCallback((q: string) => setQuery(q), []);
  return { query, setQuery, inputRef, handleChange, state, ready, clearSearch, handleHintClick };
}
