#!/usr/bin/env bash
#
# pnpm processes:triage [--dry-run] [--issue N]
#
# Runs the processes-triage skill end-to-end:
#   1. Ensures clean working tree on main, pulls latest
#   2. Creates a branch
#   3. Launches Claude Code interactively with the triage prompt — you see it
#      work and can redirect mid-session. Exit with /exit or Ctrl-D when done.
#   4. If anything in public/processes*.json changed → commits, pushes, opens PR
#   5. If nothing changed → deletes the branch and returns to main
#
# --dry-run:
#   Skips the main sync, branch creation, commit, push, and PR steps.
#   Runs the skill in place on the current branch and shows the diff. Useful
#   for iterating on the skill prompt or testing locally.
#
# --issue N:
#   Optional. Links the PR to a GitHub issue (typically the `processes-review`
#   issue opened by atlas-update.yml) by appending `Closes #N` to the PR body.
#   The issue body and comments are NOT read — the skill regenerates the
#   authoritative candidate list locally via `pnpm processes:check`.
#
# Requires `claude` and `gh` on PATH (gh required when not --dry-run or when --issue is set).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
ISSUE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --issue) ISSUE="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -n "$ISSUE" ]; then
  if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
    echo "Error: --issue requires a numeric ID, got '$ISSUE'"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

command -v claude >/dev/null || { echo "Error: 'claude' CLI not on PATH"; exit 1; }

if [ "$DRY_RUN" -eq 0 ] || [ -n "$ISSUE" ]; then
  command -v gh >/dev/null || { echo "Error: 'gh' CLI not on PATH"; exit 1; }
fi

if [ "$DRY_RUN" -eq 0 ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree not clean. Commit or stash first."
    git status --short
    exit 1
  fi
fi

# Sanity-check the issue exists + carries the expected label. Body and
# comments are deliberately NOT fetched — the skill works off the local
# audit it regenerates itself; the issue ID is purely for PR linkage.
if [ -n "$ISSUE" ]; then
  echo "→ Verifying issue #${ISSUE}…"
  if ! gh issue view "$ISSUE" >/dev/null 2>&1; then
    echo "Error: issue #${ISSUE} not found"
    exit 1
  fi
  LABELS=$(gh issue view "$ISSUE" --json labels --jq '.labels[].name' | tr '\n' ' ')
  if ! echo " $LABELS " | grep -q ' processes-review '; then
    echo "Warning: issue #${ISSUE} does not have the 'processes-review' label (labels: ${LABELS})"
  fi
fi

DATE=$(date -u +%Y-%m-%d)

# ---------------------------------------------------------------------------
# Sync main + new branch (skipped in --dry-run)
# ---------------------------------------------------------------------------

if [ "$DRY_RUN" -eq 0 ]; then
  echo "→ Syncing main…"
  git fetch origin main --quiet
  git checkout main --quiet
  git pull --ff-only origin main --quiet

  BRANCH="processes-triage/${DATE}"
  # If branch already exists (re-running same day), append a suffix.
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    BRANCH="${BRANCH}-$(date -u +%H%M)"
  fi

  echo "→ Creating branch ${BRANCH}"
  git checkout -b "${BRANCH}" --quiet
else
  echo "→ Dry run on $(git rev-parse --abbrev-ref HEAD) — skipping main sync and branch creation."
fi

# ---------------------------------------------------------------------------
# Run the skill via headless Claude
# ---------------------------------------------------------------------------

PROMPT="Run the processes-triage skill. Read .cache/processes-audit.md (regenerate it first with pnpm processes:check). For each candidate, use atlas MCP tools to apply the research-doc methodology. Edit public/processes.json and public/processes-ignored.json directly. Do not commit or push — the wrapper script handles git. When the triage is complete, summarize what changed and stop."

echo "→ Launching Claude Code (interactive)…"
echo "  Exit with /exit or Ctrl-D when triage is complete."
echo ""
# Belt-and-suspenders: even though the prompt says "don't commit", block the
# git/gh write commands at the tool layer so the wrapper retains exclusive
# control over branch / commit / push / PR.
claude "${PROMPT}" \
  --disallowed-tools "Bash(git commit *)" "Bash(git push *)" "Bash(gh pr create *)" "Bash(gh issue close *)"

# ---------------------------------------------------------------------------
# Commit, push, PR
# ---------------------------------------------------------------------------

if git diff --quiet -- public/processes.json public/processes-ignored.json; then
  echo ""
  echo "→ No changes in public/processes*.json — nothing to triage."
  if [ "$DRY_RUN" -eq 0 ]; then
    git checkout main --quiet
    git branch -D "${BRANCH}" --quiet
  fi
  exit 0
fi

echo ""
echo "→ Changes in public/processes*.json:"
git diff --stat -- public/processes.json public/processes-ignored.json

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "→ Dry run — leaving changes uncommitted. Inspect with: git diff -- public/processes.json public/processes-ignored.json"
  exit 0
fi

git add public/processes.json public/processes-ignored.json
git commit -m "chore: triage process inventory (${DATE})" --quiet

echo "→ Pushing ${BRANCH}…"
git push -u origin "${BRANCH}" --quiet

BODY=$(cat <<'EOF'
Automated triage of the curated process inventory (`public/processes.json`).

Generated by `pnpm processes:triage` — Claude ran the `processes-triage` skill against the current atlas state.

**Review:**
- `public/processes.json` — added entries / category / shape / status
- `public/processes-ignored.json` — entries the classifier surfaced but are not real processes

__CLOSING_LINE__
EOF
)

if [ -n "$ISSUE" ]; then
  CLOSING_LINE="Closes #${ISSUE}."
else
  CLOSING_LINE='Merging this PR triggers `processes-autoclose.yml` which closes the open `processes-review` issue.'
fi
BODY="${BODY/__CLOSING_LINE__/$CLOSING_LINE}"

gh pr create \
  --title "Triage process inventory (${DATE})" \
  --body "${BODY}" \
  --base main \
  --head "${BRANCH}"

echo ""
echo "Done."
