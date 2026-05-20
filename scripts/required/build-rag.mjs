#!/usr/bin/env node
/**
 * Build a vector index over the Sky Atlas for semantic search.
 *
 * Reads:  public/docs.json
 * Writes: .cache/atlas-vectors/vectors.bin
 *         .cache/atlas-vectors/ids.json        (ordered UUIDs that index vectors.bin)
 *         .cache/atlas-vectors/meta.json        (model, dim, count, atlasCommit, …)
 *         .cache/atlas-vectors/text-hashes.json (uuid → sha256(embedText) for incremental builds)
 *
 * Incremental: on each run, the embed text for every node is hashed and
 * compared to the previous text-hashes.json. Only nodes whose embed text
 * changed (or that are new) are re-embedded; unchanged nodes reuse their
 * cached Float32 vectors directly. Reused vectors are already L2-normalized
 * and are copied as-is; only fresh embeddings are normalized.
 *
 * These are not part of the frontend bundle — they feed the hosted MCP
 * server's Vectorize index via redlens-mcp/sync-vectors.mjs.
 *
 * Embedder: @huggingface/transformers Xenova/bge-base-en-v1.5 (768d, ONNX).
 * Same weights as the Workers AI model used at query time in the MCP worker.
 *
 * Strategy: one vector per atlas node. Embed text is the node's heading line
 * plus a 3-deep parent chain so tiny one-line nodes (~31% of the corpus)
 * have enough semantics to be retrievable.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { pipeline } from "@huggingface/transformers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS_PATH = resolve(ROOT, "public/docs.json");
const OUT_DIR   = resolve(ROOT, ".cache/atlas-vectors");

// Cache paths — read at startup, written at end.
const HASHES_PATH  = resolve(OUT_DIR, "text-hashes.json");
const IDS_PATH     = resolve(OUT_DIR, "ids.json");
const VECTORS_PATH = resolve(OUT_DIR, "vectors.bin");

const MODEL     = "Xenova/bge-base-en-v1.5";
const DIM       = 768;
// bge-base-en's positional embedding cap is 512 tokens. ~4 chars/token in
// English → 2048 chars is the safe cap (matches how the model was trained).
const BATCH     = Number(process.env.RAG_BATCH ?? 32);
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS ?? 2048);

const isAppleSilicon = process.platform === "darwin" && process.arch === "arm64";
const DEVICE = process.env.RAG_DEVICE ?? (isAppleSilicon ? "coreml" : "cpu");

let _embedder = null;
async function getEmbedder() {
  if (!_embedder) {
    console.log(`  loading model ${MODEL} on ${DEVICE}…`);
    _embedder = await pipeline("feature-extraction", MODEL, { device: DEVICE, dtype: "fp32" });
  }
  return _embedder;
}

function buildEmbedText(node, docs) {
  const header = `${node.doc_no} - ${node.title} [${node.type}]`;
  const chain = [];
  let cur = node.parentId ? docs[node.parentId] : null;
  let hops = 0;
  while (cur && hops < 3) {
    chain.push(`${cur.doc_no} - ${cur.title} [${cur.type}]`);
    cur = cur.parentId ? docs[cur.parentId] : null;
    hops++;
  }
  const ancestry = chain.length > 0 ? `in: ${chain.join(" ← ")}` : "";
  const content = (node.content ?? "").trim();
  const text = [header, ancestry, "", content].filter(Boolean).join("\n").trim();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

async function embedBatch(inputs) {
  const embedder = await getEmbedder();
  const output = await embedder(inputs, { pooling: "mean", normalize: false });
  const data = output.tolist();
  if (data.length !== inputs.length) {
    throw new Error(`embed count mismatch: got ${data.length}, expected ${inputs.length}`);
  }
  return data;
}

async function main() {
  console.log(`reading ${DOCS_PATH}`);
  const docs = JSON.parse(readFileSync(DOCS_PATH, "utf8"));
  const nodes = Object.values(docs);
  console.log(`  ${nodes.length} nodes`);

  // Stable order — sort by doc_no so vectors.bin layout is reproducible.
  nodes.sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));

  const chunks = nodes.map((n) => ({
    id: n.id,
    doc_no: n.doc_no,
    embedText: buildEmbedText(n, docs),
  }));

  const truncated = chunks.filter((c) => c.embedText.length === MAX_CHARS).length;
  if (truncated > 0) console.log(`  ${truncated} chunks truncated to ${MAX_CHARS} chars`);

  // ── Load previous cache ────────────────────────────────────────────────
  // prevHashes: uuid → sha256(embedText) from the last successful run.
  // prevVectors: uuid → Float32Array(DIM) view into the loaded binary.
  // Both are empty on a cold start (no cache or load failure).
  let prevHashes = {};
  let prevVectors = new Map();

  if (existsSync(HASHES_PATH) && existsSync(IDS_PATH) && existsSync(VECTORS_PATH)) {
    try {
      prevHashes = JSON.parse(readFileSync(HASHES_PATH, "utf8"));
      const prevIds = JSON.parse(readFileSync(IDS_PATH, "utf8"));
      const buf = readFileSync(VECTORS_PATH);
      // Slice to guarantee 4-byte alignment for Float32Array.
      const f32 = new Float32Array(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      );
      for (let i = 0; i < prevIds.length; i++) {
        prevVectors.set(prevIds[i], f32.subarray(i * DIM, (i + 1) * DIM));
      }
      console.log(`  ${prevIds.length} cached vectors loaded`);
    } catch (e) {
      console.warn(`  cache load failed (${e.message}) — rebuilding all vectors`);
      prevHashes = {};
      prevVectors = new Map();
    }
  }

  // ── Classify chunks ────────────────────────────────────────────────────
  // Hash each chunk's embed text. Reuse the cached vector if the hash
  // matches; otherwise queue for embedding.
  const vectors  = new Float32Array(chunks.length * DIM);
  const newHashes = {};
  const toEmbed  = []; // { idx: number, embedText: string }

  for (let i = 0; i < chunks.length; i++) {
    const { id, embedText } = chunks[i];
    const hash = createHash("sha256").update(embedText).digest("hex");
    newHashes[id] = hash;

    if (prevHashes[id] === hash && prevVectors.has(id)) {
      vectors.set(prevVectors.get(id), i * DIM);
    } else {
      toEmbed.push({ idx: i, embedText });
    }
  }

  const reused = chunks.length - toEmbed.length;
  console.log(`\nembedding via ${MODEL}, batch=${BATCH}`);
  console.log(`  ${toEmbed.length} to embed, ${reused} reused from cache`);

  // ── Embed changed / new chunks ─────────────────────────────────────────
  if (toEmbed.length === 0) {
    console.log("  all vectors reused — no API calls needed");
  } else {
    const t0 = Date.now();
    for (let b = 0; b < toEmbed.length; b += BATCH) {
      const slice = toEmbed.slice(b, b + BATCH);
      const embs  = await embedBatch(slice.map((x) => x.embedText));
      for (let k = 0; k < embs.length; k++) {
        const { idx } = slice[k];
        if (embs[k].length !== DIM) {
          throw new Error(`dim mismatch at idx ${idx}: got ${embs[k].length}, expected ${DIM}`);
        }
        vectors.set(embs[k], idx * DIM);
      }
      const done = b + slice.length;
      const pct  = ((done / toEmbed.length) * 100).toFixed(1);
      const sec  = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${done}/${toEmbed.length} embedded (${pct}%) — ${sec}s`);
    }
    const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  done in ${totalSec}s`);

    // L2-normalize only newly embedded vectors. Reused vectors are already
    // normalized from the previous run — re-normalizing would cause tiny
    // floating-point drift and break byte-identical reproducibility checks.
    const newIdxSet = new Set(toEmbed.map((x) => x.idx));
    for (let i = 0; i < chunks.length; i++) {
      if (!newIdxSet.has(i)) continue;
      let sum = 0;
      for (let k = 0; k < DIM; k++) sum += vectors[i * DIM + k] ** 2;
      const norm = Math.sqrt(sum);
      if (norm > 0) for (let k = 0; k < DIM; k++) vectors[i * DIM + k] /= norm;
    }
  }

  // ── atlasCommit ────────────────────────────────────────────────────────
  // Primary: read from committed manifest.json (always present in CI without submodule).
  // Fallback: git rev-parse in submodule (local dev with submodule checked out).
  const atlasCommit = (() => {
    try {
      const manifest = JSON.parse(readFileSync(resolve(ROOT, "public/manifest.json"), "utf8"));
      if (manifest.atlasCommit) return manifest.atlasCommit;
    } catch {}
    try {
      return execSync("git rev-parse HEAD", {
        cwd: resolve(ROOT, "vendor/next-gen-atlas"),
        encoding: "utf8",
      }).trim();
    } catch {
      return null;
    }
  })();

  // ── Write outputs ──────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(VECTORS_PATH, Buffer.from(vectors.buffer));
  writeFileSync(IDS_PATH, JSON.stringify(chunks.map((c) => c.id)));
  writeFileSync(
    resolve(OUT_DIR, "meta.json"),
    JSON.stringify(
      { model: MODEL, dim: DIM, count: chunks.length, normalized: true, maxChars: MAX_CHARS, atlasCommit },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(HASHES_PATH, JSON.stringify(newHashes));

  console.log(`\n  vectors.bin: ${(vectors.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ids.json: ${chunks.length} ids`);
  console.log(`  atlas: ${atlasCommit?.slice(0, 12) ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
