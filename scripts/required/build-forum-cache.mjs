#!/usr/bin/env node
/**
 * Pre-pass for build:history. Scans .cache/github-prs/*.json for forum
 * links and fetches the Discourse topic JSON, persisting a slim record
 * to .cache/discourse/<topicId>.json.
 *
 * Layout per file:
 *   { topicId, url, title, slug, fetchedAt, post1Raw }
 *
 * Idempotent: skips topics already cached. Pass --refetch to ignore the
 * cache and re-fetch everything (useful when iterating on the parser).
 *
 * forum.sky.money 301-redirects to forum.skyeco.com; we always hit the
 * new host directly to avoid the redirect.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findForumTopicIds } from "../lib/forum-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PR_CACHE_DIR = path.join(ROOT, ".cache/github-prs");
const FORUM_CACHE_DIR = path.join(ROOT, ".cache/discourse");
const FORUM_HOST = "https://forum.skyeco.com";

const refetch = process.argv.includes("--refetch");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function topicCachePath(topicId) {
  return path.join(FORUM_CACHE_DIR, `${topicId}.json`);
}

async function fetchTopic(topicId) {
  // /t/<id>.json returns metadata + `cooked` HTML but NOT `raw` markdown for
  // unauthenticated requests. The /raw/<id>/<post_number> endpoint returns
  // the raw markdown of a single post as text/plain — what we actually want.
  const metaRes = await fetch(`${FORUM_HOST}/t/${topicId}.json`, {
    redirect: "follow",
    headers: { Accept: "application/json", "User-Agent": "redlens-build" },
  });
  if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status} (meta) for topic ${topicId}`);
  const meta = await metaRes.json();

  const rawRes = await fetch(`${FORUM_HOST}/raw/${topicId}/1`, {
    redirect: "follow",
    headers: { Accept: "text/plain", "User-Agent": "redlens-build" },
  });
  if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status} (raw) for topic ${topicId}`);
  const post1Raw = await rawRes.text();

  return {
    topicId: Number(topicId),
    url: `${FORUM_HOST}/t/${meta.slug}/${topicId}`,
    title: meta.title ?? null,
    slug: meta.slug ?? null,
    fetchedAt: new Date().toISOString(),
    post1Raw,
  };
}

function collectTopicIds() {
  const ids = new Set();
  if (!fs.existsSync(PR_CACHE_DIR)) return ids;
  for (const file of fs.readdirSync(PR_CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const raw = fs.readFileSync(path.join(PR_CACHE_DIR, file), "utf8");
    let pr;
    try {
      pr = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const id of findForumTopicIds(pr.body ?? "")) ids.add(id);
  }
  return ids;
}

async function main() {
  fs.mkdirSync(FORUM_CACHE_DIR, { recursive: true });
  const ids = [...collectTopicIds()];
  if (ids.length === 0) {
    console.error("no forum links found in cached PR bodies");
    return;
  }
  console.error(`found ${ids.length} unique forum topics referenced in PRs`);

  let fetched = 0;
  let cached = 0;
  let failed = 0;
  for (const id of ids) {
    const p = topicCachePath(id);
    if (!refetch && fs.existsSync(p)) {
      cached++;
      continue;
    }
    try {
      const entry = await fetchTopic(id);
      fs.writeFileSync(p, JSON.stringify(entry, null, 2) + "\n");
      fetched++;
      const tag = entry.post1Raw ? `${entry.post1Raw.length} chars` : "empty body";
      console.error(`  ✓ ${id} ${entry.title?.slice(0, 60) ?? ""} (${tag})`);
      await sleep(250);
    } catch (err) {
      failed++;
      console.error(`  ! ${id}: ${err.message}`);
    }
  }
  console.error(`\ndone: ${fetched} fetched, ${cached} cached, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
