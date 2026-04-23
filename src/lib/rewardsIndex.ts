import type { AtlasNode, RelationEdge, Participant } from "../types";
import { agentsFromGraph, type AgentRef } from "./activeDataIndex";
import type { GraphData } from "./graph";
import type {
  AgentPrimitive, EntityRef, InstanceMeta, InstanceStatus, OperationalChain, ParamTuple,
  PrimitiveKind, RewardsAgent, RewardsEcosystemNode, RewardsIndex, RewardsInstance,
} from "./rewardsTypes";

export * from "./rewardsTypes";

const plain = (n: AtlasNode | undefined) => (n?.content ?? "").trim();
const unwrapBackticks = (s: string) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;
const UUID_LINK_RE = /\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/;

interface GraphCtx {
  paymentControllerByInstance: Map<string, AtlasNode>; // keyed by ICD doc_no
  rpByDocId: Map<string, EntityRef>;
  entityById: Map<string, Participant>;
  edges: RelationEdge[];
  instanceEntities: Participant[];
  instanceMetaById: Map<string, InstanceMeta>;
}

function buildGraphCtx(byDocNo: Map<string, AtlasNode>, graph?: GraphData): GraphCtx {
  // Build a UUID → doc index so we can look up active_data_for edge targets.
  const docById = new Map<string, AtlasNode>();
  for (const d of byDocNo.values()) docById.set(d.id, d);

  // Locate each DR Payment Active Data Controller via active_data_for graph
  // edges. Edge direction: doc(*.0.6.1 "List Of Payments") → doc(controller).
  // Stripping the last 2 segments of the controller's doc_no yields the ICD
  // doc_no (works for active/completed ".3.4" and in-progress ".4.4" tiers).
  const paymentControllerByInstance = new Map<string, AtlasNode>();
  for (const e of graph?.edges ?? []) {
    if (e.e !== "active_data_for") continue;
    const controller = docById.get(e.t);
    if (!controller || controller.title !== "Distribution Reward Payments") continue;
    const parts = controller.doc_no.split(".");
    if (parts.length > 2) paymentControllerByInstance.set(parts.slice(0, -2).join("."), controller);
  }
  const allEntities = [...(graph?.participants ?? []), ...(graph?.instances ?? [])];
  const entityById = new Map<string, Participant>(allEntities.map(e => [e.id, e]));
  const rpByDocId = new Map<string, EntityRef>();
  for (const e of graph?.edges ?? []) {
    if (e.e !== "responsible_party_for") continue;
    const ent = entityById.get(e.f);
    if (ent) rpByDocId.set(e.t, { id: ent.id, name: ent.name, slug: ent.slug });
  }
  const instanceEntities: Participant[] = [];
  const instanceMetaById = new Map<string, InstanceMeta>();
  for (const ent of graph?.instances ?? []) {
    if (!ent.m) continue;
    try {
      const m = JSON.parse(ent.m) as InstanceMeta;
      instanceEntities.push(ent);
      instanceMetaById.set(ent.id, {
        agent_doc_no: m.agent_doc_no ?? null,
        primitive_doc_no: m.primitive_doc_no ?? null,
        status: m.status ?? null,
        params: m.params ?? {},
      });
    } catch { /* ignore */ }
  }
  return { paymentControllerByInstance, rpByDocId, entityById, edges: graph?.edges ?? [], instanceEntities, instanceMetaById };
}

function resolveChain(ctx: GraphCtx, primeId: string): OperationalChain | null {
  const execEdge = ctx.edges.find(e => e.e === "operational_executor_agent_for" && e.t === primeId);
  const exec = execEdge ? ctx.entityById.get(execEdge.f) : null;
  const govEdge = exec ? ctx.edges.find(e => e.e === "operational_govops_for" && e.t === exec.id) : null;
  const gov = govEdge ? ctx.entityById.get(govEdge.f) : null;
  if (!exec && !gov) return null;
  return {
    executor: exec ? { id: exec.id, name: exec.name, slug: exec.slug } : null,
    govops: gov ? { id: gov.id, name: gov.name, slug: gov.slug } : null,
  };
}

function applyParamTuples(
  inst: RewardsInstance, params: Record<string, ParamTuple>,
  kind: PrimitiveKind, docs: Record<string, AtlasNode>,
): void {
  const take = (key: string): [string, string, string] | null => {
    const t = params[key]; return t && t[0] ? t : null;
  };
  if (kind === "DR") {
    const rc = take("Reward Code"); if (rc) { inst.rewardCode = rc[0]; inst.rewardCodeDocId = rc[1]; }
    const tr = take("Tracking Methodology");
    if (tr) {
      inst.tracking = tr[0];
      const rawContent = docs[tr[1]]?.content ?? "";
      const linkedId = rawContent.match(UUID_LINK_RE)?.[1];
      const target = linkedId ? docs[linkedId] : null;
      inst.trackingDocId = target?.id ?? tr[1];
      inst.trackingDocNo = target?.doc_no ?? tr[2];
    }
  } else {
    const pn = take("Integration Partner Name"); if (pn) { inst.partnerName = pn[0]; inst.partnerNameDocId = pn[1]; }
    const ra = take("Integration Partner Reward Address"); if (ra) inst.rewardAddress = ra[0];
    const ch = take("Integration Partner Chain"); if (ch) { inst.rewardChain = ch[0]; inst.rewardChainDocId = ch[1]; }
    const cd = take("Integration Boost Cadence"); if (cd) { inst.cadence = cd[0]; inst.cadenceDocId = cd[1]; }
  }
}

function extractInstanceFromEntity(
  ent: Participant, meta: InstanceMeta, status: InstanceStatus,
  kind: PrimitiveKind, ctx: GraphCtx, docs: Record<string, AtlasNode>,
): RewardsInstance {
  const icdDoc = ent.did ? docs[ent.did] : null;
  const inst: RewardsInstance = { id: ent.id, docNo: icdDoc?.doc_no ?? "", name: ent.name, status };
  applyParamTuples(inst, meta.params, kind, docs);
  if (Object.keys(meta.params).length > 0) inst.params = meta.params;
  if (kind === "DR" && inst.docNo) {
    const controller = ctx.paymentControllerByInstance.get(inst.docNo);
    if (controller) {
      inst.paymentsControllerId = controller.id;
      inst.paymentsControllerDocNo = controller.doc_no;
      inst.paymentsResponsibleParty = ctx.rpByDocId.get(controller.id) ?? undefined;
    }
  }
  return inst;
}

function extractPrimitive(byDocNo: Map<string, AtlasNode>, docs: Record<string, AtlasNode>, ctx: GraphCtx, agent: AgentRef, kind: PrimitiveKind): AgentPrimitive | null {
  const primitiveDocNo = `${agent.docNo}.2.5.${kind === "DR" ? "1" : "2"}`;
  const head = byDocNo.get(primitiveDocNo);
  if (!head) return null;
  const globalActivation = unwrapBackticks(plain(byDocNo.get(`${primitiveDocNo}.1.1`))) || null;
  const primSlug = kind === "DR" ? "distribution-reward" : "integration-boost";
  const relevant = ctx.instanceEntities.filter(e =>
    e.st === primSlug && ctx.instanceMetaById.get(e.id)?.agent_doc_no === agent.docNo
  );
  const buckets: Record<InstanceStatus, RewardsInstance[]> = { Active: [], Completed: [], InProgress: [] };
  for (const ent of relevant) {
    const meta = ctx.instanceMetaById.get(ent.id)!;
    const status: InstanceStatus = meta.status === "Pending" ? "InProgress" : meta.status === "Completed" ? "Completed" : "Active";
    buckets[status].push(extractInstanceFromEntity(ent, meta, status, kind, ctx, docs));
  }
  return {
    kind, primitiveId: head.id, primitiveDocNo, globalActivation,
    active: buckets.Active, completed: buckets.Completed, inProgress: buckets.InProgress,
  };
}

export function buildRewardsIndex(docs: Record<string, AtlasNode>, graph?: GraphData): RewardsIndex {
  const byDocNo = new Map<string, AtlasNode>();
  for (const n of Object.values(docs)) byDocNo.set(n.doc_no, n);
  const ctx = buildGraphCtx(byDocNo, graph);

  const refs: AgentRef[] = graph ? agentsFromGraph(graph.participants, docs) : [];
  const agents: RewardsAgent[] = refs.map(ref => {
    const ae: EntityRef = { id: ref.id, name: ref.name, slug: (graph?.participants ?? []).find(e => e.id === ref.id)?.slug ?? "" };
    return {
      name: ref.name, docNoPrefix: ref.docNoPrefix, agentEntity: ae,
      chain: resolveChain(ctx, ae.id),
      dr: extractPrimitive(byDocNo, docs, ctx, ref, "DR"),
      ib: extractPrimitive(byDocNo, docs, ctx, ref, "IB"),
    };
  });

  const eco = (docNo: string): RewardsEcosystemNode | null => {
    const n = byDocNo.get(docNo);
    return n ? { id: n.id, docNo: n.doc_no, title: n.title, description: n.content.trim() } : null;
  };

  return {
    agents,
    stUsdsDr: eco("A.4.4.1.3.7"),
    srUsdsDr: eco("A.3.2.2.4.2.4"),
    drPrimitive: eco("A.2.3.8.1"),
    ibPrimitive: eco("A.2.3.8.2"),
    demandSideBufferAddress: "0x5e2fec3a3c4e63a422e45c1bb83edb3a5ad0543b",
  };
}
