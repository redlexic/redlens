/**
 * Pure heuristics used by build-history.mjs to classify each per-doc change
 * and attribute it to a PR bullet. Lifted out of build-history so unit
 * tests can import without triggering main().
 *
 * Nothing in this module performs I/O.
 */

// ─────────────────────────── tokenisation ──────────────────────────────

const STOP = new Set([
  "the","a","an","and","or","for","in","on","to","at","by","with","from","of","is","as",
]);

/** Lowercase + alphanumeric-split, drop stop words and tokens ≤2 chars. */
export function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// ─────────────────────────── regexes ───────────────────────────────────

// Doc_no shape (e.g. "A.6.1.1.3.2.1", "A.1.6.var1").
export const DOC_NO_RE = /\b[A-Z](?:\.\w+)+/g;
export const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

// PR-title intent → kind. Lint and typo titles override per-diff
// classification so e.g. "fix typos" cascades read as typo regardless of
// individual diff size.
export const PR_LINT_RE =
  /\b(?:whitespace|non[\s-]?breaking|formatt?ing|lint(?:er|ing)?|cleanup\s+formatting|remove\s+formatting)\b/i;
export const PR_TYPO_RE =
  /\b(?:fix(?:es|ed|ing)?\s+(?:a\s+)?(?:typos?|spelling)|(?:typos?|spelling)\s+fix(?:es)?|correct\s+(?:typos?|spelling))\b/i;

// Boilerplate scrubbed from descriptions before the actor-history italic
// block renders. Match one boilerplate sentence; cleanDescription drops the
// whole field when residue is <10 chars (or is just a bare URL).
export const BOILERPLATE_RE = [
  /\*{0,2}[^.\n\r]*\b(?:poll passes|associated poll|merged until|cannot be merged|may only be merged|will not be merged)\b[^.\n\r]*[.!?]?\s*\*{0,2}/gi,
  /\*{0,2}\s*Do not (?:merge|post)[^.\n\r]*\*{0,2}/gi,
  /\*{0,2}\s*Originating forum post:?\s*<?\S*>?\s*\*{0,2}/gi,
];

// ─────────────────────────── classifiers ───────────────────────────────

/** Strip merge-gate boilerplate + bare-URL noise. Returns null when the
 *  cleaned residue is too short to be informative. */
export function cleanDescription(s) {
  if (!s) return null;
  let out = String(s);
  for (const re of BOILERPLATE_RE) out = out.replace(re, " ");
  out = out
    .replace(/\s+/g, " ")
    .replace(/^[\s\-—*•·:]+|[\s\-—*•·:]+$/g, "")
    .trim();
  if (/^https?:\/\/\S+$/.test(out)) return null;
  return out.length >= 10 ? out : null;
}

/** PR-title → "lint" | "typo" | null. Title-only — does not consult body. */
export function classifyPrTitle(prTitle) {
  if (!prTitle) return null;
  if (PR_LINT_RE.test(prTitle)) return "lint";
  if (PR_TYPO_RE.test(prTitle)) return "typo";
  return null;
}

/** Walk a line/word diff and classify the edit:
 *    "lint"     — added/removed text is entirely whitespace or punctuation
 *    "typo"     — ≤4 alphanumeric chars changed AND no contiguous run >2
 *    "semantic" — anything else
 *    null       — no diff data (empty array)
 *  See classifyPrTitle for the override that runs before this. */
export function classifyDiff(diff) {
  if (!diff || diff.length === 0) return null;
  let semChars = 0;
  let wsChars = 0;
  let maxRun = 0;
  const addRun = (text) => {
    const t = String(text ?? "");
    for (const chunk of t.split(/[^a-zA-Z0-9]+/)) {
      if (!chunk) continue;
      semChars += chunk.length;
      if (chunk.length > maxRun) maxRun = chunk.length;
    }
    wsChars += t.replace(/[a-zA-Z0-9]+/g, "").length;
  };
  for (const op of diff) {
    const head = op[0];
    if (head === "=" || head === "…") continue;
    if (head === "+" || head === "-") addRun(op[1]);
    else if (head === "~") {
      for (const inner of op[1] ?? []) {
        if (inner[0] === "=") continue;
        addRun(inner[1]);
      }
    }
  }
  if (semChars === 0) return wsChars > 0 ? "lint" : null;
  if (semChars <= 4 && maxRun <= 2) return "typo";
  return "semantic";
}

// ─────────────────────────── bullet matcher ────────────────────────────

/** Parse `- **Bold Title** — description` PR-style bullets out of a body. */
export function parsePrBullets(body) {
  const bullets = [];
  const re = /^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/gm;
  let m;
  while ((m = re.exec(body ?? "")) !== null) {
    bullets.push({ title: m[1].trim(), description: m[2].trim() });
  }
  return bullets;
}

/** Strip the last dotted segment of a doc_no; null for single-segment. */
export function parentDocNo(doc_no) {
  const idx = String(doc_no).lastIndexOf(".");
  return idx > 0 ? doc_no.slice(0, idx) : null;
}

/** How many ancestors to walk for context tokens, indexed by the node's
 *  doc_no segment count. Shallow docs walk 1 (already specific); deep docs
 *  walk up to 6 (their own title is generic so they need ancestor context). */
export function ancestorWalkFor(docNoDepth) {
  if (docNoDepth <= 3) return 1;
  if (docNoDepth === 4) return 2;
  if (docNoDepth === 5) return 3;
  if (docNoDepth === 6) return 3;
  if (docNoDepth === 7) return 4;
  if (docNoDepth === 8) return 5;
  return 6;
}

/** own = tokens of the node's title; ancestors = title tokens of its
 *  walked-up parents (excluding own tokens to avoid double-counting). */
export function nodeTokenSets(node, snapshotByDocNo) {
  const own = new Set(tokenize(node.title));
  const ancestors = new Set();
  const depth = String(node.doc_no).split(".").length;
  const walk = ancestorWalkFor(depth);
  let cur = node.doc_no;
  for (let i = 0; i < walk; i++) {
    cur = parentDocNo(cur);
    if (!cur) break;
    const ancestor = snapshotByDocNo.get(cur);
    if (ancestor) for (const t of tokenize(ancestor.title)) if (!own.has(t)) ancestors.add(t);
  }
  return { own, ancestors };
}

/** Score: own-token hits in (title|description) + ancestor-token hits in
 *  title only, all over own.size, capped at 1.0. Reject single-description-
 *  hit matches (the generic-vocab false-positive class — see Launch Agent 7
 *  / Skybase case): require ≥1 own-in-title, or ≥2 own-total, or ≥2 anc. */
export function matchScore(bullet, ownTokens, ancestorTokens) {
  if (ownTokens.size === 0) return 0;
  const titleTokens = new Set(tokenize(bullet.title));
  const descTokens = new Set(tokenize(bullet.description ?? ""));
  if (titleTokens.size === 0 && descTokens.size === 0) return 0;
  let ownTitleHits = 0;
  let ownTotalHits = 0;
  for (const t of ownTokens) {
    const inTitle = titleTokens.has(t);
    if (inTitle) ownTitleHits++;
    if (inTitle || descTokens.has(t)) ownTotalHits++;
  }
  let ancHits = 0;
  for (const t of ancestorTokens) if (titleTokens.has(t)) ancHits++;
  if (ownTitleHits === 0 && ownTotalHits < 2 && ancHits < 2) return 0;
  return Math.min(1, (ownTotalHits + ancHits) / ownTokens.size);
}

/** Pull doc_nos and UUIDs from a bullet's text. */
export function explicitRefs(bullet) {
  const text = `${bullet.title}\n${bullet.description ?? ""}`;
  return {
    docNos: new Set(text.match(DOC_NO_RE) ?? []),
    uuids: new Set(text.match(UUID_RE) ?? []),
  };
}

/** True iff nodeDocNo is the same as or a descendant of any ref. */
export function nodeInRefScope(nodeDocNo, refDocNos) {
  for (const ref of refDocNos) {
    if (nodeDocNo === ref || nodeDocNo.startsWith(ref + ".")) return true;
  }
  return false;
}

/** Doc_no prefixes for any prime-agent name appearing in the bullet title
 *  as a word-boundary substring. Title-only because descriptions often
 *  mention many agents in passing. */
export function detectAgentScope(bulletTitle, agentNamePrefixes) {
  const lc = String(bulletTitle ?? "").toLowerCase();
  const scopes = [];
  for (const [name, prefix] of agentNamePrefixes) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lc)) scopes.push(prefix);
  }
  return scopes;
}

/** For each changed node, find the best-matching bullet (if any).
 *  Returns Map<nodeId, { bulletTitle, bulletDescription, matchScore, via }>.
 *
 *  Passes:
 *    1a. Deterministic — bullet text contains node's doc_no or UUID.
 *    1b. Forum extraRefs — refs harvested from anywhere in a Discourse post,
 *        attributed to refFallback (SAEP Summary).
 *    2.  Fuzzy — own-title + ancestor token overlap, with scope restrictions
 *        (explicit refs + agent-name scope) to suppress cross-agent vocab
 *        collisions.
 *    3.  Sole-bullet fallback — 1-bullet PR? attach to all unmatched nodes. */
export function matchBulletsToNodes(bullets, changedNodes, snapshot, opts = {}) {
  if (bullets.length === 0) return new Map();
  const { extraRefs, refFallback, agentNamePrefixes } = opts;
  const matches = new Map();

  const byDocNo = new Map();
  for (const [id, entry] of snapshot) byDocNo.set(entry.doc_no, { ...entry, id });

  const bulletRefs = bullets.map((b) => ({
    bullet: b,
    refs: explicitRefs(b),
    agentScope: agentNamePrefixes ? detectAgentScope(b.title, agentNamePrefixes) : [],
  }));

  for (const node of changedNodes) {
    let bestBullet = null;
    let bestScore = 0;
    let via = null;
    for (const { bullet, refs } of bulletRefs) {
      if (refs.docNos.has(node.doc_no) || refs.uuids.has(node.id)) {
        bestBullet = bullet;
        bestScore = 1;
        via = "ref";
        break;
      }
    }
    if (!bestBullet && extraRefs && refFallback) {
      if (extraRefs.docNos.has(node.doc_no) || extraRefs.uuids.has(node.id)) {
        bestBullet = refFallback;
        bestScore = 1;
        via = "ref";
      }
    }
    if (!bestBullet) {
      const { own, ancestors } = nodeTokenSets(node, byDocNo);
      for (const { bullet, refs, agentScope } of bulletRefs) {
        if (refs.docNos.size > 0 && !nodeInRefScope(node.doc_no, refs.docNos)) continue;
        if (agentScope.length > 0 && !nodeInRefScope(node.doc_no, new Set(agentScope))) continue;
        const score = matchScore(bullet, own, ancestors);
        if (score > bestScore) {
          bestScore = score;
          bestBullet = bullet;
        }
      }
      via = "fuzzy";
    }
    if (bestBullet && (via === "ref" || bestScore >= 0.35)) {
      matches.set(node.id, {
        bulletTitle: bestBullet.title,
        bulletDescription: bestBullet.description,
        matchScore: Math.round(bestScore * 100),
        via,
      });
    }
  }

  // Sole-bullet fallback (SAEP-style): one bullet covers the whole PR.
  if (bullets.length === 1) {
    const only = bullets[0];
    for (const node of changedNodes) {
      if (matches.has(node.id)) continue;
      matches.set(node.id, {
        bulletTitle: only.title,
        bulletDescription: only.description,
        matchScore: 0,
        via: "sole-bullet",
      });
    }
  }

  return matches;
}
