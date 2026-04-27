#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json        — id → node (uuid, doc_no, title, type, depth, parentId, content)
 *   public/search-index.json — serialized lunr index
 *
 * Run: node scripts/required/build-index.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import lunr from "lunr";

import { sha256, HEADING_RE, parse, cleanContent } from "../lib/atlas-parser.mjs";
import {
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  normalizeAddress,
  detectChain,
  findTableContext,
  EXPLORER,
} from "../lib/address-chains.mjs";
import {
  extractRoles,
  extractEntityLabel,
  extractExpectedTokens,
} from "../lib/address-annotate.mjs";
import { mergeAddressAnnotations } from "../lib/address-merge.mjs";

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
// Per-node address extraction
// Returns { normalizedAddress → { chain, explorerUrl, roles, entityLabel, expectedTokens } }
// Keys are lowercase for EVM, original case for Solana. See normalizeAddress.
// ---------------------------------------------------------------------------
function extractAddresses(content) {
  const result = {};

  // EVM addresses (0x-prefixed)
  ETH_ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ETH_ADDR_RE.exec(content)) !== null) {
    const addr = m[0];
    const key = normalizeAddress(addr);
    if (result[key]) continue;
    const chain = detectChain(content, m.index);
    const table = findTableContext(content, m.index);
    result[key] = {
      chain,
      explorerUrl: EXPLORER[chain] + key,
      roles: extractRoles(content, m.index, addr.length, table),
      entityLabel: extractEntityLabel(content, m.index, table),
      expectedTokens: extractExpectedTokens(content, m.index, addr.length, table),
    };
  }

  // Solana addresses (base58, 43-44 chars) — assumed Solana by pattern alone
  SOL_ADDR_RE.lastIndex = 0;
  while ((m = SOL_ADDR_RE.exec(content)) !== null) {
    const addr = m[0];
    const key = normalizeAddress(addr);
    if (result[key]) continue;
    const table = findTableContext(content, m.index);
    result[key] = {
      chain: "solana",
      explorerUrl: EXPLORER.solana + key,
      roles: extractRoles(content, m.index, addr.length, table),
      entityLabel: extractEntityLabel(content, m.index, table),
      expectedTokens: extractExpectedTokens(content, m.index, addr.length, table),
    };
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
      this.add({
        id: node.id,
        title: node.title,
        doc_no: node.doc_no,
        type: node.type,
        content: node.content,
      });
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

// docs.json — strip content for the initial load; full content is only needed
// for the detail view and snippet generation (kept in same file for simplicity
// at this scale — we can split later if needed)
const docs = {};
for (const node of nodes) {
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
    addresses: extractAddresses(node.content),
  };
}

// Merge per-node annotations into a single global view per address. After
// this, every node that references a given address sees the same label, roles,
// and expectedTokens — picked from the richest per-node extraction.
console.log("\nMerging address annotations across nodes…");
const mergedAddrs = mergeAddressAnnotations(Object.values(docs));
console.log(`  ${Object.keys(mergedAddrs).length} unique addresses merged`);

// Strip the per-node addresses map: every node now carries only the list of
// normalized address keys it references. The frontend joins these against the
// shared public/addresses.json (built later by scripts/build-addresses.mjs).
for (const node of Object.values(docs)) {
  node.addressRefs = Object.keys(node.addresses || {}).sort();
  delete node.addresses;
}

// Address stats — show before any UI consumes the merged map.
{
  const total = Object.keys(mergedAddrs).length;
  let withLabel = 0;
  const byChain = {};
  for (const info of Object.values(mergedAddrs)) {
    if (info.entityLabel) withLabel++;
    byChain[info.chain] = (byChain[info.chain] ?? 0) + 1;
  }
  console.log(`  with atlas-prose label: ${withLabel} / ${total}`);
  console.log("  by chain:");
  for (const [c, n] of Object.entries(byChain).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(12)} ${n}`);
  }
}

// Hand the merged map to scripts/build-addresses.mjs as an intermediate file.
// Not a shipping artifact — build-addresses overwrites public/addresses.json
// and deletes this baton afterwards.
fs.writeFileSync(path.join(OUT_DIR, "addresses.merged.json"), JSON.stringify(mergedAddrs));

fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify(docs));
fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(idx));

const docsSize = (fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024).toFixed(1);
const idxSize = (fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024).toFixed(1);

console.log(
  `\nWrote public/docs.json (${docsSize} KB) and public/search-index.json (${idxSize} KB)`,
);
