#!/usr/bin/env bash
#
# Run the cooperative member-name backfill and keep the evidence.
#
# WHY THIS EXISTS WHEN THE SCRIPT IS ALREADY REPORT-ONLY
# ------------------------------------------------------
# backfill-member-names.ts already defaults to reporting and already prints the
# host it is about to write to, per the #329 convention. This wrapper adds the
# one thing that convention does not: a RECORD.
#
# A repair run during the #715 audit matched 52 members from their live
# profiles and wrote 41 names that were the literal string "Unknown Member".
# It was caught after the write and reverted — 41 rows cleared, 11 real names
# kept. What made the revert possible was knowing exactly which rows had been
# touched. That knowledge came from scrollback, which is not a place to keep it.
#
# So: every run is captured to a file, and an --apply run captures the report
# BEFORE and AFTER the write. The after-report is the thing worth having; a
# second run should name zero members, and if it names any, the diff says which.
#
# WHAT THIS DELIBERATELY DOES NOT DO
# -----------------------------------
# It does not re-implement the target-host guard or the --apply gate.
# _maintenance-guard.ts is the one copy of those, and the whole point of that
# module is that a fifth hand-rolled "am I allowed to write" does not appear.
# This wrapper cannot make the run safer than that guard makes it; it can only
# make the run legible afterwards.
#
# It also does not parse the report or decide anything from it. Reading it is
# the operator's job — that is what report-only is FOR.
#
#   ./scripts/backfill-member-names-run.sh                    report, captured
#   ./scripts/backfill-member-names-run.sh --apply --yes-write write, captured
#
set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="${BACKFILL_RUN_DIR:-maintenance-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

APPLY=0
CONFIRMED=0
for arg in "$@"; do
    case "$arg" in
        --apply)     APPLY=1 ;;
        --yes-write) CONFIRMED=1 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

#   TWO FLAGS, NOT ONE, AND ONLY HERE.
#
#   The script's own --apply is the gate that matters and it is not weakened by
#   this. The second flag exists because a wrapper is the kind of thing somebody
#   reaches for from shell history, where `--apply` is one arrow-up away from a
#   report. It is not a security control; it is a speed bump in the one place a
#   speed bump is cheap.
if [ "$APPLY" = 1 ] && [ "$CONFIRMED" = 0 ]; then
    cat >&2 <<'MSG'
Refusing to write.

  --apply was passed without --yes-write.

  Run the report first and read it. 41 rows were once written from a run
  nobody had read, and every one of them said "Unknown Member".

      ./scripts/backfill-member-names-run.sh

  Then, if the report is what you expect:

      ./scripts/backfill-member-names-run.sh --apply --yes-write
MSG
    exit 2
fi

#   `tee`, not `>`. The banner naming the target database is the operator's
#   main safety signal and it belongs on screen while the run happens, not only
#   in a file read afterwards.
#
#   PIPESTATUS because a pipeline's exit code is tee's, and a wrapper that
#   reports success the underlying script did not achieve is the exact fault
#   _maintenance-guard was written to remove.
run_capture() {
    local label="$1"; shift
    local path="$OUT_DIR/${STAMP}-${label}.txt"
    echo "── ${label} → ${path}"
    set +e
    npm run backfill:membernames -- "$@" 2>&1 | tee "$path"
    local status="${PIPESTATUS[0]}"
    set -e
    if [ "$status" -ne 0 ]; then
        echo "✗ ${label} FAILED (exit ${status}). Captured: ${path}" >&2
        return "$status"
    fi
    echo "✓ ${label} captured: ${path}"
}

if [ "$APPLY" = 1 ]; then
    run_capture "1-before"
    run_capture "2-apply" --apply
    #   The one that earns the wrapper. A clean second report names zero
    #   members; anything it does name is a row the write did not settle.
    run_capture "3-after"
    echo
    echo "Before / after are both in $OUT_DIR. Compare them:"
    echo "  diff ${OUT_DIR}/${STAMP}-1-before.txt ${OUT_DIR}/${STAMP}-3-after.txt"
else
    run_capture "report"
    echo
    echo "Report only — nothing was written."
    echo "To write, after reading the file above:"
    echo "  $0 --apply --yes-write"
fi
