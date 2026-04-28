#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json          — id → node (uuid, doc_no, title, type, depth, parentId, content, addressRefs)
 *   public/search-index.json  — serialized lunr index
 *   public/addresses.atlas.json — address → { chain }  (minimal; build-graph Phase 2.6 adds annotation)
 *
 * Run: node scripts/required/build-index.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import lunr from "lunr";

import { sha256, HEADING_RE, parse, cleanContent } from "../lib/atlas-parser.mjs";
import { ETH_ADDR_RE, SOL_ADDR_RE, normalizeAddress, detectChain } from "../lib/address-chains.mjs";

// Avoid unused-import noise — keep these here so the file documents the full
// surface of atlas-parser even though parse() is the only caller.
void HEADING_RE;
void cleanContent;
void sha256;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ATLAS_PATH = path.join(ROOT, "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md");
const OUT_DIR = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Per-node address extraction — chain detection only.
// Annotation (roles, entityLabel, expectedTokens) runs in build-graph Phase 2.6
// so it has access to the full entity graph and ICD param data.
// ---------------------------------------------------------------------------
function extractAddresses(content) {
  const result = {};

  ETH_ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ETH_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    if (!result[key]) result[key] = { chain: detectChain(content, m.index) };
  }

  SOL_ADDR_RE.lastIndex = 0;
  while ((m = SOL_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    if (!result[key]) result[key] = { chain: "solana" };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build lunr index
// ---------------------------------------------------------------------------
function buildIndex(nodes) {
  return lunr(function () {
    this.ref("id");
    this.field("title", { boost: 10 });
    this.field("doc_no", { boost: 5 });
    this.field("type", { boost: 2 });
    this.field("content");
    for (const node of nodes) {
      this.add({ id: node.id, title: node.title, doc_no: node.doc_no, type: node.type, content: node.content });
    }
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function printStats(nodes) {
  const byType = {};
  const byDepth = {};
  let emptyContent = 0;
  for (const node of nodes) {
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    byDepth[node.depth] = (byDepth[node.depth] ?? 0) + 1;
    if (!node.content) emptyContent++;
  }
  console.log("\n=== Atlas Parse Stats ===");
  console.log(`Total nodes:   ${nodes.length}`);
  console.log(`Empty content: ${emptyContent}`);
  console.log("\nBy type:");
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
    console.log(`  ${t.padEnd(24)} ${n}`);
  console.log("\nBy depth:");
  for (const [d, n] of Object.entries(byDepth).sort((a, b) => +a[0] - +b[0]))
    console.log(`  depth ${d}: ${n}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const src = fs.readFileSync(ATLAS_PATH, "utf8");
console.log("Parsing Atlas…");
const { nodes } = parse(src);

printStats(nodes);

console.log("\nBuilding lunr index…");
const idx = buildIndex(nodes);

fs.mkdirSync(OUT_DIR, { recursive: true });

// Build docs and extract address refs + chain map in one pass.
const docs = {};
const chainMap = {}; // addr → { chain }  (most specific chain wins over ethereum)

for (const node of nodes) {
  const addrs = extractAddresses(node.content);
  for (const [addr, info] of Object.entries(addrs)) {
    const existing = chainMap[addr];
    if (!existing || existing.chain === "ethereum") chainMap[addr] = info;
  }
  docs[node.id] = {
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    depth: node.depth,
    parentId: node.parentId,
    order: node.order,
    content: node.content,
    contentHash: node.contentHash,
    addressRefs: Object.keys(addrs).sort(),
  };
}

const total = Object.keys(chainMap).length;
const byChain = {};
for (const { chain } of Object.values(chainMap)) byChain[chain] = (byChain[chain] ?? 0) + 1;
console.log(`\n${total} unique addresses extracted`);
for (const [c, n] of Object.entries(byChain).sort((a, b) => b[1] - a[1]))
  console.log(`  ${c.padEnd(12)} ${n}`);

fs.writeFileSync(path.join(OUT_DIR, "addresses.atlas.json"), JSON.stringify(chainMap));
fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify(docs));
fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(idx));

const docsSize = (fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024).toFixed(1);
const idxSize  = (fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024).toFixed(1);
console.log(`\nWrote docs.json (${docsSize} KB), search-index.json (${idxSize} KB), addresses.atlas.json`);
