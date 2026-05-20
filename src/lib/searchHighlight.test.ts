/**
 * Highlight specificity tests — the guiding principle:
 *   highlight output MUST mirror the search specificity that produced the hit.
 *
 * Search modes and their highlight contracts:
 *   raw term       → case-insensitive prefix match (\w* extension), highlights full matched word
 *   "double-quote" → case-insensitive exact phrase, no word extension beyond the literal
 *   'single-quote' → case-sensitive exact phrase, no word extension
 */
import { describe, it, expect } from "vitest";
import { applyHighlight, buildSnippet, extractPhrases } from "./searchHighlight";

// ---------------------------------------------------------------------------
// Raw terms — case-insensitive prefix with \w* extension
// ---------------------------------------------------------------------------

describe("raw term: highlights only the matched prefix, not the full word", () => {
  it("highlights only the typed characters inside a longer word", () => {
    expect(applyHighlight("The governance framework", ["govern"], [], []))
      .toBe("The <mark>govern</mark>ance framework");
  });

  it("highlights the same prefix in multiple words with different suffixes", () => {
    expect(applyHighlight("Governance and Government both matter", ["govern"], [], []))
      .toBe("<mark>Govern</mark>ance and <mark>Govern</mark>ment both matter");
  });

  it("is case-insensitive — lowercase term matches uppercase text, marks only that span", () => {
    expect(applyHighlight("GOVERNANCE matters", ["govern"], [], []))
      .toBe("<mark>GOVERN</mark>ANCE matters");
  });
});

describe("raw term: no-match and multi-term", () => {
  it("returns HTML-escaped text unchanged when term is absent", () => {
    expect(applyHighlight("No match here <at> all", ["govern"], [], []))
      .toBe("No match here &lt;at&gt; all");
  });

  it("highlights each term independently, only the matched prefix", () => {
    expect(applyHighlight("aligned facilitator roles", ["align", "facilit"], [], []))
      .toBe("<mark>align</mark>ed <mark>facilit</mark>ator roles");
  });
});

// ---------------------------------------------------------------------------
// Word-boundary behavior — the mirror-specificity violation to document
// ---------------------------------------------------------------------------

describe("raw term: mid-word matches (no leading boundary)", () => {
  // No leading \b — "govern" matches inside "ungoverned".
  // MiniSearch wouldn't return a doc that only has "ungoverned" for query "govern",
  // so in practice this only fires on docs that genuinely match.
  it("govern matches 'govern' inside 'ungoverned'", () => {
    expect(applyHighlight("the ungoverned zone", ["govern"], [], []))
      .toBe("the un<mark>govern</mark>ed zone");
  });
});

// ---------------------------------------------------------------------------
// Double-quoted phrases — case-insensitive, no word extension
// ---------------------------------------------------------------------------

describe('"double-quote" phrase: exact multi-word, case-insensitive', () => {
  it("highlights the exact phrase together as one mark", () => {
    expect(applyHighlight("properly implemented by actors", [], ["properly implemented"], []))
      .toBe("<mark>properly implemented</mark> by actors");
  });

  it("case-insensitive — title-case phrase matches lowercase text", () => {
    expect(applyHighlight("Properly Implemented by actors", [], ["properly implemented"], []))
      .toBe("<mark>Properly Implemented</mark> by actors");
  });

  it("does NOT match when words are non-contiguous (space required)", () => {
    // Phrase "governance model" must appear as a literal substring;
    // the two words separated by other content must not match.
    const result = applyHighlight("governance of the model", [], ["governance model"], []);
    expect(result).not.toContain("<mark>");
  });

  it("phrase requires a word boundary — does not match a longer word", () => {
    // "Test" must not highlight inside "Tests"; "implement" must not match "implementing"
    expect(applyHighlight("Tests are required", [], ["Test"], []))
      .toBe("Tests are required");
    expect(applyHighlight("properly implementing the rules", [], ["properly implement"], []))
      .toBe("properly implementing the rules");
  });
});

// ---------------------------------------------------------------------------
// Single-quoted phrases — case-sensitive, no word extension
// ---------------------------------------------------------------------------

describe("'single-quote' phrase: case-sensitive exact", () => {
  it("highlights exact-case match", () => {
    expect(applyHighlight("call delegatedSigners here", [], [], ["delegatedSigners"]))
      .toBe("call <mark>delegatedSigners</mark> here");
  });

  it("does NOT highlight wrong case", () => {
    // 'delegatedSigners' searched → must NOT highlight 'DelegatedSigners'
    expect(applyHighlight("call DelegatedSigners here", [], [], ["delegatedSigners"]))
      .toBe("call DelegatedSigners here");
  });

  it("title-case single-quote finds title-case text but not camelCase", () => {
    // 'Delegated Signers' must match title text exactly
    expect(applyHighlight("Delegated Signers overview", [], [], ["Delegated Signers"]))
      .toBe("<mark>Delegated Signers</mark> overview");
    // must NOT match camelCase "delegatedSigners"
    expect(applyHighlight("delegatedSigners overview", [], [], ["Delegated Signers"]))
      .toBe("delegatedSigners overview");
  });
});

// ---------------------------------------------------------------------------
// Tier priority — phrase wins when it overlaps a raw term
// ---------------------------------------------------------------------------

describe("tier priority: casePhrase > phrase > term — no double-wrap", () => {
  it("phrase mark encompasses the same words a raw term would mark individually", () => {
    // Both phrase "properly implemented" and terms ["properly","implemented"] present:
    // phrase should win, producing one contiguous mark, not two separate ones.
    const result = applyHighlight(
      "properly implemented rules",
      ["properly", "implemented"],
      ["properly implemented"],
      [],
    );
    expect(result).toBe("<mark>properly implemented</mark> rules");
  });
});

// ---------------------------------------------------------------------------
// HTML escaping — special chars safe in and around highlights
// ---------------------------------------------------------------------------

describe("HTML escaping", () => {
  it("escapes & < > \" in non-highlighted text", () => {
    expect(applyHighlight('a & b < c > d "e"', ["xyz"], [], []))
      .toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it("content with HTML entities highlights the surrounding word correctly", () => {
    const result = applyHighlight("govern&ance matters", ["govern"], [], []);
    // "&" is escaped, highlight wraps the leading "govern" portion
    expect(result).toContain("<mark>govern</mark>");
    expect(result).toContain("&amp;");
  });
});

// ---------------------------------------------------------------------------
// Snippet anchoring — buildSnippet
// ---------------------------------------------------------------------------

describe("buildSnippet: anchors on most specific match", () => {
  it("anchors on casePhrase before phrase before term", () => {
    const content =
      "Some intro text. delegatedSigners is the term. More content follows after.";
    const snippet = buildSnippet(content, ["delegated"], [], ["delegatedSigners"]);
    expect(snippet).toContain("delegatedSigners");
    expect(snippet).toContain("<mark>");
  });

  it("phrase anchor skips partial matches — 'test' anchors on standalone 'test', not inside 'tests'", () => {
    const content =
      "All tests must pass. Run the test script to verify. Save the test results.";
    const snippet = buildSnippet(content, [], ["test"], []);
    // Should anchor on "test script" or "test results", not "tests"
    // Verify the snippet contains a \b-bounded highlight
    expect(snippet).toContain("<mark>test</mark>");
    // "tests" must not be marked
    expect(snippet).not.toContain("<mark>tests</mark>");
    expect(snippet).not.toContain("<mark>Tests</mark>");
  });

  it("adds leading ellipsis only when excerpt starts mid-content", () => {
    const prefix = "x".repeat(100);
    const content = prefix + " governance matters here";
    const snippet = buildSnippet(content, ["govern"], [], []);
    expect(snippet.startsWith("…")).toBe(true);
  });

  it("no leading ellipsis when match is near the start", () => {
    const snippet = buildSnippet("governance matters", ["govern"], [], []);
    expect(snippet.startsWith("…")).toBe(false);
    expect(snippet).toContain("<mark>govern</mark>");
  });
});

// ---------------------------------------------------------------------------
// extractPhrases — query parsing
// ---------------------------------------------------------------------------

describe("extractPhrases: query parsing", () => {
  it("extracts double-quoted phrase into phrases[]", () => {
    const { phrases, casePhrases, rest } = extractPhrases('"properly implemented" delegate');
    expect(phrases).toContain("properly implemented");
    expect(casePhrases).toHaveLength(0);
    expect(rest.trim()).toContain("delegate");
  });

  it("extracts single-quoted phrase into casePhrases[]", () => {
    const { phrases, casePhrases } = extractPhrases("'delegatedSigners' overview");
    expect(casePhrases).toContain("delegatedSigners");
    expect(phrases).toHaveLength(0);
  });

  it("apostrophe in possessive does not create a spurious casePhrase", () => {
    // "user's delegate" must NOT extract "s delegate" as a case-sensitive phrase
    const { casePhrases } = extractPhrases("user's delegate");
    expect(casePhrases).not.toContain("s delegate");
  });
});
