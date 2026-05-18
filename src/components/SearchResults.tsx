import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "./Link";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import type { SearchHit, GraphEntity } from "../types";
import type { SearchState } from "../hooks/useSearch";
import { useUrlState, urlInt } from "../hooks/useUrlState";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { loadGraph } from "../lib/graph";
import { matchParticipants } from "../lib/search";
import { entityHref } from "../lib/routes";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, SUBTYPE_LABEL } from "../lib/entityGraph";

interface Props {
  state: SearchState;
  query: string;
  onHintClick: (query: string) => void;
}
const PAGE_SIZE = 500;
const ENTITY_CAP = 6;
const empty: SearchHit[] = [];
const visibleCodec = urlInt(PAGE_SIZE);

export const SearchResults = memo(function SearchResults({
  state,
  query,
  onHintClick,
}: Props) {
  const hits = state.status === "done" ? state.hits : empty;
  const [visible, setVisible] = useUrlState("n", visibleCodec);
  // Reset pagination only when the query actually changes. On mount with a restored
  // URL like `/?n=1000` (back-button after "show more"), keep the saved page count.
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      setVisible(PAGE_SIZE);
    }
  }, [query, setVisible]);

  const [participants, setParticipants] = useState<GraphEntity[] | null>(null);
  useEffect(() => {
    loadGraph().then((g) => setParticipants(g.participants));
  }, []);

  const entityHits = useMemo(() => {
    if (!participants || !query.trim() || query.startsWith("/")) return [];
    return matchParticipants(query, participants).slice(0, ENTITY_CAP);
  }, [participants, query]);

  const displayed = hits.slice(0, visible);
  const remaining = hits.length - displayed.length;

  const scrollRef = useRef<HTMLElement>(null);
  // Wait until results are rendered before restoring — otherwise we'd scroll
  // an empty container and clobber the saved offset.
  useScrollRestore(scrollRef, state.status === "done" && displayed.length > 0);

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {entityHits.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
              Agents · Alignment Conservers · Goverance Operators {entityHits.length}
            </div>
            <ul>
              {entityHits.map(({ participant }) => (
                <li key={participant.id}>
                  <Link
                    to={entityHref(participant.id)}
                    className="search-result-link px-4 py-3 flex items-center gap-3"
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mr-3"
                      style={{ background: ENTITY_TYPE_COLOR[participant.et] ?? "var(--entity-fallback)" }}
                    />
                    <span className="text-sm font-semibold text-tan">{participant.name}</span>
                    <span className="mono text-[10px] text-tan-3 ml-4">
                      {ENTITY_TYPE_LABEL[participant.et] ?? participant.et}
                      {participant.st
                        ? ` · ${SUBTYPE_LABEL[participant.st] ?? participant.st}`
                        : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {state.status === "done" && (
          <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
            {hits.length === 0
              ? `no results for "${state.query}"`
              : `${displayed.length < hits.length ? `${displayed.length} of ` : ""}${hits.length} result${hits.length !== 1 ? "s" : ""} · ${state.durationMs.toFixed(0)}ms`}
          </div>
        )}
        {displayed.length > 0 && (
          <ul>
            {displayed.map((hit) => (
              <li key={hit.id}>
                <SearchResult hit={hit} />
              </li>
            ))}
          </ul>
        )}
        {remaining > 0 && (
          <div className="px-4 py-4 text-center">
            <button
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="load-more-btn text-xs mono px-3 py-1.5 rounded"
            >
              show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
            </button>
          </div>
        )}
        {(state.status === "idle" || state.status === "loading") && query.startsWith("/") && (
          <SearchHints onSearch={onHintClick} slashFilter={query} />
        )}
        {state.status === "error" && (
          <div className="flex items-center justify-center py-24 text-sm text-red">
            {state.message}
          </div>
        )}
      </div>
    </main>
  );
});
