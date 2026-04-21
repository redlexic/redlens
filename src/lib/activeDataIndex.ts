// Pure data-shaping logic for the Active Data Index report. Kept separate
// from the React component so it's trivially testable against docs.json +
// relations.json.

import type { AtlasNode, RelationEntity, RelationEdge } from "../types";

export const AGENT_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["A.6.1.1.1.", "Spark"],
  ["A.6.1.1.2.", "Grove"],
  ["A.6.1.1.3.", "Keel"],
  ["A.6.1.1.4.", "Skybase"],
  ["A.6.1.1.5.", "Obex"],
  ["A.6.1.1.6.", "Pattern"],
  ["A.6.1.1.7.", "Launch Agent 6"],
  ["A.6.1.1.8.", "Launch Agent 7"],
];

export type ProcessKind = "Direct Edit" | "Alignment Conserver Changes";

export interface AgentChain {
  agentName: string;
  agentId: string;
  executorName: string | null;
  executorId: string | null;
  facilitatorName: string | null;
  facilitatorId: string | null;
  govopsName: string | null;
  govopsId: string | null;
}

export type FacilitatorRole = "Operational Facilitator" | "Core Facilitator";

export interface ResponsibleParty {
  name: string;
  id: string;           // entity UUID (not a doc)
  docId: string | null; // defining Atlas doc — safe target for navigation
  resolution: "direct" | "chain" | "role";
  declared: string | null; // raw RP text from the ADC, for provenance
}

export interface Facilitator {
  name: string;
  id: string;           // entity UUID (not a doc)
  docId: string | null; // defining Atlas doc — safe target for navigation
  role: FacilitatorRole;
}

export interface ActiveDataRow {
  activeDataId: string;
  activeDataDocNo: string;
  activeDataTitle: string;
  controllerId: string | null;
  controllerDocNo: string | null;
  controllerTitle: string | null;
  agent: string | null;
  chain: AgentChain | null;
  responsibleParty: ResponsibleParty | null;
  facilitator: Facilitator | null;
  process: ProcessKind;
  sourceDocNo: string | null;
}

export function agentFromDocNo(docNo: string): string | null {
  for (const [prefix, name] of AGENT_PREFIXES) {
    if (docNo.startsWith(prefix)) return name;
  }
  return null;
}

export function extractProcess(content: string): ProcessKind {
  if (/alignment conserver/i.test(content)) return "Alignment Conserver Changes";
  return "Direct Edit";
}

// Chain: prime → executor → facilitator/govops, resolved via role-as-edge
// types emitted by build-graph.mjs (operational_* + core_* variants).
export function buildChainMap(entities: RelationEntity[], edges: RelationEdge[]): Map<string, AgentChain> {
  const entityById = new Map(entities.map(e => [e.id, e]));
  const primes = entities.filter(e => e.et === "agent" && e.st === "prime");

  const execEdges = edges.filter(e => e.e === "operational_executor_agent_for" || e.e === "core_executor_agent_for");
  const facEdges  = edges.filter(e => e.e === "operational_facilitator_for" || e.e === "core_facilitator_for");
  const govEdges  = edges.filter(e => e.e === "operational_govops_for" || e.e === "core_govops_for");

  const map = new Map<string, AgentChain>();
  for (const prime of primes) {
    const execEdge = execEdges.find(e => e.t === prime.id);
    const executor = execEdge ? entityById.get(execEdge.f) : null;

    const facEdge = executor ? facEdges.find(e => e.t === executor.id) : null;
    const govEdge = executor ? govEdges.find(e => e.t === executor.id) : null;

    map.set(prime.name, {
      agentName: prime.name,
      agentId: prime.id,
      executorName: executor?.name ?? null,
      executorId: executor?.id ?? null,
      facilitatorName: facEdge ? (entityById.get(facEdge.f)?.name ?? null) : null,
      facilitatorId: facEdge ? facEdge.f : null,
      govopsName: govEdge ? (entityById.get(govEdge.f)?.name ?? null) : null,
      govopsId: govEdge ? govEdge.f : null,
    });
  }
  return map;
}

export interface GraphInput {
  entities: RelationEntity[];
  edges: RelationEdge[];
}

// One row per Active Data doc.
//
//   Controller         — `active_data_for` edge (AD doc → controller doc).
//   Responsible Party  — `responsible_party_for` edge (entity → controller doc).
//                        Atlas A.1.12.1.2 — declared in the ADC; proposes updates.
//                        Resolution priority (mirrored in build-graph.mjs):
//                        role-binding → direct → chain.
//                        Falls back to null ("Governance") only if the graph didn't
//                        emit an edge (support_facilitator case, unparseable text).
//   Facilitator        — Atlas A.1.12.1.3.1. Approves/commits the edit. For an ADC
//                        under a Prime Agent (doc_no starts with an agent prefix),
//                        facilitator = the Operational Facilitator for that Prime's
//                        Executor Agent. Otherwise (Sky Core), = the Core Facilitator.
export function buildActiveDataRows(
  docs: Record<string, AtlasNode>,
  graph: GraphInput,
): ActiveDataRow[] {
  const { entities, edges } = graph;
  const entityById = new Map(entities.map(e => [e.id, e]));
  const chainMap = buildChainMap(entities, edges);

  const controllerByAd = new Map<string, { id: string; source: string | null }>();
  const respByCtrl = new Map<string, RelationEdge>();
  for (const e of edges) {
    if (e.e === "active_data_for") controllerByAd.set(e.f, { id: e.t, source: e.s?.[0] ?? null });
    else if (e.e === "responsible_party_for") respByCtrl.set(e.t, e);
  }

  // Core Facilitator is the sole source of a `core_facilitator_for` edge.
  const coreFacEdge = edges.find(e => e.e === "core_facilitator_for");
  const coreFacEntity = coreFacEdge ? (entityById.get(coreFacEdge.f) ?? null) : null;

  const activeDataDocs = Object.values(docs).filter(d => d.type === "Active Data");

  return activeDataDocs.map((ad): ActiveDataRow => {
    const ctrl = controllerByAd.get(ad.id);
    const controllerDoc = ctrl ? docs[ctrl.id] : null;
    const controllerDocNo = controllerDoc?.doc_no ?? null;

    const agent = controllerDocNo ? agentFromDocNo(controllerDocNo) : null;
    const chain = agent ? (chainMap.get(agent) ?? null) : null;

    const respEdge = ctrl ? respByCtrl.get(ctrl.id) : undefined;
    const respEntity = respEdge ? entityById.get(respEdge.f) : null;
    const respMeta = (() => {
      if (!respEdge?.m) return null;
      try { return JSON.parse(respEdge.m) as { role_declared?: string; resolution?: "direct" | "chain" | "role" }; }
      catch { return null; }
    })();

    const responsibleParty: ResponsibleParty | null = respEntity ? {
      name: respEntity.name,
      id: respEntity.id,
      docId: respEntity.did ?? null,
      resolution: respMeta?.resolution ?? "direct",
      declared: respMeta?.role_declared ?? null,
    } : null;

    // A.1.12.1.3.1 only specifies a Facilitator for Agent Artifacts (A.6.1.1.*) and
    // the Sky Core Atlas (A.1.*). For other areas (primitive specs A.2.*, ecosystem
    // accords, etc.) the Atlas is silent — leave it null rather than guess.
    const isSkyCoreAtlasAdc = (controllerDocNo ?? "").startsWith("A.1.");
    const facilitator: Facilitator | null = agent
      ? (chain?.facilitatorName && chain.facilitatorId
          ? {
              name: chain.facilitatorName,
              id: chain.facilitatorId,
              docId: entityById.get(chain.facilitatorId)?.did ?? null,
              role: "Operational Facilitator",
            }
          : null)
      : (isSkyCoreAtlasAdc && coreFacEntity
          ? {
              name: coreFacEntity.name,
              id: coreFacEntity.id,
              docId: coreFacEntity.did ?? null,
              role: "Core Facilitator",
            }
          : null);

    return {
      activeDataId: ad.id,
      activeDataDocNo: ad.doc_no,
      activeDataTitle: ad.title,
      controllerId: controllerDoc?.id ?? null,
      controllerDocNo,
      controllerTitle: controllerDoc?.title ?? null,
      agent,
      chain,
      responsibleParty,
      facilitator,
      process: extractProcess((controllerDoc ?? ad).content),
      sourceDocNo: respEdge?.s?.[0] ?? ctrl?.source ?? null,
    };
  }).sort((a, b) => a.activeDataDocNo.localeCompare(b.activeDataDocNo, undefined, { numeric: true }));
}

export function activeDataRowsToCSV(rows: ActiveDataRow[]): string {
  const header = "Active Data Doc,Active Data Title,Controller Doc,Controller Title,Agent,Responsible Party,Facilitator,Facilitator Role,Process\n";
  const body = rows.map(r =>
    `"${r.activeDataDocNo}","${r.activeDataTitle}","${r.controllerDocNo ?? ""}","${r.controllerTitle ?? ""}","${r.agent ?? ""}","${r.responsibleParty?.name ?? ""}","${r.facilitator?.name ?? ""}","${r.facilitator?.role ?? ""}","${r.process}"`
  ).join("\n");
  return header + body;
}
