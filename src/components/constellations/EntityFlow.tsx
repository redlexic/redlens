import { useMemo, useEffect, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { parseMeta } from "../../lib/meta";
import type { EntityNodeData, EntityEdgeData, EntityRelation } from "../../lib/entityGraph";
import {
  edgeLabel,
  ENTITY_TYPE_LABEL,
  SUBTYPE_LABEL,
  getEntityRelations,
} from "../../lib/entityGraph";
import type { GraphData } from "../../lib/graph";
import type { Participant } from "../../types";

const EDGE_COLOR = "#5a3a32";
const EDGE_HIGHLIGHT = "#c67267";

type CardData = {
  label: string;
  color: string;
  entityType: string;
  subtype: string | null;
  degree: number;
  entity: Participant;
  graphData: GraphData;
  entityById: Map<string, Participant>;
  onSelect: (id: string) => void;
  onNavigateDoc: (id: string) => void;
};

type CardNode = Node<CardData, "entity">;

const EntityCard = memo(function EntityCard({ data, selected }: NodeProps<CardNode>) {
  const {
    label,
    color,
    entityType,
    subtype,
    degree,
    entity,
    graphData,
    entityById,
    onSelect,
    onNavigateDoc,
  } = data;

  const typeLabel = ENTITY_TYPE_LABEL[entityType] ?? entityType;
  const subLabel = subtype ? (SUBTYPE_LABEL[subtype] ?? subtype) : null;

  return (
    <div
      className={`entity-card ${selected ? "is-open" : "is-closed"}`}
      style={{
        background: "var(--surface)",
        border: `1px solid ${selected ? color : "var(--border)"}`,
        borderRadius: 10,
        padding: selected ? "12px 14px" : "6px 10px",
        width: selected ? 280 : 160,
        boxShadow: selected ? `0 8px 24px rgba(0,0,0,0.5)` : "0 2px 6px rgba(0,0,0,0.3)",
        transition: "width 150ms ease, padding 150ms ease",
        fontFamily: "'Lora', serif",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
      />

      <div className="flex items-center gap-2">
        <span
          className="inline-block rounded-full shrink-0"
          style={{ background: color, width: selected ? 10 : 8, height: selected ? 10 : 8 }}
        />
        <span className="font-semibold text-sm truncate" style={{ color: "var(--tan)" }}>
          {label}
        </span>
      </div>

      <div className="mono text-[10px] mt-0.5" style={{ color: "var(--tan-3)" }}>
        {typeLabel}
        {subLabel ? ` · ${subLabel}` : ""}
      </div>

      {selected && (
        <CardBody
          entity={entity}
          graphData={graphData}
          entityById={entityById}
          onSelect={onSelect}
          onNavigateDoc={onNavigateDoc}
        />
      )}
      {!selected && degree > 0 && (
        <div className="mono text-[9px] mt-1" style={{ color: "var(--tan-3)" }}>
          {degree} connection{degree !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
});

function CardBody({
  entity,
  graphData,
  entityById,
  onSelect,
  onNavigateDoc,
}: {
  entity: Participant;
  graphData: GraphData;
  entityById: Map<string, Participant>;
  onSelect: (id: string) => void;
  onNavigateDoc: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const rels = getEntityRelations(entity.id, graphData, entityById);
    // Key includes direction so the group label matches every chip in the group.
    const byType = new Map<
      string,
      { edgeType: string; direction: "outbound" | "inbound"; rels: EntityRelation[] }
    >();
    for (const r of rels) {
      const k = `${r.edge.e}|${r.direction}`;
      let bucket = byType.get(k);
      if (!bucket) {
        bucket = { edgeType: r.edge.e, direction: r.direction, rels: [] };
        byType.set(k, bucket);
      }
      bucket.rels.push(r);
    }
    return [...byType.values()].sort((a, b) => b.rels.length - a.rels.length);
  }, [entity, graphData, entityById]);

  // Parse meta.params for instance entities — structured tuples of
  // [formattedValue, srcUuid, srcDocNo] per key.
  const params = useMemo(() => {
    const m = parseMeta<{ params?: Record<string, [string, string, string]> }>(entity.m);
    return m?.params && Object.keys(m.params).length > 0 ? m.params : null;
  }, [entity.m]);

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
      {entity.did && (
        <button
          className="mono text-[11px] hover:underline mb-3"
          style={{ color: "var(--accent)" }}
          onClick={(e) => {
            e.stopPropagation();
            onNavigateDoc(entity.did!);
          }}
        >
          → defining document
        </button>
      )}
      {params && (
        <div className="mb-3">
          <p
            className="mono text-[9px] uppercase tracking-wide mb-1"
            style={{ color: "var(--tan-3)" }}
          >
            parameters · {Object.keys(params).length}
          </p>
          <div className="space-y-1">
            {Object.entries(params).map(([key, [value, srcId, srcDocNo]]) => (
              <div key={key} className="text-[10px] leading-tight">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateDoc(srcId);
                  }}
                  className="mono hover:underline"
                  style={{ color: "var(--tan-3)" }}
                  title={srcDocNo}
                >
                  {key}
                </button>
                <span className="mx-1" style={{ color: "var(--tan-3)" }}>
                  :
                </span>
                <span style={{ color: "var(--tan-2)" }}>
                  {value.length > 90 ? value.slice(0, 90) + "…" : value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {grouped.length === 0 ? (
        <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
          No relations.
        </p>
      ) : (
        grouped.map(({ edgeType, direction, rels }) => (
          <div key={`${edgeType}|${direction}`} className="mb-2.5 last:mb-0">
            <p
              className="mono text-[9px] uppercase tracking-wide mb-1"
              style={{ color: "var(--tan-3)" }}
            >
              {edgeLabel(edgeType, direction)} · {rels.length}
            </p>
            <div className="flex flex-wrap gap-1">
              {rels.map((r, i) => (
                <RelationChip key={i} rel={r} onSelect={onSelect} onNavigateDoc={onNavigateDoc} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function RelationChip({
  rel,
  onSelect,
  onNavigateDoc,
}: {
  rel: EntityRelation;
  onSelect: (id: string) => void;
  onNavigateDoc: (id: string) => void;
}) {
  const { otherType, otherId, otherLabel, direction } = rel;
  const sources = rel.edge.s ?? [];
  const arrow = direction === "outbound" ? "→" : "←";

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (otherType === "entity") onSelect(otherId);
    else if (otherType === "doc") onNavigateDoc(otherId);
  };

  const clickable = otherType === "entity" || otherType === "doc";

  return (
    <button
      className={`mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${clickable ? "hover:bg-hover" : ""}`}
      style={{
        background: "var(--bg)",
        color: "var(--tan-2)",
        border: "1px solid var(--border)",
        cursor: clickable ? "pointer" : "default",
      }}
      onClick={clickable ? handle : undefined}
      title={sources.length ? `cited in ${sources.join(", ")}` : "structural edge"}
    >
      <span style={{ color: "var(--tan-3)" }}>{arrow}</span>
      <span>{otherLabel}</span>
    </button>
  );
}

const nodeTypes = { entity: EntityCard };

export function EntityFlow({
  nodes: entityNodes,
  edges: entityEdges,
  selectedId,
  onSelect,
  graphData,
  entityById,
  onNavigateDoc,
}: {
  nodes: EntityNodeData[];
  edges: EntityEdgeData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  graphData: GraphData;
  entityById: Map<string, Participant>;
  onNavigateDoc: (id: string) => void;
}) {
  // Compute positions once per nodes/edges reference using forceatlas2 + noverlap.
  const { rfNodes, rfEdges } = useMemo(() => {
    const graph = new MultiDirectedGraph();
    const N = entityNodes.length || 1;
    entityNodes.forEach((n, i) => {
      const angle = (i / N) * 2 * Math.PI;
      graph.addNode(n.id, {
        x: Math.cos(angle) * 200,
        y: Math.sin(angle) * 200,
        size: 90,
      });
    });
    for (const e of entityEdges) {
      if (graph.hasNode(e.src) && graph.hasNode(e.tgt)) {
        graph.addDirectedEdgeWithKey(e.key, e.src, e.tgt);
      }
    }
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 500,
      settings: { ...settings, gravity: 1.5, scalingRatio: 5, slowDown: 3 },
    });
    noverlap.assign(graph, {
      maxIterations: 300,
      settings: { margin: 12, ratio: 1.0, speed: 4 },
    });

    // Clamp outliers (isolated nodes like instances) back toward the cluster.
    // Cap at 1.2× the 85th-percentile radius so only true strays are pulled in.
    {
      const pts: { x: number; y: number }[] = [];
      graph.forEachNode((_, a) => pts.push({ x: a.x as number, y: a.y as number }));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const dists = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
      const cap = dists[Math.floor(dists.length * 0.85)] * 1.2;
      graph.updateEachNodeAttributes((_, attrs) => {
        const dx = (attrs.x as number) - cx;
        const dy = (attrs.y as number) - cy;
        const d = Math.hypot(dx, dy);
        if (d > cap) {
          const s = cap / d;
          return { ...attrs, x: cx + dx * s, y: cy + dy * s };
        }
        return attrs;
      });
    }

    const rfNodes: CardNode[] = entityNodes.map((n) => {
      const attrs = graph.getNodeAttributes(n.id);
      return {
        id: n.id,
        type: "entity",
        position: { x: attrs.x as number, y: attrs.y as number },
        data: {
          label: n.label,
          color: n.color,
          entityType: n.entity.et,
          subtype: n.entity.st,
          degree: n.degree,
          entity: n.entity,
          graphData,
          entityById,
          onSelect,
          onNavigateDoc,
        },
      };
    });

    const rfEdges: Edge[] = entityEdges.map((e) => ({
      id: e.key,
      source: e.src,
      target: e.tgt,
      label: edgeLabel(e.type, "outbound"),
      style: { stroke: EDGE_COLOR, strokeWidth: 1.2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 16, height: 16 },
      labelStyle: { fill: "#8a6a60", fontSize: 10, fontFamily: "'Source Code Pro', monospace" },
      labelBgStyle: { fill: "#160e0d", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
    }));

    return { rfNodes, rfEdges };
    // onSelect/onNavigateDoc/graphData/entityById are stable enough per user session;
    // relayout should only happen when the visible node/edge set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityNodes, entityEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges);

  // Rebuild state when the incoming (filtered) set changes.
  useEffect(() => {
    setNodes(rfNodes);
  }, [rfNodes, setNodes]);
  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  // Drive "selected" attribute from external selectedId so the card can expand.
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) =>
        n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId },
      ),
    );
  }, [selectedId, setNodes]);

  // Highlight edges incident to selection.
  useEffect(() => {
    setEdges((es) =>
      es.map((e) => {
        const active = selectedId && (e.source === selectedId || e.target === selectedId);
        return {
          ...e,
          style: { stroke: active ? EDGE_HIGHLIGHT : EDGE_COLOR, strokeWidth: active ? 2 : 1.2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: active ? EDGE_HIGHLIGHT : EDGE_COLOR,
            width: 16,
            height: 16,
          },
          zIndex: active ? 1 : 0,
        };
      }),
    );
  }, [selectedId, setEdges]);

  const handleNodeClick = useCallback<NodeMouseHandler<CardNode>>(
    (_, node) => {
      onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      maxZoom={2}
      nodesConnectable={false}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="#2a1a16" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
