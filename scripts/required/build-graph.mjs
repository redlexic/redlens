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

console.log("Loading addresses.json…");
const addressesRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
console.log(`  ${Object.keys(addressesRaw).length} addresses`);

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
    etherscan_name: null,
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
