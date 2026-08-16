#!/usr/bin/env bash
#
# Type-check with strictNullChecks and noImplicitAny ON, and fail if the number
# of errors has gone UP since the baseline below.
#
# WHY A RATCHET RATHER THAN A GATE
# --------------------------------
# tsconfig.json has both flags off. Turning them on outright fails the build
# today, and a check that cannot be made green gets deleted or ignored. This
# holds the line instead: existing errors are tolerated, new ones are not.
#
# The count only ever moves down. When it reaches zero, set both flags in
# tsconfig.json, delete tsconfig.strict.json, and delete this script.
#
#   npm run typecheck:strict          check against the baseline
#   npm run typecheck:strict -- list  print the remaining errors
#
# LOWER THE BASELINE WHEN YOU FIX SOMETHING. That is the entire mechanism; a
# baseline nobody lowers is just a disabled check with extra steps.

set -euo pipefail
cd "$(dirname "$0")/.."

# The number of errors remaining. Was 132 when the flags were first turned on.
BASELINE=60

OUT="$(npx tsc -p tsconfig.strict.json --noEmit 2>&1 || true)"
COUNT="$(printf '%s\n' "$OUT" | grep -c 'error TS' || true)"

if [ "${1:-}" = "list" ]; then
    printf '%s\n' "$OUT" | grep 'error TS' || true
    echo
    echo "── by error code ──"
    printf '%s\n' "$OUT" | grep -oE 'error TS[0-9]+' | sort | uniq -c | sort -rn
    echo
fi

echo "strict type errors: $COUNT (baseline $BASELINE)"

if [ "$COUNT" -gt "$BASELINE" ]; then
    echo
    echo "❌ $((COUNT - BASELINE)) NEW strict type error(s)."
    echo "   Run 'npm run typecheck:strict -- list' to see them."
    echo "   These are the defects that reach production: a call to a method that"
    echo "   does not exist, or a read of a value that may be undefined."
    exit 1
fi

if [ "$COUNT" -lt "$BASELINE" ]; then
    echo
    echo "✅ $((BASELINE - COUNT)) fewer than the baseline."
    echo "   Lower BASELINE in scripts/typecheck-strict.sh to $COUNT so the"
    echo "   progress is locked in."
    exit 1
fi

echo "✅ No new strict type errors."
