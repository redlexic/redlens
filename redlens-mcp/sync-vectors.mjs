#!/usr/bin/env node
/**
 * sync-vectors.mjs
 *
 * Reads the prebuilt embedding artifacts and upserts them into Vectorize.
 * Run build:rag first so the artifacts are up to date.
 *
 * Usage (from redlens-mcp/):
 *   node sync-vectors.mjs
 *
 * Reads:
 *   public/atlas-vectors.bin         Float32Array, count*dim values
 *   public/atlas-vectors.ids.json    string[]  ordered UUIDs
 *   public/atlas-vectors.meta.json   { model, dim, count, atlasCommit, ... }
 *   public/docs.json                 to enrich Vectorize metadata
 *
 * Writes:
 *   Vectorize index `redlens-atlas-bge` (must be created beforehand:
 *     `npx wrangler vectorize create redlens-atlas-bge --dimensions=768 --metric=cosine`)
 *   D1 kv_meta keys: vectorsAtlasCommit, vectorsModel, vectorsCount, vectorsSyncedAt
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MCP_DIR = __dirname;
const INDEX = "redlens-atlas-bge";
const DB = "redlens-atlas";

const BIN = path.join(ROOT, "public/atlas-vectors.bin");
const IDS = path.join(ROOT, "public/atlas-vectors.ids.json");
const META = path.join(ROOT, "public/atlas-vectors.meta.json");
const DOCS = path.join(ROOT, "public/docs.json");

for (const p of [BIN, IDS, META]) {
  if (!fs.existsSync(p)) {
    console.warn(`sync-vectors: missing ${p}; build:rag was skipped (no token?). Skipping.`);
    process.exit(0);
  }
}
if (!fs.existsSync(DOCS)) {
  console.error(`missing ${DOCS}; run \`pnpm build:index\` first`);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(META, "utf8"));
const ids = JSON.parse(fs.readFileSync(IDS, "utf8"));
const docs = JSON.parse(fs.readFileSync(DOCS, "utf8"));
const buf = fs.readFileSync(BIN);
const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

if (vectors.length !== ids.length * meta.dim) {
  console.error(`vector buffer size mismatch: ${vectors.length} != ${ids.length} * ${meta.dim}`);
  process.exit(1);
}
console.log(`vectors: ${ids.length} × ${meta.dim} (${meta.model})`);
console.log(`atlas:   ${meta.atlasCommit?.slice(0, 12) ?? "unknown"}`);

// Build NDJSON: {"id":..., "values":[...], "metadata":{...}}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-vectors-"));
const NDJSON = path.join(TMP, "vectors.ndjson");

console.log(`writing ${NDJSON}…`);
const out = fs.createWriteStream(NDJSON);
let written = 0;
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const node = docs[id];
  const values = Array.from(vectors.subarray(i * meta.dim, (i + 1) * meta.dim));
  const metadata = node
    ? { docId: id, doc_no: node.doc_no, type: node.type, depth: node.depth }
    : { docId: id };
  out.write(JSON.stringify({ id, values, metadata }) + "\n");
  written++;
}
out.end();
await new Promise((r) => out.on("finish", r));
const fileSizeMB = (fs.statSync(NDJSON).size / 1024 / 1024).toFixed(1);
console.log(`  ${written} rows, ${fileSizeMB} MB`);

console.log(`\nUpserting into Vectorize index "${INDEX}"…`);
execSync(`npx wrangler@latest vectorize insert ${INDEX} --file="${NDJSON}" --batch-size=1000`, {
  stdio: "inherit",
  cwd: MCP_DIR,
});

// Stamp kv_meta so the worker can detect drift between vectors and D1 docs.
const syncedAt = new Date().toISOString();
const stampSql = path.join(TMP, "stamp.sql");
const stampRows = [
  ["vectorsAtlasCommit", meta.atlasCommit ?? ""],
  ["vectorsModel", meta.model],
  ["vectorsCount", String(meta.count)],
  ["vectorsSyncedAt", syncedAt],
];
const escSql = (s) => "'" + String(s).replace(/'/g, "''") + "'";
fs.writeFileSync(
  stampSql,
  "INSERT OR REPLACE INTO kv_meta (key,value) VALUES\n" +
    stampRows.map(([k, v]) => `(${escSql(k)},${escSql(v)})`).join(",\n") +
    ";\n",
);
console.log(`\nStamping kv_meta in D1 ${DB}…`);
execSync(`npx wrangler@latest d1 execute ${DB} --remote --file="${stampSql}"`, {
  stdio: "inherit",
  cwd: MCP_DIR,
});

fs.unlinkSync(NDJSON);
fs.unlinkSync(stampSql);
fs.rmdirSync(TMP);

console.log("\nDone.");
