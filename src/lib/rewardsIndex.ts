import type { AtlasNode, RelationEdge, RelationEntity } from "../types";
import { agentsFromGraph, type AgentRef } from "./activeDataIndex";
import type { GraphData } from "./graph";
import type {
  AgentPrimitive, EntityRef, InstanceStatus, OperationalChain, ParamTuple,
  PrimitiveKind, RewardsAgent, RewardsEcosystemNode, RewardsIndex, RewardsInstance,
} from "./rewardsTypes";

export * from "./rewardsTypes";

const STATUS_BY_TIER: Record<string, InstanceStatus> = { "2": "Active", "3": "Completed", "4": "InProgress" };
const plain = (n: AtlasNode | undefined) => (n?.content ?? "").trim();
const unwrapBackticks = (s: string) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;
const UUID_LINK_RE = /\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/;

interface GraphCtx {
  paymentControllerByInstance: Map<string, AtlasNode>;
  rpByDocId: Map<string, EntityRef>;
  entityById: Map<string, RelationEntity>;
  edges: RelationEdge[];
  paramsByInstanceId: Map<string, Record<string, ParamTuple>>;
}

function buildGraphCtx(byDocNo: Map<string, AtlasNode>, graph?: GraphData): GraphCtx {
  const paymentControllerByInstance = new Map<string, AtlasNode>();
  for (const n of byDocNo.values()) {
    if (n.title !== "Distribution Reward Payments") continue;
    for (let dn = n.doc_no; ; ) {
      const dot = dn.lastIndexOf("."); if (dot < 0) break;
      dn = dn.slice(0, dot);
      const anc = byDocNo.get(dn);
      if (anc && /Instance Configuration Document/i.test(anc.title)) {
        paymentControllerByInstance.set(dn, n); break;
      }
    }
  }
  const entityById = new Map<string, RelationEntity>((graph?.entities ?? []).map(e => [e.id, e]));
  const rpByDocId = new Map<string, EntityRef>();
  for (const e of graph?.edges ?? []) {
    if (e.e !== "responsible_party_for") continue;
    const ent = entityById.get(e.f);
    if (ent) rpByDocId.set(e.t, { id: ent.id, name: ent.name, slug: ent.slug });
  }
  const paramsByInstanceId = new Map<string, Record<string, ParamTuple>>();
  for (const ent of graph?.entities ?? []) {
    if (ent.et !== "instance" || !ent.m) continue;
    try {
      const p = (JSON.parse(ent.m) as { params?: Record<string, ParamTuple> }).params;
      if (p) paramsByInstanceId.set(ent.id, p);
    } catch { /* ignore */ }
  }
  return { paymentControllerByInstance, rpByDocId, entityById, edges: graph?.edges ?? [], paramsByInstanceId };
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

// Read each well-known field from meta.params tuples. No prose stripping here;
// build-graph already applies PARAM_FORMATTERS at extraction time.
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
      // If the sub-doc's raw content links to a shared methodology, target that;
      // otherwise fall through to the ICD's own Tracking Methodology sub-doc.
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

function extractInstance(
  byDocNo: Map<string, AtlasNode>, docs: Record<string, AtlasNode>,
  baseDocNo: string, title: string,
  status: InstanceStatus, kind: PrimitiveKind, ctx: GraphCtx,
): RewardsInstance {
  const head = byDocNo.get(baseDocNo);
  const name = title.replace(/\s+Instance Configuration Document\s*$/i, "").trim();
  const inst: RewardsInstance = { id: head?.id ?? "", docNo: baseDocNo, name, status };
  const params = inst.id ? ctx.paramsByInstanceId.get(inst.id) : undefined;
  if (params) {
    applyParamTuples(inst, params, kind, docs);
    if (Object.keys(params).length > 0) inst.params = params;
  }
  if (kind === "DR") {
    const controller = ctx.paymentControllerByInstance.get(baseDocNo);
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
  const buckets: Record<InstanceStatus, RewardsInstance[]> = { Active: [], Completed: [], InProgress: [] };
  for (const tier of ["2", "3", "4"] as const) {
    const status = STATUS_BY_TIER[tier];
    for (let n = 1; n <= 99; n++) {
      const base = `${primitiveDocNo}.${tier}.${n}`;
      const node = byDocNo.get(base);
      if (!node || !/Instance Configuration Document/i.test(node.title)) break;
      buckets[status].push(extractInstance(byDocNo, docs, base, node.title, status, kind, ctx));
    }
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

  const refs: AgentRef[] = graph ? agentsFromGraph(graph.entities, docs) : [];
  const agents: RewardsAgent[] = refs.map(ref => {
    const ae: EntityRef = { id: ref.id, name: ref.name, slug: (graph?.entities ?? []).find(e => e.id === ref.id)?.slug ?? "" };
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
