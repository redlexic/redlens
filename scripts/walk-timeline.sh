#!/usr/bin/env bash
# Atlas commit walk: jumps back 5 commits at a time, runs build:at + pnpm test.
# Bisects to find exact breaking commit when new failures appear.
# Stops when <50% of baseline tests pass OR 100 commits traversed.

set -euo pipefail

ROOT="/Users/m7/lens"
LOG_DIR="/tmp/atlas-walk"
RESULTS="$LOG_DIR/results.txt"

mkdir -p "$LOG_DIR"
> "$RESULTS"

cd "$ROOT"

COMMITS=($(git -C vendor/next-gen-atlas log --format="%H"))
TOTAL=${#COMMITS[@]}
echo "Atlas: $TOTAL commits total"
echo "Walking up to 100 commits back, 5 at a time"
echo ""

BASELINE_PASS=65
MIN_PASS=32  # <50% of 65

run_and_test() {
  local sha="$1"
  local short="${sha:0:12}"
  local log="$LOG_DIR/${short}.log"

  # Build (exit 0 even on build failure — we report it)
  if ! pnpm build:at "$sha" > "$log" 2>&1; then
    echo "BUILD_FAILED 0 99"
    return
  fi

  # Test
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

prev_i=0
prev_fail=0

for (( i=0; i<=100 && i<TOTAL; i+=5 )); do
  sha="${COMMITS[$i]}"
  short="${sha:0:12}"
  msg=$(git -C vendor/next-gen-atlas log --format="%s" -1 "$sha")

  printf "\n[%3d] %s  %s\n" "$i" "$short" "$msg"

  read -r status passed failed <<< "$(run_and_test "$sha")"
  printf "      %s  pass=%-3s  fail=%-3s\n" "$status" "$passed" "$failed"
  printf "MAIN %d %s %s %s %s | %s\n" "$i" "$short" "$status" "$passed" "$failed" "$msg" >> "$RESULTS"

  # Bisect if new failures appeared
  if [[ "$failed" -gt 0 && "$prev_fail" -eq 0 ]]; then
    echo "  *** BREAK between commits $prev_i...$i — bisecting ***"
    BISECT_FOUND=0
    for (( j=prev_i+1; j<i; j++ )); do
      bsha="${COMMITS[$j]}"
      bshort="${bsha:0:12}"
      bmsg=$(git -C vendor/next-gen-atlas log --format="%s" -1 "$bsha")
      printf "  bisect[%d] %s  %s\n" "$j" "$bshort" "$bmsg"
      read -r bs bp bf <<< "$(run_and_test "$bsha")"
      printf "           %s  pass=%-3s  fail=%-3s\n" "$bs" "$bp" "$bf"
      printf "BISECT %d %s %s %s %s | %s\n" "$j" "$bshort" "$bs" "$bp" "$bf" "$bmsg" >> "$RESULTS"
      if [[ "$bf" -gt 0 && "$BISECT_FOUND" -eq 0 ]]; then
        echo "  >>> BREAKS AT [$j] $bshort: $bmsg <<<"
        printf "BREAK %d %s %s %s | %s\n" "$j" "$bshort" "$bs" "$bp" "$bmsg" >> "$RESULTS"
        BISECT_FOUND=1
      fi
    done
  fi

  # Stop if <50% passing
  if [[ "$passed" -lt "$MIN_PASS" ]]; then
    echo "STOP: only $passed tests passing (< $MIN_PASS threshold)"
    printf "STOP_LOW_PASS %d %s %s\n" "$i" "$short" "$passed" >> "$RESULTS"
    break
  fi

  prev_i=$i
  prev_fail="$failed"
done

echo ""
echo "Restoring submodule to pinned commit..."
git submodule update

echo ""
echo "=== WALK COMPLETE ==="
echo ""
cat "$RESULTS"
