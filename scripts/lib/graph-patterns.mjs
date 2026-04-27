/**
 * Pure predicate functions, regexes, and content-extraction helpers for
 * pattern-driven graph extraction.
 */

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Pattern matchers (doc_no / title-based; no hardcoded names)
// ---------------------------------------------------------------------------

export const isPrimeAgent = d => /^A\.6\.1\.1\.\d+$/.test(d.doc_no);
export const isExecutorAgent = d => /^A\.6\.1\.2\.\d+$/.test(d.doc_no);
export const isFacilitatorDoc = d => /^A\.6\.1\.2\.\d+\.1$/.test(d.doc_no);
export const isGovOpsDoc = d => /^A\.6\.1\.2\.\d+\.2$/.test(d.doc_no);
export const isActiveData = d => /\.0\.6\.\d+$/.test(d.doc_no);
export const isAnnotation = d => /\.(0\.[34]|\d+\.var\d+)(\.\d+)?$/.test(d.doc_no);
export const isEcosystemAccord = d => /^A\.2\.8\.2\.\d+$/.test(d.doc_no);
export const isPartyDetails = d => /^A\.2\.8\.2\.\d+\.1\.1\.\d+$/.test(d.doc_no);
export const isGrantDoc = d => /^A\.2\.13\.1\.\d+\.\d+$/.test(d.doc_no);
export const isICDLocation = d =>
  /instance configuration document location/i.test(d.title) ||
  /^\s*This Instance[’']s associated Instance Configuration Document is located at/i.test(d.content ?? "");
export const isICD = d => /instance configuration document/i.test(d.title) && !isICDLocation(d);
export const isGlobalActivationStatus = d => /global activation status/i.test(d.title);

export const ERG_DOC_NO = "A.1.8.1.2.2.0.6.1";
export const ALIGNED_DELEGATES_DOC_NO = "A.1.5.1.5.0.6.1";
export const CORE_COUNCIL_RISK_ADVISOR_DOC_NO = "A.1.7.1.1.2";

export const UUID_LINK_RE = /\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
export const COMPRISES_RE = /The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i;
// Atomic parties use a different sentence shape — "The party 'X' is <descriptor>."
// (e.g. A.2.8.2.2.1.1.4 Moonbow: "…is the entity owning relevant intellectual
// property."). The party still signs the accord, it just has no members to list.
export const ATOMIC_PARTY_RE = /The party ['‘]([^'’]+)['’]\s+is\b/i;

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

// Extract "X is Y." or "X is the Y." from content
export function extractAssignment(content, prefix) {
  const re = new RegExp(prefix + '\\s+is\\s+(?:the\\s+)?([^.\\[]+)\\.', 'i');
  const m = content?.match(re);
  return m ? m[1].trim() : null;
}

// Active Data Controllers declare a Responsible Party in one of two forms:
//   "The Responsible Party is <role/name>."
//   "Responsible Party: <role/name>."
// The value may be a role alone ("Operational GovOps"), a named entity alone
// ("Soter Labs"), or role+name ("Operational GovOps Soter Labs"). Role-only
// declarations are resolved via the entity chain at edge-emission time.
export const RP_RE_IS = /(?:The\s+)?Responsible Party\s+is\s+(?:the\s+)?([^.\[\n]+?)\s*\./i;
export const RP_RE_COLON = /Responsible Party:\s*([^\n]+?)\s*(?:\.\s*$|\.(?=\s|\n)|$)/im;
export const RP_ROLES = [
  { re: /^Operational GovOps\b\s*/i,        key: "operational_govops" },
  { re: /^Core GovOps\b\s*/i,               key: "core_govops" },
  { re: /^Operational Facilitator\b\s*/i,   key: "operational_facilitator" },
  { re: /^Core Facilitator\b\s*/i,          key: "core_facilitator" },
  { re: /^Support Facilitators?\b\s*/i,     key: "support_facilitators" },
];

export function extractRP(content) {
  if (!content) return null;
  return (content.match(RP_RE_IS)?.[1] ?? content.match(RP_RE_COLON)?.[1] ?? "").trim() || null;
}

export function rpRoleAndName(raw) {
  for (const r of RP_ROLES) {
    if (r.re.test(raw)) return { role: r.key, name: raw.replace(r.re, "").trim() };
  }
  return { role: null, name: raw };
}

// Parse a comma/and-separated list, stripping leading "the " / "and ".
export function parseNameList(str) {
  return str
    .split(/,\s*/)
    .flatMap(p => p.split(/\s+and\s+/i))
    .map(s => s.trim().replace(/^(?:the|and)\s+/i, "").trim())
    .filter(Boolean);
}

// Extract list items from Active Data content (for ERG membership, delegate lists)
export function extractListItems(content) {
  return (content ?? "")
    .split("\n")
    .filter(l => /^[-*]\s+/.test(l.trim()))
    .map(l => l.trim().replace(/^[-*]\s+/, "").trim())
    // Strip "Recipient: X" or bullet labels; keep plain names.
    .map(l => l.replace(/^Recipient:\s*/i, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Doc_no-based parent derivation (Atlas depth cap workaround)
// ---------------------------------------------------------------------------

export function semanticParent(doc, docById, docByDocNo) {
  if (doc.doc_no.split(".").length <= 7) {
    return doc.parentId ? docById.get(doc.parentId) : null;
  }
  const parts = doc.doc_no.split(".");
  const parentDocNo = parts.slice(0, -1).join(".");
  return docByDocNo.get(parentDocNo) ?? null;
}

export function ancestorByStripping(doc, n, docByDocNo) {
  const parts = doc.doc_no.split(".");
  if (parts.length <= n) return null;
  return docByDocNo.get(parts.slice(0, -n).join(".")) ?? null;
}

// Resolve the Primitive root for any per-agent ICD. Primitive roots live at
// A.6.1.1.X.2.G.P (agent X → Sky Primitives section → primitive group G →
// primitive P). Every ICD lives under one of these, however deeply nested.
export function primitiveRootFor(doc, docByDocNo) {
  const m = doc.doc_no.match(/^(A\.6\.1\.1\.\d+\.2\.\d+\.\d+)(?:$|\.)/);
  if (!m) return null;
  const root = docByDocNo.get(m[1]);
  return root && /Primitive$/i.test(root.title) ? root : null;
}
