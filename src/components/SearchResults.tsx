import { memo, useState, useEffect, useMemo } from "react";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import type { SearchHit, RelationEntity } from "../types";
import type { SearchState } from "../hooks/useSearch";
import { loadGraph } from "../lib/graph";
import { searchEntities } from "../lib/entitySearch";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, SUBTYPE_LABEL } from "../lib/entityGraph";

interface Props {
  state: SearchState;
  query: string;
  onNavigate: (id: string) => void;
  onNavigateEntity: (id: string) => void;
  onHintClick: (query: string) => void;
}
const PAGE_SIZE = 500;
const ENTITY_CAP = 6;
const empty: SearchHit[] = [];

export const SearchResults = memo(function SearchResults({ state, query, onNavigate, onNavigateEntity, onHintClick }: Props) {
  const hits = state.status === "done" ? state.hits : empty;
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); }, [hits]);

  const [entities, setEntities] = useState<RelationEntity[] | null>(null);
  useEffect(() => { loadGraph().then(g => setEntities(g.entities)); }, []);

  const entityHits = useMemo(() => {
    if (!entities || !query.trim() || query.startsWith("/")) return [];
    return searchEntities(query, entities).slice(0, ENTITY_CAP);
  }, [entities, query]);

  const displayed = hits.slice(0, visible);
  const remaining = hits.length - displayed.length;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {entityHits.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
              entities · {entityHits.length}
            </div>
            <ul>
              {entityHits.map(({ entity }) => (
                <li key={entity.id}>
                  <a
                    href={`/entities?id=${entity.id}`}
                    onClick={(e) => { e.preventDefault(); onNavigateEntity(entity.id); }}
                    className="search-result-link px-4 py-3 flex items-center gap-3"
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ENTITY_TYPE_COLOR[entity.et] ?? "#888" }} />
                    <span className="text-sm font-semibold text-tan">{entity.name}</span>
                    <span className="mono text-[10px] text-tan-3">
                      {ENTITY_TYPE_LABEL[entity.et] ?? entity.et}
                      {entity.st ? ` · ${SUBTYPE_LABEL[entity.st] ?? entity.st}` : ""}
                    </span>
                  </a>
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
              <li key={hit.id}><SearchResult hit={hit} onNavigate={onNavigate} /></li>
            ))}
          </ul>
        )}
        {remaining > 0 && (
          <div className="px-4 py-4 text-center">
            <button onClick={() => setVisible(v => v + PAGE_SIZE)}
              className="load-more-btn text-xs mono px-3 py-1.5 rounded">
              show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
            </button>
          </div>
        )}
        {(state.status === "idle" || state.status === "loading") && query.startsWith('/') && (
          <SearchHints onSearch={onHintClick} slashFilter={query} />
        )}
        {state.status === "error" && (
          <div className="flex items-center justify-center py-24 text-sm text-red">{state.message}</div>
        )}
      </div>
    </main>
  );
});
