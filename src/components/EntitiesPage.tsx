import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { loadGraph, type GraphData } from "../lib/graph";
import { loadAtlas } from "../lib/docs";
import {
  buildEntityNodes, buildEntityEdges, buildEntityIndex,
  ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, CONNECTED_ENTITY_TYPES,
} from "../lib/entityGraph";
import { searchEntities, neighborhoodOfEntities } from "../lib/entitySearch";
import { EntityFlow } from "./entities/EntityFlow";
import { Loading } from "./Loading";
import type { RelationEntity } from "../types";

export function EntitiesPage({ onNavigate, query }: { onNavigate: (id: string) => void; query: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [docNoToId, setDocNoToId] = useState<Map<string, string> | null>(null);
  const [searchParams] = useSearchParams();
  const urlId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  // Default focus: the agent hierarchy. Types with no direct entity↔entity edges
  // (scope, govops, facilitators, alignment conservers) start hidden but toggleable.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set([
    "scope", "govops", "core_facilitator", "operational_facilitator", "alignment_conserver",
  ]));

  useEffect(() => {
    Promise.all([loadGraph(), loadAtlas()]).then(([g, atlas]) => {
      setGraphData(g);
      setDocNoToId(atlas.docNoToId);
    });
  }, []);

  const entityById = useMemo(
    () => (graphData ? buildEntityIndex(graphData.entities) : new Map<string, RelationEntity>()),
    [graphData],
  );

  // Query-driven scope: when a search is active, narrow to the matches and their
  // 2-hop entity↔entity neighborhood so solitary primes don't look orphaned.
  const queryScope = useMemo(() => {
    if (!graphData || !query.trim()) return null;
    const matches = searchEntities(query, graphData.entities);
    if (matches.length === 0) return { ids: new Set<string>(), topId: null as string | null };
    const seedIds = matches.map(m => m.entity.id);
    const ids = neighborhoodOfEntities(seedIds, graphData.edges, 2);
    return { ids, topId: matches[0].entity.id };
  }, [graphData, query]);

  // When the query changes and there's a top match, auto-select it.
  useEffect(() => {
    if (queryScope?.topId) setSelectedId(queryScope.topId);
  }, [queryScope?.topId]);

  // URL ?id= pre-selection (only when no active query).
  useEffect(() => {
    if (!query.trim() && urlId) setSelectedId(urlId);
  }, [urlId, query]);

  const { nodes, edges } = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };
    const allNodes = buildEntityNodes(graphData).filter(n => {
      if (hiddenTypes.has(n.entity.et)) return false;
      if (queryScope && !queryScope.ids.has(n.id)) return false;
      return true;
    });
    const visible = new Set(allNodes.map(n => n.id));
    const allEdges = buildEntityEdges(graphData).filter(e => visible.has(e.src) && visible.has(e.tgt));
    return { nodes: allNodes, edges: allEdges };
  }, [graphData, hiddenTypes, queryScope]);

  const typeCounts = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const e of graphData.entities) m.set(e.et, (m.get(e.et) ?? 0) + 1);
    return m;
  }, [graphData]);

  if (!graphData || !docNoToId) {
    return <Loading>loading entity graph</Loading>;
  }

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-4 flex-wrap" style={{ borderColor: "var(--border)" }}>
        <p className="mono text-[10px] uppercase tracking-wide" style={{ color: "var(--tan-3)" }}>
          {queryScope
            ? (nodes.length === 0
                ? `no entities match "${query}"`
                : `"${query}" · ${nodes.length} entities · ${edges.length} relationships`)
            : `${graphData.entities.length} entities · ${edges.length} relationships shown`}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {[...typeCounts.entries()].map(([et, count]) => {
            const hidden = hiddenTypes.has(et);
            const connected = CONNECTED_ENTITY_TYPES.has(et);
            return (
              <button
                key={et}
                className="mono text-[10px] px-2 py-1 rounded flex items-center gap-1.5 transition-opacity"
                style={{
                  background: "var(--surface)",
                  color: hidden ? "var(--tan-3)" : "var(--tan-2)",
                  opacity: hidden ? 0.4 : 1,
                }}
                onClick={() => {
                  setHiddenTypes(prev => {
                    const next = new Set(prev);
                    if (next.has(et)) next.delete(et); else next.add(et);
                    return next;
                  });
                }}
                title={connected ? (hidden ? "Show" : "Hide") : "No direct entity-to-entity edges — panel context only"}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: ENTITY_TYPE_COLOR[et] ?? "#888" }} />
                {ENTITY_TYPE_LABEL[et] ?? et} · {count}
                {!connected && <span style={{ color: "var(--tan-3)" }}>·</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <EntityFlow
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
          graphData={graphData}
          entityById={entityById}
          onNavigateDoc={onNavigate}
        />
      </div>
    </div>
  );
}
