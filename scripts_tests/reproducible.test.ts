// Determinism: running build:index twice on a clean checkout should produce
// byte-identical docs.json and search-index.json. Only runs in REPRO=1 mode
// because it takes ~10s — it's the kind of check you want in CI, not in
// every local `pnpm test`.

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
      idx:  sha256(path.join(ROOT, "public/search-index.json")),
    };
    execSync("pnpm build:index", { cwd: ROOT, stdio: "pipe" });
    const after = {
      docs: sha256(path.join(ROOT, "public/docs.json")),
      idx:  sha256(path.join(ROOT, "public/search-index.json")),
    };
    expect(after.docs).toBe(before.docs);
    expect(after.idx).toBe(before.idx);
  }, 120_000);
});
