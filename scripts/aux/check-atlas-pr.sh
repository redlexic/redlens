#!/usr/bin/env bash
# check-atlas-pr.sh — build + test RedLens at the head commit of a next-gen-atlas PR.
#
# Usage:
#   pnpm check:pr <pr-number>
#   bash scripts/aux/check-atlas-pr.sh <pr-number>
#
# Only OPEN PRs are eligible. Closed / merged PRs are rejected.
#
# On success: writes .cache/pr-check/pr<N>-<sha7>.md with a relationship-delta
#             summary for the agent to describe, then exits 0.
# On failure: writes the same report with the build log and diagnosis hints,
#             then exits 1.
#
# Atlas submodule stays at the PR head SHA after the run. To restore:
#   git submodule update

set -euo pipefail

ATLAS_REPO="sky-ecosystem/next-gen-atlas"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ATLAS_DIR="$ROOT/vendor/next-gen-atlas"
CACHE_DIR="$ROOT/.cache/pr-check"
PUBLIC="$ROOT/public"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
PR="${1:-}"
if [[ -z "$PR" || ! "$PR" =~ ^[0-9]+$ ]]; then
  cat >&2 <<'USAGE'
Usage: check-atlas-pr <pr-number>

Builds and tests RedLens at the head commit of an open
sky-ecosystem/next-gen-atlas PR, then reports failures or
relationship changes.

Only OPEN PRs are eligible.
USAGE
  exit 1
fi

# ---------------------------------------------------------------------------
# Fetch PR metadata (gh ships its own jq; no external dep)
# ---------------------------------------------------------------------------
echo "Fetching PR #$PR from $ATLAS_REPO ..."
HEAD_SHA=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json headRefOid --jq '.headRefOid')
PR_TITLE=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json title     --jq '.title')
PR_STATE=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json state     --jq '.state')
PR_URL=$(gh  pr view "$PR" --repo "$ATLAS_REPO" --json url        --jq '.url')
SHA7="${HEAD_SHA:0:7}"
REDLENS_BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)

echo "PR #$PR: $PR_TITLE"
echo "State:   $PR_STATE"
echo "SHA:     $HEAD_SHA"
echo "URL:     $PR_URL"
echo ""

# ---------------------------------------------------------------------------
# Guard: only open PRs
# ---------------------------------------------------------------------------
if [[ "$PR_STATE" != "OPEN" ]]; then
  echo "ERROR: PR #$PR is $PR_STATE. Only OPEN PRs are supported." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
mkdir -p "$CACHE_DIR"
REPORT="$CACHE_DIR/pr${PR}-${SHA7}.md"

BASELINE=$(mktemp)
BUILD_LOG=$(mktemp)
trap 'rm -f "$BASELINE" "$BUILD_LOG"' EXIT

# Snapshot relations.json — valid baseline only when manifest.json records the
# same atlas commit as the currently pinned submodule. A stale or absent
# manifest means public/ is from a different build; use null so the success
# report shows absolute counts with a note instead of a meaningless diff.
PINNED_SHA=$(git -C "$ATLAS_DIR" rev-parse HEAD)
MANIFEST_COMMIT=$(node -e "
  try {
    const m = JSON.parse(require('fs').readFileSync(process.env.MF, 'utf8'));
    process.stdout.write(m.atlasCommit ?? '');
  } catch { process.stdout.write(''); }
" MF="$PUBLIC/manifest.json" 2>/dev/null || true)

if [[ -n "$MANIFEST_COMMIT" && "$MANIFEST_COMMIT" == "$PINNED_SHA" && -f "$PUBLIC/relations.json" ]]; then
  cp "$PUBLIC/relations.json" "$BASELINE"
else
  printf 'null' > "$BASELINE"
  if [[ -f "$PUBLIC/relations.json" ]]; then
    echo "(baseline skipped: public/ is from a different atlas commit; delta will show absolute counts)"
  fi
fi

# ---------------------------------------------------------------------------
# Failure report writer
# ---------------------------------------------------------------------------
write_failure_report() {
  local phase="$1"
  {
    echo "# Atlas PR check — FAILED"
    echo ""
    echo "**PR:** [#${PR} ${PR_TITLE}](${PR_URL}) \`${PR_STATE}\`"
    echo "**Atlas SHA:** \`${HEAD_SHA}\`"
    echo "**Failed phase:** \`${phase}\`"
    echo "**RedLens branch:** \`${REDLENS_BRANCH}\`"
    echo ""
    echo "## Build log"
    echo ""
    echo '```'
    cat "$BUILD_LOG"
    echo '```'
  } > "$REPORT"

  echo "" >&2
  echo "FAILED: $phase" >&2
  echo "Report: $REPORT" >&2
}

# ---------------------------------------------------------------------------
# Pre-fetch the PR head ref into the atlas submodule.
# GitHub creates refs/pull/<N>/head for every PR including forks, so this
# ensures build:at's `git checkout <sha>` resolves even for non-branch SHAs.
# ---------------------------------------------------------------------------
echo "Fetching atlas PR head ref ..."
git -C "$ATLAS_DIR" fetch origin "+refs/pull/${PR}/head:refs/remotes/origin/pr/${PR}" --quiet

# ---------------------------------------------------------------------------
# Phase 1: build pipeline at the PR's atlas SHA
# ---------------------------------------------------------------------------
echo ""
echo "=== build:at ${SHA7} ==="
(cd "$ROOT" && pnpm build:at "$HEAD_SHA") 2>&1 | tee -a "$BUILD_LOG" \
  || { write_failure_report "build:at ${SHA7}"; exit 1; }

# ---------------------------------------------------------------------------
# Phase 2: test suite
# ---------------------------------------------------------------------------
echo ""
echo "=== pnpm test ==="
(cd "$ROOT" && pnpm test) 2>&1 | tee -a "$BUILD_LOG" \
  || { write_failure_report "pnpm test"; exit 1; }

# ---------------------------------------------------------------------------
# Success: compute relationship delta
# ---------------------------------------------------------------------------
DELTA=$(BASELINE_FILE="$BASELINE" RELATIONS="$PUBLIC/relations.json" \
  node --input-type=module <<'JS'
import { readFileSync } from "fs";

const baseline = JSON.parse(readFileSync(process.env.BASELINE_FILE, "utf8"));
const current  = JSON.parse(readFileSync(process.env.RELATIONS,      "utf8"));

function countByKey(items, key) {
  const out = {};
  for (const item of items ?? []) {
    const k = item[key] ?? "(unknown)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const oldEnt = baseline ? countByKey(baseline.entities, "entity_type") : {};
const newEnt =            countByKey(current.entities,  "entity_type");
const oldEdge = baseline ? countByKey(baseline.edges,   "edge_type")   : {};
const newEdge =             countByKey(current.edges,   "edge_type");

const allEntTypes  = new Set([...Object.keys(oldEnt),  ...Object.keys(newEnt)]);
const allEdgeTypes = new Set([...Object.keys(oldEdge), ...Object.keys(newEdge)]);

function deltas(oldC, newC, allKeys) {
  const rows = [];
  for (const t of [...allKeys].sort()) {
    const d = (newC[t] ?? 0) - (oldC[t] ?? 0);
    if (d !== 0) rows.push({ type: t, before: oldC[t] ?? 0, after: newC[t] ?? 0, delta: d });
  }
  return rows;
}

const entDeltas  = deltas(oldEnt,  newEnt,  allEntTypes);
const edgeDeltas = deltas(oldEdge, newEdge, allEdgeTypes);
const newEntTypes  = [...allEntTypes].filter(t => !oldEnt[t]  && newEnt[t]);
const newEdgeTypes = [...allEdgeTypes].filter(t => !oldEdge[t] && newEdge[t]);

const lines = [];

const noBaseline = !baseline;

lines.push("### Entities");
if (noBaseline) {
  lines.push("_(no baseline — first run; showing current counts)_");
  for (const [t, n] of Object.entries(newEnt).sort()) lines.push(`- ${t}: ${n}`);
} else if (entDeltas.length === 0) {
  lines.push("No change.");
} else {
  for (const { type, before, after, delta } of entDeltas) {
    lines.push(`- **${type}**: ${before} → ${after} (${delta > 0 ? "+" : ""}${delta})`);
  }
}
if (newEntTypes.length) lines.push(`\n> New entity types: ${newEntTypes.join(", ")}`);

lines.push("");
lines.push("### Edges by type");
if (noBaseline) {
  lines.push("_(no baseline — first run; showing current counts)_");
  for (const [t, n] of Object.entries(newEdge).sort()) lines.push(`- ${t}: ${n}`);
} else if (edgeDeltas.length === 0) {
  lines.push("No change.");
} else {
  for (const { type, before, after, delta } of edgeDeltas) {
    lines.push(`- **${type}**: ${before} → ${after} (${delta > 0 ? "+" : ""}${delta})`);
  }
}
if (newEdgeTypes.length) lines.push(`\n> New edge types: ${newEdgeTypes.join(", ")}`);

const totalEnt  = Object.values(newEnt).reduce((a, b) => a + b, 0);
const totalEdge = Object.values(newEdge).reduce((a, b) => a + b, 0);
lines.push("");
lines.push(`### Totals: ${totalEnt} entities · ${totalEdge} edges`);

process.stdout.write(lines.join("\n"));
JS
)

# Write success report
{
  echo "# Atlas PR check — PASSED"
  echo ""
  echo "**PR:** [#${PR} ${PR_TITLE}](${PR_URL}) \`${PR_STATE}\`"
  echo "**Atlas SHA:** \`${HEAD_SHA}\`"
  echo "**RedLens branch:** \`${REDLENS_BRANCH}\`"
  echo ""
  echo "## Relationship delta"
  echo ""
  echo "$DELTA"
} > "$REPORT"

echo ""
echo "All checks passed for atlas PR #${PR} (${SHA7})."
echo ""
echo "Report: $REPORT"
echo ""
echo "Atlas submodule is now at ${HEAD_SHA}."
echo "To restore the pinned commit: git submodule update"
