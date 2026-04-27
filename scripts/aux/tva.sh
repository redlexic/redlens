#!/usr/bin/env bash
# TVA — Time Variance Authority -- Protecting The Atlas Timeline
#
# Walks atlas git history newest→oldest, rebuilds artifacts at each commit,
# and runs the full test suite. Reveals exactly when each test failure was
# introduced and how the atlas evolved over time.
#
# Usage:
#   pnpm tva                  # walk up to 100 commits, logs to /tmp/tva/
#   MAX_COMMITS=50 pnpm tva   # shorter walk
#   LOG_DIR=./tva-out pnpm tva
#
# Stop condition: a SUCCESSFUL build where <50% of baseline tests pass.
# BUILD_FAILED commits are logged and skipped — they do not trigger the stop.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${LOG_DIR:-/tmp/tva}"
RESULTS="$LOG_DIR/results.txt"
MAX_COMMITS="${MAX_COMMITS:-100}"

BASELINE_PASS=67
MIN_PASS=$(( BASELINE_PASS / 2 ))  # <50% triggers stop

mkdir -p "$LOG_DIR"
> "$RESULTS"

cd "$ROOT"

COMMITS=($(git -C vendor/next-gen-atlas log --format="%H"))
TOTAL=${#COMMITS[@]}
echo "TVA — Time Variance Authority"
echo "Atlas: $TOTAL commits total"
echo "Walking up to $MAX_COMMITS commits, newest→oldest"
echo "Baseline: $BASELINE_PASS | Stop threshold: <$MIN_PASS"
echo "Logs: $LOG_DIR"
echo ""

run_and_test() {
  local sha="$1"
  local short="${sha:0:12}"
  local log="$LOG_DIR/${short}.log"

  if ! pnpm build:at "$sha" > "$log" 2>&1; then
    echo "BUILD_FAILED 0 99"
    return
  fi

  local test_out
  test_out=$(pnpm test 2>&1 || true)
  printf "\n--- TEST OUTPUT ---\n%s\n" "$test_out" >> "$log"

  local passed failed
  passed=$(echo "$test_out" | grep " Tests " | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1 || true)
  failed=$(echo "$test_out"  | grep " Tests " | grep -oE '[0-9]+ failed'  | grep -oE '[0-9]+' | head -1 || true)
  passed=${passed:-0}
  failed=${failed:-0}

  echo "OK $passed $failed"
}

for (( i=0; i<MAX_COMMITS && i<TOTAL; i+=1 )); do
  sha="${COMMITS[$i]}"
  short="${sha:0:12}"
  msg=$(git -C vendor/next-gen-atlas log --format="%s" -1 "$sha")

  printf "\n[%3d] %s  %s\n" "$i" "$short" "$msg"

  read -r status passed failed <<< "$(run_and_test "$sha")"
  printf "      %s  pass=%-3s  fail=%-3s\n" "$status" "$passed" "$failed"
  printf "%d %s %s %s %s | %s\n" "$i" "$short" "$status" "$passed" "$failed" "$msg" >> "$RESULTS"

  # Only stop on low pass count when the build actually succeeded.
  if [[ "$status" == "OK" && "$passed" -lt "$MIN_PASS" ]]; then
    echo "STOP: only $passed tests passing (< $MIN_PASS threshold)"
    break
  fi
done

echo ""
echo "Restoring submodule to pinned commit..."
git submodule update

echo ""
echo "=== TVA WALK COMPLETE ==="
echo ""
cat "$RESULTS"
