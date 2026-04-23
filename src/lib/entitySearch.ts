import type { Participant } from "../types";

export interface EntityMatch {
  participant: Participant;
  score: number; // 3 exact, 2 prefix, 1 substring
}

export function searchParticipants(query: string, participants: Participant[]): EntityMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: EntityMatch[] = [];
  for (const e of participants) {
    const name = e.name.toLowerCase();
    let score = 0;
    if (name === q) score = 3;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    if (score > 0) hits.push({ participant: e, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.participant.name.length - b.participant.name.length);
}

/** Collect participants reachable within `depth` hops via entity↔entity edges. */
export function neighborhoodOfParticipants(
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

// Edges we follow one extra hop from an executor agent — to pull in their
// facilitator / govops / role-holders without also pulling in sibling primes.
const EXECUTOR_ROLE_EDGES = new Set([
  "operational_facilitator_for", "operational_govops_for",
  "core_facilitator_for", "core_govops_for",
  "holds_role_for", "erg_member_for",
]);

/** Cluster of participants affiliated with a Prime Agent: direct neighbors, plus
 *  the role-holders attached to any executor the agent reports to. Bounded
 *  traversal — does not leak across sibling primes that share an executor. */
export function agentClusterIds(
  agentId: string,
  allEntities: Array<{ id: string; et: string; st: string | null }>,
  edges: Array<{ f: string; t: string; ft: string; tt: string; e: string }>,
): Set<string> {
  const entityById = new Map(allEntities.map(e => [e.id, e]));
  const included = new Set<string>([agentId]);
  // Level 1: every entity directly connected to the agent.
  for (const e of edges) {
    if (e.ft !== "entity" || e.tt !== "entity") continue;
    if (e.f === agentId) included.add(e.t);
    if (e.t === agentId) included.add(e.f);
  }
  // Level 2: for executors in the set, pull in role-holders only.
  const executors = [...included].filter(id => {
    const p = entityById.get(id);
    return p?.et === "agent" && p.st !== "prime";
  });
  for (const execId of executors) {
    for (const e of edges) {
      if (e.ft !== "entity" || e.tt !== "entity") continue;
      if (!EXECUTOR_ROLE_EDGES.has(e.e)) continue;
      if (e.f === execId) included.add(e.t);
      if (e.t === execId) included.add(e.f);
    }
  }
  return included;
}
