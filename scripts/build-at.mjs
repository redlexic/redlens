#!/usr/bin/env node
/**
 * Reproducible atlas build at a specific submodule commit.
 *
 *   pnpm build:at <atlas-commit-sha>
 *
 * Anyone with a fresh clone can run this, pin the atlas to any historical
 * commit, and regenerate docs.json + search-index.json + manifest.json. Two
 * people running this against the same atlas SHA get byte-identical artifacts
 * (that's what tests/reproducible.test.ts enforces).
 *
 * Scope is intentionally just build:index + build:manifest — those are the
 * deterministic, offline-reproducible steps. build:addresses and
 * build:snapshot depend on external APIs (Etherscan, RPC) so they are not
 * part of the repro path.
 *
 * Leaves the atlas submodule checked out at <sha>. To restore the pinned
 * commit from the main repo's index: `git submodule update`.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");

const sha = process.argv[2];
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error("Usage: pnpm build:at <atlas-commit-sha>");
  console.error("       sha must be 7–40 hex chars");
  process.exit(1);
}

function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}${cwd === ROOT ? "" : `   (in ${path.relative(ROOT, cwd)})`}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

run("git fetch origin --quiet", ATLAS);
run(`git checkout --quiet ${sha}`, ATLAS);

const resolvedSha = execSync("git rev-parse HEAD", { cwd: ATLAS, encoding: "utf8" }).trim();
console.log(`atlas checked out at ${resolvedSha}\n`);

run("pnpm build:index");
run("pnpm build:manifest");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
console.log("\n=== Reproducible build ===");
console.log(`atlas:   ${manifest.atlasCommit}`);
console.log(`redlens: ${manifest.redlensCommit}`);
console.log("");
for (const [name, info] of Object.entries(manifest.artifacts)) {
  console.log(`  ${name.padEnd(22)} ${info.sha256}`);
}
console.log(`\nAtlas submodule is now at ${resolvedSha.slice(0, 12)}.`);
console.log(`To restore the pinned commit: git submodule update`);
