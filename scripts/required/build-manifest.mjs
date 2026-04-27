#!/usr/bin/env node
/**
 * Emits public/manifest.json — a sha256 digest of every shipping artifact.
 *
 * Runs last in `pnpm build`. vite.config.ts reads the manifest at build time
 * and inlines the hash map into the bundle as __ARTIFACT_HASHES__. The
 * frontend verifies each fetched JSON against the expected hash before using
 * it, so CDN tampering / stale caches / truncated responses hard-fail.
 *
 * Also pins the atlas submodule SHA and the redlens commit SHA so the
 * manifest is a self-contained provenance record for this build.
 *
 * Run: node scripts/build-manifest.mjs
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "manifest.json");

// Artifacts we hash and verify on the frontend. Anything else in public/ is
// either intermediate (addresses.merged.json — gitignored) or out of scope
// for verification (history/** — too many files, fetched on demand).
const ARTIFACTS = [
  "docs.json",
  "search-index.json",
  "addresses.json",
  "chain-state.json",
  "relations.json",
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function gitRev(cwd) {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const artifacts = {};
for (const name of ARTIFACTS) {
  const p = path.join(PUBLIC, name);
  if (!fs.existsSync(p)) {
    console.warn(`  skip ${name} — not present`);
    continue;
  }
  const buf = fs.readFileSync(p);
  artifacts[name] = {
    sha256: sha256(buf),
    bytes: buf.length,
  };
}

const chainStatePath = path.join(PUBLIC, "chain-state.json");
const blockNumber = fs.existsSync(chainStatePath)
  ? (JSON.parse(fs.readFileSync(chainStatePath, "utf8")).block ?? null)
  : null;

const manifest = {
  generatedAt: new Date().toISOString(),
  redlensCommit: gitRev(ROOT),
  atlasCommit: gitRev(path.join(ROOT, "vendor/next-gen-atlas")),
  blockNumber,
  artifacts,
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");

console.log("=== Manifest ===");
console.log(`redlens: ${manifest.redlensCommit?.slice(0, 12) ?? "unknown"}`);
console.log(`atlas:   ${manifest.atlasCommit?.slice(0, 12) ?? "unknown"}`);
for (const [name, info] of Object.entries(artifacts)) {
  const kb = (info.bytes / 1024).toFixed(1).padStart(8);
  console.log(`  ${name.padEnd(22)} ${kb} KB  ${info.sha256.slice(0, 12)}…`);
}
console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
