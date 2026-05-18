/// <reference lib="webworker" />
import MiniSearch from "minisearch";
import type {
  AtlasNode,
  AddressInfo,
  SearchHit,
  WorkerInMessage,
  WorkerOutMessage,
} from "../types";
import { fetchJsonVerified, fetchTextVerified } from "../lib/verify";

declare const self: DedicatedWorkerGlobalScope;

// KEEP IN SYNC WITH scripts/required/build-index.mjs (same processTerm config)
const MINISEARCH_OPTIONS: ConstructorParameters<typeof MiniSearch>[0] = {
  fields: ["title", "doc_no", "type", "content"],
  idField: "id",
  processTerm: (term) => {
    // Strip leading/trailing non-alphanumeric chars so backtick-wrapped tokens
    // like `delegatedSigners` index as "delegatedsigners" not "`delegatedsigners`".
    const lower = term.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
    return lower.length >= 2 ? lower : null;
  },
};

let idx: MiniSearch | null = null;
let docs: Record<string, AtlasNode> = {};

// Address reverse-lookup structures, built at init from addresses.json + docs.
// chainlogId  → lowercase address  (e.g. "MCD_VAT" → "0x35d1…")
// address     → node ids that reference it via addressRefs
const chainlogToAddr: Map<string, string> = new Map();
const addrToNodeIds: Map<string, string[]> = new Map();

// Exact doc_no → node for fast direct-navigation lookups
const byDocNo: Map<string, AtlasNode> = new Map();

async function init() {
  const base = import.meta.env.BASE_URL;
  const [idxText, docsData, addrsData] = await Promise.all([
    fetchTextVerified(`${base}search-index.json`, "search-index.json"),
    fetchJsonVerified<Record<string, AtlasNode>>(`${base}docs.json`, "docs.json"),
    fetchJsonVerified<Record<string, AddressInfo>>(`${base}addresses.json`, "addresses.json"),
  ]);

  idx = MiniSearch.loadJSON(idxText, MINISEARCH_OPTIONS);
  docs = docsData;

  for (const [addr, info] of Object.entries(addrsData)) {
    if (info.chainlogId) chainlogToAddr.set(info.chainlogId, addr);
  }

  for (const [id, doc] of Object.entries(docs)) {
    byDocNo.set(doc.doc_no, doc);
    for (const ref of doc.addressRefs ?? []) {
      const list = addrToNodeIds.get(ref);
      if (list) list.push(id);
      else addrToNodeIds.set(ref, [id]);
    }
  }

  post({ type: "ready" });
}

function post(msg: WorkerOutMessage) {
  self.postMessage(msg);
}

const ESC_HTML = (c: string) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!;
const ESC_RE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Single-pass highlight over plain text (HTML-escaped first).
// Three tiers in priority order — higher tiers win when ranges overlap:
//   casePhrases → exact case-sensitive, no word-extension
//   phrases     → exact case-insensitive, no word-extension
//   terms       → prefix case-insensitive, with \w* word-extension
// Using one regex + callback avoids double-wrapping <mark> tags across passes.
function applyHighlight(
  raw: string,
  terms: string[],
  phrases: string[],
  casePhrases: string[],
): string {
  const escaped = raw.replace(/[&<>"]/g, ESC_HTML);

  type Entry = { pattern: string; exact: string; caseSensitive: boolean };
  const entries: Entry[] = [];

  for (const p of casePhrases) if (p.length >= 2) entries.push({ pattern: ESC_RE(p), exact: p, caseSensitive: true });
  for (const p of phrases)    if (p.length >= 2) entries.push({ pattern: ESC_RE(p), exact: p, caseSensitive: false });
  for (const t of terms)      if (t.length >= 2) entries.push({ pattern: ESC_RE(t) + "\\w*", exact: "", caseSensitive: false });

  if (entries.length === 0) return escaped;

  // Build one alternation; use 'gi' so the engine finds all candidates — the
  // callback enforces case-sensitivity for casePhrases by comparing match text.
  const re = new RegExp(entries.map((e) => `(${e.pattern})`).join("|"), "gi");
  return escaped.replace(re, (...args: unknown[]) => {
    const match = args[0] as string;
    const groups = args.slice(1, entries.length + 1) as (string | undefined)[];
    const idx = groups.findIndex((g) => g !== undefined);
    if (idx === -1) return match;
    const entry = entries[idx];
    // Reject case-insensitive hit for a case-sensitive pattern
    if (entry.caseSensitive && match !== entry.exact) return match;
    return `<mark>${match}</mark>`;
  });
}

function buildSnippet(
  content: string,
  terms: string[],
  phrases: string[],
  casePhrases: string[],
): string {
  if (!content) return "";

  const WINDOW = 160;
  const lower = content.toLowerCase();

  // Anchor on the most specific match first: case-sensitive phrase > case-insensitive phrase > term
  let bestPos = -1;
  for (const p of casePhrases) {
    const pos = content.indexOf(p);
    if (pos !== -1) { bestPos = pos; break; }
  }
  if (bestPos === -1) {
    for (const p of phrases) {
      const pos = lower.indexOf(p.toLowerCase());
      if (pos !== -1) { bestPos = pos; break; }
    }
  }
  if (bestPos === -1) {
    for (const t of terms) {
      const pos = lower.indexOf(t.toLowerCase());
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
    }
  }

  if (bestPos === -1) return content.slice(0, WINDOW) + (content.length > WINDOW ? "…" : "");

  const start = Math.max(0, bestPos - 60);
  const end = Math.min(content.length, start + WINDOW);
  const excerpt = (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");

  return applyHighlight(excerpt, terms, phrases, casePhrases);
}

function highlightTerms(
  text: string,
  terms: string[],
  phrases: string[] = [],
  casePhrases: string[] = [],
): string {
  return applyHighlight(text, terms, phrases, casePhrases);
}

import { UUID_RE } from "../lib/patterns";
const CHAINLOG_RE = /^[A-Z][A-Z0-9_]{2,}$/;
// Doc number pattern for fast exact-lookup: e.g. "A.1.2", "A.1.2.3.4", "NR-12"
const DOC_NO_RE = /^[A-Z][A-Z0-9]*(?:\.\w+)+$|^NR-\d+$/i;

// Ticker pattern: all-caps tokens that the stemmer would mangle.
// NOTE: the phrase-filter substring check means "USDC" also matches "USDCe"
// in content — a known pre-existing limitation not regressed by this migration.
const TICKER_RE = /^[a-z]{0,2}[A-Z]{2,}[0-9]*$/;

function extractPhrases(q: string): {
  phrases: string[];
  casePhrases: string[];
  rest: string;
} {
  const phrases: string[] = [];
  const casePhrases: string[] = [];
  let rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    const trimmed = p.trim();
    if (trimmed) phrases.push(trimmed);
    return ` ${p} `;
  });
  // Single quotes → case-sensitive exact match
  rest = rest.replace(/'([^']+)'/g, (_, p: string) => {
    const trimmed = p.trim();
    if (trimmed) casePhrases.push(trimmed);
    return ` ${p} `;
  });
  return { phrases, casePhrases, rest };
}

function docToHit(
  doc: AtlasNode,
  score = 1,
  snippet?: string,
  terms: string[] = [],
  matchReason = "",
): SearchHit {
  return {
    id: doc.id,
    score,
    doc_no: doc.doc_no,
    title: doc.title,
    titleHtml:
      terms.length > 0
        ? highlightTerms(doc.title, terms)
        : doc.title.replace(
            /[&<>"]/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
          ),
    matchReason,
    type: doc.type,
    depth: doc.depth,
    parentId: doc.parentId,
    snippet: snippet ?? doc.content.slice(0, 160) + (doc.content.length > 160 ? "…" : ""),
  };
}

function search(q: string): SearchHit[] {
  if (!idx) return [];

  const trimmed = q.trim();

  // Direct UUID lookup — bypass MiniSearch entirely
  if (UUID_RE.test(trimmed)) {
    const doc = docs[trimmed.toLowerCase()];
    return doc ? [docToHit(doc)] : [];
  }

  // Exact doc_no fast-path — e.g. "A.1.2" or "NR-12"
  if (DOC_NO_RE.test(trimmed)) {
    const doc = byDocNo.get(trimmed.toUpperCase());
    if (doc) return [docToHit(doc, 10, undefined, [trimmed], "doc number")];
  }

  // Extract in:DOCNUMBER scope filter
  const IN_RE = /\bin:(\S+)/gi;
  let inPrefix: string | null = null;
  const qWithoutIn = q
    .replace(IN_RE, (_, prefix: string) => {
      inPrefix = prefix.toUpperCase();
      return " ";
    })
    .trim();

  // Extract type:VALUE filters
  const TYPE_RE = /\btype:\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_-]*))/gi;
  const typeFilters: string[] = [];
  const qForPhrases = qWithoutIn
    .replace(TYPE_RE, (_, quoted: string | undefined, bare: string | undefined) => {
      const raw = (quoted ?? bare ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (raw) typeFilters.push(raw);
      return " ";
    })
    .trim();

  const { phrases, casePhrases, rest: restAfterPhrases } = extractPhrases(qForPhrases);

  // Tickers get auto-added as phrases so the stemmer can't mangle them
  const restWords = restAfterPhrases.trim().split(/\s+/).filter(Boolean);
  for (const word of restWords) {
    const bare = word.replace(/^[+\-~]/, "").replace(/[~^*]\d*$/, "");
    if (
      bare.length >= 3 &&
      bare.length <= 8 &&
      TICKER_RE.test(bare) &&
      !phrases.includes(bare) &&
      !casePhrases.includes(bare)
    ) {
      phrases.push(bare);
    }
  }

  // Extract field scope: title:foo, content:foo, doc_no:foo
  let searchFields: string[] | undefined;
  const restAfterFields = restAfterPhrases
    .replace(/\b(title|content|doc_no):\s*(\S+)/gi, (_, field, term) => {
      if (!searchFields) searchFields = [];
      searchFields.push((field as string).toLowerCase());
      return term as string;
    })
    .trim();

  // Extract ~N fuzzy operator (applied globally to the query)
  let fuzzyLevel: number | false = false;
  const restAfterFuzzy = restAfterFields
    .replace(/(\S+)~(\d+)/g, (_, term, n) => {
      fuzzyLevel = parseInt(n as string, 10);
      return term as string;
    })
    .trim();

  // Extract -word exclusions as a post-filter
  const excludeTerms: string[] = [];
  const finalQuery = restAfterFuzzy
    .replace(/(?:^|\s)-(\w+)/g, (_, term) => {
      excludeTerms.push((term as string).toLowerCase());
      return " ";
    })
    .trim();

  // Chainlog reverse-map — collected into a scored map to merge with search results
  const chainlogHits = new Map<string, SearchHit>();
  let matchedChainlogId: string | undefined;
  let matchedChainlogAddr: string | undefined;
  if (CHAINLOG_RE.test(trimmed)) {
    const addr = chainlogToAddr.get(trimmed);
    if (addr) {
      matchedChainlogId = trimmed;
      matchedChainlogAddr = addr;
      for (const id of addrToNodeIds.get(addr) ?? []) {
        const doc = docs[id];
        if (doc) {
          const hit = docToHit(doc, 2, undefined, [], "chainlog");
          hit.chainlogId = trimmed;
          hit.chainlogAddress = addr;
          chainlogHits.set(id, hit);
        }
      }
    }
  }

  const queryEmpty = !finalQuery;

  type MiniResult = { id: unknown; score: number; terms: string[]; queryTerms: string[]; match: Record<string, string[]> };
  let results: MiniResult[];

  if (queryEmpty) {
    results = Object.keys(docs).map((id) => ({
      id,
      score: 1,
      terms: [],
      queryTerms: [],
      match: {},
    }));
  } else {
    results = idx.search(finalQuery, {
      prefix: true,
      fuzzy: fuzzyLevel || false,
      boost: { title: 10, doc_no: 5, type: 2 },
      combineWith: "OR",
      ...(searchFields ? { fields: searchFields } : {}),
    }) as MiniResult[];
  }

  // Use original query words for highlighting (not stems)
  // Exclude words that came from phrases — the phrase highlight covers them.
  // Without this, "Delegated" from 'Delegated Signers' leaks into terms and
  // highlights "delegatedSigners" case-insensitively via the \w* extension.
  const phraseWordSet = new Set(
    [...phrases, ...casePhrases].flatMap((p) => p.toLowerCase().split(/\s+/)),
  );
  const queryWords = finalQuery
    .trim()
    .split(/\s+/)
    .filter((w) => w && !phraseWordSet.has(w.toLowerCase()));

  const hits = results
    .map((r) => {
      const doc = docs[r.id as string];
      if (!doc) return null;

      // Type post-filter
      if (typeFilters.length > 0 && !typeFilters.includes(doc.type.toLowerCase())) return null;

      // Phrase post-filter: every quoted phrase must literally appear in title or content
      if (phrases.length > 0) {
        const lowerContent = doc.content.toLowerCase();
        const lowerTitle = doc.title.toLowerCase();
        for (const p of phrases) {
          const lp = p.toLowerCase();
          if (!lowerContent.includes(lp) && !lowerTitle.includes(lp)) return null;
        }
      }
      // Case-sensitive phrase post-filter (single-quoted phrases)
      if (casePhrases.length > 0) {
        for (const p of casePhrases) {
          if (!doc.content.includes(p) && !doc.title.includes(p)) return null;
        }
      }

      // Exclusion post-filter
      if (excludeTerms.length > 0) {
        const haystack = (doc.title + " " + doc.content).toLowerCase();
        if (excludeTerms.some((t) => haystack.includes(t))) return null;
      }

      // Build matchReason from MiniSearch match object: { term: [field, ...] }
      const fieldSet = new Set<string>();
      for (const fields of Object.values(r.match)) {
        for (const f of fields) fieldSet.add(f);
      }
      const parts: string[] = [];
      if (typeFilters.length > 0) parts.push("type");
      if (fieldSet.has("title")) parts.push("title");
      if (fieldSet.has("doc_no")) parts.push("doc number");
      if (fieldSet.has("content")) parts.push("content");
      if (phrases.length > 0 || casePhrases.length > 0) parts.push("exact phrase");
      const matchReason = parts.join(" + ");

      return {
        id: doc.id,
        score: r.score,
        doc_no: doc.doc_no,
        title: doc.title,
        titleHtml: highlightTerms(doc.title, queryWords, phrases, casePhrases),
        matchReason,
        type: doc.type,
        depth: doc.depth,
        parentId: doc.parentId,
        snippet: buildSnippet(doc.content, queryWords, phrases, casePhrases),
      } satisfies SearchHit;
    })
    .filter((h): h is SearchHit => h !== null);

  // Apply in:DOCNUMBER scope filter
  const scopedHits = inPrefix
    ? hits.filter((h) => h.doc_no === inPrefix || h.doc_no.startsWith(inPrefix + "."))
    : hits;

  // Merge with three tiers:
  //   1. found by BOTH chainlog + search  (best snippet from search, highest priority)
  //   2. chainlog only
  //   3. search only  (sorted by score)
  if (chainlogHits.size === 0) return scopedHits;

  const hitsById = new Map(scopedHits.map((h) => [h.id, h]));

  const both: SearchHit[] = [];
  const chainlogOnly: SearchHit[] = [];
  for (const [id, chainlogHit] of chainlogHits) {
    const hit = hitsById.get(id);
    if (hit) {
      both.push({
        ...hit,
        matchReason: "chainlog + " + hit.matchReason,
        chainlogId: matchedChainlogId,
        chainlogAddress: matchedChainlogAddr,
      });
    } else {
      chainlogOnly.push(chainlogHit);
    }
  }
  const searchOnly = scopedHits.filter((h) => !chainlogHits.has(h.id));

  both.sort((a, b) => b.score - a.score);
  searchOnly.sort((a, b) => b.score - a.score);

  return [...both, ...chainlogOnly, ...searchOnly];
}

self.addEventListener("message", (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === "ping") {
    post({ type: "ready" });
    return;
  }
  if (msg.type === "query") {
    const t0 = performance.now();
    const hits = search(msg.q);
    post({ type: "results", id: msg.id, hits, durationMs: performance.now() - t0 });
  }
});

init().catch((err) => {
  console.error("Search worker init failed:", err);
});
