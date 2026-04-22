// Semantic invariants for primitive Instance entities + instance_of edges.
// Read built artifacts; run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode, RelationEntity, RelationEdge } from "../src/types";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
type Relations = { meta: unknown; entities: RelationEntity[]; edges: RelationEdge[] };
const relations: Relations = JSON.parse(fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"));
const docs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"));

const INSTANCE_SLUGS = new Set([
  "distribution-reward", "integration-boost", "allocation-system",
  "pioneer-chain", "core-governance-reward", "agent-token", "executor-accord",
  "root-edit", "distribution-requirement", "upkeep-rebate",
]);

const instances = relations.entities.filter(e => e.et === "instance");
const instanceById = new Map(instances.map(e => [e.id, e]));
const instanceOfEdges = relations.edges.filter(e => e.e === "instance_of");

describe("instance entity emission", () => {
  it("emits ~170 instance entities across the approved primitive scope", () => {
    expect(instances.length).toBeGreaterThan(150);
    expect(instances.length).toBeLessThan(200);
  });

  it("every instance entity has st set to an allowlisted primitive slug", () => {
    for (const e of instances) {
      expect(INSTANCE_SLUGS.has(e.st ?? ""),
        `${e.name} (${e.id.slice(0,8)}): unexpected st=${e.st}`).toBe(true);
    }
  });

  it("every instance's did points at an ICD in docs.json", () => {
    for (const e of instances) {
      const d = e.did ? docs[e.did] : null;
      expect(d, `${e.name}: did missing from docs`).toBeTruthy();
      expect(/instance configuration document/i.test(d!.title)).toBe(true);
    }
  });

  it("excludes Agent Creation and Prime Transformation (covered by Prime Agent entity)", () => {
    for (const e of instances) {
      expect(e.st).not.toBe("agent-creation");
      expect(e.st).not.toBe("prime-transformation");
    }
  });
});

describe("instance_of edges", () => {
  it("every edge lands on a doc whose title ends in 'Primitive'", () => {
    for (const edge of instanceOfEdges) {
      const target = docs[edge.t];
      expect(target, `edge ${edge.f.slice(0,8)} → ${edge.t.slice(0,8)}: target missing`).toBeTruthy();
      expect(/Primitive$/i.test(target!.title),
        `edge target is "${target!.title}" (${target!.doc_no}) — should end in "Primitive"`).toBe(true);
    }
  });

  it("every instance entity has a matching instance_of edge whose source is that entity", () => {
    const edgeBySource = new Map(instanceOfEdges.map(e => [e.f, e]));
    for (const ent of instances) {
      const edge = edgeBySource.get(ent.id);
      expect(edge, `no instance_of edge for ${ent.name} (${ent.id.slice(0,8)})`).toBeTruthy();
    }
  });

  it("status on edge meta is one of {Active, Completed, Pending} when present", () => {
    for (const edge of instanceOfEdges) {
      if (!edge.m) continue;
      const meta = JSON.parse(edge.m) as { status?: string };
      expect(["Active", "Completed", "Pending"]).toContain(meta.status);
    }
  });

  it("every instance entity's edge carries a status in meta (in-scope primitives only)", () => {
    const edgeBySource = new Map(instanceOfEdges.map(e => [e.f, e]));
    for (const ent of instances) {
      const edge = edgeBySource.get(ent.id);
      expect(edge?.m, `${ent.name}: missing status meta`).toBeTruthy();
    }
  });
});
