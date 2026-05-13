#!/usr/bin/env node
/**
 * Process inventory drift check.
 *
 * Compares public/processes.json (curated list of 55 process nodes) against the
 * current public/docs.json. Three outputs:
 *
 *   1. Auto-applied: title / doc_no snapshot updates. If a curated UUID still
 *      exists but its title or doc_no changed in the atlas, we silently update
 *      public/processes.json. This is a snapshot drift, not a structural change.
 *
 *   2. audit.missingUuids — curated entry whose UUID is gone from docs.json
 *      (deleted, restructured, or merged into another node).
 *
 *   3. audit.newCandidates — docs whose titles match the process keyword
 *      classifier but aren't in public/processes.json AND not in
 *      public/processes-ignored.json.
 *
 * Exits 0 always — never blocks builds/deployments. Sets the GH Actions
 * outputs `dirty` and `summary` so the atlas-update workflow can decide
 * whether to open / update a tracking issue.
 *
 * Run: node scripts/required/check-processes-dirty.mjs [--no-write]
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

const NO_WRITE = process.argv.includes("--no-write");

// ---------------------------------------------------------------------------

const docs = JSON.parse(fs.readFileSync(DOCS, "utf8"));
const processes = JSON.parse(fs.readFileSync(PROCESSES, "utf8"));
const ignored = JSON.parse(fs.readFileSync(IGNORED, "utf8"));

const curatedUuids = new Set(processes.map((p) => p.uuid));
const ignoredUuids = new Set(ignored.map((i) => i.uuid));

// 1. Auto-update title/doc_no snapshots; collect missing UUIDs.
const missingUuids = [];
const driftedSnapshots = [];

for (const entry of processes) {
  const node = docs[entry.uuid];
  if (!node) {
    missingUuids.push({
      uuid: entry.uuid,
      title_at_curation: entry.title_at_curation,
      doc_no_at_curation: entry.doc_no_at_curation,
      category: entry.category,
    });
    continue;
  }
  if (node.title !== entry.title_at_curation || node.doc_no !== entry.doc_no_at_curation) {
    driftedSnapshots.push({
      uuid: entry.uuid,
      title_before: entry.title_at_curation,
      title_after: node.title,
      doc_no_before: entry.doc_no_at_curation,
      doc_no_after: node.doc_no,
    });
    entry.title_at_curation = node.title;
    entry.doc_no_at_curation = node.doc_no;
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

// 3. Persist snapshot updates back to processes.json.
if (driftedSnapshots.length > 0 && !NO_WRITE) {
  fs.writeFileSync(PROCESSES, JSON.stringify(processes, null, 2) + "\n");
}

// 4. Write audit + markdown summary.
const audit = {
  generated_at: new Date().toISOString().split("T")[0],
  total_curated: processes.length,
  total_candidates: candidates.length,
  total_ignored: ignored.length,
  auto_applied: driftedSnapshots,
  missing_uuids: missingUuids,
  new_candidates: newCandidates,
};

const dirty = missingUuids.length > 0 || newCandidates.length > 0;

fs.mkdirSync(path.dirname(AUDIT_OUT), { recursive: true });
fs.writeFileSync(AUDIT_OUT, JSON.stringify(audit, null, 2) + "\n");
fs.writeFileSync(AUDIT_MD, renderMarkdown(audit, dirty));

// 5. Human-readable summary.
console.log(`Curated: ${processes.length}  Candidates: ${candidates.length}  Ignored: ${ignored.length}`);
if (driftedSnapshots.length > 0) {
  console.log(`Auto-applied snapshot updates: ${driftedSnapshots.length}${NO_WRITE ? " (--no-write, not persisted)" : ""}`);
}
if (missingUuids.length > 0) {
  console.log(`\n⚠ Missing UUIDs (${missingUuids.length}):`);
  for (const m of missingUuids) {
    console.log(`  ${m.uuid}  ${m.title_at_curation} (${m.doc_no_at_curation})`);
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

  if (audit.auto_applied.length > 0) {
    lines.push(`## Auto-applied snapshot updates (${audit.auto_applied.length})`);
    lines.push("");
    lines.push("These were committed to `public/processes.json` automatically — no action needed.");
    lines.push("");
    for (const d of audit.auto_applied) {
      lines.push(`- \`${d.uuid}\``);
      if (d.title_before !== d.title_after) {
        lines.push(`  - title: \`${d.title_before}\` → \`${d.title_after}\``);
      }
      if (d.doc_no_before !== d.doc_no_after) {
        lines.push(`  - doc_no: \`${d.doc_no_before}\` → \`${d.doc_no_after}\``);
      }
    }
    lines.push("");
  }

  if (audit.missing_uuids.length > 0) {
    lines.push(`## Missing UUIDs (${audit.missing_uuids.length})`);
    lines.push("");
    lines.push("These curated entries no longer exist in the atlas — deleted, merged, or restructured. Review and either remove from `public/processes.json` or replace the UUID.");
    lines.push("");
    for (const m of audit.missing_uuids) {
      lines.push(`- \`${m.uuid}\` — ${m.title_at_curation} (${m.doc_no_at_curation}, ${m.category})`);
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

  if (!dirty && audit.auto_applied.length === 0) {
    lines.push("Nothing to review.");
  }

  return lines.join("\n");
}
