#!/usr/bin/env bash
#
# Apply every migration to a THROWAWAY Postgres and assert the money functions
# behave — including the concurrency properties the jest suites cannot reach.
#
# WHY THIS EXISTS
# ---------------
# Until now there was no way to run a migration before pasting it into the
# Supabase SQL Editor of a live project. The cost of that showed up twice on
# 2026-08-10:
#
#   * 021 inserted a loan into cooperative_loans filling only raw_data, leaving
#     the native `status` and `amount` columns NULL. The adapter routes
#     .where('status', ...) to the COLUMN, so every loan created through it
#     would have been invisible to the admin approval queue — the guard working
#     perfectly while the loan disappeared. Caught by reading, not by testing,
#     and only because something else had already gone wrong.
#
#   * The consolidated deploy file silently omitted four migrations, because the
#     builder checked "expected but absent" and never "present but unlisted".
#
# Neither is the kind of thing a unit test with a mocked database can see. Both
# are trivial for a real one.
#
# WHAT IT DOES NOT DO
# -------------------
# It does not test the application. It answers two questions: do the migrations
# apply in order against a clean schema, and do the functions they create behave
# as their headers claim — including under concurrency, which is the whole point
# of most of them and is exactly what a mocked adapter cannot show you.
#
# It does not run 004 (row-level security) or 022 (CREATE INDEX CONCURRENTLY).
# 004 makes every subsequent assertion return zero rows, which would look like a
# failure of the thing under test rather than of the harness. 022 cannot run
# inside a transaction block and is applied separately in production too.
#
# USAGE
#   ./scripts/test-migrations.sh
#
# Requires a local postgres (brew install postgresql@16). It never touches a
# remote database: it initdb's a fresh cluster in a temp directory, runs on a
# non-default port, and removes it on exit.

set -uo pipefail

PGBIN="${PGBIN:-/usr/local/opt/postgresql@16/bin}"
[ -x "$PGBIN/psql" ] || PGBIN=/opt/homebrew/opt/postgresql@16/bin
if [ ! -x "$PGBIN/psql" ]; then
    echo "postgres not found. brew install postgresql@16, or set PGBIN." >&2
    exit 1
fi

PORT="${PGPORT_TEST:-55432}"
PGDATA_DIR="$(mktemp -d)/pgdata"
SOCK="$(mktemp -d)"
DB=migrationtest

cleanup() {
    "$PGBIN/pg_ctl" -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1
    rm -rf "$PGDATA_DIR" "$SOCK"
}
trap cleanup EXIT

Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -t -A -c "$1"; }

pass=0
fail=0
check() { # check <label> <expected> <actual>
    if [ "$2" = "$3" ]; then
        printf "  ok    %s\n" "$1"; pass=$((pass+1))
    else
        printf "  FAIL  %s\n        expected: %s\n        actual:   %s\n" "$1" "$2" "$3"; fail=$((fail+1))
    fi
}

echo "== starting throwaway postgres on port $PORT"
"$PGBIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
"$PGBIN/pg_ctl" -D "$PGDATA_DIR" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$PGDATA_DIR/log" start >/dev/null 2>&1
for _ in $(seq 1 30); do "$PGBIN/pg_isready" -h "$SOCK" -p "$PORT" >/dev/null 2>&1 && break; sleep 1; done
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -q -c "CREATE DATABASE $DB;" >/dev/null || exit 1

echo "== applying schema.sql"
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql >/dev/null || {
    echo "  FAIL  schema.sql did not apply"; exit 1; }

echo "== applying migrations, in the order build-deploy-sql.mjs defines"
# The order comes from that script rather than being repeated here, so the two
# cannot drift. 004 is skipped: see the header.
while read -r f; do
    case "$f" in 004_*) continue;; esac
    out=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "supabase/migrations/$f" 2>&1)
    if [ $? -eq 0 ]; then printf "  ok    %s\n" "$f"; pass=$((pass+1))
    else printf "  FAIL  %s\n%s\n" "$f" "$out"; fail=$((fail+1)); fi
done < <(node scripts/build-deploy-sql.mjs --order)

echo "== 020  debit_jsonb_balance_with_floor"
Q "INSERT INTO cooperative_members (id, raw_data) VALUES ('m1','{\"savingsBalance\":10000}');" >/dev/null
check "refuses a debit that would breach the floor" "f|10000|below_floor" \
      "$(Q "SELECT * FROM debit_jsonb_balance_with_floor('cooperative_members','m1','savingsBalance',6000,5000);")"
check "allows a debit landing exactly on the floor" "t|5000|" \
      "$(Q "SELECT * FROM debit_jsonb_balance_with_floor('cooperative_members','m1','savingsBalance',5000,5000);")"
# below_floor and insufficient_funds must stay distinct: the member HAS the
# money in one case and does not in the other, and telling them the wrong one is
# a lie either way.
check "reports insufficient_funds, not below_floor, when short" "f|5000|insufficient_funds" \
      "$(Q "SELECT * FROM debit_jsonb_balance_with_floor('cooperative_members','m1','savingsBalance',99999,5000);")"

echo "== 020  claim_versioned_update"
check "first caller claims"            "t|1" "$(Q "SELECT * FROM claim_versioned_update('cooperative_members','m1',0,'{\"note\":\"first\"}');")"
check "stale caller is refused"        "f|1" "$(Q "SELECT * FROM claim_versioned_update('cooperative_members','m1',0,'{\"note\":\"second\"}');")"
check "the loser's patch did not land" "first" "$(Q "SELECT raw_data->>'note' FROM cooperative_members WHERE id='m1';")"
# A missing record is a DIFFERENT failure from a lost claim. Confusing them
# tells a user to refresh and retry something that is not there.
check "missing record returns a null version" "f|" "$(Q "SELECT * FROM claim_versioned_update('cooperative_members','nope',0);")"

echo "== 021  claim_single_open_loan_application"
check "first application is inserted" "t|" \
      "$(Q "SELECT * FROM claim_single_open_loan_application('u1','L1','cooperative_loans','{\"memberId\":\"u1\",\"status\":\"pending\",\"amount\":1000}');")"
# THE regression check. Filling only raw_data leaves these NULL, and the adapter
# routes .where('status', ...) to the column — so the loan exists and the
# approval queue cannot see it.
check "native columns are populated from the row" "pending|1000.00" \
      "$(Q "SELECT status||'|'||amount FROM cooperative_loans WHERE id='L1';")"
check "an open coop loan blocks a general application" "f|L1" \
      "$(Q "SELECT * FROM claim_single_open_loan_application('u1','L2','document_collections','{\"userId\":\"u1\",\"status\":\"pending\"}','loan_applications');")"
check "a different borrower is unaffected" "t|" \
      "$(Q "SELECT * FROM claim_single_open_loan_application('u2','L3','cooperative_loans','{\"memberId\":\"u2\",\"status\":\"pending\",\"amount\":50}');")"

echo "== concurrency — the property the jest suites cannot reach"
# Two sessions, the second starting while the first holds its lock. If the
# locking works the second BLOCKS and then sees the first's effect. Under the
# code these functions replace, both proceeded.
Q "INSERT INTO cooperative_members (id, raw_data) VALUES ('r1','{\"savingsBalance\":1000}');" >/dev/null
(
  "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -t -A >/dev/null 2>&1 <<EOF
BEGIN;
SELECT * FROM debit_jsonb_balance_with_floor('cooperative_members','r1','savingsBalance',600,0);
SELECT pg_sleep(3);
COMMIT;
EOF
) &
sleep 1
t0=$(date +%s)
# `SELECT ok, reason` and not `ok||'|'||reason`: concatenating a boolean to
# text renders it "false", while the tuple output of a boolean column is "f".
# The first draft asserted against the wrong one.
b=$(Q "SELECT ok, COALESCE(reason,'') FROM debit_jsonb_balance_with_floor('cooperative_members','r1','savingsBalance',600,0);")
t1=$(date +%s)
wait
check "second debit is refused rather than overdrawing" "f|insufficient_funds" "$b"
check "balance is 400, not -200"                        "400" "$(Q "SELECT raw_data->>'savingsBalance' FROM cooperative_members WHERE id='r1';")"
if [ $((t1-t0)) -ge 2 ]; then
    printf "  ok    second session BLOCKED on the row lock (%ss)\n" "$((t1-t0))"; pass=$((pass+1))
else
    printf "  FAIL  second session did not block (%ss) — the lock is not holding\n" "$((t1-t0))"; fail=$((fail+1))
fi

echo "== 023 — the academy field-rename backfill"
# A DATA migration, not a function, so it needs fixtures rather than a call.
#
# It is worth testing here for the same reason 021 was: the failure mode is a
# row that exists and cannot be seen, which no assertion against a mocked
# adapter reaches. Part 2 also runs an aggregate cast over JSONB, and a single
# non-numeric value there would abort the whole migration part-way.
Q "INSERT INTO document_collections (id, collection_name, raw_data) VALUES
   ('u1_c1','course_progress','{\"resolvedUserId\":\"u1\",\"courseId\":\"c1\",\"progressPercent\":0,\"completionPercentage\":0,\"completed\":false,\"completedAt\":null}'),
   ('u1_l1','lesson_video_progress','{\"userId\":\"u1\",\"courseId\":\"c1\",\"lessonId\":\"l1\",\"progressPercent\":100,\"completed\":true}'),
   ('u1_l2','lesson_video_progress','{\"userId\":\"u1\",\"courseId\":\"c1\",\"lessonId\":\"l2\",\"progressPercent\":50,\"completed\":false}'),
   ('u2_c1','course_progress','{\"userId\":\"u2\",\"courseId\":\"c1\",\"progressPercent\":73}'),
   ('u3_c1','course_progress','{\"userId\":\"u3\",\"resolvedUserId\":\"u3\",\"courseId\":\"c1\",\"progressPercent\":12}'),
   ('u4_c1','course_progress','{\"resolvedUserId\":\"u4\",\"courseId\":\"c9\",\"progressPercent\":0}'),
   ('u4_l1','lesson_video_progress','{\"userId\":\"u4\",\"courseId\":\"c9\",\"lessonId\":\"l1\",\"progressPercent\":\"n/a\"}'),
   ('u1_sub','user_progress/u1/courses','{\"resolvedUserId\":\"u1\",\"courseId\":\"c1\"}'),
   ('u5_c1','course_progress','{\"resolvedUserId\":\"u5\",\"courseId\":\"c1\",\"progressPercent\":0,\"completed\":false}'),
   ('u5_l1','lesson_video_progress','{\"userId\":\"u5\",\"courseId\":\"c1\",\"lessonId\":\"l1\",\"progressPercent\":100,\"completed\":true}'),
   ('u5_l2','lesson_video_progress','{\"userId\":\"u5\",\"courseId\":\"c1\",\"lessonId\":\"l2\",\"progressPercent\":100,\"completed\":true}'),
   ('e1','course_enrollments','{\"userId\":\"u1\",\"courseId\":\"c1\",\"status\":\"active\"}'),
   ('e2','course_enrollments','{\"resolvedUserId\":\"u1\",\"courseId\":\"c1\",\"status\":\"active\"}');" >/dev/null

"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
    -f supabase/migrations/023_academy_resolved_user_id_backfill.sql >/dev/null 2>&1 \
    || { printf "  FAIL  023 did not apply\n"; fail=$((fail+1)); }

check "no resolvedUserId survives, in any collection" "0" \
      "$(Q "SELECT COUNT(*) FROM document_collections WHERE raw_data ? 'resolvedUserId';")"
check "the subcollection row was renamed too" "u1" \
      "$(Q "SELECT raw_data->>'userId' FROM document_collections WHERE id='u1_sub';")"
check "a row holding both keys keeps its userId" "u3" \
      "$(Q "SELECT raw_data->>'userId' FROM document_collections WHERE id='u3_c1';")"
# The lessons say 100 and 50, so the course figure comes back as 75.
check "zeroed progress is restored from the lesson records" "75" \
      "$(Q "SELECT raw_data->>'progressPercent' FROM document_collections WHERE id='u1_c1';")"
# THE assertion. Restoring this would mint a certificate the platform then
# vouches for publicly, from a number a migration guessed.
#
# u5 is the fixture that makes this bite: BOTH their lessons are at 100, so any
# rule that infers completion from the lesson records would set it. The first
# version of this check used u1, whose average is 75 — it passed against a
# deliberately mutated migration that DID restore completion, because that
# fixture never crossed the threshold. An assertion that cannot fail is not one.
check "completion is NOT restored, even at 100% lessons" "false" \
      "$(Q "SELECT raw_data->>'completed' FROM document_collections WHERE id='u5_c1';")"
check "and its percentage still is restored" "100" \
      "$(Q "SELECT raw_data->>'progressPercent' FROM document_collections WHERE id='u5_c1';")"
check "a learner who has since progressed is untouched" "73" \
      "$(Q "SELECT raw_data->>'progressPercent' FROM document_collections WHERE id='u2_c1';")"
check "a non-numeric lesson value does not abort the run" "0" \
      "$(Q "SELECT raw_data->>'progressPercent' FROM document_collections WHERE id='u4_c1';")"
check "duplicate enrolments are reported, not deleted" "2" \
      "$(Q "SELECT COUNT(*) FROM document_collections WHERE collection_name='course_enrollments';")"

"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
    -f supabase/migrations/023_academy_resolved_user_id_backfill.sql >/dev/null 2>&1
check "re-running changes nothing (idempotent)" "75|13" \
      "$(Q "SELECT (SELECT raw_data->>'progressPercent' FROM document_collections WHERE id='u1_c1')||'|'||(SELECT COUNT(*) FROM document_collections);")"

echo
echo "== $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
