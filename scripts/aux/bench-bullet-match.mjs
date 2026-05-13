#!/usr/bin/env node
/**
 * bench-bullet-match.mjs
 *
 * Replays bullet-matching for a single PR against the current docs.json and
 * the per-node history files, then reports match rate. Lets us tune the
 * algorithm without rebuilding the whole history.
 *
 * Usage: node scripts/aux/bench-bullet-match.mjs <pr_number> [<pr_number> ...]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractForumBullets, findForumTopicIds } from "../lib/forum-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HISTORY_DIR = path.join(ROOT, "public/history");
const DOCS_PATH = path.join(ROOT, "public/docs.json");
const PR_CACHE_DIR = path.join(ROOT, ".cache/github-prs");
const FORUM_CACHE_DIR = path.join(ROOT, ".cache/discourse");

const prNumbers = process.argv.slice(2).map((n) => parseInt(n, 10)).filter(Boolean);
if (prNumbers.length === 0) {
  console.error("usage: node scripts/aux/bench-bullet-match.mjs <pr> [<pr> ...]");
  process.exit(2);
}

// --- duplicate the matcher functions inline so we can iterate the algorithm
// without polluting the production build-history module --------------------

function tokenize(s) {
  const STOP = new Set([
    "the","a","an","and","or","for","in","on","to","at","by","with","from","of","is","as",
  ]);
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function parsePrBullets(body) {
  const bullets = [];
  const re = /^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    bullets.push({ title: m[1].trim(), description: m[2].trim() });
  }
  return bullets;
}

// ---- OLD scorer (pre-change) ----
function oldScore(bullet, nodeTitle) {
  const bTokens = tokenize(bullet.title);
  const nTokens = tokenize(nodeTitle);
  if (bTokens.length === 0 || nTokens.length === 0) return 0;
  const bSet = new Set(bTokens);
  const nSet = new Set(nTokens);
  let hits = 0;
  for (const t of nSet) if (bSet.has(t)) hits++;
  const titleScore = hits / nSet.size;
  const descTokens = new Set(tokenize(bullet.description ?? ""));
  let descHits = 0;
  for (const t of nSet) if (descTokens.has(t)) descHits++;
  const descScore = bullet.description ? descHits / nSet.size : 0;
  return titleScore + Math.min(descScore * 0.4, 0.2);
}

function oldMatchRate(bullets, changedNodes) {
  let matched = 0;
  for (const node of changedNodes) {
    let best = 0;
    for (const b of bullets) {
      const s = oldScore(b, node.title);
      if (s > best) best = s;
    }
    if (best >= 0.35) matched++;
  }
  return matched;
}

// ---- NEW scorer ----
const DOC_NO_RE = /\b[A-Z](?:\.\w+)+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

function parentDocNo(doc_no) {
  const idx = doc_no.lastIndexOf(".");
  return idx > 0 ? doc_no.slice(0, idx) : null;
}

function ancestorWalkFor(d) {
  if (d <= 3) return 1;
  if (d === 4) return 2;
  if (d === 5) return 3;
  if (d === 6) return 3;
  if (d === 7) return 4;
  if (d === 8) return 5;
  return 6;
}

function nodeTokenSets(node, byDocNo) {
  const own = new Set(tokenize(node.title));
  const ancestors = new Set();
  const walk = ancestorWalkFor(node.doc_no.split(".").length);
  let cur = node.doc_no;
  for (let i = 0; i < walk; i++) {
    cur = parentDocNo(cur);
    if (!cur) break;
    const a = byDocNo.get(cur);
    if (a) for (const t of tokenize(a.title)) if (!own.has(t)) ancestors.add(t);
  }
  return { own, ancestors };
}

function newScore(bullet, own, ancestors) {
  if (own.size === 0) return 0;
  const titleT = new Set(tokenize(bullet.title));
  const descT = new Set(tokenize(bullet.description ?? ""));
  if (titleT.size === 0 && descT.size === 0) return 0;
  let ownTitleHits = 0, ownTotalHits = 0;
  for (const t of own) {
    const inTitle = titleT.has(t);
    if (inTitle) ownTitleHits++;
    if (inTitle || descT.has(t)) ownTotalHits++;
  }
  let ancHits = 0;
  for (const t of ancestors) if (titleT.has(t)) ancHits++;
  if (ownTitleHits === 0 && ownTotalHits < 2 && ancHits < 2) return 0;
  return Math.min(1, (ownTotalHits + ancHits) / own.size);
}

function explicitRefs(bullet) {
  const text = `${bullet.title}\n${bullet.description ?? ""}`;
  return {
    docNos: new Set(text.match(DOC_NO_RE) ?? []),
    uuids: new Set(text.match(UUID_RE) ?? []),
  };
}

function nodeInRefScope(nodeDocNo, refDocNos) {
  for (const ref of refDocNos) {
    if (nodeDocNo === ref || nodeDocNo.startsWith(ref + ".")) return true;
  }
  return false;
}

function newMatchRate(bullets, changedNodes, byDocNo, opts = {}) {
  const { extraRefs, refFallback } = opts;
  let matched = 0;
  const breakdown = { ref: 0, forumRef: 0, fuzzy: 0, sole: 0 };
  const bulletRefs = bullets.map((b) => ({ bullet: b, refs: explicitRefs(b) }));
  const matchedSet = new Set();

  for (const node of changedNodes) {
    let hit = null;
    for (const { bullet, refs } of bulletRefs) {
      if (refs.docNos.has(node.doc_no) || refs.uuids.has(node.id)) {
        hit = { via: "ref" }; break;
      }
    }
    if (!hit && extraRefs && refFallback) {
      if (extraRefs.docNos.has(node.doc_no) || extraRefs.uuids.has(node.id)) {
        hit = { via: "forumRef" };
      }
    }
    if (!hit) {
      const { own, ancestors } = nodeTokenSets(node, byDocNo);
      let best = 0;
      for (const { bullet, refs } of bulletRefs) {
        if (refs.docNos.size > 0 && !nodeInRefScope(node.doc_no, refs.docNos)) continue;
        const s = newScore(bullet, own, ancestors);
        if (s > best) best = s;
      }
      if (best >= 0.35) hit = { via: "fuzzy" };
    }
    if (hit) {
      matched++;
      breakdown[hit.via]++;
      matchedSet.add(node.id);
    }
  }

  if (bullets.length === 1) {
    for (const node of changedNodes) {
      if (matchedSet.has(node.id)) continue;
      matched++;
      breakdown.sole++;
    }
  }

  return { matched, breakdown };
}

// Load forum bullets+extraRefs from disk cache for the PR (if any forum link).
function loadForumExtrasForBench(pr) {
  if (!pr?.body) return null;
  const topicIds = findForumTopicIds(pr.body);
  if (topicIds.length === 0) return null;
  const bullets = [];
  const docNos = new Set();
  const uuids = new Set();
  let any = false;
  for (const id of topicIds) {
    const p = path.join(FORUM_CACHE_DIR, `${id}.json`);
    if (!fs.existsSync(p)) continue;
    const entry = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!entry.post1Raw) continue;
    const { bullets: bs, extraRefs } = extractForumBullets(entry.post1Raw, {
      fallbackTitle: pr.title,
    });
    bullets.push(...bs);
    for (const r of extraRefs.docNos) docNos.add(r);
    for (const r of extraRefs.uuids) uuids.add(r);
    any = true;
  }
  return any ? { bullets, extraRefs: { docNos, uuids } } : null;
}

// ---- Load docs + per-node history to find which nodes were touched by each PR ----

console.log("Loading docs.json…");
const docs = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8"));
const byDocNo = new Map();
for (const [id, d] of Object.entries(docs)) byDocNo.set(d.doc_no, { ...d, id });

console.log("Scanning history files for PR references…");
const prToNodes = new Map(); // pr_number → [{id, doc_no, title}]
for (const file of fs.readdirSync(HISTORY_DIR)) {
  if (file.startsWith("_") || !file.endsWith(".json")) continue;
  const id = file.slice(0, -".json".length);
  const entries = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), "utf8"));
  for (const e of entries) {
    if (!e.pr) continue;
    if (!prToNodes.has(e.pr)) prToNodes.set(e.pr, []);
    const doc = docs[id];
    if (doc) prToNodes.get(e.pr).push({ id, doc_no: doc.doc_no, title: doc.title });
  }
}

// ---- Report ----

for (const prNum of prNumbers) {
  const cacheFile = path.join(PR_CACHE_DIR, `${prNum}.json`);
  if (!fs.existsSync(cacheFile)) {
    console.error(`PR #${prNum}: no cached PR body (${cacheFile})`);
    continue;
  }
  const pr = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const prBullets = parsePrBullets(pr.body || "");
  const forum = loadForumExtrasForBench(pr);
  const bullets = [...prBullets, ...(forum?.bullets ?? [])];
  const refFallback =
    prBullets.length === 0 && forum?.bullets.length === 1 ? forum.bullets[0] : null;

  const touched = prToNodes.get(prNum) ?? [];
  // Dedup: a node can appear once per changeType but we want unique ids.
  const seen = new Set();
  const uniq = [];
  for (const n of touched) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    uniq.push(n);
  }
  const oldMatched = oldMatchRate(prBullets, uniq);
  const { matched: newMatched, breakdown } = newMatchRate(bullets, uniq, byDocNo, {
    extraRefs: forum?.extraRefs ?? null,
    refFallback,
  });

  console.log(`\n=== PR #${prNum}: ${pr.title} ===`);
  console.log(`  bullets:        pr=${prBullets.length}, forum=${forum?.bullets.length ?? 0}`);
  console.log(`  touched nodes:  ${uniq.length}`);
  console.log(`  OLD matched:    ${oldMatched}/${uniq.length} (${pct(oldMatched, uniq.length)}%)`);
  console.log(`  NEW matched:    ${newMatched}/${uniq.length} (${pct(newMatched, uniq.length)}%)`);
  console.log(`    via doc_no/uuid ref: ${breakdown.ref}`);
  console.log(`    via forum extraRefs: ${breakdown.forumRef}`);
  console.log(`    via fuzzy:           ${breakdown.fuzzy}`);
  console.log(`    via sole-bullet:     ${breakdown.sole}`);
}

function pct(a, b) {
  return b === 0 ? "0" : ((a / b) * 100).toFixed(0);
}
