#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Pattern-driven extraction of the Atlas graph.
 * See .claude/skills/graph-atlas/SKILL.md for the full relationship reference.
 *
 * Usage (from redlens-mcp/):
 *   node scripts/build-graph.mjs [--remote]
 *
 * Reads (from parent repo root = ../../ relative to this script):
 *   public/docs.json
 *   public/addresses.json
 *   public/chain-state.json
 *
 * Writes:
 *   public/graph.json        — export for local inspection
 *   public/relations.json    — lean browser payload
 *   D1 tables: entities, docs, addresses, edges
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const BATCH = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function newUuid() { return crypto.randomUUID(); }

function runFile(filePath) {
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });
}

async function writeBatched(filePath, tableName, cols, rows) {
  const out = fs.createWriteStream(filePath);
  out.write(`DELETE FROM ${tableName};\n`);
  let i = 0;
  for (const row of rows) {
    if (i % BATCH === 0) {
      if (i > 0) out.write(";\n");
      out.write(`INSERT OR REPLACE INTO ${tableName} (${cols.join(",")}) VALUES\n`);
    } else {
      out.write(",\n");
    }
    out.write("(" + cols.map(c => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(";\n");
  out.end();
  return new Promise(r => out.on("finish", r));
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const allDocs = Object.values(rawDocs);
console.log(`  ${allDocs.length} docs`);

const docById = new Map(allDocs.map(d => [d.id, d]));
const docByDocNo = new Map(allDocs.map(d => [d.doc_no, d]));

console.log("Loading addresses.json…");
const addressesRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
console.log(`  ${Object.keys(addressesRaw).length} addresses`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"));
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = { chain, block: data.block ?? data.slot ?? null, at: chainState.generatedAt, values };
    }
  }
} else {
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = { chain: "ethereum", block: chainState.block ?? null, at: chainState.generatedAt, values };
  }
}

// ---------------------------------------------------------------------------
// Pattern matchers (doc_no / title-based; no hardcoded names)
// ---------------------------------------------------------------------------

const isPrimeAgent = d => /^A\.6\.1\.1\.\d+$/.test(d.doc_no);
const isExecutorAgent = d => /^A\.6\.1\.2\.\d+$/.test(d.doc_no);
const isFacilitatorDoc = d => /^A\.6\.1\.2\.\d+\.1$/.test(d.doc_no);
const isGovOpsDoc = d => /^A\.6\.1\.2\.\d+\.2$/.test(d.doc_no);
const isActiveData = d => /\.0\.6\.\d+$/.test(d.doc_no);
const isAnnotation = d => /\.(0\.[34]|\d+\.var\d+)(\.\d+)?$/.test(d.doc_no);
const isEcosystemAccord = d => /^A\.2\.8\.2\.\d+$/.test(d.doc_no);
const isPartyDetails = d => /^A\.2\.8\.2\.\d+\.1\.1\.\d+$/.test(d.doc_no);
const isGrantDoc = d => /^A\.2\.13\.1\.\d+\.\d+$/.test(d.doc_no);
const isICD = d => /instance configuration document/i.test(d.title) && !/location/i.test(d.title);
const isICDLocation = d => /instance configuration document location/i.test(d.title);
const isGlobalActivationStatus = d => /global activation status/i.test(d.title);

const ERG_DOC_NO = "A.1.8.1.2.2.0.6.1";
const ALIGNED_DELEGATES_DOC_NO = "A.1.5.1.5.0.6.1";
const CORE_COUNCIL_RISK_ADVISOR_DOC_NO = "A.1.7.1.1.2";

const UUID_LINK_RE = /\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
const COMPRISES_RE = /The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i;

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

// Extract "X is Y." or "X is the Y." from content
function extractAssignment(content, prefix) {
  const re = new RegExp(prefix + '\\s+is\\s+(?:the\\s+)?([^.\\[]+)\\.', 'i');
  const m = content?.match(re);
  return m ? m[1].trim() : null;
}

// Parse a comma/and-separated list, stripping leading "the " / "and ".
function parseNameList(str) {
  return str
    .split(/,\s*/)
    .flatMap(p => p.split(/\s+and\s+/i))
    .map(s => s.trim().replace(/^(?:the|and)\s+/i, "").trim())
    .filter(Boolean);
}

// Extract list items from Active Data content (for ERG membership, delegate lists)
function extractListItems(content) {
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

function semanticParent(doc) {
  if (doc.doc_no.split(".").length <= 7) {
    return doc.parentId ? docById.get(doc.parentId) : null;
  }
  const parts = doc.doc_no.split(".");
  const parentDocNo = parts.slice(0, -1).join(".");
  return docByDocNo.get(parentDocNo) ?? null;
}

function ancestorByStripping(doc, n) {
  const parts = doc.doc_no.split(".");
  if (parts.length <= n) return null;
  return docByDocNo.get(parts.slice(0, -n).join(".")) ?? null;
}

// ---------------------------------------------------------------------------
// Phase 1: Extract entities
// ---------------------------------------------------------------------------

console.log("\nExtracting entities…");
const entityMap = new Map(); // slug → entity record

function addEntity(slug, name, entity_type, subtype, defining_doc_id, meta = null) {
  if (entityMap.has(slug)) return entityMap.get(slug);
  const ent = {
    id: newUuid(),
    slug,
    name,
    entity_type,
    subtype: subtype ?? null,
    defining_doc_id: defining_doc_id ?? null,
    is_active: 1,
    meta: meta ? JSON.stringify(meta) : null,
  };
  entityMap.set(slug, ent);
  return ent;
}

function entityByName(name) { return entityMap.get(slugify(name)); }

// --- 1a. Bootstrap entities (Pattern 13) ---
// Sky Ecosystem / Sky Core / Sky Governance — targets of role edges; no defining doc.
const skyEcosystem = addEntity("sky-ecosystem", "Sky Ecosystem", "ecosystem", null, null, { source: "bootstrap" });
const skyCore      = addEntity("sky-core", "Sky Core", "operational_party", null, null, { source: "bootstrap" });
const skyGovernance = addEntity("sky-governance", "Sky Governance", "governance_body", null, null, { source: "bootstrap" });

// --- 1b. Prime Agents (Pattern 1) ---
for (const d of allDocs.filter(isPrimeAgent)) {
  const s = slugify(d.title);
  const ent = addEntity(s, d.title, "agent", "prime", d.id);
  ent.id = d.id; // use atlas doc uuid as entity id
}

// --- 1c. Executor Agents (Pattern 1) ---
// Strip "Operational Executor Agent " prefix so the semantic short name survives
// ("Ozone", "Amatsu"). Keep full title for Core Council entries because the number
// suffix IS their identity ("Core Council Executor Agent 1").
for (const d of allDocs.filter(isExecutorAgent)) {
  const isCore = /^Core Council Executor Agent/i.test(d.title);
  const name = isCore
    ? d.title
    : d.title.replace(/^Operational Executor Agent\s+/i, "").trim();
  const subtype = isCore ? "core_executor" : "operational_executor";
  const ent = addEntity(slugify(name), name, "agent", subtype, d.id);
  ent.id = d.id;
}

// --- 1d. Facilitators (Pattern 5) — entity_type = facilitator_org ---
for (const d of allDocs.filter(isFacilitatorDoc)) {
  const name = extractAssignment(
    d.content,
    "(?:The )?(?:(?:Operational|Core) (?:Executor )?)?Facilitator for [^.]+"
  );
  if (name) addEntity(slugify(name), name, "facilitator_org", null, null, {
    source: "facilitator_doc",
    source_doc_no: d.doc_no,
  });
}

// --- 1e. GovOps (Pattern 5) — entity_type = govops_org ---
for (const d of allDocs.filter(isGovOpsDoc)) {
  const name = extractAssignment(
    d.content,
    "(?:(?:Operational|Core) )?GovOps for [^.]+"
  );
  if (name) addEntity(slugify(name), name, "govops_org", null, null, {
    source: "govops_doc",
    source_doc_no: d.doc_no,
  });
}

// --- 1f. Responsible parties from Active Data Controllers (Pattern 6) ---
const ROLE_PREFIXES = [
  /^Operational GovOps\s+/i,
  /^Core GovOps\s+/i,
  /^Operational Facilitator\s+/i,
  /^Core Facilitator\s+/i,
  /^Support Facilitators?\s+/i,
];
function stripRolePrefix(name) {
  for (const re of ROLE_PREFIXES) {
    const stripped = name.replace(re, "").trim();
    if (stripped && stripped !== name) return stripped;
  }
  return name;
}

for (const d of allDocs.filter(d => d.type === "Active Data Controller")) {
  const rawName = extractAssignment(d.content, "The Responsible Party");
  if (!rawName) continue;
  const name = stripRolePrefix(rawName);
  const s = slugify(name);
  if (!entityMap.has(s)) {
    addEntity(s, name, "ecosystem_actor", null, null, {
      source: "active_data_controller",
      source_doc_no: d.doc_no,
    });
  }
}

// --- 1g. ERG members (Pattern 7) ---
const ergDoc = docByDocNo.get(ERG_DOC_NO);
const ergMemberNames = ergDoc ? extractListItems(ergDoc.content) : [];
for (const name of ergMemberNames) {
  const s = slugify(name);
  if (!entityMap.has(s)) {
    addEntity(s, name, "ecosystem_actor", null, null, {
      source: "erg_list",
      source_doc_no: ERG_DOC_NO,
    });
  }
}

// --- 1h. Delegates from addresses.json (labels; entity_type = delegate_org) ---
const labelToAddresses = new Map();
for (const [addr, info] of Object.entries(addressesRaw)) {
  if (info.label) {
    const s = slugify(info.label);
    if (!labelToAddresses.has(s)) labelToAddresses.set(s, []);
    labelToAddresses.get(s).push({ addr: addr.toLowerCase(), chain: info.chain ?? "ethereum" });
    if (info.roles?.includes("delegate") && !entityMap.has(s)) {
      addEntity(s, info.label, "delegate_org", null, null, {
        source: "addresses_json_delegate",
        address: addr,
      });
    }
  }
}

// --- 1i. Aligned Delegates (Pattern 10) ---
const alignedDelegatesDoc = docByDocNo.get(ALIGNED_DELEGATES_DOC_NO);
const alignedDelegateNames = [];
if (alignedDelegatesDoc) {
  // Prefer explicit list items, fall back to prose "Aligned Delegates are X, Y, Z."
  const items = extractListItems(alignedDelegatesDoc.content);
  if (items.length) {
    alignedDelegateNames.push(...items);
  } else {
    const m = alignedDelegatesDoc.content?.match(/Aligned Delegates?\s+(?:are|is)\s+([^.]+)\./i);
    if (m) alignedDelegateNames.push(...parseNameList(m[1]));
  }
  for (const name of alignedDelegateNames) {
    const s = slugify(name);
    if (!entityMap.has(s)) {
      addEntity(s, name, "delegate_org", null, null, {
        source: "aligned_delegates_list",
        source_doc_no: ALIGNED_DELEGATES_DOC_NO,
      });
    }
  }
}

// --- 1j. Ranked Delegates (Pattern 10) ---
// Levels 1 and 2 have current-members docs; level 3 does not (verified in atlas).
const rankedDelegatesByLevel = new Map(); // level → [{name, docNo}]
for (let level = 1; level <= 2; level++) {
  const docNo = `A.1.5.4.1.${level}.3.1`;
  const d = docByDocNo.get(docNo);
  if (!d) continue;
  const m = d.content?.match(/Ranked Delegates?\s+(?:are|is)\s+([^.]+)\./i);
  if (!m) continue;
  const names = parseNameList(m[1]);
  rankedDelegatesByLevel.set(level, names.map(name => ({ name, docNo })));
  for (const name of names) {
    const s = slugify(name);
    if (!entityMap.has(s)) {
      addEntity(s, name, "delegate_org", null, null, {
        source: "ranked_delegates_list",
        source_doc_no: docNo,
      });
    }
  }
}

// --- 1k. Core Council Risk Advisor role binding (Pattern 11) ---
const ccraDoc = docByDocNo.get(CORE_COUNCIL_RISK_ADVISOR_DOC_NO);
let ccraHolder = null;
if (ccraDoc) {
  const m = ccraDoc.content?.match(/role is held by\s+([^.]+)\./i);
  if (m) {
    const name = m[1].trim();
    const s = slugify(name);
    let entity = entityMap.get(s);
    if (!entity) {
      entity = addEntity(s, name, "ecosystem_actor", null, null, {
        source: "role_binding",
        source_doc_no: CORE_COUNCIL_RISK_ADVISOR_DOC_NO,
      });
    }
    ccraHolder = entity;
  }
}

// --- 1l. Grant recipients (foundations surface here) ---
for (const d of allDocs.filter(isGrantDoc)) {
  const m = d.content?.match(/\*\s*Recipient:\s*([^\n]+?)(?:\n|$)/i)
        ?? d.content?.match(/-\s*Recipient:\s*([^\n]+?)(?:\n|$)/i)
        ?? d.content?.match(/\bRecipient:\s*([^\n]+?)(?:\n|$)/i);
  if (!m) continue;
  const name = m[1].trim();
  const s = slugify(name);
  if (entityMap.has(s)) continue;
  const entity_type = /\bFoundation\b/i.test(name) ? "foundation" : "ecosystem_actor";
  addEntity(s, name, entity_type, null, null, {
    source: "grant_recipient",
    source_doc_no: d.doc_no,
  });
}

// --- 1m. Composite accord parties and members (Pattern 12) ---
// Scan A.2.8.2.Y.1.1.N party-details docs. Create composite_party entity (suffix "-party"
// to avoid slug collision with member agent). Resolve or create each member.
function resolveAccordMember(rawName, sourceDocNo) {
  const cleaned = rawName.replace(/^the\s+/i, "").trim();

  // Sky Core special — party 'Sky' comprises Sky Core; always maps to bootstrap.
  if (/^Sky Core$/i.test(cleaned)) return skyCore;

  // Strip "Prime Agent" or "Executor Agent" suffix to match short agent slugs.
  const stripped = cleaned.replace(/\s+(Prime Agent|Executor Agent)$/i, "").trim();
  if (stripped !== cleaned) {
    const hit = entityMap.get(slugify(stripped));
    if (hit) return hit;
  }

  // Within an A.2.8.2.Y.1.1.N comprises list, any non-agent non-Foundation
  // member is a development_company by the atlas's positional convention
  // (e.g. "The party 'Spark' comprises the Spark Prime Agent, Spark Foundation,
  // and Phoenix Labs." — Phoenix Labs is the dev company). Foundation suffix
  // gives us the foundation vs dev-company split; no hardcoded name list needed.
  const inferredType = /\bFoundation$/i.test(cleaned) ? "foundation" : "development_company";

  const exact = entityMap.get(slugify(cleaned));
  if (exact) {
    // Upgrade a previously-created ecosystem_actor if the accord now classifies it
    // more specifically (e.g. Phoenix Labs first seen in ERG list, then confirmed
    // as dev-company via the Spark accord).
    if (exact.entity_type === "ecosystem_actor") exact.entity_type = inferredType;
    return exact;
  }

  return addEntity(slugify(cleaned), cleaned, inferredType, null, null, {
    source: "accord_party_member",
    source_doc_no: sourceDocNo,
  });
}

const compositeBySlug = new Map(); // partySlug (with "-party" suffix) → entity
const accordPartyDocsByAccordDocNo = new Map(); // accord doc_no → [{ partyEntity, sourceDocNo }]

for (const d of allDocs.filter(isPartyDetails)) {
  const m = d.content?.match(COMPRISES_RE);
  if (!m) continue;
  const partyName = m[1].trim();
  const memberStr = m[2];

  // Accord doc_no = first 5 parts of party-details doc_no (e.g. A.2.8.2.2 ← A.2.8.2.2.1.1.2)
  const accordDocNo = d.doc_no.split(".").slice(0, 5).join(".");

  // The "Sky" party maps directly to Sky Core (bootstrap) — no separate composite.
  let partyEntity;
  if (/^Sky$/i.test(partyName)) {
    partyEntity = skyCore;
  } else {
    const partySlug = `${slugify(partyName)}-party`;
    partyEntity = compositeBySlug.get(partySlug);
    if (!partyEntity) {
      partyEntity = addEntity(partySlug, partyName, "composite_party", null, null, {
        source: "accord_party_composite",
        source_doc_no: d.doc_no,
      });
      compositeBySlug.set(partySlug, partyEntity);
    }
  }

  if (!accordPartyDocsByAccordDocNo.has(accordDocNo)) accordPartyDocsByAccordDocNo.set(accordDocNo, []);
  accordPartyDocsByAccordDocNo.get(accordDocNo).push({ partyEntity, sourceDocNo: d.doc_no, memberStr, isSky: /^Sky$/i.test(partyName) });

  // Resolve members now so they exist before edges are emitted in Phase 2.
  for (const memberName of parseNameList(memberStr)) {
    resolveAccordMember(memberName, d.doc_no);
  }
}

console.log(`  ${entityMap.size} entities`);

// ---------------------------------------------------------------------------
// Phase 2: Extract edges
// ---------------------------------------------------------------------------

console.log("Extracting edges…");
const edges = [];
const docIds = new Set(allDocs.map(d => d.id));

function addEdge(fromId, fromType, toId, toType, edgeType, sourceDocNos = [], meta = null) {
  edges.push({ fromId, fromType, toId, toType, edgeType, sourceDocNos, meta });
}

// doc UUID → entity (via defining_doc_id)
const entityByDocId = new Map();
for (const e of entityMap.values()) {
  if (e.defining_doc_id) entityByDocId.set(e.defining_doc_id, e);
}

// --- 2a. parent_of (from parentId) ---
for (const d of allDocs) {
  if (d.parentId && docById.has(d.parentId)) {
    addEdge(d.parentId, "doc", d.id, "doc", "parent_of", []);
  }
}

// --- 2b. annotates (*.0.3.X, *.0.4.X, *.varX) ---
for (const d of allDocs.filter(isAnnotation)) {
  if (d.parentId) addEdge(d.id, "doc", d.parentId, "doc", "annotates", [d.doc_no]);
}

// --- 2c. active_data_for (*.0.6.X → parent controller) ---
for (const d of allDocs.filter(isActiveData)) {
  if (d.parentId) addEdge(d.id, "doc", d.parentId, "doc", "active_data_for", [d.doc_no]);
}

// --- 2d. cites (UUID markdown links) ---
let citeCount = 0;
const citedByDoc = new Map();
for (const d of allDocs) {
  const seen = citedByDoc.get(d.id) ?? new Set();
  for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
    const targetId = m[2];
    if (docIds.has(targetId) && targetId !== d.id && !seen.has(targetId)) {
      seen.add(targetId);
      addEdge(d.id, "doc", targetId, "doc", "cites", [d.doc_no]);
      citeCount++;
    }
  }
  citedByDoc.set(d.id, seen);
}
console.log(`  ${citeCount} cites edges`);

// --- 2e. implements (primitive root → global primitive in A.2.2) ---
const IMPLEMENTS_RE = /\bSee\s+\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i;
for (const d of allDocs) {
  if (!d.doc_no.startsWith("A.6.1.1.")) continue;
  const m = (d.content ?? "").match(IMPLEMENTS_RE);
  if (!m) continue;
  const targetDoc = docById.get(m[2]);
  if (targetDoc && targetDoc.doc_no.startsWith("A.2.2.")) {
    addEdge(d.id, "doc", targetDoc.id, "doc", "implements", [d.doc_no]);
  }
}

// --- 2f. instance_of (ICD → primitive root) ---
for (const d of allDocs.filter(d => isICD(d) && d.doc_no.startsWith("A.6.1.1."))) {
  const primRoot = ancestorByStripping(d, 2);
  if (primRoot) addEdge(d.id, "doc", primRoot.id, "doc", "instance_of", [d.doc_no]);
}

// --- 2g. located_at (ICD Location → ICD) ---
for (const d of allDocs.filter(isICDLocation)) {
  for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
    const targetDoc = docById.get(m[2]);
    if (targetDoc && isICD(targetDoc)) {
      addEdge(d.id, "doc", targetDoc.id, "doc", "located_at", [d.doc_no]);
      break;
    }
  }
}

// --- 2h. has_status (primitive root → Global Activation Status) ---
for (const d of allDocs.filter(d => isGlobalActivationStatus(d) && d.doc_no.startsWith("A.6.1.1."))) {
  const primRoot = ancestorByStripping(d, 2);
  if (primRoot) addEdge(primRoot.id, "doc", d.id, "doc", "has_status", [primRoot.doc_no]);
}

// --- 2i. prime_agent_for: each Prime Agent → Sky Ecosystem (Pattern 1) ---
for (const d of allDocs.filter(isPrimeAgent)) {
  const ent = entityByDocId.get(d.id);
  if (ent) addEdge(ent.id, "entity", skyEcosystem.id, "entity", "prime_agent_for", [d.doc_no]);
}

// --- 2j. {operational,core}_executor_agent_for (Pattern 3) ---
// Source: ICD parameter docs titled "Operational/Core Executor Agent" at
// A.6.1.1.X.2.Z.2.N.1.1.1. Content cites the executor's defining doc. Walk parentId
// chain to find the prime agent.
for (const paramDoc of allDocs.filter(d =>
  /^(operational|core)(?: council)? executor agent$/i.test(d.title)
)) {
  let executorDocId = null;
  for (const m of (paramDoc.content ?? "").matchAll(UUID_LINK_RE)) {
    if (docIds.has(m[2])) { executorDocId = m[2]; break; }
  }
  if (!executorDocId) continue;
  const executorEntity = entityByDocId.get(executorDocId);
  if (!executorEntity) continue;

  let cur = paramDoc;
  let primeDoc = null;
  for (let i = 0; i < 20 && cur?.parentId; i++) {
    const parent = docById.get(cur.parentId);
    if (parent && isPrimeAgent(parent)) { primeDoc = parent; break; }
    cur = parent;
  }
  if (!primeDoc) continue;
  const primeEntity = entityByDocId.get(primeDoc.id);
  if (!primeEntity) continue;

  // Best-effort matching accord doc (by party name containing the executor name).
  const primeName = primeEntity.name;
  const accordDoc = allDocs.find(a => {
    if (!isEcosystemAccord(a)) return false;
    const partyDocs = accordPartyDocsByAccordDocNo.get(a.doc_no) ?? [];
    return partyDocs.some(pd => pd.partyEntity.id === primeEntity.id || (pd.memberStr ?? "").includes(primeName));
  });
  const sources = [paramDoc.doc_no];
  if (accordDoc) sources.push(accordDoc.doc_no);

  const edgeType = executorEntity.subtype === "core_executor"
    ? "core_executor_agent_for"
    : "operational_executor_agent_for";
  addEdge(executorEntity.id, "entity", primeEntity.id, "entity", edgeType, sources);
}

// --- 2k. {operational,core}_facilitator_for (Pattern 5) ---
for (const d of allDocs.filter(isFacilitatorDoc)) {
  const isCore = /core executor facilitator/i.test(d.title);
  const name = extractAssignment(
    d.content,
    "(?:The )?(?:(?:Operational|Core) (?:Executor )?)?Facilitator for [^.]+"
  );
  if (!name) continue;
  const facEntity = entityByName(name);
  const executorDoc = d.parentId ? docById.get(d.parentId) : null;
  const executorEntity = executorDoc ? entityByDocId.get(executorDoc.id) : null;
  if (!facEntity || !executorEntity) continue;
  const edgeType = isCore ? "core_facilitator_for" : "operational_facilitator_for";
  addEdge(facEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
}

// --- 2l. {operational,core}_govops_for (Pattern 5) ---
for (const d of allDocs.filter(isGovOpsDoc)) {
  const isCore = /core govops/i.test(d.title);
  const name = extractAssignment(
    d.content,
    "(?:(?:Operational|Core) )?GovOps for [^.]+"
  );
  if (!name) continue;
  const govEntity = entityByName(name);
  const executorDoc = d.parentId ? docById.get(d.parentId) : null;
  const executorEntity = executorDoc ? entityByDocId.get(executorDoc.id) : null;
  if (!govEntity || !executorEntity) continue;
  const edgeType = isCore ? "core_govops_for" : "operational_govops_for";
  addEdge(govEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
}

// --- 2m. aligned_delegate_for (Pattern 10) ---
for (const name of alignedDelegateNames) {
  const entity = entityByName(name);
  if (entity) {
    addEdge(entity.id, "entity", skyGovernance.id, "entity", "aligned_delegate_for", [ALIGNED_DELEGATES_DOC_NO]);
  }
}

// --- 2n. ranked_delegate_for (Pattern 10; meta.level) ---
for (const [level, items] of rankedDelegatesByLevel) {
  for (const { name, docNo } of items) {
    const entity = entityByName(name);
    if (entity) {
      addEdge(entity.id, "entity", skyGovernance.id, "entity", "ranked_delegate_for", [docNo], JSON.stringify({ level }));
    }
  }
}

// --- 2o. holds_role_for (Pattern 11) ---
if (ccraHolder && ccraDoc) {
  addEdge(
    ccraHolder.id, "entity", ccraDoc.id, "doc",
    "holds_role_for", [CORE_COUNCIL_RISK_ADVISOR_DOC_NO],
    JSON.stringify({ role: "core_council_risk_advisor" }),
  );
}

// --- 2p. ecosystem_accord: accord doc → party entity (composite_party or Sky Core) ---
// Target is the composite party, not individual members. Built from Pattern 12's party-details scan.
for (const [accordDocNo, partyDocs] of accordPartyDocsByAccordDocNo) {
  const accordDoc = docByDocNo.get(accordDocNo);
  if (!accordDoc) continue;
  for (const { partyEntity } of partyDocs) {
    addEdge(accordDoc.id, "doc", partyEntity.id, "entity", "ecosystem_accord", [accordDocNo]);
  }
}

// --- 2q. comprises: composite_party → member (Pattern 12) ---
// Skip the "Sky" party (maps to Sky Core bootstrap; no composite created, no comprises edge emitted).
for (const [, partyDocs] of accordPartyDocsByAccordDocNo) {
  for (const { partyEntity, sourceDocNo, memberStr, isSky } of partyDocs) {
    if (isSky) continue;
    for (const memberName of parseNameList(memberStr)) {
      const memberEntity = resolveAccordMember(memberName, sourceDocNo);
      if (memberEntity && memberEntity.id !== partyEntity.id) {
        addEdge(partyEntity.id, "entity", memberEntity.id, "entity", "comprises", [sourceDocNo]);
      }
    }
  }
}

// --- 2r. erg_member_for (Pattern 7) ---
if (ergDoc) {
  for (const name of ergMemberNames) {
    const entity = entityByName(name);
    if (entity) addEdge(entity.id, "entity", ergDoc.id, "doc", "erg_member_for", [ERG_DOC_NO]);
  }
}

// --- 2s. responsible_party_for (Pattern 6) ---
for (const d of allDocs.filter(d => d.type === "Active Data Controller")) {
  const rawName = extractAssignment(d.content, "The Responsible Party");
  if (!rawName) continue;
  const name = stripRolePrefix(rawName);
  const entity = entityByName(name);
  if (entity) addEdge(entity.id, "entity", d.id, "doc", "responsible_party_for", [d.doc_no]);
}

// --- 2t. defines_entity (doc → entity it defines) ---
for (const e of entityMap.values()) {
  if (e.defining_doc_id && docIds.has(e.defining_doc_id)) {
    addEdge(e.defining_doc_id, "doc", e.id, "entity", "defines_entity", []);
  }
}

// --- 2u. has_address (entity → address) ---
for (const [s, entity] of entityMap) {
  for (const { addr, chain } of labelToAddresses.get(s) ?? []) {
    addEdge(entity.id, "entity", `${addr}:${chain}`, "address", "has_address", []);
  }
}

// --- 2v. mentions (doc → address) ---
for (const d of allDocs) {
  for (const addr of (d.addressRefs ?? [])) {
    const info = addressesRaw[addr] ?? addressesRaw[addr.toLowerCase()];
    const chain = info?.chain ?? "ethereum";
    addEdge(d.id, "doc", `${addr.toLowerCase()}:${chain}`, "address", "mentions", [d.doc_no]);
  }
}

// --- 2w. proxies_to (address → implementation address) ---
for (const [addr, info] of Object.entries(addressesRaw)) {
  if (info.implementation) {
    const chain = info.chain ?? "ethereum";
    addEdge(
      `${addr.toLowerCase()}:${chain}`, "address",
      `${info.implementation.toLowerCase()}:${chain}`, "address",
      "proxies_to", [],
    );
  }
}

console.log(`  ${edges.length} total edges`);

// Edge-type breakdown for quick verification.
const edgeTypeCounts = new Map();
for (const e of edges) edgeTypeCounts.set(e.edgeType, (edgeTypeCounts.get(e.edgeType) ?? 0) + 1);
console.log("  edge type breakdown:");
for (const [et, count] of [...edgeTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${et.padEnd(36)} ${count}`);
}

// ---------------------------------------------------------------------------
// Phase 3: Prepare rows
// ---------------------------------------------------------------------------

const entityRows = [...entityMap.values()].map(e => ({
  id: e.id, slug: e.slug, name: e.name,
  entity_type: e.entity_type, subtype: e.subtype ?? null,
  defining_doc_id: e.defining_doc_id ?? null,
  is_active: e.is_active ?? 1, meta: e.meta ?? null,
}));

const docRows = allDocs.map(d => ({
  id: d.id, doc_no: d.doc_no, title: d.title, type: d.type,
  depth: d.depth ?? 0, parent_id: d.parentId ?? null,
  content: (d.content ?? "").slice(0, 50000),
  ord: d.order ?? 0,
}));

const addressRows = Object.entries(addressesRaw).map(([addr, info]) => {
  const chain = info.chain ?? "ethereum";
  const cs = chainStateByAddr[addr.toLowerCase()];
  const s = info.label ? slugify(info.label) : null;
  return {
    address: addr.toLowerCase(), chain,
    label: info.label ?? null, chainlog_id: info.chainlogId ?? null,
    etherscan_name: null,
    is_contract: info.isContract ? 1 : 0,
    is_proxy: info.isProxy ? 1 : 0,
    implementation: info.implementation ?? null,
    roles: JSON.stringify(info.roles ?? []),
    aliases: JSON.stringify(info.aliases ?? []),
    expected_tokens: JSON.stringify(info.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null, state_at: cs?.at ?? null,
    entity_id: s ? (entityMap.get(s)?.id ?? null) : null,
  };
});

const edgeRows = edges.map((e, i) => ({
  id: i + 1,
  from_id: e.fromId, from_type: e.fromType,
  to_id: e.toId, to_type: e.toType,
  edge_type: e.edgeType,
  source_doc_nos: e.sourceDocNos?.length ? JSON.stringify(e.sourceDocNos) : null,
  weight: 1.0,
  meta: e.meta ?? null,
}));

// ---------------------------------------------------------------------------
// Phase 4: Write SQL + import
// ---------------------------------------------------------------------------

const TMP = path.join(__dirname);
// Load order follows the FK graph: docs first (source of truth, referenced by
// entities.defining_doc_id), then entities (referenced by addresses.entity_id),
// then addresses, then edges (which reference all three).
const files = {
  docs:      path.join(TMP, "_docs.sql"),
  entities:  path.join(TMP, "_entities.sql"),
  addresses: path.join(TMP, "_addresses.sql"),
  edges:     path.join(TMP, "_edges.sql"),
};

console.log("\nWriting SQL files…");
await writeBatched(files.entities, "entities",
  ["id","slug","name","entity_type","subtype","defining_doc_id","is_active","meta"],
  entityRows);
await writeBatched(files.docs, "docs",
  ["id","doc_no","title","type","depth","parent_id","content","ord"],
  docRows);
await writeBatched(files.addresses, "addresses",
  ["address","chain","label","chainlog_id","etherscan_name","is_contract","is_proxy",
   "implementation","roles","aliases","expected_tokens","chain_state","state_block","state_at","entity_id"],
  addressRows);
await writeBatched(files.edges, "edges",
  ["id","from_id","from_type","to_id","to_type","edge_type","source_doc_nos","weight","meta"],
  edgeRows);

console.log(`  entities: ${entityRows.length}`);
console.log(`  docs:     ${docRows.length}`);
console.log(`  addresses:${addressRows.length}`);
console.log(`  edges:    ${edgeRows.length}`);

// graph.json — full export for local inspection / debugging
fs.writeFileSync(path.join(ROOT, "public/graph.json"), JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    schemaVersion: 4,
    counts: { entities: entityRows.length, docs: docRows.length, addresses: addressRows.length, edges: edgeRows.length },
  },
  entities: entityRows,
  edges: edgeRows,
}));
console.log("  public/graph.json written");

// relations.json — lean browser payload (no parent_of edges; compact keys)
const relationEdges = edges
  .filter(e => e.edgeType !== "parent_of")
  .map(e => {
    const out = {
      f: e.fromId,
      ft: e.fromType,
      t: e.toId,
      tt: e.toType,
      e: e.edgeType,
      s: e.sourceDocNos?.length ? e.sourceDocNos : undefined,
    };
    if (e.meta) out.m = e.meta;
    return out;
  });

const relationEntities = entityRows.map(e => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  et: e.entity_type,
  st: e.subtype,
  did: e.defining_doc_id,
}));

fs.writeFileSync(path.join(ROOT, "public/relations.json"), JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    schemaVersion: 4,
    counts: { entities: relationEntities.length, edges: relationEdges.length },
  },
  entities: relationEntities,
  edges: relationEdges,
}));
const relSize = fs.statSync(path.join(ROOT, "public/relations.json")).size;
console.log(`  public/relations.json written (${(relSize/1024).toFixed(0)} KB)`);

console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);
for (const [name, file] of Object.entries(files)) {
  runFile(file);
  console.log(`  ${name} done`);
  fs.unlinkSync(file);
}
console.log("\nDone.");
