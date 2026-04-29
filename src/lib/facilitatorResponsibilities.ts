import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";

export interface OFResponsibility {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category: "universal" | "core-facilitator" | "root-edit" | "artifact-edit" | "active-data";
  agent?: string;
  agents?: string[];
}

export const CATEGORY_LABELS: Record<OFResponsibility["category"], string> = {
  universal: "Universal — all Facilitators",
  "core-facilitator": "Core Facilitator Duties",
  "root-edit": "Root Edit Proposal Review & Vote (per agent)",
  "artifact-edit": "Artifact Edit Restrictions Enforcement (per agent)",
  "active-data": "Active Data Maintenance — OF as Responsible Party (per agent)",
};

// These 4 nodes impose universal OF duties but no graph edge connects them to
// the OF role — they are scattered across A.1.x scopes.
const SCATTERED_UNIVERSAL_DOC_NOS = [
  "A.1.12.1.3.1",
  "A.1.9.2.4.13.5",
  "A.2.2.5.2.1.2.2",
  "A.2.2.9.1.1.3.3.1.3",
] as const;

const ROOT_EDIT_OF_TITLES = new Set([
  "root edit proposal review by operational facilitator",
  "root edit token holder vote",
]);

function dutySnippet(content: string): string {
  const cleaned = content
    .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => m.match(/\[([^\]]+)\]/)?.[1] ?? "")
    .replace(/[*_`#]/g, "")
    .trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return sentences[0] ?? cleaned.slice(0, 140);
  // Prefer a sentence where Facilitator is the grammatical subject —
  // i.e. "Facilitator" appears before a governing verb in the same sentence.
  const asSubject = /\bFacilitators?\b[^.!?]*?\b(must|may|shall|will|is\b|are\b|agrees?|ensures?|reviews?|documents?)/i;
  let i = sentences.findIndex((s) => asSubject.test(s));
  if (i === -1) i = sentences.findIndex((s) => /facilitator/i.test(s));
  if (i === -1) i = 0;
  const last = sentences.length - 1;
  return (i > 0 ? "…" : "") + sentences[i] + (i < last ? "…" : "");
}

export function deriveResponsibilities(
  { docs, docNoToId, byParent }: AtlasBundle,
  { edges }: GraphData,
): OFResponsibility[] {
  const results: OFResponsibility[] = [];

  // Build agent name lookup: "A.6.1.1.X" → agent title
  const agentByPrefix = new Map<string, string>();
  const a611Id = docNoToId.get("A.6.1.1");
  if (a611Id) {
    for (const n of byParent.get(a611Id) ?? []) agentByPrefix.set(n.doc_no, n.title);
  }
  const getAgent = (docNo: string) => {
    const p = docNo.split(".");
    return p.length >= 5 ? agentByPrefix.get(p.slice(0, 5).join(".")) : undefined;
  };

  // 1. A.1.6 duties — classify by subject of the opening sentence.
  //    Sections that open with "The Core Facilitator…" are Core Facilitator duties, not universal OF duties.
  //    Sections about "Core Executor Agent" (A.1.6.2) are Core Executor context, not OF duties.
  const a16Id = docNoToId.get("A.1.6");
  for (const n of a16Id ? (byParent.get(a16Id) ?? []) : []) {
    const trimmed = n.content.trimStart();
    const isCoreFacilitatorDuty =
      /^The Core Facilitator\b/i.test(trimmed) || /^Every Core Executor Agent\b/i.test(trimmed);
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: isCoreFacilitatorDuty ? "core-facilitator" : "universal",
    });
  }

  // 2. Scattered universals — no graph edge marks them as OF duties
  for (const dn of SCATTERED_UNIVERSAL_DOC_NOS) {
    const id = docNoToId.get(dn);
    const n = id ? docs[id] : null;
    if (n)
      results.push({
        docNo: n.doc_no,
        uuid: n.id,
        title: n.title,
        duty: dutySnippet(n.content),
        category: "universal",
      });
  }

  // 3. Root-edit duties and artifact-edit duties under A.6.1.1
  for (const n of Object.values(docs)) {
    if (!n.doc_no.startsWith("A.6.1.1.")) continue;
    const tl = n.title.toLowerCase();
    if (ROOT_EDIT_OF_TITLES.has(tl)) {
      results.push({
        docNo: n.doc_no,
        uuid: n.id,
        title: n.title,
        duty: dutySnippet(n.content),
        category: "root-edit",
        agent: getAgent(n.doc_no),
      });
    } else if (tl === "artifact edit restrictions") {
      results.push({
        docNo: n.doc_no,
        uuid: n.id,
        title: n.title,
        duty: dutySnippet(n.content),
        category: "artifact-edit",
        agent: getAgent(n.doc_no),
      });
    }
  }

  // 4. Active-data: responsible_party_for edges from OF facilitators
  const ofFacIds = new Set(
    edges.filter((e) => e.e === "operational_facilitator_for").map((e) => e.f),
  );
  for (const edge of edges) {
    if (edge.e !== "responsible_party_for" || !ofFacIds.has(edge.f) || edge.tt !== "doc") continue;
    const n = docs[edge.t];
    if (!n?.doc_no.startsWith("A.6.1.1.")) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: "active-data",
      agent: getAgent(n.doc_no),
    });
  }

  return results;
}
