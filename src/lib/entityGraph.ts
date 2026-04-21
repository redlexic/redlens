import type { RelationEntity, RelationEdge } from "../types";
import type { GraphData } from "./graph";

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  agent: "Agent",
  operational_facilitator: "Operational Facilitator",
  core_facilitator: "Core Facilitator",
  govops: "GovOps",
  alignment_conserver: "Alignment Conserver",
  ecosystem_actor: "Ecosystem Actor",
  scope: "Scope",
};

export const SUBTYPE_LABEL: Record<string, string> = {
  prime: "Prime",
  executor: "Executor",
  aligned_delegate: "Aligned Delegate",
  operational: "Operational",
  core: "Core",
};

export const EDGE_TYPE_LABEL: Record<string, string> = {
  executor_accord: "Executor Accord",
  member_of: "Member of",
  ecosystem_accord: "Ecosystem Accord",
  defines_entity: "Defined by",
  has_address: "Has Address",
  responsible_for: "Responsible for",
  member_of_erg: "Member of ERG",
};

export const ENTITY_TYPE_COLOR: Record<string, string> = {
  agent: "#c67267",
  operational_facilitator: "#e0a060",
  core_facilitator: "#b88a4a",
  govops: "#8fb8c2",
  alignment_conserver: "#9ab58a",
  ecosystem_actor: "#a89090",
  scope: "#d4b878",
};

export interface EntityNodeData {
  id: string;
  label: string;
  entity: RelationEntity;
  color: string;
  degree: number;
  size: number;
}

export interface EntityEdgeData {
  key: string;
  src: string;
  tgt: string;
  type: string;
  sources: string[];
}

export interface EntityRelation {
  edge: RelationEdge;
  direction: "outbound" | "inbound";
  otherId: string;
  otherType: "doc" | "entity" | "address";
  otherLabel: string;
}

/** Visual importance: primes are the focal point, executors are the hubs they report to. */
function nodeSize(ent: RelationEntity, degree: number): number {
  if (ent.et === "agent" && ent.st === "prime") return 14;
  if (ent.et === "agent" && ent.st === "executor") return 10;
  return 4 + Math.min(degree, 8) * 0.8;
}

/** Build the set of entity nodes with computed degree (counts direct entity↔entity edges only). */
export function buildEntityNodes(data: GraphData): EntityNodeData[] {
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    if (e.ft === "entity" && e.tt === "entity") {
      degree.set(e.f, (degree.get(e.f) ?? 0) + 1);
      degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
    }
  }
  return data.entities.map(ent => {
    const d = degree.get(ent.id) ?? 0;
    return {
      id: ent.id,
      label: ent.name,
      entity: ent,
      color: ENTITY_TYPE_COLOR[ent.et] ?? "#888888",
      degree: d,
      size: nodeSize(ent, d),
    };
  });
}

/** Entity types that participate in direct entity↔entity edges. */
export const CONNECTED_ENTITY_TYPES: ReadonlySet<string> = new Set(["agent", "ecosystem_actor"]);

/** Entity↔entity edges only, for the sigma canvas. */
export function buildEntityEdges(data: GraphData): EntityEdgeData[] {
  const out: EntityEdgeData[] = [];
  let i = 0;
  for (const e of data.edges) {
    if (e.ft !== "entity" || e.tt !== "entity") continue;
    out.push({
      key: `e${i++}`,
      src: e.f,
      tgt: e.t,
      type: e.e,
      sources: e.s ?? [],
    });
  }
  return out;
}

/** Every edge that involves an entity on either end, grouped by direction relative to `entityId`.
 *  Used by the detail panel — includes entity↔doc and entity↔address edges too. */
export function getEntityRelations(
  entityId: string,
  data: GraphData,
  entityById: Map<string, RelationEntity>,
): EntityRelation[] {
  const rels: EntityRelation[] = [];
  for (const e of data.edges) {
    if (e.f === entityId) {
      rels.push({
        edge: e,
        direction: "outbound",
        otherId: e.t,
        otherType: e.tt as EntityRelation["otherType"],
        otherLabel: labelFor(e.t, e.tt, entityById),
      });
    } else if (e.t === entityId) {
      rels.push({
        edge: e,
        direction: "inbound",
        otherId: e.f,
        otherType: e.ft as EntityRelation["otherType"],
        otherLabel: labelFor(e.f, e.ft, entityById),
      });
    }
  }
  return rels;
}

function labelFor(id: string, type: string, entityById: Map<string, RelationEntity>): string {
  if (type === "entity") return entityById.get(id)?.name ?? id.slice(0, 8);
  if (type === "address") return id.startsWith("addr:") ? id.slice(5, 17) + "…" : id.slice(0, 10);
  return id;
}

export function buildEntityIndex(entities: RelationEntity[]): Map<string, RelationEntity> {
  const m = new Map<string, RelationEntity>();
  for (const e of entities) m.set(e.id, e);
  return m;
}
