// Determinism: running the build twice on a clean checkout should produce
// byte-identical artifacts. Only runs in REPRO=1 mode because each build
// takes ~10s — it's a CI check, not part of every local `pnpm test`.
//
// Why this matters: ci.yml drops `build:manifest` and uses the committed
// manifest as the source of truth. The manifest test asserts disk hashes
// match committed hashes, which only works if every build is deterministic.
// If determinism breaks here, CI starts flaking on the manifest test.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");
const run = process.env.REPRO === "1";

function sha256(p: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe.runIf(run)("reproducible build:index", () => {
  it("docs.json and search-index.json are byte-identical across two runs", () => {
    const before = {
      docs: sha256(path.join(ROOT, "public/docs.json")),
      idx: sha256(path.join(ROOT, "public/search-index.json")),
    };
    execSync("pnpm build:index", { cwd: ROOT, stdio: "pipe" });
    const after = {
      docs: sha256(path.join(ROOT, "public/docs.json")),
      idx: sha256(path.join(ROOT, "public/search-index.json")),
    };
    expect(after.docs).toBe(before.docs);
    expect(after.idx).toBe(before.idx);
  }, 120_000);
});

describe.runIf(run)("reproducible build:graph", () => {
  it("graph.json and relations.json are byte-identical across two runs", () => {
    const before = {
      graph: sha256(path.join(ROOT, "public/graph.json")),
      rels: sha256(path.join(ROOT, "public/relations.json")),
    };
    execSync("pnpm build:graph", { cwd: ROOT, stdio: "pipe" });
    const after = {
      graph: sha256(path.join(ROOT, "public/graph.json")),
      rels: sha256(path.join(ROOT, "public/relations.json")),
    };
    expect(after.graph).toBe(before.graph);
    expect(after.rels).toBe(before.rels);
  }, 120_000);
});
