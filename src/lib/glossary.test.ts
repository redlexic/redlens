// Tests for buildLookup — the alias-flattening step that powers glossary highlighting.

import { describe, it, expect } from "vitest";
import { buildLookup, type Glossary } from "./glossary";

const entry = (term: string) => ({
  term,
  content: "definition",
  nodeId: "00000000-0000-0000-0000-000000000001",
  docNo: "A.0.1",
  sourceDocNo: "A.0.1",
  sourceContext: null,
});

describe("buildLookup", () => {
  it("keys a plain term by its lowercase form", () => {
    const g: Glossary = { "sky protocol": [entry("Sky Protocol")] };
    const lookup = buildLookup(g);
    expect(lookup["sky protocol"]).toBeDefined();
  });

  it("expands 'Term (Alias)' into three keys: full, base, and alias", () => {
    const g: Glossary = {
      "accessibility scope (acc)": [entry("Accessibility Scope (ACC)")],
    };
    const lookup = buildLookup(g);
    expect(lookup["accessibility scope (acc)"]).toBeDefined();
    expect(lookup["accessibility scope"]).toBeDefined();
    expect(lookup["acc"]).toBeDefined();
  });

  it("all three alias keys point to the same entries array", () => {
    const entries = [entry("Governance Scope (GOV)")];
    const g: Glossary = { "governance scope (gov)": entries };
    const lookup = buildLookup(g);
    expect(lookup["governance scope (gov)"]).toBe(lookup["governance scope"]);
    expect(lookup["governance scope"]).toBe(lookup["gov"]);
  });

  it("first-registered key wins — duplicate keys do not overwrite", () => {
    const first = [entry("Sky")];
    const second = [entry("Sky")];
    const g: Glossary = { sky: first, SKY: second };
    const lookup = buildLookup(g);
    expect(lookup["sky"]).toBe(first);
  });

  it("returns an empty object for an empty glossary", () => {
    expect(buildLookup({})).toEqual({});
  });

  it("handles a term with no parenthetical alias without error", () => {
    const g: Glossary = { "aligned delegate": [entry("Aligned Delegate")] };
    const lookup = buildLookup(g);
    expect(lookup["aligned delegate"]).toBeDefined();
    expect(Object.keys(lookup)).toHaveLength(1);
  });
});
