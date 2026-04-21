// Tests for the Active Data Index report's data-shaping logic.
// Reads the built artifacts in /public — run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode, RelationEntity, RelationEdge } from "../src/types";
import {
  agentFromDocNo, extractProcess, buildChainMap, buildActiveDataRows, activeDataRowsToCSV,
} from "../src/lib/activeDataIndex";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

type Relations = { meta: unknown; entities: RelationEntity[]; edges: RelationEdge[] };

const relations: Relations = JSON.parse(fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"));
const docs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"));

const activeDataDocs = Object.values(docs).filter(d => d.type === "Active Data");
const adEdges = relations.edges.filter(e => e.e === "active_data_for");
const rows = buildActiveDataRows(docs, relations);

describe("agentFromDocNo", () => {
  it("matches known agent prefixes", () => {
    expect(agentFromDocNo("A.6.1.1.1.2")).toBe("Spark");
    expect(agentFromDocNo("A.6.1.1.4.2.0.6.1")).toBe("Skybase");
    expect(agentFromDocNo("A.6.1.1.8.2")).toBe("Launch Agent 7");
  });
  it("returns null for non-agent doc_nos", () => {
    expect(agentFromDocNo("A.1.1.3.1")).toBeNull();
    expect(agentFromDocNo("A.2.8.1.2")).toBeNull();
  });
});

describe("extractProcess", () => {
  it("returns 'Alignment Conserver Changes' when phrase is present", () => {
    expect(extractProcess("Edits flow through the Alignment Conserver.")).toBe("Alignment Conserver Changes");
  });
  it("is case-insensitive", () => {
    expect(extractProcess("alignment conserver")).toBe("Alignment Conserver Changes");
  });
  it("defaults to 'Direct Edit'", () => {
    expect(extractProcess("Some unrelated content.")).toBe("Direct Edit");
  });
});

describe("buildChainMap", () => {
  const chainMap = buildChainMap(relations.entities, relations.edges);

  it("includes every prime agent", () => {
    const primes = relations.entities.filter(e => e.et === "agent" && e.st === "prime");
    expect(chainMap.size).toBe(primes.length);
    for (const p of primes) expect(chainMap.get(p.name)?.agentId).toBe(p.id);
  });

  it("resolves the Spark → Amatsu → Endgame Edge / Soter Labs chain", () => {
    const spark = chainMap.get("Spark");
    expect(spark).toBeTruthy();
    expect(spark!.executorName).toBe("Amatsu");
    expect(spark!.facilitatorName).toBe("Endgame Edge");
    expect(spark!.govopsName).toBe("Soter Labs");
    // Every chain slot should carry both name + id, or both be null.
    for (const key of ["executor", "facilitator", "govops"] as const) {
      const name = spark![`${key}Name`];
      const id   = spark![`${key}Id`];
      expect(name === null).toBe(id === null);
    }
  });

  it("resolves the Skybase → Ozone → Redline chain", () => {
    const skybase = chainMap.get("Skybase");
    expect(skybase?.executorName).toBe("Ozone");
    expect(skybase?.facilitatorName).toBe("Redline Facilitation Group");
  });
});

describe("buildActiveDataRows", () => {
  it("returns exactly one row per Active Data doc", () => {
    expect(rows.length).toBe(activeDataDocs.length);
    expect(new Set(rows.map(r => r.activeDataId)).size).toBe(rows.length);
  });

  it("covers every active_data_for edge's source doc", () => {
    const adEdgeSources = new Set(adEdges.map(e => e.f));
    const rowIds = new Set(rows.map(r => r.activeDataId));
    for (const id of adEdgeSources) expect(rowIds.has(id)).toBe(true);
  });

  it("is sorted by active data doc_no (natural)", () => {
    const sorted = [...rows].sort((a, b) =>
      a.activeDataDocNo.localeCompare(b.activeDataDocNo, undefined, { numeric: true })
    );
    expect(rows.map(r => r.activeDataDocNo)).toEqual(sorted.map(r => r.activeDataDocNo));
  });

  it("links each row to its controller via active_data_for", () => {
    const ctrlByAd = new Map(adEdges.map(e => [e.f, e.t]));
    for (const r of rows) {
      const expected = ctrlByAd.get(r.activeDataId) ?? null;
      expect(r.controllerId).toBe(expected);
      if (expected) {
        expect(r.controllerDocNo).toBe(docs[expected]?.doc_no ?? null);
      }
    }
  });

  it("resolves agent iff controller doc_no starts with an agent prefix", () => {
    for (const r of rows) {
      const expectedAgent = r.controllerDocNo ? agentFromDocNo(r.controllerDocNo) : null;
      expect(r.agent).toBe(expectedAgent);
      // Chain is attached only when an agent is set.
      if (!r.agent) expect(r.chain).toBeNull();
      if (r.agent) expect(r.chain?.agentName).toBe(r.agent);
    }
  });

  it("responsibleParty matches the responsible_party_for edge target", () => {
    const respByCtrl = new Map(
      relations.edges.filter(e => e.e === "responsible_party_for").map(e => [e.t, e.f]),
    );
    for (const r of rows) {
      if (r.controllerId && respByCtrl.has(r.controllerId)) {
        expect(r.responsibleParty?.id).toBe(respByCtrl.get(r.controllerId));
      } else {
        expect(r.responsibleParty).toBeNull();
      }
    }
  });

  it("every row under a Prime Agent gets an Operational Facilitator editor", () => {
    for (const r of rows) {
      if (!r.agent) continue;
      // If the chain has a facilitator for this agent, editor must match it.
      if (r.chain?.facilitatorName) {
        expect(r.editor?.name).toBe(r.chain.facilitatorName);
        expect(r.editor?.role).toBe("Operational Facilitator");
      }
    }
  });

  it("every Sky Core Atlas row (A.1.*) gets the Core Facilitator editor", () => {
    const coreFacEdge = relations.edges.find(e => e.e === "core_facilitator_for");
    if (!coreFacEdge) return; // Graph-level guarantee tested elsewhere.
    for (const r of rows) {
      if (r.agent) continue;
      if (!(r.controllerDocNo ?? "").startsWith("A.1.")) continue;
      expect(r.editor?.id).toBe(coreFacEdge.f);
      expect(r.editor?.role).toBe("Core Facilitator");
    }
  });

  it("ADCs outside agents and Sky Core (A.2.*, accords, …) have no editor", () => {
    for (const r of rows) {
      if (r.agent) continue;
      if ((r.controllerDocNo ?? "").startsWith("A.1.")) continue;
      expect(r.editor).toBeNull();
    }
  });
});

describe("activeDataRowsToCSV", () => {
  const csv = activeDataRowsToCSV(rows);
  const lines = csv.split("\n");

  it("has a header and one data line per row", () => {
    expect(lines.length).toBe(rows.length + 1);
    expect(lines[0]).toMatch(/^Active Data Doc,/);
  });

  it("quotes every cell — no bare commas in row content leak the column count", () => {
    // Active Data Doc, Title, Controller Doc, Controller Title,
    // Agent, Responsible Party, Editor, Editor Role, Process = 9 cells.
    const expectedQuotes = 9 * 2;
    for (const line of lines.slice(1)) {
      expect((line.match(/"/g) ?? []).length).toBe(expectedQuotes);
    }
  });
});
