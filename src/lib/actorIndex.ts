import type { AtlasNode, Participant, RelationEdge } from "../types";
import { ROUTES } from "./routes";
import { parseMeta } from "./meta";
import type { GraphData } from "./graph";
import type { InstanceMeta, RewardsAgent } from "./rewardsTypes";
import type { ActiveDataRow } from "./activeDataIndex";

export interface ChainNode { id: string; slug: string; name: string; et: string; st: string|null; docId: string|null; }
export interface ActorChain { prime: ChainNode|null; executors: ChainNode[]; facilitators: ChainNode[]; govops: ChainNode[]; }
export interface ActorRelation { edge: RelationEdge; direction: "outbound"|"inbound"; otherLabel: string; otherId: string; otherSlug: string|null; otherEt: string|null; }
export interface InstanceParam { key: string; value: string; srcDocId: string|null; }
export interface RadarInstance { id: string; slug: string; rawName: string; st: string; displayName: string; status: string|null; docId: string|null; docNo: string|null; signalParams: InstanceParam[]; paramCount: number; }
export interface Recommendation { kind: "missing-rp"|"governance-edge"|"no-rewards"; label: string; detail: string; reportLink?: string; entityLink?: string; }
export interface ActorProfile { entity: Participant; definingDoc: AtlasNode|null; chain: ActorChain; adRows: ActiveDataRow[]; rewardsAgent: RewardsAgent|null; relations: ActorRelation[]; instances: RadarInstance[]; recommendations: Recommendation[]; }
export interface SidebarActor { id: string; slug: string; name: string; et: string; st: string|null; docId: string|null; }
export interface SidebarGroup { label: string; actors: SidebarActor[]; }

const CHAIN_EDGES = new Set(["operational_executor_agent_for","core_executor_agent_for","operational_facilitator_for","core_facilitator_for","operational_govops_for","core_govops_for"]);
const EXEC_EDGES  = new Set(["operational_executor_agent_for","core_executor_agent_for"]);
const FAC_EDGES   = new Set(["operational_facilitator_for","core_facilitator_for"]);
const GOV_EDGES   = new Set(["operational_govops_for","core_govops_for"]);
const EXCLUDED_INSTANCE_TYPES = new Set(["root-edit"]);
const INSTANCE_TYPE_LABEL: Record<string,string> = {
  "agent-token":"Agent Token","allocation-system":"Allocation System","distribution-reward":"Distribution Reward",
  "integration-boost":"Integration Boost","upkeep-rebate":"Upkeep Rebate","executor-accord":"Executor Accord",
  "distribution-requirement":"Distribution Requirement","pioneer-chain":"Pioneer Chain","core-governance-reward":"Core Governance Reward",
};

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ADDR_KEY_RE = /address|addr|contract|wallet/i;
const TOKEN_KEY_RE = /token|symbol|ticker/i;
const PARTNER_KEY_RE = /partner|party|recipient/i;
const RATE_KEY_RE = /rate|cadence|limit|max|amount|cap|budget|reward|allocation/i;
function isSignal(key: string, val: string) {
  return EVM_RE.test(val) || SOL_RE.test(val) || ADDR_KEY_RE.test(key) || TOKEN_KEY_RE.test(key) || PARTNER_KEY_RE.test(key) || RATE_KEY_RE.test(key);
}

export function buildSidebarActors(graph: GraphData, docs: Record<string, AtlasNode>): SidebarGroup[] {
  const by = (pred: (p: Participant) => boolean): SidebarActor[] =>
    graph.participants.filter(pred)
      .sort((a, b) => {
        const da = (a.did && docs[a.did]?.doc_no) ?? "";
        const db = (b.did && docs[b.did]?.doc_no) ?? "";
        return da.localeCompare(db, undefined, { numeric: true });
      })
      .map(e => ({ id: e.id, slug: e.slug, name: e.name, et: e.et, st: e.st, docId: e.did }));
  return [
    { label: "Prime Agents",    actors: by(e => e.et==="agent" && e.st==="prime") },
    { label: "Executor Agents", actors: by(e => e.et==="agent" && e.st!=="prime" && e.st!==null) },
    { label: "Facilitators",    actors: by(e => e.et==="facilitator_org") },
    { label: "GovOps",          actors: by(e => e.et==="govops_org") },
  ].filter(g => g.actors.length > 0);
}

export function buildActorProfile(
  slug: string, graph: GraphData, docs: Record<string, AtlasNode>,
  rewardsIndex: { agents: RewardsAgent[] }, allActiveDataRows: ActiveDataRow[],
): ActorProfile | null {
  const entity = graph.participants.find(p => p.slug === slug);
  if (!entity) return null;
  const definingDoc = entity.did ? (docs[entity.did] ?? null) : null;

  const entityById = new Map(graph.participants.map(e => [e.id, e]));
  const edgesFrom = new Map<string, RelationEdge[]>();
  const edgesTo   = new Map<string, RelationEdge[]>();
  for (const e of graph.edges) {
    (edgesFrom.get(e.f) ?? (edgesFrom.set(e.f, []), edgesFrom.get(e.f)!)).push(e);
    (edgesTo.get(e.t)   ?? (edgesTo.set(e.t, []),   edgesTo.get(e.t)!)).push(e);
  }
  const cn = (p: Participant): ChainNode => ({ id: p.id, slug: p.slug, name: p.name, et: p.et, st: p.st, docId: p.did });
  const resolve = (ids: string[]) => ids.map(id => entityById.get(id)).filter((p): p is Participant => !!p);
  const execsTo  = (id: string) => (edgesTo.get(id)   ?? []).filter(e => EXEC_EDGES.has(e.e));
  const execsFrom= (id: string) => (edgesFrom.get(id) ?? []).filter(e => EXEC_EDGES.has(e.e));
  const facsTo   = (id: string) => (edgesTo.get(id)   ?? []).filter(e => FAC_EDGES.has(e.e));
  const govsTo   = (id: string) => (edgesTo.get(id)   ?? []).filter(e => GOV_EDGES.has(e.e));

  let chain: ActorChain;
  const { et, st } = entity;
  if (et === "agent" && st === "prime") {
    const execEdge = execsTo(entity.id)[0];
    const exec = execEdge ? entityById.get(execEdge.f) : null;
    chain = { prime: cn(entity), executors: exec ? [cn(exec)] : [],
      facilitators: exec ? resolve(facsTo(exec.id).map(e=>e.f)).map(cn) : [],
      govops:       exec ? resolve(govsTo(exec.id).map(e=>e.f)).map(cn) : [] };
  } else if (et === "agent") {
    const primeEdge = execsFrom(entity.id)[0];
    const prime = primeEdge ? entityById.get(primeEdge.t) : null;
    chain = { prime: prime ? cn(prime) : null, executors: [cn(entity)],
      facilitators: resolve(facsTo(entity.id).map(e=>e.f)).map(cn),
      govops:       resolve(govsTo(entity.id).map(e=>e.f)).map(cn) };
  } else if (et === "facilitator_org") {
    const facEdge = (edgesFrom.get(entity.id)??[]).find(e => FAC_EDGES.has(e.e));
    const exec = facEdge ? entityById.get(facEdge.t) : null;
    const primeEdge = exec ? execsFrom(exec.id)[0] : null;
    const prime = primeEdge ? entityById.get(primeEdge.t) : null;
    chain = { prime: prime ? cn(prime) : null, executors: exec ? [cn(exec)] : [],
      facilitators: exec ? resolve(facsTo(exec.id).map(e=>e.f)).map(cn) : [cn(entity)],
      govops:       exec ? resolve(govsTo(exec.id).map(e=>e.f)).map(cn) : [] };
  } else {
    const govEdges = (edgesFrom.get(entity.id)??[]).filter(e => GOV_EDGES.has(e.e));
    const execs = resolve(govEdges.map(e=>e.t));
    const primeEdge = execs[0] ? execsFrom(execs[0].id)[0] : null;
    const prime = primeEdge ? entityById.get(primeEdge.t) : null;
    chain = { prime: prime ? cn(prime) : null, executors: execs.map(cn),
      facilitators: execs.flatMap(ex => resolve(facsTo(ex.id).map(e=>e.f)).map(cn)),
      govops: execs[0] ? resolve(govsTo(execs[0].id).map(e=>e.f)).map(cn) : [cn(entity)] };
  }

  const seenAd = new Set<string>();
  const adRows = allActiveDataRows.filter(r => {
    const hit = r.responsibleParty?.id===entity.id || r.facilitator?.id===entity.id
      || (et==="agent" && st==="prime" && r.agent===entity.name);
    if (!hit || seenAd.has(r.activeDataId)) return false;
    seenAd.add(r.activeDataId); return true;
  });

  const rewardsAgent = rewardsIndex.agents.find(a => a.agentEntity?.id===entity.id) ?? null;

  const relations: ActorRelation[] = [];
  for (const e of graph.edges) {
    if (e.ft!=="entity" || e.tt!=="entity" || CHAIN_EDGES.has(e.e)) continue;
    if (e.f!==entity.id && e.t!==entity.id) continue;
    const dir = e.f===entity.id ? "outbound" as const : "inbound" as const;
    const otherId = dir==="outbound" ? e.t : e.f;
    const other = entityById.get(otherId);
    relations.push({ edge:e, direction:dir, otherLabel: other?.name ?? otherId.slice(0,8), otherId, otherSlug: other?.slug??null, otherEt: other?.et??null });
  }

  const instances: RadarInstance[] = [];
  if (definingDoc) {
    for (const inst of graph.instances) {
      if (!inst.m || !inst.st || EXCLUDED_INSTANCE_TYPES.has(inst.st)) continue;
      const meta = parseMeta<InstanceMeta>(inst.m);
      if (!meta) continue;
      if (meta.agent_doc_no !== definingDoc.doc_no) continue;
      const signalParams = Object.entries(meta.params)
        .filter(([k, t]) => isSignal(k, t[0]))
        .map(([key, t]) => ({ key, value: t[0], srcDocId: t[1] || null }));
      const displayName = inst.name==="Single" ? (INSTANCE_TYPE_LABEL[inst.st]??inst.st) : inst.name;
      const instDoc = inst.did ? docs[inst.did] : null;
      instances.push({ id:inst.id, slug:inst.slug, rawName:inst.name, st:inst.st, displayName, status:meta.status, docId:inst.did, docNo: instDoc?.doc_no ?? meta.primitive_doc_no, signalParams, paramCount: Object.keys(meta.params).length });
    }
  }

  const recommendations: Recommendation[] = [];
  const missingRP = adRows.filter(r => !r.responsibleParty).length;
  if (missingRP>0) recommendations.push({ kind:"missing-rp", label:`${missingRP} AD doc${missingRP>1?"s":""} without a responsible party`, detail:"These active data docs have no declared responsible party.", reportLink: ROUTES.REPORTS_ACTIVE_DATA });
  if (et==="agent" && st==="prime" && !rewardsAgent) recommendations.push({ kind:"no-rewards", label:"No DR or IB primitives found", detail:"This prime agent has no distribution reward or integration boost instances.", reportLink: ROUTES.REPORTS_REWARDS });
  for (const r of relations) {
    if (r.otherEt && ["governance_body","composite_party"].includes(r.otherEt))
      recommendations.push({ kind:"governance-edge", label:`Governance relationship: ${r.otherLabel}`, detail:`Edge type: ${r.edge.e}`, entityLink:r.otherSlug??undefined });
  }

  return { entity, definingDoc, chain, adRows, rewardsAgent, relations, instances, recommendations };
}
