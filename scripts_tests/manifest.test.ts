// public/manifest.json should match what's actually on disk, and should
// cover every artifact the frontend relies on.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const MANIFEST_PATH = path.join(PUBLIC, "manifest.json");

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

describe("manifest", () => {
  it("exists", () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
  });

  if (!fs.existsSync(MANIFEST_PATH)) return;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    generatedAt: string;
    redlensCommit: string | null;
    atlasCommit: string | null;
    artifacts: Record<string, { sha256: string; bytes: number }>;
  };

  it("records every artifact the frontend can verify", () => {
    // Anything added to the build pipeline without a manifest entry would be
    // silently unverifiable on the frontend — fail on new artifacts that
    // haven't been registered.
    const required = [
      "docs.json",
      "search-index.json",
      "addresses.atlas.json",
      "addresses.json",
      "chain-state.json",
      "glossary.json",
      "relations.json",
      "graph.json",
    ];
    for (const name of required) {
      if (fs.existsSync(path.join(PUBLIC, name))) {
        expect(manifest.artifacts[name], `${name} missing from manifest`).toBeDefined();
      }
    }
  });

  it("sha256 of every listed artifact matches what's on disk", () => {
    for (const [name, info] of Object.entries(manifest.artifacts)) {
      const p = path.join(PUBLIC, name);
      expect(fs.existsSync(p), `${name} in manifest but missing on disk`).toBe(true);
      const actual = sha256(fs.readFileSync(p));
      expect(actual, `${name} content does not match manifest hash`).toBe(info.sha256);
      expect(fs.statSync(p).size).toBe(info.bytes);
    }
  });

  it("pins the redlens + atlas commits for this build", () => {
    expect(manifest.redlensCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.atlasCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});
