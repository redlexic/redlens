#!/usr/bin/env node
/**
 * sync-d1.mjs
 *
 * Reads the already-built graph artifacts and syncs them into D1.
 * Run build-graph.mjs first so the artifacts are up to date.
 *
 * Usage (from redlens-mcp/):
 *   node sync-d1.mjs           # sync to local D1
 *   node sync-d1.mjs --remote  # sync to remote D1
 *
 * Reads:
 *   public/docs.json
 *   public/graph.json
 *   public/addresses.atlas.json
 *   public/addresses.json      (optional)
 *   public/chain-state.json
 *
 * Writes: D1 tables: docs, entities, addresses, edges
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { slugify } from "../scripts/lib/graph-patterns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MCP_DIR = __dirname;
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const SCHEMA = path.join(MCP_DIR, "schema.sql");
const BATCH = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function runFile(filePath) {
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: MCP_DIR,
  });
}

async function writeBatched(filePath, tableName, cols, rows) {
  const out = fs.createWriteStream(filePath);
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
// Load artifacts
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const allDocs = Object.values(rawDocs);
console.log(`  ${allDocs.length} docs`);

console.log("Loading graph.json…");
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "public/graph.json"), "utf8"));
const entityRows = graph.entities;
const edgeRows = graph.edges;
console.log(`  ${entityRows.length} entities, ${edgeRows.length} edges`);

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
console.log(`  ${Object.keys(addressesAtlas).length} atlas, ${Object.keys(addressesOnChain).length} on-chain`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"),
);
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = { chain, block: data.block ?? data.slot ?? null, values };
    }
  }
} else {
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = { chain: "ethereum", block: chainState.block ?? null, values };
  }
}

// ---------------------------------------------------------------------------
// Build rows
// ---------------------------------------------------------------------------

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

// slug → entity id, for resolving address.entity_id
const entityBySlug = new Map(entityRows.map((e) => [e.slug, e]));

const addressRows = Object.entries(addressesAtlas).map(([addr, atlas]) => {
  const onChain = addressesOnChain[addr] ?? {};
  const label = onChain.chainlogId ?? atlas.entityLabel ?? onChain.etherscanName ?? null;
  const s = label ? slugify(label) : null;
  const cs = chainStateByAddr[addr.toLowerCase()];
  return {
    address: addr.toLowerCase(),
    chain: atlas.chain ?? "ethereum",
    label,
    chainlog_id: onChain.chainlogId ?? null,
    etherscan_name: onChain.etherscanName ?? null,
    is_contract: onChain.isContract ? 1 : 0,
    is_proxy: onChain.isProxy ? 1 : 0,
    implementation: onChain.implementation ?? null,
    roles: JSON.stringify(atlas.roles ?? []),
    aliases: JSON.stringify(atlas.aliases ?? []),
    expected_tokens: JSON.stringify(atlas.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null,
    entity_id: s ? (entityBySlug.get(s)?.id ?? null) : null,
  };
});

console.log(`\nRow counts:`);
console.log(`  docs:      ${docRows.length}`);
console.log(`  entities:  ${entityRows.length}`);
console.log(`  addresses: ${addressRows.length}`);
console.log(`  edges:     ${edgeRows.length}`);

// ---------------------------------------------------------------------------
// Write SQL files and apply
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-sync-"));
const clearFile = path.join(TMP, "_0_clear.sql");
fs.writeFileSync(
  clearFile,
  "DELETE FROM edges;\nDELETE FROM addresses;\nDELETE FROM entities;\nDELETE FROM docs;\n",
);
const files = {
  docs:      path.join(TMP, "_docs.sql"),
  entities:  path.join(TMP, "_entities.sql"),
  addresses: path.join(TMP, "_addresses.sql"),
  edges:     path.join(TMP, "_edges.sql"),
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
    "address", "chain", "label", "chainlog_id", "etherscan_name",
    "is_contract", "is_proxy", "implementation",
    "roles", "aliases", "expected_tokens",
    "chain_state", "state_block", "entity_id",
  ],
  addressRows,
);
await writeBatched(
  files.edges,
  "edges",
  ["id", "from_id", "from_type", "to_id", "to_type", "edge_type", "source_doc_nos", "weight", "meta"],
  edgeRows,
);

console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);
runFile(SCHEMA);
console.log("  schema done");
runFile(clearFile);
fs.unlinkSync(clearFile);
console.log("  clear done");
for (const [name, file] of Object.entries(files)) {
  runFile(file);
  console.log(`  ${name} done`);
  fs.unlinkSync(file);
}
fs.rmdirSync(TMP);

console.log("\nDone.");
