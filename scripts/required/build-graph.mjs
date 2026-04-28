#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Pattern-driven extraction of the Atlas graph. Outputs live at repo root so
 * they're first-class artifacts for every consumer — the frontend loads
 * relations.json directly; the redlens-mcp Worker mirrors the graph into D1.
 * See .claude/skills/graph-atlas/SKILL.md for the full relationship reference.
 *
 * Usage (from repo root):
 *   node scripts/required/build-graph.mjs                       # builds JSONs only
 *   node scripts/required/build-graph.mjs --apply-to-d1         # also syncs local D1
 *   node scripts/required/build-graph.mjs --apply-to-d1 --remote # also syncs remote D1
 *
 * Reads:
 *   public/docs.json
 *   public/addresses.json
 *   public/chain-state.json
 *
 * Writes:
 *   public/graph.json        — full export for local inspection
 *   public/relations.json    — lean browser payload
 *   [with --apply-to-d1] D1 tables: docs, entities, addresses, edges
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import { slugify } from "../lib/graph-patterns.mjs";
import { extractEntities } from "../lib/graph-entities.mjs";
import { extractDocEdges } from "../lib/graph-doc-edges.mjs";
import { extractEntityEdges } from "../lib/graph-entity-edges.mjs";
import {
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  normalizeAddress,
  detectChain,
  findTableContext,
} from "../lib/address-chains.mjs";
import {
  extractRoles,
  extractEntityLabel,
  extractExpectedTokens,
} from "../lib/address-annotate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MCP_DIR = path.join(ROOT, "redlens-mcp");
const APPLY_D1 = process.argv.includes("--apply-to-d1");
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

function runFile(filePath) {
  // wrangler needs to resolve wrangler.jsonc from redlens-mcp/ for D1 config.
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: MCP_DIR,
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
    out.write("(" + cols.map((c) => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(";\n");
  out.end();
  return new Promise((r) => out.on("finish", r));
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const allDocs = Object.values(rawDocs);
console.log(`  ${allDocs.length} docs`);

const docById = new Map(allDocs.map((d) => [d.id, d]));
const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));

// Load both address artifacts and build a merged in-memory view for graph
// extraction. Phase 4.5 writes enrichments back to addresses.atlas.json only;
// addresses.json (on-chain data) is never mutated by build-graph.
console.log("Loading address artifacts…");
const addressesAtlas = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/addresses.atlas.json"), "utf8"),
);
const addressesOnChain = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
  } catch {
    return {};
  }
})();

function resolveLabel(atlas, onChain) {
  return onChain.chainlogId ?? atlas.entityLabel ?? onChain.etherscanName ?? null;
}

const addressesRaw = {};
for (const [addr, atlas] of Object.entries(addressesAtlas)) {
  const onChain = addressesOnChain[addr] ?? {};
  const label = resolveLabel(atlas, onChain);
  const aliasCandidates = [onChain.chainlogId, atlas.entityLabel, onChain.etherscanName].filter(
    (l) => l && l !== label,
  );
  const aliases = [
    ...new Set([...(atlas.aliases ?? []), ...aliasCandidates]),
  ].sort();
  addressesRaw[addr] = { ...atlas, ...onChain, label, aliases };
}
console.log(`  ${Object.keys(addressesAtlas).length} atlas, ${Object.keys(addressesOnChain).length} on-chain`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"));
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = {
        chain,
        block: data.block ?? data.slot ?? null,
        at: chainState.generatedAt,
        values,
      };
    }
  }
} else {
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = {
      chain: "ethereum",
      block: chainState.block ?? null,
      at: chainState.generatedAt,
      values,
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2.6: Annotate addresses from doc content
//
// Runs before Phase 1 (entity extraction) so that role-based detection
// (e.g. delegate role → create delegate_org entity) works correctly.
//
// Scans every doc for EVM and Solana addresses, applies sliding-window
// annotation (structural roles, entity labels, expected tokens), and merges
// the results into addressesAtlas. This replaces the annotation that
// previously ran in build-index, and now has access to the full doc set
// in one place — no loopback needed.
//
// GENERIC_LABELS filters out single-word prose artifacts that aren't real
// entity names (e.g. "contract", "address" picked up from nearby text).
// ---------------------------------------------------------------------------
{
  const GENERIC_LABELS = new Set([
    "contract", "address", "registry", "multisig",
    "the contract", "the address", "the multisig", "agreement",
  ]);

  // Per-address aggregation across all docs
  const agg = new Map(); // addr → { chains: Set, labels: Set, roles: Set, tokens: Set }

  for (const doc of allDocs) {
    const content = doc.content ?? "";

    ETH_ADDR_RE.lastIndex = 0;
    let m;
    while ((m = ETH_ADDR_RE.exec(content)) !== null) {
      const key = normalizeAddress(m[0]);
      const chain = detectChain(content, m.index);
      const table = findTableContext(content, m.index);
      let g = agg.get(key);
      if (!g) { g = { chains: new Set(), labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
      g.chains.add(chain);
      const label = extractEntityLabel(content, m.index, table);
      if (label) g.labels.add(label);
      for (const r of extractRoles(content, m.index, m[0].length, table)) g.roles.add(r);
      for (const t of extractExpectedTokens(content, m.index, m[0].length, table)) g.tokens.add(t);
    }

    SOL_ADDR_RE.lastIndex = 0;
    while ((m = SOL_ADDR_RE.exec(content)) !== null) {
      const key = normalizeAddress(m[0]);
      const table = findTableContext(content, m.index);
      let g = agg.get(key);
      if (!g) { g = { chains: new Set(["solana"]), labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
      g.chains.add("solana");
      const label = extractEntityLabel(content, m.index, table);
      if (label) g.labels.add(label);
      for (const r of extractRoles(content, m.index, m[0].length, table)) g.roles.add(r);
      for (const t of extractExpectedTokens(content, m.index, m[0].length, table)) g.tokens.add(t);
    }
  }

  // Merge into addressesAtlas
  for (const [addr, g] of agg) {
    let entry = addressesAtlas[addr];
    if (!entry) continue; // address not found during build-index (shouldn't happen)

    // Chain: prefer any non-ethereum detection
    const specific = [...g.chains].find((c) => c !== "ethereum");
    entry.chain = specific ?? [...g.chains][0] ?? entry.chain ?? "ethereum";

    // Entity label: pick longest non-generic candidate
    const labelPool = [...g.labels];
    const candidates = labelPool.filter((l) => !GENERIC_LABELS.has(l.toLowerCase()));
    const pool = candidates.length ? candidates : labelPool;
    pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
    entry.entityLabel = pool[0] ?? null;
    entry.aliases = pool.length > 1 ? pool.slice(1) : [];

    entry.roles = [...g.roles].sort();
    entry.expectedTokens = [...g.tokens].sort();
  }

  // Rebuild addressesRaw from the now-annotated atlas so Phase 1 entity
  // extraction sees roles (e.g. delegate role → create delegate_org entity).
  for (const [addr, atlas] of Object.entries(addressesAtlas)) {
    const onChain = addressesOnChain[addr] ?? {};
    const label = resolveLabel(atlas, onChain);
    const aliasCandidates = [onChain.chainlogId, atlas.entityLabel, onChain.etherscanName]
      .filter((l) => l && l !== label);
    const aliases = [...new Set([...(atlas.aliases ?? []), ...aliasCandidates])].sort();
    addressesRaw[addr] = { ...atlas, ...onChain, label, aliases };
  }

  console.log(`  Phase 2.6: ${agg.size} addresses annotated from doc content`);
}

// ---------------------------------------------------------------------------
// Phase 1: Extract entities
// ---------------------------------------------------------------------------

console.log("\nExtracting entities…");
const entityContext = extractEntities(allDocs, docById, docByDocNo, addressesRaw);
console.log(`  ${entityContext.entityMap.size} entities`);
const { entityMap, entityByDocId } = entityContext;

// ---------------------------------------------------------------------------
// Phase 2: Extract edges
// ---------------------------------------------------------------------------

console.log("Extracting edges…");
const docEdges = extractDocEdges(allDocs, docById, docByDocNo, entityByDocId);
const entityEdges = extractEntityEdges(allDocs, docById, docByDocNo, entityContext, addressesRaw);
const edges = [...docEdges, ...entityEdges];
console.log(`  ${edges.length} total edges`);

// ---------------------------------------------------------------------------
// Phase 2.5: ICD-param address annotations + has_address edges
//
// Instance entities carry meta.params with structured address values. We use
// these to emit (a) has_address edges from the instance entity to each param
// address, and (b) an icdAnnotations map used in Phase 4.5 to enrich
// addresses.json with structurally-derived roles and labels — overriding the
// prose-heuristic results from build-index.
// ---------------------------------------------------------------------------

// Param keys that contain addresses, mapped to role tags.
// "Token Address (ERC4626 Vault)" is a vault contract, not a token — handled
// by the prefix rule in icdParamRole(). Bare "Address" is too ambiguous
// (appears in Pioneer Chain ICDs with no stable meaning) and is omitted.
const ICD_PARAM_ROLES = new Map([
  ["Integration Partner Reward Address", "integration-boost-reward"],
  ["Token Address", "token"],
  ["Underlying Asset Address", "underlying-asset"],
  ["Pool Address", "pool"],
  ["Allocator Role Address", "allocator-role"],
]);

function icdParamRole(key) {
  if (ICD_PARAM_ROLES.has(key)) return ICD_PARAM_ROLES.get(key);
  if (key.startsWith("Token Address (")) return /ERC4626/i.test(key) ? "vault" : "token";
  return null;
}

function normalizeChain(raw) {
  if (!raw) return "ethereum";
  const s = raw.toLowerCase();
  if (s.includes("base")) return "base";
  if (s.includes("arbitrum")) return "arbitrum";
  if (s.includes("optimism")) return "optimism";
  if (s.includes("solana")) return "solana";
  if (s.includes("avalanche") || s.includes("avax")) return "avalanche";
  if (s.includes("polygon")) return "polygon";
  if (s.includes("gnosis")) return "gnosis";
  if (s.includes("monad") || s.includes("plume") || s.includes("plasma")) return "ethereum"; // testnets/future — map to eth for now
  if (s.includes("ethereum") || s.includes("mainnet")) return "ethereum";
  console.warn(`  icd-chain: unrecognized chain string "${raw}", defaulting to ethereum`);
  return "ethereum";
}

function icdParamChain(key, params) {
  if (key.startsWith("Token Address (")) {
    const m = key.match(/\(([^)]+)\)/);
    if (m && !/ERC4626/i.test(m[1])) return normalizeChain(m[1]);
  }
  return normalizeChain(
    params["Integration Partner Chain"]?.[0] ?? params["Network"]?.[0],
  );
}

function icdParamLabel(key, params, agentName, instanceName) {
  if (key === "Integration Partner Reward Address") {
    const partner = params["Integration Partner Name"]?.[0];
    return partner ? `${partner} (IB reward)` : instanceName;
  }
  if (key.startsWith("Token Address")) {
    return params["Token Symbol"]?.[0] ?? params["Token Name"]?.[0] ?? instanceName;
  }
  if (key === "Pool Address") {
    const protocol = params["Target Protocol"]?.[0];
    return protocol ? `${protocol} Pool (${agentName ?? instanceName})` : instanceName;
  }
  if (key === "Underlying Asset Address") {
    const token = params["Token"]?.[0] ?? params["Token Symbol"]?.[0];
    return token ? `${token} underlying asset` : instanceName;
  }
  if (key === "Allocator Role Address") {
    return agentName ? `${agentName} allocator role` : instanceName;
  }
  return instanceName;
}

const icdAnnotations = new Map(); // lowercase addr → { roles, entityLabel, chain }
// IB partner names and agent token symbols — collected for Phase 4.5 logging.
const ibPartnerNames = new Set();
const agentTokenSymbols = new Set();
let icdHasAddressCount = 0;
let icdAgentResolved = 0;

for (const ent of entityMap.values()) {
  if (ent.entity_type !== "instance") continue;
  let meta;
  try { meta = JSON.parse(ent.meta ?? "{}"); } catch { continue; }
  const params = meta.params ?? {};

  const agentDoc = meta.agent_doc_no ? docByDocNo.get(meta.agent_doc_no) : null;
  const agentEntity = agentDoc ? entityByDocId.get(agentDoc.id) : null;
  const agentName = agentEntity?.name ?? null;
  if (agentName) icdAgentResolved++;

  // Collect IB partner names and agent token symbols (logged at end).
  if (ent.subtype === "integration-boost") {
    const partner = params["Integration Partner Name"]?.[0];
    if (partner && partner.length > 1) ibPartnerNames.add(partner);
  }
  if (ent.subtype === "agent-token") {
    const symbol = params["Token Symbol"]?.[0];
    if (symbol && /^[A-Z]{2,10}$/.test(symbol)) agentTokenSymbols.add(symbol);
  }

  for (const [key, tuple] of Object.entries(params)) {
    const role = icdParamRole(key);
    if (!role) continue;
    const [value, , srcDocNo] = tuple;
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(value);
    const isSol = !isEvm && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value);
    if (!isEvm && !isSol) continue;

    const addr = isEvm ? value.toLowerCase() : value;
    const chain = isSol ? "solana" : icdParamChain(key, params);
    const label = icdParamLabel(key, params, agentName, ent.name);

    if (!icdAnnotations.has(addr)) {
      icdAnnotations.set(addr, { roles: [role], entityLabel: label, chain });
    } else {
      const existing = icdAnnotations.get(addr);
      if (!existing.roles.includes(role)) existing.roles.push(role);
    }

    edges.push({
      fromId: ent.id,
      fromType: "entity",
      toId: `${addr}:${chain}`,
      toType: "address",
      edgeType: "has_address",
      sourceDocNos: [srcDocNo],
      meta: JSON.stringify({ param: key }),
    });
    icdHasAddressCount++;
  }
}

const instanceCount = [...entityMap.values()].filter((e) => e.entity_type === "instance").length;
console.log(
  `  ICD-param: ${icdHasAddressCount} has_address edges, ${icdAnnotations.size} unique addresses` +
  ` (agent resolved: ${icdAgentResolved}/${instanceCount} instances)`,
);

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

const entityRows = [...entityMap.values()].map((e) => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  entity_type: e.entity_type,
  subtype: e.subtype ?? null,
  defining_doc_id: e.defining_doc_id ?? null,
  is_active: e.is_active ?? 1,
  meta: e.meta ?? null,
}));

const docRows = allDocs.map((d) => ({
  id: d.id,
  doc_no: d.doc_no,
  title: d.title,
  type: d.type,
  depth: d.depth ?? 0,
  parent_id: d.parentId ?? null,
  content: (d.content ?? "").slice(0, 50000),
  ord: d.order ?? 0,
}));

const addressRows = Object.entries(addressesRaw).map(([addr, info]) => {
  const chain = info.chain ?? "ethereum";
  const cs = chainStateByAddr[addr.toLowerCase()];
  const s = info.label ? slugify(info.label) : null;
  return {
    address: addr.toLowerCase(),
    chain,
    label: info.label ?? null,
    chainlog_id: info.chainlogId ?? null,
    etherscan_name: info.etherscanName ?? null,
    is_contract: info.isContract ? 1 : 0,
    is_proxy: info.isProxy ? 1 : 0,
    implementation: info.implementation ?? null,
    roles: JSON.stringify(info.roles ?? []),
    aliases: JSON.stringify(info.aliases ?? []),
    expected_tokens: JSON.stringify(info.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null,
    state_at: cs?.at ?? null,
    entity_id: s ? (entityMap.get(s)?.id ?? null) : null,
  };
});

const edgeRows = edges.map((e, i) => ({
  id: i + 1,
  from_id: e.fromId,
  from_type: e.fromType,
  to_id: e.toId,
  to_type: e.toType,
  edge_type: e.edgeType,
  source_doc_nos: e.sourceDocNos?.length ? JSON.stringify(e.sourceDocNos) : null,
  weight: 1.0,
  meta: e.meta ?? null,
}));

// ---------------------------------------------------------------------------
// Phase 4: Write JSON outputs (always); optionally sync to D1.
// ---------------------------------------------------------------------------

console.log("\nRow counts:");
console.log(`  entities: ${entityRows.length}`);
console.log(`  docs:     ${docRows.length}`);
console.log(`  addresses:${addressRows.length}`);
console.log(`  edges:    ${edgeRows.length}`);

// graph.json — full export for local inspection / debugging
fs.writeFileSync(
  path.join(ROOT, "public/graph.json"),
  JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 4,
      counts: {
        entities: entityRows.length,
        docs: docRows.length,
        addresses: addressRows.length,
        edges: edgeRows.length,
      },
    },
    entities: entityRows,
    edges: edgeRows,
  }),
);
console.log("  public/graph.json written");

// relations.json — lean browser payload.
// Filter rules:
//   - Drop parent_of edges (the tree is already in docs.json).
//   - Drop ecosystem_actor entities: too many, mostly orphans with no incoming edges.
//     Any edge referencing a dropped entity is also dropped to avoid dangling ids.
//   - Keep ecosystem_actors referenced by load-bearing role/RP edges so their
//     relationships survive (e.g. BA Labs → Core Council Risk Advisor role).
const OMIT_ENTITY_TYPES = new Set(["ecosystem_actor"]);
const KEEP_ACTOR_EDGE_TYPES = new Set(["holds_role_for", "responsible_party_for"]);
const pinnedActorIds = new Set(
  edges
    .filter((e) => KEEP_ACTOR_EDGE_TYPES.has(e.edgeType) && e.fromType === "entity")
    .map((e) => e.fromId),
);
const keptEntityIds = new Set(
  entityRows
    .filter((e) => !OMIT_ENTITY_TYPES.has(e.entity_type) || pinnedActorIds.has(e.id))
    .map((e) => e.id),
);

const relationEdges = edges
  .filter((e) => e.edgeType !== "parent_of")
  .filter((e) => {
    if (e.fromType === "entity" && !keptEntityIds.has(e.fromId)) return false;
    if (e.toType === "entity" && !keptEntityIds.has(e.toId)) return false;
    return true;
  })
  .map((e) => {
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

const relationEntities = entityRows
  .filter((e) => keptEntityIds.has(e.id))
  .map((e) => {
    const out = {
      id: e.id,
      slug: e.slug,
      name: e.name,
      et: e.entity_type,
      st: e.subtype,
      did: e.defining_doc_id,
    };
    if (e.meta) out.m = e.meta;
    return out;
  });

fs.writeFileSync(
  path.join(ROOT, "public/relations.json"),
  JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 4,
      counts: { entities: relationEntities.length, edges: relationEdges.length },
    },
    entities: relationEntities,
    edges: relationEdges,
  }),
);
const relSize = fs.statSync(path.join(ROOT, "public/relations.json")).size;
console.log(`  public/relations.json written (${(relSize / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------------------
// Phase 4.5: Enrich addresses.atlas.json with graph-derived annotations
//
// Mutates addressesAtlas in place (the atlas-only artifact). Never touches
// addresses.json (on-chain data). Five passes, each only fills gaps:
//   4.5a — ICD-param: roles + entityLabel from structured ICD params
//   4.5b — Entity-linked: entityLabel from graph entities via labelToAddresses
//   4.5c — Parent-titled: "Address" docs → parent doc title
//   4.5d — Doc-titled: any address-bearing doc with a descriptive title
//   4.5e — Chainlog/Etherscan fallback: last resort from on-chain data
// ---------------------------------------------------------------------------
{
  let icdUpdated = 0, icdMissing = 0;
  let entityLabeled = 0, parentLabeled = 0, titleLabeled = 0, chainlogFallback = 0;

  // 4.5a
  for (const [addr, ann] of icdAnnotations) {
    const entry = addressesAtlas[addr];
    if (!entry) { icdMissing++; continue; }
    entry.roles = [...new Set([...ann.roles, ...(entry.roles ?? [])])];
    if (ann.entityLabel) entry.entityLabel = ann.entityLabel;
    icdUpdated++;
  }

  // 4.5b
  const { labelToAddresses } = entityContext;
  for (const [slug, addrList] of labelToAddresses) {
    const entity = entityMap.get(slug);
    if (!entity) continue;
    for (const { addr } of addrList) {
      const entry = addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = entity.name;
      entityLabeled++;
    }
  }

  // 4.5c
  const GENERIC_TITLE = /^address(?:es)?$/i;
  for (const doc of allDocs) {
    if (!GENERIC_TITLE.test(doc.title.trim()) || !doc.addressRefs?.length) continue;
    const parentDocNo = doc.doc_no.split(".").slice(0, -1).join(".");
    const parentDoc = docByDocNo.get(parentDocNo);
    if (!parentDoc) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = parentDoc.title;
      parentLabeled++;
    }
  }

  // 4.5d
  const SKIP_TITLE_D = /^address(?:es)?$|^parameters?$/i;
  for (const doc of allDocs) {
    if (!doc.addressRefs?.length || SKIP_TITLE_D.test(doc.title.trim())) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = doc.title;
      titleLabeled++;
    }
  }

  // 4.5e: chainlog/Etherscan fallback — pull from on-chain file
  for (const [addr, entry] of Object.entries(addressesAtlas)) {
    if (entry.entityLabel) continue;
    const onChain = addressesOnChain[addr] ?? {};
    const fallback = onChain.chainlogId ?? onChain.etherscanName ?? null;
    if (fallback) { entry.entityLabel = fallback; chainlogFallback++; }
  }

  fs.writeFileSync(path.join(ROOT, "public/addresses.atlas.json"), JSON.stringify(addressesAtlas));
  console.log(
    `  Atlas enrichment:` +
    ` ${icdUpdated} ICD` +
    (icdMissing ? ` (${icdMissing} not in prose)` : "") +
    `, ${entityLabeled} entity-linked` +
    `, ${parentLabeled} parent-titled` +
    `, ${titleLabeled} doc-titled` +
    `, ${chainlogFallback} chainlog-fallback`,
  );
}

if (APPLY_D1) {
  // Load order follows the FK graph: docs first (source of truth, referenced
  // by entities.defining_doc_id), then entities (referenced by
  // addresses.entity_id), then addresses, then edges (which reference all three).
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-graph-"));
  const files = {
    docs: path.join(TMP, "_docs.sql"),
    entities: path.join(TMP, "_entities.sql"),
    addresses: path.join(TMP, "_addresses.sql"),
    edges: path.join(TMP, "_edges.sql"),
  };

  console.log("\nWriting SQL files…");
  await writeBatched(
    files.docs,
    "docs",
    ["id", "doc_no", "title", "type", "depth", "parent_id", "content", "ord"],
    docRows,
  );
  await writeBatched(
    files.entities,
    "entities",
    ["id", "slug", "name", "entity_type", "subtype", "defining_doc_id", "is_active", "meta"],
    entityRows,
  );
  await writeBatched(
    files.addresses,
    "addresses",
    [
      "address",
      "chain",
      "label",
      "chainlog_id",
      "etherscan_name",
      "is_contract",
      "is_proxy",
      "implementation",
      "roles",
      "aliases",
      "expected_tokens",
      "chain_state",
      "state_block",
      "state_at",
      "entity_id",
    ],
    addressRows,
  );
  await writeBatched(
    files.edges,
    "edges",
    [
      "id",
      "from_id",
      "from_type",
      "to_id",
      "to_type",
      "edge_type",
      "source_doc_nos",
      "weight",
      "meta",
    ],
    edgeRows,
  );

  console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);
  for (const [name, file] of Object.entries(files)) {
    runFile(file);
    console.log(`  ${name} done`);
    fs.unlinkSync(file);
  }
  fs.rmdirSync(TMP);
}
console.log("\nDone.");
