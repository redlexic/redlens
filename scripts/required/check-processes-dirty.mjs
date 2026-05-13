#!/usr/bin/env node
/**
 * Process inventory drift check.
 *
 * Compares public/processes.json (curated process nodes, identified by UUID)
 * against the current public/docs.json. Two outputs:
 *
 *   1. audit.missingUuids — curated entry whose UUID is gone from docs.json
 *      (deleted, restructured, or merged into another node).
 *
 *   2. audit.newCandidates — docs whose titles match the process keyword
 *      classifier but aren't in public/processes.json AND not in
 *      public/processes-ignored.json.
 *
 * Title / doc_no are resolved from docs.json on every read — no snapshot
 * fields are stored on the entries, so there's no drift to auto-apply.
 *
 * Exits 0 always — never blocks builds/deployments. Sets the GH Actions
 * outputs `dirty`, `missing`, `candidates` so the atlas-update workflow can
 * decide whether to open / update a tracking issue.
 *
 * Run: node scripts/required/check-processes-dirty.mjs
 *      pnpm processes:check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findCandidates } from "../lib/process-keywords.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROCESSES = path.join(ROOT, "public/processes.json");
const IGNORED = path.join(ROOT, "public/processes-ignored.json");
const DOCS = path.join(ROOT, "public/docs.json");
const AUDIT_OUT = path.join(ROOT, ".cache/processes-audit.json");
const AUDIT_MD = path.join(ROOT, ".cache/processes-audit.md");

// ---------------------------------------------------------------------------

const docs = JSON.parse(fs.readFileSync(DOCS, "utf8"));
const processes = JSON.parse(fs.readFileSync(PROCESSES, "utf8"));
const ignored = JSON.parse(fs.readFileSync(IGNORED, "utf8"));

const curatedUuids = new Set(processes.map((p) => p.uuid));
const ignoredUuids = new Set(ignored.map((i) => i.uuid));

// 1. Curated entries whose UUID is gone from docs.json. We only know the
// uuid + category from the local entry; the human can `git log -S <uuid> --
// public/processes.json` to recover what it was previously titled.
const missingUuids = [];
for (const entry of processes) {
  if (!docs[entry.uuid]) {
    missingUuids.push({ uuid: entry.uuid, category: entry.category });
  }
}

// 2. New candidates from the keyword classifier. Descendants of already-curated
// processes are skipped — they're step nodes, not standalone processes.
const candidates = findCandidates(docs, curatedUuids);
const newCandidates = candidates
  .filter((c) => !curatedUuids.has(c.id) && !ignoredUuids.has(c.id))
  .map((c) => ({
    uuid: c.id,
    title: c.title,
    doc_no: docs[c.id].doc_no,
    type: docs[c.id].type,
    keywords: c.keywords,
  }))
  .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));

// 3. Write audit + markdown summary.
const audit = {
  generated_at: new Date().toISOString().split("T")[0],
  total_curated: processes.length,
  total_candidates: candidates.length,
  total_ignored: ignored.length,
  missing_uuids: missingUuids,
  new_candidates: newCandidates,
};

const dirty = missingUuids.length > 0 || newCandidates.length > 0;

fs.mkdirSync(path.dirname(AUDIT_OUT), { recursive: true });
fs.writeFileSync(AUDIT_OUT, JSON.stringify(audit, null, 2) + "\n");
fs.writeFileSync(AUDIT_MD, renderMarkdown(audit, dirty));

// 4. Human-readable summary.
console.log(`Curated: ${processes.length}  Candidates: ${candidates.length}  Ignored: ${ignored.length}`);
if (missingUuids.length > 0) {
  console.log(`\n⚠ Missing UUIDs (${missingUuids.length}):`);
  for (const m of missingUuids) {
    console.log(`  ${m.uuid}  (${m.category})`);
  }
}
if (newCandidates.length > 0) {
  console.log(`\n⚠ New candidates (${newCandidates.length}):`);
  for (const c of newCandidates) {
    console.log(`  ${c.doc_no}  ${c.title}  [${c.keywords.join(", ")}]`);
  }
}
if (!dirty) {
  console.log("\nClean — no action needed.");
}

// 6. GH Actions outputs.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `dirty=${dirty}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `missing=${missingUuids.length}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidates=${newCandidates.length}\n`);
}

// ---------------------------------------------------------------------------

function renderMarkdown(audit, dirty) {
  const lines = [];
  lines.push(`# Process inventory audit`);
  lines.push("");
  lines.push(`**Generated:** ${audit.generated_at}`);
  lines.push(`**Status:** ${dirty ? "needs review" : "clean"}`);
  lines.push("");
  lines.push(`Curated: ${audit.total_curated} · Candidates: ${audit.total_candidates} · Ignored: ${audit.total_ignored}`);
  lines.push("");

  if (audit.missing_uuids.length > 0) {
    lines.push(`## Missing UUIDs (${audit.missing_uuids.length})`);
    lines.push("");
    lines.push("These curated entries no longer exist in the atlas — deleted, merged, or restructured. Review and either remove from `public/processes.json` or replace the UUID. To see what each was, run `git log -S <uuid> -- public/processes.json`.");
    lines.push("");
    for (const m of audit.missing_uuids) {
      lines.push(`- \`${m.uuid}\` (${m.category})`);
    }
    lines.push("");
  }

  if (audit.new_candidates.length > 0) {
    lines.push(`## New candidates (${audit.new_candidates.length})`);
    lines.push("");
    lines.push("Atlas nodes whose titles match the process keyword classifier but aren't in the curated list. For each: add to `public/processes.json` if it's a real process, or to `public/processes-ignored.json` to suppress permanently.");
    lines.push("");
    for (const c of audit.new_candidates) {
      lines.push(`- ${c.doc_no} — **${c.title}** (\`${c.uuid}\`, ${c.type}) — keywords: ${c.keywords.join(", ")}`);
    }
    lines.push("");
  }

  if (!dirty) {
    lines.push("Nothing to review.");
  }

  return lines.join("\n");
}
