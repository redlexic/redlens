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
  agentDocNo: string | null;        // Prime Agent's defining doc_no
  executorName: string | null;
  executorId: string | null;
  executorEdgeSource: string | null;    // source doc_no of the executor→prime edge
  facilitatorName: string | null;
  facilitatorId: string | null;
  facilitatorEdgeSource: string | null; // source doc_no of the facilitator→executor edge
  govopsName: string | null;
  govopsId: string | null;
  govopsEdgeSource: string | null;      // source doc_no of the govops→executor edge
}

export type FacilitatorRole = "Operational Facilitator" | "Core Facilitator";

// One link in an evidence chain. `docNo` is the human-readable identifier;
// `docId` (when non-null) is the UUID the UI can navigate to.
export interface EvidenceStep {
  docNo: string;
  docId: string | null;
  label: string;
}

export interface ResponsibleParty {
  name: string;
  id: string;           // entity UUID (not a doc)
  docId: string | null; // defining Atlas doc — safe target for navigation
  resolution: "direct" | "chain" | "role";
  declared: string | null; // raw RP text from the ADC, for provenance
  evidence: EvidenceStep[];
}

export interface Facilitator {
  name: string;
  id: string;           // entity UUID (not a doc)
  docId: string | null; // defining Atlas doc — safe target for navigation
  role: FacilitatorRole;
  evidence: EvidenceStep[];
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
// Each slot carries the source doc_no of the edge that established it — this
// is what drives the Evidence column in the Active Data Index.
export function buildChainMap(
  entities: RelationEntity[],
  edges: RelationEdge[],
  docs?: Record<string, AtlasNode>,
): Map<string, AgentChain> {
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
      agentDocNo: docs && prime.did ? (docs[prime.did]?.doc_no ?? null) : null,
      executorName: executor?.name ?? null,
      executorId: executor?.id ?? null,
      executorEdgeSource: execEdge?.s?.[0] ?? null,
      facilitatorName: facEdge ? (entityById.get(facEdge.f)?.name ?? null) : null,
      facilitatorId: facEdge ? facEdge.f : null,
      facilitatorEdgeSource: facEdge?.s?.[0] ?? null,
      govopsName: govEdge ? (entityById.get(govEdge.f)?.name ?? null) : null,
      govopsId: govEdge ? govEdge.f : null,
      govopsEdgeSource: govEdge?.s?.[0] ?? null,
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
  const chainMap = buildChainMap(entities, edges, docs);

  // doc_no → doc, used to resolve evidence doc_nos back to navigable UUIDs.
  const docByDocNo = new Map<string, AtlasNode>();
  for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d);
  const step = (docNo: string | null | undefined, label: string): EvidenceStep | null => {
    if (!docNo) return null;
    return { docNo, docId: docByDocNo.get(docNo)?.id ?? null, label };
  };

  const controllerByAd = new Map<string, { id: string; source: string | null }>();
  const respByCtrl = new Map<string, RelationEdge>();
  // holds_role_for edges keyed by holder entity id — for "role" resolutions.
  const roleBindingDocByHolder = new Map<string, string>();
  for (const e of edges) {
    if (e.e === "active_data_for") controllerByAd.set(e.f, { id: e.t, source: e.s?.[0] ?? null });
    else if (e.e === "responsible_party_for") respByCtrl.set(e.t, e);
    else if (e.e === "holds_role_for" && e.s?.[0]) roleBindingDocByHolder.set(e.f, e.s[0]);
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

    const responsibleParty: ResponsibleParty | null = respEntity ? (() => {
      const resolution = respMeta?.resolution ?? "direct";
      const declared = respMeta?.role_declared ?? null;
      const evidence: EvidenceStep[] = [];
      const adcDocNo = respEdge?.s?.[0] ?? controllerDocNo;
      const declaredLabel = declared ? `ADC declares Responsible Party ("${declared}")` : "ADC names Responsible Party";
      const s0 = step(adcDocNo, declaredLabel); if (s0) evidence.push(s0);

      if (resolution === "chain") {
        const decl = (declared ?? "").toLowerCase();
        if (chain) {
          const s1 = step(chain.agentDocNo, `Prime Agent: ${chain.agentName}`); if (s1) evidence.push(s1);
          if (chain.executorEdgeSource && chain.executorName) {
            const s2 = step(chain.executorEdgeSource, `Executor Agent: ${chain.executorName}`); if (s2) evidence.push(s2);
          }
          if (decl.includes("govops") && chain.govopsEdgeSource) {
            const s3 = step(chain.govopsEdgeSource, `${declared}: ${respEntity.name}`); if (s3) evidence.push(s3);
          } else if (decl.includes("facilitator") && chain.facilitatorEdgeSource) {
            const s3 = step(chain.facilitatorEdgeSource, `${declared}: ${respEntity.name}`); if (s3) evidence.push(s3);
          }
        } else {
          // Sky Core chain: no Prime/Executor hops. Look up the core role edge
          // that names this entity and cite its source.
          const coreType = decl.includes("govops") ? "core_govops_for"
                        : decl.includes("facilitator") ? "core_facilitator_for"
                        : null;
          if (coreType) {
            const ed = edges.find(e => e.e === coreType && e.f === respEntity.id);
            const roleLabel = coreType === "core_govops_for" ? "Core GovOps" : "Core Facilitator";
            const sx = step(ed?.s?.[0], `${roleLabel}: ${respEntity.name}`); if (sx) evidence.push(sx);
          }
        }
      } else if (resolution === "role") {
        const bindingDocNo = roleBindingDocByHolder.get(respEntity.id);
        const sb = step(bindingDocNo, `Role held by ${respEntity.name}`); if (sb) evidence.push(sb);
      } else if (respEntity.did) {
        const entDoc = docs[respEntity.did];
        const sd = step(entDoc?.doc_no, `Entity: ${respEntity.name}`); if (sd) evidence.push(sd);
      }

      return {
        name: respEntity.name,
        id: respEntity.id,
        docId: respEntity.did ?? null,
        resolution,
        declared,
        evidence,
      };
    })() : null;

    // A.1.12.1.3.1 only specifies a Facilitator for Agent Artifacts (A.6.1.1.*) and
    // the Sky Core Atlas (A.1.*). For other areas (primitive specs A.2.*, ecosystem
    // accords, etc.) the Atlas is silent — leave it null rather than guess.
    const isSkyCoreAtlasAdc = (controllerDocNo ?? "").startsWith("A.1.");
    const facilitator: Facilitator | null = (() => {
      if (agent && chain?.facilitatorName && chain.facilitatorId) {
        const evidence: EvidenceStep[] = [];
        const s1 = step(chain.agentDocNo, `Prime Agent: ${chain.agentName}`); if (s1) evidence.push(s1);
        if (chain.executorEdgeSource && chain.executorName) {
          const s2 = step(chain.executorEdgeSource, `Executor Agent: ${chain.executorName}`); if (s2) evidence.push(s2);
        }
        const s3 = step(chain.facilitatorEdgeSource, `Operational Facilitator: ${chain.facilitatorName}`);
        if (s3) evidence.push(s3);
        return {
          name: chain.facilitatorName,
          id: chain.facilitatorId,
          docId: entityById.get(chain.facilitatorId)?.did ?? null,
          role: "Operational Facilitator",
          evidence,
        };
      }
      if (!agent && isSkyCoreAtlasAdc && coreFacEntity) {
        const evidence: EvidenceStep[] = [];
        const s1 = step(coreFacEdge?.s?.[0], `Core Facilitator: ${coreFacEntity.name}`);
        if (s1) evidence.push(s1);
        return {
          name: coreFacEntity.name,
          id: coreFacEntity.id,
          docId: coreFacEntity.did ?? null,
          role: "Core Facilitator",
          evidence,
        };
      }
      return null;
    })();

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
