#!/usr/bin/env node
/**
 * sync-history.mjs
 *
 * Loads public/history/<uuid>.json into the redlens-mcp D1 database, table
 * node_history. Reads every per-node history JSON, flattens entries, and
 * batched-inserts. Diff payloads are NOT stored in D1 — callers fetch the
 * deployed GitHub Pages JSON when they need line/word diffs.
 *
 * Run build-history first so the artifacts on disk are current.
 *
 * Usage (from repo root):
 *   node scripts/required/sync-history.mjs            # apply to local D1
 *   node scripts/required/sync-history.mjs --remote   # apply to remote D1
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HISTORY_DIR = path.join(ROOT, "public/history");
const MCP_DIR = path.join(ROOT, "redlens-mcp");
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const BATCH = 20;

function esc(s) {
  if (s == null) return "NULL";
  if (typeof s === "number") return String(s);
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function writeBatched(filePath, tableName, cols, rows) {
  const out = fs.createWriteStream(filePath);
  out.write(`DELETE FROM ${tableName};\n`);
  let i = 0;
  for (const row of rows) {
    if (i % BATCH === 0) {
      if (i > 0) out.write(";\n");
      out.write(`INSERT INTO ${tableName} (${cols.join(",")}) VALUES\n`);
    } else {
      out.write(",\n");
    }
    out.write("(" + cols.map((c) => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(";\n");
  out.end();
  return new Promise((r) => out.on("finish", r));
}

function runFile(filePath) {
  // wrangler resolves D1 binding config from redlens-mcp/wrangler.jsonc
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: MCP_DIR,
  });
}

if (!fs.existsSync(HISTORY_DIR)) {
  console.error(`No history directory at ${HISTORY_DIR}. Run \`pnpm build:history\` first.`);
  process.exit(1);
}

console.log("Loading per-node history files…");
const rows = [];
let fileCount = 0;
for (const f of fs.readdirSync(HISTORY_DIR)) {
  if (f.startsWith("_") || !f.endsWith(".json")) continue;
  fileCount++;
  const docId = f.slice(0, -".json".length);
  const entries = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), "utf8"));
  for (const e of entries) {
    rows.push({
      doc_id: docId,
      date: e.date,
      commit_hash: e.commitHash,
      change_type: e.changeType,
      pr_number: e.pr ?? null,
      pr_title: e.prTitle ?? null,
      pr_author: e.prAuthor ?? null,
      pr_url: e.prUrl ?? null,
      summary: e.summary ?? null,
      description: e.description ?? null,
      moved_from: e.movedFrom ?? null,
      moved_to: e.movedTo ?? null,
    });
  }
}
console.log(`  ${rows.length} history rows across ${fileCount} docs`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-history-"));
const sqlFile = path.join(TMP, "_node_history.sql");

console.log("Writing SQL…");
await writeBatched(
  sqlFile,
  "node_history",
  [
    "doc_id",
    "date",
    "commit_hash",
    "change_type",
    "pr_number",
    "pr_title",
    "pr_author",
    "pr_url",
    "summary",
    "description",
    "moved_from",
    "moved_to",
  ],
  rows,
);

console.log(`Applying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);
runFile(sqlFile);
fs.unlinkSync(sqlFile);
fs.rmdirSync(TMP);

console.log("Done.");
