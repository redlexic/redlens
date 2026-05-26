import type { GraphEntity, RelationEdge } from "../types";
import { actorHref, atlasHref } from "./routes";

const RADAR_ETS = new Set(["agent", "facilitator_org", "govops_org"]);
// Entity types that appear on an agent's radar page via comprises edges.
const COMPRISES_ETS = new Set(["composite_party", "foundation", "development_company"]);

/**
 * Returns a map of participant id → href for search entity hit links.
 * Sidebar actors get their own radar page; composite/foundation/dev-company
 * entities resolve to the agent's radar page via comprises edges; others fall
 * back to their defining atlas doc, or are omitted.
 */
export function buildParticipantLinks(
  participants: GraphEntity[],
  edges: RelationEdge[],
): Map<string, string> {
  const byId = new Map(participants.map((e) => [e.id, e]));
  const result = new Map<string, string>();

  for (const e of participants) {
    if (RADAR_ETS.has(e.et)) result.set(e.id, actorHref(e.slug));
  }

  // Two-pass over comprises edges:
  // Pass 1 — map composite_party to its agent's radar page.
  // Pass 2 — map foundation/dev_company to that composite_party's agent link.
  for (const edge of edges) {
    if (edge.e !== "comprises" || edge.ft !== "entity" || edge.tt !== "entity") continue;
    const from = byId.get(edge.f);
    const to = byId.get(edge.t);
    if (!from || !to || from.et !== "composite_party" || to.et !== "agent") continue;
    result.set(from.id, actorHref(to.slug));
  }
  for (const edge of edges) {
    if (edge.e !== "comprises" || edge.ft !== "entity" || edge.tt !== "entity") continue;
    const from = byId.get(edge.f);
    const to = byId.get(edge.t);
    if (!from || !to || from.et !== "composite_party" || !COMPRISES_ETS.has(to.et)) continue;
    const agentLink = result.get(from.id);
    if (agentLink) result.set(to.id, agentLink);
  }

  // Fallback: defining atlas doc for anything still unmapped.
  for (const e of participants) {
    if (!result.has(e.id) && e.did) result.set(e.id, atlasHref(e.did));
  }

  return result;
}

interface EntityMatch {
  participant: GraphEntity;
  score: number; // 3 exact, 2 prefix, 1 substring
}

export function matchParticipants(query: string, participants: GraphEntity[]): EntityMatch[] {
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
  return hits.sort(
    (a, b) => b.score - a.score || a.participant.name.length - b.participant.name.length,
  );
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
      if (frontier.has(e.f) && !included.has(e.t)) {
        next.add(e.t);
        included.add(e.t);
      }
      if (frontier.has(e.t) && !included.has(e.f)) {
        next.add(e.f);
        included.add(e.f);
      }
    }
    frontier = next;
  }
  return included;
}

// Edges we follow one extra hop from an executor agent — to pull in their
// facilitator / govops / role-holders without also pulling in sibling primes.
const EXECUTOR_ROLE_EDGES = new Set([
  "operational_facilitator_for",
  "operational_govops_for",
  "core_facilitator_for",
  "core_govops_for",
  "holds_role_for",
  "erg_member_for",
]);

/** Cluster of participants affiliated with a Prime Agent: direct neighbors, plus
 *  the role-holders attached to any executor the agent reports to. Bounded
 *  traversal — does not leak across sibling primes that share an executor. */
export function agentClusterIds(
  agentId: string,
  allEntities: Array<{ id: string; et: string; st: string | null }>,
  edges: Array<{ f: string; t: string; ft: string; tt: string; e: string }>,
): Set<string> {
  const entityById = new Map(allEntities.map((e) => [e.id, e]));
  const included = new Set<string>([agentId]);
  // Level 1: every entity directly connected to the agent.
  for (const e of edges) {
    if (e.ft !== "entity" || e.tt !== "entity") continue;
    if (e.f === agentId) included.add(e.t);
    if (e.t === agentId) included.add(e.f);
  }
  // Level 2: for executors in the set, pull in role-holders only.
  const executors = [...included].filter((id) => {
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
