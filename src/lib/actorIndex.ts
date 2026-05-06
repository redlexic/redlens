import type { AtlasNode, Participant, RelationEdge } from "../types";
import { ROUTES } from "./routes";
import { parseMeta } from "./meta";
import type { GraphData } from "./graph";
import type { InstanceMeta, RewardsAgent } from "./rewardsTypes";
import type { ActiveDataRow } from "./activeDataIndex";

export interface ChainNode {
  id: string;
  slug: string;
  name: string;
  et: string;
  st: string | null;
  docId: string | null;
}
export interface ActorChain {
  primes: ChainNode[];
  executors: ChainNode[];
  facilitators: ChainNode[];
  govops: ChainNode[];
}
export interface ActorRelation {
  edge: RelationEdge;
  direction: "outbound" | "inbound";
  otherLabel: string;
  otherId: string;
  otherSlug: string | null;
  otherEt: string | null;
}
export interface InstanceParam {
  key: string;
  value: string;
  srcDocId: string | null;
}
export interface RadarInstance {
  id: string;
  slug: string;
  rawName: string;
  st: string;
  displayName: string;
  status: string | null;
  docId: string | null;
  docNo: string | null;
  primitiveTitle: string | null;
  primitiveDocId: string | null;
  primitiveCategory: string | null;
  primitiveCategoryDocId: string | null;
  isUnknownPrimitive: boolean;
  signalParams: InstanceParam[];
}
export interface Recommendation {
  kind: "missing-rp" | "governance-edge" | "no-rewards";
  label: string;
  detail: string;
  reportLink?: string;
  entityLink?: string;
}
export interface ActorProfile {
  entity: Participant;
  definingDoc: AtlasNode | null;
  chain: ActorChain;
  adRows: ActiveDataRow[];
  rewardsAgent: RewardsAgent | null;
  relations: ActorRelation[];
  instances: RadarInstance[];
  recommendations: Recommendation[];
  comprisesMembers: { name: string; slug: string | null }[];
  partOfComposite: { name: string; slug: string | null } | null;
}
export interface SidebarActor {
  id: string;
  slug: string;
  name: string;
  et: string;
  st: string | null;
  docId: string | null;
}
export interface SidebarGroup {
  label: string;
  actors: SidebarActor[];
}

const CHAIN_EDGES = new Set([
  "operational_executor_agent_for",
  "core_executor_agent_for",
  "operational_facilitator_for",
  "core_facilitator_for",
  "operational_govops_for",
  "core_govops_for",
]);
const EXEC_EDGES = new Set(["operational_executor_agent_for", "core_executor_agent_for"]);
const FAC_EDGES = new Set(["operational_facilitator_for", "core_facilitator_for"]);
const GOV_EDGES = new Set(["operational_govops_for", "core_govops_for"]);
const EXCLUDED_INSTANCE_TYPES = new Set(["root-edit"]);

// Params whose values are purely forward references to other docs — no displayable content.
const PARAM_BLACKLIST = new Set(["Tracking Methodology", "Operational Executor Agent"]);

export function buildSidebarActors(
  graph: GraphData,
  docs: Record<string, AtlasNode>,
): SidebarGroup[] {
  const by = (pred: (p: Participant) => boolean): SidebarActor[] =>
    graph.participants
      .filter(pred)
      .sort((a, b) => {
        const da = (a.did && docs[a.did]?.doc_no) ?? "";
        const db = (b.did && docs[b.did]?.doc_no) ?? "";
        return da.localeCompare(db, undefined, { numeric: true });
      })
      .map((e) => ({ id: e.id, slug: e.slug, name: e.name, et: e.et, st: e.st, docId: e.did }));
  return [
    { label: "Prime Agents", actors: by((e) => e.et === "agent" && e.st === "prime") },
    {
      label: "Executor Agents",
      actors: by((e) => e.et === "agent" && e.st !== "prime" && e.st !== null),
    },
    { label: "Facilitators", actors: by((e) => e.et === "facilitator_org") },
    { label: "GovOps", actors: by((e) => e.et === "govops_org") },
  ].filter((g) => g.actors.length > 0);
}

export function buildActorProfile(
  slug: string,
  graph: GraphData,
  docs: Record<string, AtlasNode>,
  rewardsIndex: { agents: RewardsAgent[] },
  allActiveDataRows: ActiveDataRow[],
): ActorProfile | null {
  const entity = graph.participants.find((p) => p.slug === slug);
  if (!entity) return null;
  const definingDoc = entity.did ? (docs[entity.did] ?? null) : null;

  const entityById = new Map(graph.participants.map((e) => [e.id, e]));
  const edgesFrom = new Map<string, RelationEdge[]>();
  const edgesTo = new Map<string, RelationEdge[]>();
  for (const e of graph.edges) {
    (edgesFrom.get(e.f) ?? (edgesFrom.set(e.f, []), edgesFrom.get(e.f)!)).push(e);
    (edgesTo.get(e.t) ?? (edgesTo.set(e.t, []), edgesTo.get(e.t)!)).push(e);
  }
  const cn = (p: Participant): ChainNode => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    et: p.et,
    st: p.st,
    docId: p.did,
  });
  const resolve = (ids: string[]) =>
    ids.map((id) => entityById.get(id)).filter((p): p is Participant => !!p);
  const execsTo = (id: string) => (edgesTo.get(id) ?? []).filter((e) => EXEC_EDGES.has(e.e));
  const execsFrom = (id: string) => (edgesFrom.get(id) ?? []).filter((e) => EXEC_EDGES.has(e.e));
  const facsTo = (id: string) => (edgesTo.get(id) ?? []).filter((e) => FAC_EDGES.has(e.e));
  const govsTo = (id: string) => (edgesTo.get(id) ?? []).filter((e) => GOV_EDGES.has(e.e));

  const dedup = (nodes: ChainNode[]) => {
    const seen = new Set<string>();
    return nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  };
  const primesOf = (execs: Participant[]) =>
    dedup(
      resolve(execs.flatMap((ex) => execsFrom(ex.id).map((e) => e.t))).map(cn),
    );

  let chain: ActorChain;
  const { et, st } = entity;
  if (et === "agent" && st === "prime") {
    const execs = resolve(execsTo(entity.id).map((e) => e.f));
    chain = {
      primes: [cn(entity)],
      executors: execs.map(cn),
      facilitators: execs.length > 0 ? dedup(execs.flatMap((ex) => resolve(facsTo(ex.id).map((e) => e.f)).map(cn))) : [],
      govops: execs.length > 0 ? dedup(execs.flatMap((ex) => resolve(govsTo(ex.id).map((e) => e.f)).map(cn))) : [],
    };
  } else if (et === "agent") {
    const primes = resolve(execsFrom(entity.id).map((e) => e.t));
    chain = {
      primes: primes.map(cn),
      executors: [cn(entity)],
      facilitators: dedup(resolve(facsTo(entity.id).map((e) => e.f)).map(cn)),
      govops: dedup(resolve(govsTo(entity.id).map((e) => e.f)).map(cn)),
    };
  } else if (et === "facilitator_org") {
    const facEdges = (edgesFrom.get(entity.id) ?? []).filter((e) => FAC_EDGES.has(e.e));
    const execs = resolve(facEdges.map((e) => e.t));
    chain = {
      primes: primesOf(execs),
      executors: execs.map(cn),
      facilitators: execs.length > 0 ? dedup(execs.flatMap((ex) => resolve(facsTo(ex.id).map((e) => e.f)).map(cn))) : [cn(entity)],
      govops: execs.length > 0 ? dedup(execs.flatMap((ex) => resolve(govsTo(ex.id).map((e) => e.f)).map(cn))) : [],
    };
  } else {
    const govEdges = (edgesFrom.get(entity.id) ?? []).filter((e) => GOV_EDGES.has(e.e));
    const execs = resolve(govEdges.map((e) => e.t));
    chain = {
      primes: primesOf(execs),
      executors: execs.map(cn),
      facilitators: dedup(execs.flatMap((ex) => resolve(facsTo(ex.id).map((e) => e.f)).map(cn))),
      govops: execs.length > 0 ? dedup(execs.flatMap((ex) => resolve(govsTo(ex.id).map((e) => e.f)).map(cn))) : [cn(entity)],
    };
  }

  const seenAd = new Set<string>();
  const adRows = allActiveDataRows.filter((r) => {
    const hit =
      r.responsibleParty?.id === entity.id ||
      r.facilitator?.id === entity.id ||
      (et === "agent" && st === "prime" && r.agent === entity.name);
    if (!hit || seenAd.has(r.activeDataId)) return false;
    seenAd.add(r.activeDataId);
    return true;
  });

  const rewardsAgent = rewardsIndex.agents.find((a) => a.agentEntity?.id === entity.id) ?? null;

  // Collect comprises members for composite parties before filtering
  const comprisesMembers: { name: string; slug: string | null }[] = graph.edges
    .filter((e) => e.e === "comprises" && e.f === entity.id && e.tt === "entity")
    .map((e) => {
      const m = entityById.get(e.t);
      return { name: m?.name ?? e.t.slice(0, 8), slug: m?.slug ?? null };
    });

  // If this entity is a member of a composite party, surface that for navigation
  const compositeEdge = graph.edges.find(
    (e) => e.e === "comprises" && e.t === entity.id && e.ft === "entity",
  );
  const compositeParty = compositeEdge ? entityById.get(compositeEdge.f) : null;
  const partOfComposite = compositeParty
    ? { name: compositeParty.name, slug: compositeParty.slug ?? null }
    : null;

  const relations: ActorRelation[] = [];
  for (const e of graph.edges) {
    if (e.ft !== "entity" || e.tt !== "entity" || CHAIN_EDGES.has(e.e)) continue;
    if (e.e === "comprises" || e.e === "member_of" || e.e === "cites" || e.e === "cited_by") continue;
    if (e.f !== entity.id && e.t !== entity.id) continue;
    const dir = e.f === entity.id ? ("outbound" as const) : ("inbound" as const);
    const otherId = dir === "outbound" ? e.t : e.f;
    const other = entityById.get(otherId);
    if (!other) continue; // instance or unresolvable entity — skip
    relations.push({
      edge: e,
      direction: dir,
      otherLabel: other.name,
      otherId,
      otherSlug: other.slug ?? null,
      otherEt: other.et ?? null,
    });
  }

  // instance config doc ID → primitive doc ID (from instance_of edges)
  const instanceOfMap = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.e === "instance_of" && e.ft === "doc" && e.tt === "doc") instanceOfMap.set(e.f, e.t);
  }

  const instances: RadarInstance[] = [];
  if (definingDoc) {
    for (const inst of graph.instances) {
      if (!inst.m || !inst.st || EXCLUDED_INSTANCE_TYPES.has(inst.st)) continue;
      const meta = parseMeta<InstanceMeta>(inst.m);
      if (!meta) continue;
      if (meta.agent_doc_id !== definingDoc.id) continue;
      const signalParams = Object.entries(meta.params)
        .filter(([k]) => !PARAM_BLACKLIST.has(k))
        .map(([key, t]) => ({ key, value: t[0], srcDocId: t[1] || null }));
      const instDoc = inst.did ? docs[inst.did] : null;
      const primitiveDocId = inst.did ? (instanceOfMap.get(inst.did) ?? null) : null;
      const primitiveDoc = primitiveDocId ? docs[primitiveDocId] : null;
      instances.push({
        id: inst.id,
        slug: inst.slug,
        rawName: inst.name,
        st: inst.st,
        displayName: inst.name,
        status: meta.status,
        docId: inst.did,
        docNo: instDoc?.doc_no ?? null,
        primitiveTitle: primitiveDoc?.title ?? null,
        primitiveDocId,
        primitiveCategoryDocId: meta.primitive_category_doc_id ?? null,
        primitiveCategory: meta.primitive_category_doc_id ? (docs[meta.primitive_category_doc_id]?.title ?? null) : null,
        isUnknownPrimitive: meta.is_unknown_primitive ?? false,
        signalParams,
      });
    }
  }

  const recommendations: Recommendation[] = [];
  const missingRP = adRows.filter((r) => !r.responsibleParty).length;
  if (missingRP > 0)
    recommendations.push({
      kind: "missing-rp",
      label: `${missingRP} AD doc${missingRP > 1 ? "s" : ""} without a responsible party`,
      detail: "These active data docs have no declared responsible party.",
      reportLink: ROUTES.REPORTS_ACTIVE_DATA,
    });
  if (et === "agent" && st === "prime" && !rewardsAgent)
    recommendations.push({
      kind: "no-rewards",
      label: "No DR or IB primitives found",
      detail: "This prime agent has no distribution reward or integration boost instances.",
      reportLink: ROUTES.REPORTS_REWARDS,
    });
  for (const r of relations) {
    if (r.otherEt && ["governance_body", "composite_party"].includes(r.otherEt))
      recommendations.push({
        kind: "governance-edge",
        label: `Governance relationship: ${r.otherLabel}`,
        detail: `Edge type: ${r.edge.e}`,
        entityLink: r.otherSlug ?? undefined,
      });
  }

  return {
    entity,
    definingDoc,
    chain,
    adRows,
    rewardsAgent,
    relations,
    instances,
    recommendations,
    comprisesMembers,
    partOfComposite,
  };
}
