-- ============================================================================
-- #536  THE GHOST BUCKET READ TWO SPELLINGS OF ADDRESS AND TWO OF BANK.
--       THE PLATFORM WRITES SEVEN AND FOUR.
-- ============================================================================
--
-- Reported by the owner, who opened /admin and saw
--
--     Ghost   19,853 (47.1%)   Incomplete registrations / minimal data
--
-- and asked whether the data had fallen out of sync with the database. It had
-- not. user_segment() and categorizeUser() agree exactly — 029 and its parity
-- test made sure of that — and BOTH read a narrower set of keys than the
-- platform's own writers use:
--
--   _wv_applications writes onto the USER row  stateOfOrigin, residentialState,
--                                              lga, residentialAddress
--   admin/_legacy (the importer)               stateOfOrigin, lga,
--                                              residentialAddress, address.state
--   bank-account.ts                            bankAccountNumber, bankName,
--                                              bankCode, bankAccountName, and
--                                              the nested bankDetails block
--
-- So a member carrying `stateOfOrigin: "Kano"` and a verified
-- `bankAccountNumber` — everything a payout needs — was counted under "minimal
-- data" because the two keys this function read were not the two the writer
-- used.
--
-- WHY A NEW FILE RATHER THAN AN EDIT TO 029
-- -----------------------------------------
-- 029 has been applied. Editing an applied migration means the file on disk and
-- the function in the database disagree for every cluster that already ran it,
-- and the only way to tell is to read the catalog. CREATE OR REPLACE in a new
-- file is the whole change and it is transaction-safe, per #469.
--
-- THE ODDITY 029 PRESERVED IS NOW GONE, DELIBERATELY
-- --------------------------------------------------
-- 029 reproduced an asymmetry it called load-bearing: the verificationProfile
-- branches excluded the literal 'N/A' and the top-level ones did not. That was
-- the right call THEN — the rule was being moved, not changed, and reproducing
-- it exactly is what made the move safe.
--
-- It is being changed now, on purpose, because widening the reads without
-- widening the placeholder rule would count 'N/A' as an address. The importer
-- writes that string. jsonb_present() below applies one rule to all of them and
-- mirrors present() in broadcast-logic.ts.
--
-- WHAT DID NOT CHANGE: precedence is still active > pending > stalled > ghost,
-- first match wins; "suspended" still falls through to hasStartedAny and counts
-- as STALLED; JavaScript truthiness is still what jsonb_truthy models. Phone and
-- name are still not counted as data — the segments feed broadcast targeting,
-- where Ghost means "zero activity", and a phone number is not activity.
--
-- HELD TO THE JAVASCRIPT by
-- src/__tests__/pg/the-sql-segments-agree-with-the-javascript.test.ts, which
-- classifies the same documents both ways and fails on a single disagreement.
-- That suite needs a local cluster and SKIPS LOUDLY without one, so on a machine
-- with no PostgreSQL this file is checked by review and by the JavaScript half
-- alone. Saying so is part of the change.
-- ============================================================================

-- Is there a real value here? Placeholders and whitespace are not.
--
-- Mirrors present() in src/lib/broadcast-logic.ts. Non-strings fall back to
-- JavaScript truthiness, which is what jsonb_truthy already models.
CREATE OR REPLACE FUNCTION jsonb_present(v jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN false
        WHEN jsonb_typeof(v) = 'string' THEN
            lower(btrim(v #>> '{}')) NOT IN ('', 'n/a', 'na', 'none', 'null', 'undefined', '-')
        ELSE jsonb_truthy(v)
    END;
$$;

-- Which segment one user's document falls into — #536's widened reads.
CREATE OR REPLACE FUNCTION user_segment(doc jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN jsonb_path_exists(doc,
            '$.serviceRegistrations.*.status ? (@ == "approved" || @ == "active" || @ == "paid" || @ == "completed")')
        THEN 'active'

        WHEN jsonb_path_exists(doc,
            '$.serviceRegistrations.*.status ? (@ == "pending" || @ == "submitted" || @ == "under_review" || @ == "briefing")')
        THEN 'pending'

        -- hasStartedAny: `r.status && r.status !== "not_started"`. Unchanged
        -- from 029 — see that file for why each JavaScript-falsy value is
        -- excluded within its own type.
        WHEN jsonb_path_exists(doc,
            '$.serviceRegistrations.*.status ? ((@.type() == "string" && @ != "" && @ != "not_started") || (@.type() == "number" && @ != 0) || (@.type() == "boolean" && @ == true) || @.type() == "object" || @.type() == "array")')

          -- hasBank: every spelling bank-account.ts and the importer write.
          OR jsonb_present(doc->'verificationProfile'->'bankDetails'->'bankName')
          OR jsonb_present(doc->'bankDetails'->'bankName')
          OR jsonb_present(doc->'bankDetails'->'accountNumber')
          OR jsonb_present(doc->'bankAccountNumber')
          OR jsonb_present(doc->'bankName')

          -- hasAddress: every spelling the WAVE application and the importer
          -- write onto the user row.
          OR jsonb_present(doc->'verificationProfile'->'address'->'state')
          OR jsonb_present(doc->'address'->'state')
          OR jsonb_present(doc->'state')
          OR jsonb_present(doc->'stateOfOrigin')
          OR jsonb_present(doc->'residentialState')
          OR jsonb_present(doc->'residentialAddress')
          OR jsonb_present(doc->'lga')
        THEN 'stalled'

        ELSE 'ghost'
    END;
$$;

-- Grants, guarded exactly as 029 guards them: scripts/test-migrations.sh runs
-- every migration against a throwaway cluster with no Supabase roles, and an
-- unguarded GRANT fails there with `role "anon" does not exist`.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION jsonb_present(jsonb) TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION user_segment(jsonb) TO %I', r);
        END IF;
    END LOOP;
END $$;

-- count_user_segments() is unchanged and still calls user_segment(), so it picks
-- the new rule up without being redefined. The notify is still needed: PostgREST
-- serves RPC from a cached schema, and 029's own note records a fix that
-- silently fell back to the slow path because the cache had not been reloaded.
NOTIFY pgrst, 'reload schema';
