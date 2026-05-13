---
name: processes-triage
description: >
  Runbook for reconciling the curated process inventory (data/processes.json)
  against atlas drift. Triggered when a GitHub issue with the
  "processes-review" label is open, or by phrases like "triage the processes
  issue", "review process candidates", "reconcile process inventory",
  "process inventory drift". Covers running the dirty check, applying the
  research-doc methodology to each candidate using atlas MCP tools, and
  editing data/processes.json + data/processes-ignored.json in place.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# processes-triage

The curated process inventory lives in `data/processes.json` (55 hand-validated process nodes from `docs/process-inventory.md`). When the atlas changes, `scripts/required/check-processes-dirty.mjs` surfaces three categories of drift; this skill is the runbook for reconciling them locally.

## Inputs

- `data/processes.json` — curated list (source of truth)
- `data/processes-ignored.json` — UUIDs that matched the keyword classifier but are explicitly not processes
- `.cache/processes-audit.json` + `.cache/processes-audit.md` — written by the dirty check
- `public/docs.json` — current atlas state (used by atlas MCP tools)

## Drift categories

1. **Auto-applied snapshot updates** — title / doc_no changed for a UUID that still exists. The dirty check already wrote these to `data/processes.json`. No action needed; skim them for sanity.
2. **Missing UUIDs** — curated entry's UUID is gone. Likely renamed, merged, or deleted. Decide rename vs. delete.
3. **New candidates** — keyword classifier hits that aren't in the curated or ignored lists. Decide add vs. ignore.

## Runbook

### 1. Refresh state

```bash
pnpm processes:check
```

This rewrites `.cache/processes-audit.{json,md}` and auto-applies title/doc_no snapshot updates. Read the markdown for the candidate list.

### 2. Apply the research-doc methodology

For each new candidate, fetch context via atlas MCP and decide:

**A node is a PROCESS only if it (or its children) describes an ordered sequence where sequence matters** — steps, phases, stages, a cycle breakdown, a workflow.

Use `atlas_get` for content and `atlas_neighbors` (or `atlas_traverse` with `parent_of` reversed) to read children. Look for:

- **Positive signals**: child nodes titled "Step N", "Stage N", "Phase N"; inline content with "First, … Then, … Finally, …"; explicit calendar references (Mon W1 → Fri W1); explicit "Process Definition" doc structure
- **Negative signals**: schema/template (e.g. `Primitive Process Definition Schema` at A.2.2.2 is the template, not a process); category container that groups multiple sub-processes without itself being sequential; stub that defers to another doc (`*see other documentation*`); requirement spec or role definition; annotation/action tenet/scenario (already filtered by type, but double-check)

### 3. Classify

For each candidate, write either an **add** entry into `data/processes.json` or an **ignore** entry into `data/processes-ignored.json`. Schema:

**`processes.json` entry:**
```json
{
  "uuid": "...",
  "category": "Governance & Voting Cycles | Executive & Spell Processes | Settlement & Financial | Agent & Primitive Lifecycle | Personnel & Delegation | Collateral & Asset Management | Dispute & Emergency | Artifact & Atlas Governance | <or a new one>",
  "shape": "child | inline",
  "status": "active | deferred-stub",
  "title_at_curation": "<current atlas title>",
  "doc_no_at_curation": "<current atlas doc_no>"
}
```

- `shape: "child"` — steps are atlas children of this node (most common)
- `shape: "inline"` — steps are described in this node's own content, not as children
- `status: "deferred-stub"` — node explicitly defers to another doc; include in inventory but flag as incomplete

**`processes-ignored.json` entry:**
```json
{
  "uuid": "...",
  "reason": "schema template | category container | role definition | requirement spec | other (specify)",
  "title_when_ignored": "<current atlas title>"
}
```

### 4. Resolve missing UUIDs

For each `missing_uuids` entry:

- Use `atlas_search` with the entry's old title to find a likely replacement. Compare doc_no, parent chain, and content.
- If a clear successor exists → **rename**: update the `uuid` field on the existing entry in `processes.json`. The snapshot fields will auto-update on the next dirty check.
- If no successor → **delete**: remove the entry entirely.

### 5. Sort + diff + handoff

The dirty check sorts `processes.json` on auto-update, but if you added entries by hand they may be out of order. Sort by category, then `doc_no_at_curation` (numeric). Then:

```bash
pnpm processes:check    # verify clean (no new candidates, no missing UUIDs)
git diff data/
```

Show the diff and a short summary to the user. **Don't commit** — let them sign off. End with: "Review `git diff data/`, commit + push, then close issue #N."

## Constraints

- **Never invent UUIDs** — always copy from `.cache/processes-audit.json` or look up via atlas MCP. UUIDs are 36-char canonical UUIDs (matching the keys in `public/docs.json`).
- **Don't add categories liberally** — prefer reusing an existing category. New categories are fine but should describe a distinct cluster, not a one-off node.
- **Stubs are real entries** — `status: "deferred-stub"` means it's in the inventory but its content is incomplete. Don't ignore stubs just because they don't have step children; check content for the "defers to" pattern.
- **The keyword classifier is conservative** — many real processes have generic titles ("Implementation", "Setup") and won't be caught. If the user mentions a process they expect to see and it's missing, search the atlas with `atlas_search` and add by hand.

## File map

- `scripts/required/check-processes-dirty.mjs` — the dirty check; runs in atlas-update CI and locally
- `scripts/lib/process-keywords.mjs` — keyword list + type/title/ancestor filters
- `scripts/aux/processes-bootstrap.mjs` — one-shot rebuilder from `docs/process-inventory.md` (rarely needed)
- `docs/process-inventory.md` — original research doc with the 55 seed processes and methodology
