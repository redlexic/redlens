import type { RelationEntity } from "../types";

export interface EntityMatch {
  entity: RelationEntity;
  score: number; // 3 exact, 2 prefix, 1 substring
}

export function searchEntities(query: string, entities: RelationEntity[]): EntityMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: EntityMatch[] = [];
  for (const e of entities) {
    const name = e.name.toLowerCase();
    let score = 0;
    if (name === q) score = 3;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    if (score > 0) hits.push({ entity: e, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.entity.name.length - b.entity.name.length);
}

/** Collect entities reachable within `depth` hops via entity↔entity edges. */
export function neighborhoodOfEntities(
  seedIds: Iterable<string>,
  edges: Array<{ f: string; t: string; ft: string; tt: string }>,
  depth: number,
): Set<string> {
  const included = new Set<string>(seedIds);
  let frontier = new Set<string>(included);
  for (let d = 0; d < depth && frontier.size > 0; d++) {
    const next = new Set<string>();
    for (const e of edges) {
      if (e.ft !== "entity" || e.tt !== "entity") continue;
      if (frontier.has(e.f) && !included.has(e.t)) { next.add(e.t); included.add(e.t); }
      if (frontier.has(e.t) && !included.has(e.f)) { next.add(e.f); included.add(e.f); }
    }
    frontier = next;
  }
  return included;
}
