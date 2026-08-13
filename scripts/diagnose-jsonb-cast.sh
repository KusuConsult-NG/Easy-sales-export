#!/usr/bin/env bash
#
# TEMPORARY. Asks PostgREST which JSONB numeric-cast filter syntax it honours.
#
# adapter-semantics.test.ts "compares numbers as numbers, not as text" failed on
# its first execution with [90000] where [1000, 1500, 90000] was expected —
# exactly the text-comparison answer, because '1000' and '1500' sort before
# '900'. supabase-db.ts builds `raw_data->>"amount"::numeric` and believes that
# casts. The result says it does not.
#
# Guessing the right syntax costs a CI round trip each. This asks.
#
# Delete once the answer is in the adapter.

set -uo pipefail

API="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "== seeding amounts 50, 900, 1000, 1500, 90000 into document_collections"
psql "$DB_URL" -q <<'SQL'
DELETE FROM document_collections WHERE collection_name = 'cast_probe';
INSERT INTO document_collections (id, collection_name, raw_data, created_at, updated_at)
VALUES
  ('probe-1', 'cast_probe', '{"amount": 50}',    now(), now()),
  ('probe-2', 'cast_probe', '{"amount": 900}',   now(), now()),
  ('probe-3', 'cast_probe', '{"amount": 1000}',  now(), now()),
  ('probe-4', 'cast_probe', '{"amount": 1500}',  now(), now()),
  ('probe-5', 'cast_probe', '{"amount": 90000}', now(), now());
SQL

probe() {
    local label="$1" filter="$2"
    local out code body
    out="$(curl -s -w '\n%{http_code}' -G \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
        --data-urlencode "collection_name=eq.cast_probe" \
        --data-urlencode "select=raw_data" \
        --data-urlencode "$filter" \
        "$API/rest/v1/document_collections")"
    code="$(echo "$out" | tail -n1)"
    body="$(echo "$out" | sed '$d')"
    echo "-- $label"
    echo "   filter: $filter"
    echo "   $code  $body"
}

echo
echo "== expected for a correct numeric cast: 1000, 1500, 90000 (three rows)"
echo "== the text answer, which is the bug: 90000 only"
echo

probe "current: quoted key, cast after quotes" 'raw_data->>"amount"::numeric=gt.900'
probe "unquoted key, cast at end"              'raw_data->>amount::numeric=gt.900'
probe "arrow (not ->>) with cast"              'raw_data->amount::numeric=gt.900'
probe "quoted key with single arrow"          'raw_data->"amount"::numeric=gt.900'
probe "cast written as ::int"                  'raw_data->>amount::int=gt.900'
probe "no cast at all (text baseline)"         'raw_data->>amount=gt.900'
probe "quoted key, no cast (text baseline)"    'raw_data->>"amount"=gt.900'

echo
echo "== and what Postgres itself says, as the ground truth"
psql "$DB_URL" -c \
  "SELECT id, raw_data->>'amount' AS as_text
     FROM document_collections
    WHERE collection_name = 'cast_probe'
      AND (raw_data->>'amount')::numeric > 900
    ORDER BY id;"

psql "$DB_URL" -q -c "DELETE FROM document_collections WHERE collection_name = 'cast_probe';"
