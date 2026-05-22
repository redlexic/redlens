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
import { buildSnippet, highlightTerms, extractPhrases } from "../lib/searchHighlight";
import { UUID_RE } from "../lib/patterns";

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

const CHAINLOG_RE = /^[A-Z][A-Z0-9_]{2,}$/;
// Doc number pattern for fast exact-lookup: e.g. "A.1.2", "A.1.2.3.4", "NR-12"
const DOC_NO_RE = /^[A-Z][A-Z0-9]*(?:\.\w+)+$|^NR-\d+$/i;
// Ticker pattern: all-caps tokens that the stemmer would mangle.
// NOTE: the phrase-filter substring check means "USDC" also matches "USDCe" in content.
const TICKER_RE = /^[a-z]{0,2}[A-Z]{2,}[0-9]*$/;

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
  // fieldScopedTerms tracks which terms belong to title: or content: so they
  // only highlight in that field, not everywhere.
  let searchFields: string[] | undefined;
  const fieldScopedTerms = new Map<string, string[]>();
  const restAfterFields = restAfterPhrases
    .replace(/\b(title|content|doc_no):\s*(\S+)/gi, (_, field, term) => {
      const f = (field as string).toLowerCase();
      if (!searchFields) searchFields = [];
      searchFields.push(f);
      if (!fieldScopedTerms.has(f)) fieldScopedTerms.set(f, []);
      fieldScopedTerms.get(f)!.push(term as string);
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
          const snippet = buildSnippet(doc.content, [addr], [], []);
          const hit = docToHit(doc, 2, snippet, [], "chainlog");
          hit.chainlogId = trimmed;
          hit.chainlogAddress = addr;
          chainlogHits.set(id, hit);
        }
      }
    }
  }

  // When query is a known chainlog ID, require it literally in text-matched results.
  // Without this, MiniSearch splits "MCD_VAT" → ["MCD","VAT"] and prefix-matches
  // every node containing "MCD_JUG", "advocate", etc.
  if (matchedChainlogId && !casePhrases.includes(matchedChainlogId)) {
    casePhrases.push(matchedChainlogId);
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

  // title: and content: scoped terms only highlight in their own field.
  // doc_no: and unscoped terms are treated as free (highlight everywhere).
  const strictFieldTerms = new Set([
    ...(fieldScopedTerms.get("title") ?? []),
    ...(fieldScopedTerms.get("content") ?? []),
  ].map((w) => w.toLowerCase()));
  const freeWords = queryWords.filter((w) => !strictFieldTerms.has(w.toLowerCase()));
  const titleHighlightTerms = [...(fieldScopedTerms.get("title") ?? []), ...freeWords];
  const contentHighlightTerms = [...(fieldScopedTerms.get("content") ?? []), ...freeWords];

  const hits = results
    .map((r) => {
      const doc = docs[r.id as string];
      if (!doc) return null;

      // Type post-filter
      if (typeFilters.length > 0 && !typeFilters.includes(doc.type.toLowerCase())) return null;

      // Phrase post-filter: every quoted phrase must appear as a whole-word sequence
      if (phrases.length > 0) {
        for (const p of phrases) {
          const re = new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
          if (!re.test(doc.content) && !re.test(doc.title)) return null;
        }
      }
      // Case-sensitive phrase post-filter (single-quoted phrases)
      if (casePhrases.length > 0) {
        for (const p of casePhrases) {
          const re = new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
          if (!re.test(doc.content) && !re.test(doc.title)) return null;
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
        titleHtml: highlightTerms(doc.title, titleHighlightTerms, phrases, casePhrases),
        matchReason,
        type: doc.type,
        depth: doc.depth,
        parentId: doc.parentId,
        snippet: buildSnippet(doc.content, contentHighlightTerms, phrases, casePhrases),
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
