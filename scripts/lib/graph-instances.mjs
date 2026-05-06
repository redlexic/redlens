/**
 * ICD / primitive instance parameter extraction.
 */

const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

/**
 * Parse the "Current Primitives" doc content to build the authoritative set of
 * known primitive titles. Indented list items are primitives; top-level items
 * are category headings and are excluded from the set.
 */
export function buildKnownPrimitives(docById) {
  const doc = docById.get(CURRENT_PRIMITIVES_UUID);
  const known = new Set();
  if (!doc?.content) return known;
  for (const line of doc.content.split("\n")) {
    const m = line.match(/^(\s+)-\s+(.+)$/);
    if (m) known.add(m[2].trim());
  }
  return known;
}

/** Derive a stable slug from a primitive title by stripping the "Primitive" suffix. */
export function primitiveSlugFromTitle(title) {
  return title
    .replace(/\s+Primitive$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function instanceStatusFor(icd, primRoot, docByDocNo) {
  // Tier position varies (Allocation System interposes a Multi-Instance Coordinator
  // at .2), so read the tier doc's title directly rather than assuming .2=Active.
  const rest = icd.doc_no.slice(primRoot.doc_no.length + 1);
  if (!rest) return null;
  const tierSeg = rest.split(".")[0];
  const tierDoc = docByDocNo.get(`${primRoot.doc_no}.${tierSeg}`);
  const title = tierDoc?.title.toLowerCase() ?? "";
  if (title === "active instances") return "Active";
  if (title === "completed instances") return "Completed";
  if (title === "in progress invocations") return "Pending";
  return null;
}

// Index of direct children by parent doc_no (doc_no-based; parentId is unreliable past depth 6).
export function buildChildrenIndex(allDocs) {
  const childrenByDocNo = new Map();
  for (const d of allDocs) {
    const lastDot = d.doc_no.lastIndexOf(".");
    if (lastDot < 0) continue;
    const parentDocNo = d.doc_no.slice(0, lastDot);
    if (!childrenByDocNo.has(parentDocNo)) childrenByDocNo.set(parentDocNo, []);
    childrenByDocNo.get(parentDocNo).push(d);
  }
  return childrenByDocNo;
}

// Atlas "directory" placeholder content is a convention — a doc whose content
// is just "The documents herein (define|contain|organize|govern)…" and whose
// real data lives in children. Those are NOT leaves.
const DIRECTORY_RE =
  /^The documents? herein (define|contain|organize|govern|specify|describe|set|compose|hold)\b/i;

// Value formatters — normalize raw content into a displayable value. Keyed by
// leaf title. Each takes the raw trimmed content and returns a cleaned string.
// Fallback is backtick-unwrap + trim.
const unwrapBt = (s) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;
const firstBtOrAddr = (s) => {
  const bt = s.match(/`([^`\n]+)`/)?.[1];
  if (bt && (/^0x[0-9a-fA-F]{40}$/.test(bt) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(bt))) return bt;
  return s.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? s;
};
const stripSentence =
  (prefixRe, suffixRe = null) =>
  (s) => {
    let v = s.replace(prefixRe, "");
    if (suffixRe) v = v.replace(suffixRe, "");
    return v.replace(/\.$/, "").trim();
  };
// Extracts the 64-char hex hash from backticks, or preserves N/A variants.
const RATE_LIMIT_ID_RE = /^(Inflow|Outflow|Swap) Rate ?Limit ?ID/i;
const extractRateLimitId = (s) => {
  const hash = s.match(/`(0x[0-9a-fA-F]{64})`/)?.[1];
  if (hash) return hash;
  const na = s.match(/:\s*(N\/A[^.]*)/i)?.[1]?.trim();
  return na ?? unwrapBt(s);
};

const PARAM_FORMATTERS = {
  "Reward Code": unwrapBt,
  "Integration Partner Name": stripSentence(/^The partner for the [^.]*? is /i),
  "Integration Partner Reward Address": firstBtOrAddr,
  "Integration Partner Chain": stripSentence(/^The [^.]*? is on (the )?/i, /\s*blockchain\.?$/i),
  "Integration Boost Cadence": stripSentence(/^The payment cadence for the [^.]*? is /i),
  "Token Name": stripSentence(/^The name of [^.]*? is /i),
  "Token Symbol": stripSentence(/^The symbol of [^.]*? is /i),
  "Genesis Supply": stripSentence(/^The Genesis Supply of [^.]*? is /i),
  "Token Address": firstBtOrAddr,
  "Underlying Asset Address": firstBtOrAddr,
  "Allocator Role Address": firstBtOrAddr,
  "Pool Address": firstBtOrAddr,
  Address: firstBtOrAddr,
  Network: (s) => s.replace(/\.$/, "").trim(),
  "Target Protocol": (s) => s.replace(/\.$/, "").trim(),
  Token: (s) => s.replace(/\.$/, "").trim(),
  "Asset Supplied By Spark Liquidity Layer": (s) => s.replace(/\.$/, "").trim(),
};
function formatParam(title, raw) {
  const fn = PARAM_FORMATTERS[title];
  if (fn) return fn(raw.trim());
  if (RATE_LIMIT_ID_RE.test(title)) return extractRateLimitId(raw.trim());
  return unwrapBt(raw.trim());
}

// Expanders turn a compound prose leaf into multiple keyed params sharing the
// same source doc. Used when a single leaf embeds per-chain or per-variant
// values (e.g. Agent Token's "Token Address" stuffs every deployed chain
// address into one blob). Returns Array<[key, value]> or null to fall through.
const PARAM_EXPANDERS = {
  "Token Address": (content) => {
    // "The address of X on (the) CHAIN is `ADDR`." — repeats per chain.
    const re = /The address of \S+ on (?:the )?([^.]+?) is `([^`\n]+)`/gi;
    const out = [];
    for (const m of content.matchAll(re)) {
      const chain = m[1].trim().replace(/\s+blockchain$/i, "");
      out.push([`Token Address (${chain})`, m[2]]);
    }
    return out.length ? out : null;
  },
};

// Generic bullet-list expansion. Matches the atlas convention used for rate
// limits and similar parameter groupings:
//   "The {variant} are:\n\n- `key`: value\n- `key`: value"
// Keys are prefixed with the leaf title so sibling groups stay distinct
// ("Inflow Rate Limits / maxAmount" vs "Outflow Rate Limits / maxAmount").
const BULLET_KV_RE = /^\s*[-*]\s+`([^`\n]+)`\s*:\s*(.+?)\s*$/gm;
function expandBulletList(content, outerTitle) {
  const out = [];
  for (const m of content.matchAll(BULLET_KV_RE)) {
    out.push([`${outerTitle} / ${m[1].trim()}`, m[2].trim()]);
  }
  return out.length ? out : null;
}

// Walk down from the Parameters doc under an ICD and flatten leaves into
// { key: [formattedValue, srcUuid, srcDocNo] }. Handles both flat (DR/IB/
// agent-token) and nested (Allocation System: Parameters → Instance Identifiers
// → Network) variants. Key = leaf title. On title collision, prefix with
// "{parentTitle} / " to disambiguate.
export function extractInstanceParams(icd, childrenByDocNo) {
  const direct = childrenByDocNo.get(icd.doc_no) ?? [];
  const paramsDoc = direct.find((c) => c.title === "Parameters");
  if (!paramsDoc) return {};
  const params = {};
  const pending = [{ doc: paramsDoc, parents: [] }];
  while (pending.length) {
    const { doc, parents } = pending.shift();
    const kids = childrenByDocNo.get(doc.doc_no) ?? [];
    const content = (doc.content ?? "").trim();
    const isLeaf = kids.length === 0;
    if (isLeaf) {
      if (!content || DIRECTORY_RE.test(content)) continue;
      // Expansion order: per-title expander → generic bullet-list → formatter.
      const expanded =
        PARAM_EXPANDERS[doc.title]?.(content) ?? expandBulletList(content, doc.title);
      if (expanded) {
        for (const [key, value] of expanded) {
          const finalKey =
            key in params ? `${parents[parents.length - 1] ?? ""} / ${key}`.trim() : key;
          params[finalKey] = [value, doc.id, doc.doc_no];
        }
      } else {
        const baseKey = doc.title;
        const key =
          baseKey in params ? `${parents[parents.length - 1] ?? ""} / ${baseKey}`.trim() : baseKey;
        params[key] = [formatParam(doc.title, content), doc.id, doc.doc_no];
      }
    } else {
      // Skip the "Custom Instance Parameters" subtree at any depth — it's a
      // reserved extension slot, almost always empty/placeholder in practice.
      if (/^custom instance parameters$/i.test(doc.title)) continue;
      for (const c of kids) pending.push({ doc: c, parents: [...parents, doc.title] });
    }
  }
  return params;
}
