import type { AtlasNode, RelationEdge, RelationEntity } from "../types";
import { agentsFromGraph, type AgentRef } from "./activeDataIndex";
import type { GraphData } from "./graph";
import type {
  AgentPrimitive, EntityRef, InstanceStatus, OperationalChain,
  PrimitiveKind, RewardsAgent, RewardsEcosystemNode, RewardsIndex, RewardsInstance,
} from "./rewardsTypes";

export * from "./rewardsTypes";

const STATUS_BY_TIER: Record<string, InstanceStatus> = { "2": "Active", "3": "Completed", "4": "InProgress" };
const plain = (n: AtlasNode | undefined) => (n?.content ?? "").trim();
const unwrapBackticks = (s: string) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;

// Atlas wraps addresses in backticks; check that form first so Solana matches too.
function firstAddress(s: string): string | undefined {
  const quoted = s.match(/`([^`\n]{32,44})`/);
  if (quoted) {
    const v = quoted[1];
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return v;
  }
  return s.match(/0x[0-9a-fA-F]{40}/)?.[0];
}

interface GraphCtx {
  paymentControllerByInstance: Map<string, AtlasNode>;
  rpByDocId: Map<string, EntityRef>;
  entityById: Map<string, RelationEntity>;
  edges: RelationEdge[];
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
  return { paymentControllerByInstance, rpByDocId, entityById, edges: graph?.edges ?? [] };
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

function extractInstance(
  byDocNo: Map<string, AtlasNode>, baseDocNo: string, title: string,
  status: InstanceStatus, kind: PrimitiveKind, ctx: GraphCtx,
): RewardsInstance {
  const head = byDocNo.get(baseDocNo);
  const name = title.replace(/\s+Instance Configuration Document\s*$/i, "").trim();
  const inst: RewardsInstance = { id: head?.id ?? "", docNo: baseDocNo, name, status };
  const p11 = plain(byDocNo.get(`${baseDocNo}.1.1`));
  const p12 = plain(byDocNo.get(`${baseDocNo}.1.2`));
  const p13 = plain(byDocNo.get(`${baseDocNo}.1.3`));
  const p14 = plain(byDocNo.get(`${baseDocNo}.1.4`));
  if (kind === "DR") {
    if (p11) inst.rewardCode = unwrapBackticks(p11);
    if (p12) inst.tracking = p12;
    const controller = ctx.paymentControllerByInstance.get(baseDocNo);
    if (controller) {
      inst.paymentsControllerId = controller.id;
      inst.paymentsControllerDocNo = controller.doc_no;
      inst.paymentsResponsibleParty = ctx.rpByDocId.get(controller.id) ?? undefined;
    }
  } else {
    if (p11) inst.partnerName = p11.replace(/^The partner for the [^]*? is /i, "").replace(/\.$/, "").trim();
    if (p12) inst.rewardAddress = firstAddress(p12);
    if (p13) inst.rewardChain = p13.replace(/^The [^]*? is on (the )?/i, "").replace(/\s*blockchain\.?$/i, "").replace(/\.$/, "").trim();
    if (p14) inst.cadence = p14.replace(/^The payment cadence for the [^]*? is /i, "").replace(/\.$/, "").trim();
  }
  return inst;
}

function extractPrimitive(byDocNo: Map<string, AtlasNode>, ctx: GraphCtx, agent: AgentRef, kind: PrimitiveKind): AgentPrimitive | null {
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
      buckets[status].push(extractInstance(byDocNo, base, node.title, status, kind, ctx));
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
      dr: extractPrimitive(byDocNo, ctx, ref, "DR"),
      ib: extractPrimitive(byDocNo, ctx, ref, "IB"),
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
