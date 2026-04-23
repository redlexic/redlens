import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, useSearchParams } from "wouter";
import { loadGraph, type GraphData } from "../lib/graph";
import { loadAtlas } from "../lib/docs";
import {
  buildEntityNodes, buildEntityEdges, buildEntityIndex,
  ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, CONNECTED_ENTITY_TYPES,
} from "../lib/entityGraph";
import { searchEntities, neighborhoodOfEntities, agentClusterIds } from "../lib/entitySearch";
import { EntityFlow } from "./entities/EntityFlow";
import { Loading } from "./Loading";
import type { RelationEntity } from "../types";

export function EntitiesPage({ onNavigate, query }: { onNavigate: (id: string) => void; query: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [docNoToId, setDocNoToId] = useState<Map<string, string> | null>(null);
  const [, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const urlId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(urlId);

  const selectEntity = useCallback((id: string) => {
    setSelectedId(id);
    navigate(`/entities?id=${id}`);
  }, [navigate]);
  // Default focus: the agent hierarchy plus instances (temporarily visible so we
  // can inspect the graph shape — will likely move back to hidden-by-default once
  // a purpose-built instance panel exists). Types with no direct entity↔entity
  // edges (scope, govops, facilitators, alignment conservers) start hidden.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set([
    "scope", "govops", "core_facilitator", "operational_facilitator", "alignment_conserver",
  ]));
  // When set, narrow the graph to just this Prime Agent's cluster: executor,
  // facilitator, govops, and all Instances the agent has invoked.
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);

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
    if (queryScope?.topId) selectEntity(queryScope.topId);
  // selectEntity is stable; topId change is the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryScope?.topId]);

  // URL ?id= pre-selection (only when no active query).
  useEffect(() => {
    if (!query.trim() && urlId) setSelectedId(urlId);
  }, [urlId, query]);

  // Agent cluster for focus mode — transitively walks from the selected prime.
  const focusCluster = useMemo(() => {
    if (!graphData || !focusAgentId) return null;
    return agentClusterIds(focusAgentId, graphData.entities, graphData.edges);
  }, [graphData, focusAgentId]);

  const { nodes, edges } = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };
    const allNodes = buildEntityNodes(graphData).filter(n => {
      // Instances filter by composite et:st key so subtypes can be toggled independently.
      const subKey = n.entity.et === "instance" && n.entity.st ? `instance:${n.entity.st}` : null;
      if (hiddenTypes.has(n.entity.et)) return false;
      if (subKey && hiddenTypes.has(subKey)) return false;
      if (focusCluster && !focusCluster.has(n.id)) return false;
      if (queryScope && !queryScope.ids.has(n.id)) return false;
      return true;
    });
    const visible = new Set(allNodes.map(n => n.id));
    const allEdges = buildEntityEdges(graphData).filter(e => visible.has(e.src) && visible.has(e.tgt));
    return { nodes: allNodes, edges: allEdges };
  }, [graphData, hiddenTypes, queryScope, focusCluster]);

  // Type pills: for instances, split per subtype; for others, aggregate by et.
  const typeRows = useMemo(() => {
    if (!graphData) return [] as { key: string; et: string; label: string; count: number; color: string }[];
    const m = new Map<string, { key: string; et: string; label: string; count: number; color: string }>();
    for (const e of graphData.entities) {
      const key = e.et === "instance" && e.st ? `instance:${e.st}` : e.et;
      const label = e.et === "instance" && e.st
        ? e.st.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")
        : ENTITY_TYPE_LABEL[e.et] ?? e.et;
      const color = ENTITY_TYPE_COLOR[e.et] ?? "#888";
      const cur = m.get(key);
      if (cur) cur.count++; else m.set(key, { key, et: e.et, label, count: 1, color });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [graphData]);

  const primeAgents = useMemo(() => {
    if (!graphData) return [] as RelationEntity[];
    return graphData.entities
      .filter(e => e.et === "agent" && e.st === "prime")
      .sort((a, b) => a.name.localeCompare(b.name));
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
          <button
            className="mono text-[10px] px-2 py-1 rounded transition-opacity"
            style={{ background: "var(--surface)", color: "var(--tan-3)" }}
            onClick={() => setHiddenTypes(new Set(typeRows.map(r => r.key)))}
            title="Hide all types"
          >none</button>
          <button
            className="mono text-[10px] px-2 py-1 rounded transition-opacity"
            style={{ background: "var(--surface)", color: "var(--tan-3)" }}
            onClick={() => setHiddenTypes(new Set())}
            title="Show all types"
          >all</button>
          {typeRows.map(row => {
            const hidden = hiddenTypes.has(row.key);
            const connected = CONNECTED_ENTITY_TYPES.has(row.et);
            return (
              <button
                key={row.key}
                className="mono text-[10px] px-2 py-1 rounded flex items-center gap-1.5 transition-opacity"
                style={{
                  background: "var(--surface)",
                  color: hidden ? "var(--tan-3)" : "var(--tan-2)",
                  opacity: hidden ? 0.4 : 1,
                }}
                onClick={() => {
                  setHiddenTypes(prev => {
                    const next = new Set(prev);
                    if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
                    return next;
                  });
                }}
                title={connected ? (hidden ? "Show" : "Hide") : "No direct entity-to-entity edges — panel context only"}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: row.color }} />
                {row.label} · {row.count}
                {!connected && <span style={{ color: "var(--tan-3)" }}>·</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 px-4 py-2 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--border)" }}>
        <span className="mono text-[10px] uppercase tracking-wide" style={{ color: "var(--tan-3)" }}>Focus:</span>
        <button
          onClick={() => setFocusAgentId(null)}
          className="mono text-[10px] px-2 py-1 rounded transition-opacity"
          style={{
            background: "var(--surface)",
            color: focusAgentId === null ? "var(--tan)" : "var(--tan-3)",
            opacity: focusAgentId === null ? 1 : 0.6,
            border: focusAgentId === null ? "1px solid var(--accent)" : "1px solid transparent",
          }}
        >All</button>
        {primeAgents.map(a => {
          const on = focusAgentId === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setFocusAgentId(on ? null : a.id)}
              className="mono text-[10px] px-2 py-1 rounded transition-opacity"
              style={{
                background: "var(--surface)",
                color: on ? "var(--tan)" : "var(--tan-3)",
                opacity: on ? 1 : 0.6,
                border: on ? "1px solid var(--accent)" : "1px solid transparent",
              }}
              title={on ? "Clear focus" : `Show only ${a.name}'s cluster`}
            >{a.name}</button>
          );
        })}
      </div>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <EntityFlow
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={selectEntity}
          graphData={graphData}
          entityById={entityById}
          onNavigateDoc={onNavigate}
        />
      </div>
    </div>
  );
}
