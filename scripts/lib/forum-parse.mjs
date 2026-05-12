/**
 * Discourse forum-post parsing.
 *
 * Some atlas PRs link to a Sky forum post instead of inlining bullets.
 * - "Atlas Edit Weekly Cycle" posts: one `### Heading` block per atlas edit.
 *   Atomize into bullets with rationale as description.
 * - "SAEP" posts: `## Summary`, `## Background`, ...; only the Summary is
 *   short enough to act as a PR-level description. We skip the rest.
 *
 * In both modes we also harvest doc_no / UUID references from the entire
 * body — those feed the deterministic-ref pass of the matcher.
 *
 * All functions are pure; I/O lives in build-forum-cache.mjs.
 */

// Forum URL regex — both old (forum.sky.money) and new (forum.skyeco.com)
// hosts. The old host 301-redirects to the new one. Capture the numeric
// topic id; slug is ignored (the JSON endpoint accepts /t/<id>.json).
export const FORUM_URL_RE =
  /https?:\/\/forum\.(?:sky\.money|skyeco\.com)\/t\/[\w-]+\/(\d+)/g;

// Mirrors build-history.mjs — kept in sync deliberately.
const DOC_NO_RE = /\b[A-Z](?:\.\w+)+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

/** Extract all topic ids from a body of text. Returns unique ids in order
 *  of first appearance. */
export function findForumTopicIds(text) {
  if (!text) return [];
  const ids = new Set();
  for (const m of text.matchAll(FORUM_URL_RE)) ids.add(m[1]);
  return [...ids];
}

/** Trim a string to at most `n` chars, cutting at the last whitespace
 *  boundary so we don't break a word mid-token. */
function trimTo(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastWs = cut.lastIndexOf(" ");
  return (lastWs > n * 0.6 ? cut.slice(0, lastWs) : cut).trim() + "…";
}

/** Squash the Discourse markdown into something that reads naturally as a
 *  one-paragraph summary: strip bullet/heading markers, collapse runs of
 *  whitespace, drop blockquote prefixes, etc. */
function flattenForDescription(md) {
  return md
    .replace(/^\s*[-*]\s+/gm, "") // bullet markers
    .replace(/^\s*>\s?/gm, "") // blockquote
    .replace(/^\s*#{1,6}\s+/gm, "") // stray subheadings inside a block
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/\s+/g, " ")
    .trim();
}

/** Split the body into ### heading + body blocks. Body extends until the
 *  next `##` or `###` line or EOF. */
function splitByH3(md) {
  const lines = md.split("\n");
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    const h2 = line.match(/^##\s+(?!#)/); // a `## ` that isn't a `### `
    if (h3) {
      if (cur) blocks.push(cur);
      cur = { title: h3[1].trim(), bodyLines: [] };
    } else if (h2 && cur) {
      // A top-level `##` closes the current ### block.
      blocks.push(cur);
      cur = null;
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) blocks.push(cur);

  return blocks
    .filter((b) => b.title)
    .map((b) => ({
      title: cleanHeading(b.title),
      description: trimTo(flattenForDescription(b.bodyLines.join("\n")), 600),
    }))
    .filter((b) => b.description.length > 0);
}

/** Strip markdown inline formatting from a heading title — some authors wrap
 *  `### **Title**`, some don't. We want a clean plain-text title for display. */
function cleanHeading(s) {
  return s
    .replace(/^\s*\*\*(.+?)\*\*\s*$/, "$1")
    .replace(/^\s*\*(.+?)\*\s*$/, "$1")
    .replace(/^\s*_(.+?)_\s*$/, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Find a `## <name>` section and return its body up to the next `##` or
 *  EOF. Case-insensitive on the heading text. */
function sectionBody(md, headingRe) {
  const lines = md.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+(?!#)/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** Decide proposal mode and emit bullets accordingly.
 *  Returns { bullets, extraRefs }.
 *  - extraRefs: every doc_no / UUID anywhere in the body. The deterministic
 *    ref pass in matchBulletsToNodes ORs these with per-bullet refs.
 *  - bullets:
 *    - Weekly Cycle (≥2 ### headings) → one bullet per heading block.
 *    - SAEP (## Summary present) → single bullet using fallbackTitle as
 *      title and the Summary section as description.
 *    - Otherwise → empty (refs alone still help).
 */
export function extractForumBullets(rawMd, { fallbackTitle } = {}) {
  const extraRefs = {
    docNos: new Set(rawMd.match(DOC_NO_RE) ?? []),
    uuids: new Set(rawMd.match(UUID_RE) ?? []),
  };

  // SAEPs (e.g. SAEP-07, SAEP-08) have nested `###` subheadings inside their
  // top-level `##` sections, so a naive ≥2 `###` heuristic mis-classifies
  // them as Weekly Cycle. Detect SAEPs first: a `## Summary` line plus at
  // least 2 top-level `## `-prefixed sections is a strong SAEP signal.
  const hasSummary = /^##\s+Summary\s*$/im.test(rawMd);
  const h2Count = (rawMd.match(/^##\s+(?!#)/gm) ?? []).length;
  if (hasSummary && h2Count >= 2 && fallbackTitle) {
    const summary = sectionBody(rawMd, /^##\s+Summary\s*$/im);
    if (summary) {
      return {
        bullets: [
          {
            title: fallbackTitle,
            description: trimTo(flattenForDescription(summary), 600),
          },
        ],
        extraRefs,
      };
    }
  }

  // Weekly Cycle: each atlas edit gets its own `### Heading` block at top
  // level (not nested inside a `## ` section). splitByH3 already closes a
  // block on a `## ` boundary, so SAEP-style nested `###`s don't bleed into
  // the bullet list when we miss the SAEP detection.
  //
  // Some Weekly Cycle posts include an intro that lists every edit as a
  // `- **Title** - description` line but then OMIT the `### ` section for
  // a few of them (e.g. forum 27720 lists "Add Launch Agent 7 Artifact" in
  // the intro but has no matching `###`). Parse the intro bullets too and
  // merge — H3 bullets carry the rich edit instructions, intro bullets fill
  // the gaps when an edit's section is missing.
  const h3Count = (rawMd.match(/^###\s+/gm) ?? []).length;
  if (h3Count >= 2) {
    const h3Bullets = splitByH3(rawMd);
    const introBullets = parseIntroBullets(introBefore(rawMd, /^###\s+/m));
    const titles = new Set(h3Bullets.map((b) => normalizeTitle(b.title)));
    for (const b of introBullets) {
      if (!titles.has(normalizeTitle(b.title))) h3Bullets.push(b);
    }
    if (h3Bullets.length > 0) return { bullets: h3Bullets, extraRefs };
  }

  return { bullets: [], extraRefs };
}

function introBefore(md, re) {
  const m = md.match(re);
  return m ? md.slice(0, m.index) : md;
}

function normalizeTitle(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Parse `- **Title** - description` style bullets out of an intro block.
 *  Mirrors build-history's parsePrBullets but only used for forum content. */
function parseIntroBullets(text) {
  const out = [];
  const re = /^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      title: cleanHeading(m[1].trim()),
      description: m[2].trim(),
    });
  }
  return out;
}
