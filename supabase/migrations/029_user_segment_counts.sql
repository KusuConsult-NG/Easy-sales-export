-- ============================================================================
-- #473  THE ADMIN DASHBOARD DOWNLOADED THE ENTIRE USERS TABLE TO COUNT FOUR
--       NUMBERS.
-- ============================================================================
--
-- analytics.service.ts calculateUserSegments():
--
--     const totalPages = Math.ceil(count / pageSize);   // 50,009 / 1000 = 51
--     for (let page = 0; page < totalPages; page++) {
--         promises.push(supabaseAdmin.from("users").select(...).range(...));
--     }
--     await Promise.all(promises);
--
-- Every row of the users table, fetched over HTTP, to classify each user in
-- JavaScript and report four totals: active, pending, stalled, ghost.
--
-- MEASURED, not guessed — a real browser logged in as admin against a real
-- PostgREST and a real PostgreSQL with 50,009 users, every database round trip
-- recorded with its HTTP method and payload size:
--
--     /admin, cold load        96 round trips
--       count-only (HEAD)      29 calls, 1,415 ms      — correct, and cheap
--       returning rows         67 calls, 8,795 ms, 4.6 MB transferred
--
-- Over fifty of those 67 are this one loop, at 92 kB a page. The four counters
-- are its entire output.
--
-- AND IT FIRES ALL FIFTY-ONE AT ONCE. Promise.all on every page means the
-- connection pool is saturated by one dashboard widget. Everything else the
-- page needs — and anything another request needs at that moment — queues behind
-- it. The Farm Nation forensic reporting `canceling statement due to statement
-- timeout` while this was in flight is consistent with that, though not proven
-- to be caused by it.
--
-- On Railway the cost is per container: every restart, every deploy, every new
-- instance, and every cache expiry pays it again.
--
-- WHY A FUNCTION RATHER THAN FILTERS
-- ----------------------------------
-- getModuleRegistrationStats() a few hundred lines below does this correctly
-- with `head: true` counts and `or=` filters, and that is the pattern to copy
-- where it fits. It does not fit here. The classification iterates the KEYS of
-- serviceRegistrations — `Object.values(regs).some(...)` — and PostgREST has no
-- way to express "any value in this object has a status of X". jsonb_each does,
-- so the rule moves into SQL rather than being approximated by a filter that
-- would silently disagree.
--
-- THE RULE IS COPIED EXACTLY, INCLUDING ITS ODDITIES
-- --------------------------------------------------
-- These four counters appear on the admin dashboard. If this function and the
-- JavaScript disagree, the numbers change without anyone noticing, which is a
-- worse defect than the slowness. So the asymmetries in the original are
-- REPRODUCED, not tidied:
--
--   * verificationProfile.bankDetails.bankName excludes the literal "N/A".
--     bankDetails.bankName does NOT. Same for address.state. That is what
--     broadcast-logic.ts:30-31 says, and both branches are kept as written.
--
--   * "suspended" is in neither the approved list nor the pending list, so a
--     suspended registration falls through to `hasStartedAny` and counts as
--     STALLED. Deliberately preserved.
--
--   * precedence is active > pending > stalled > ghost, first match wins.
--
-- jsonb_truthy() exists because `r.status && ...` is JavaScript truthiness, not
-- "is present". null, false, 0 and "" are all falsy there, and `->>` would
-- render false and 0 as the non-empty strings 'false' and '0'. Anything else —
-- objects and arrays included, which are truthy in JavaScript — is truthy here.
--
-- ONE BEHAVIOUR IS DELIBERATELY NOT COPIED, BECAUSE IT IS A CRASH.
-- `Object.values(regs).some((r: any) => r.status === ...)` throws TypeError if
-- any registration value is null, and calculateUserSegments has no try around
-- the loop — so ONE malformed user record blanks all four counters for
-- everybody. jsonb_each simply yields a null value with no status, which is the
-- answer the JavaScript would give if it survived to give one.
--
-- HOW TO APPLY
-- ------------
-- Paste into the Supabase SQL Editor, or let it arrive in the consolidated
-- deploy. Plain CREATE OR REPLACE, transaction-safe, per #469.
--
-- The application FALLS BACK to the old paging loop if this function is absent,
-- and says so loudly in the logs, so deploying the code before applying this is
-- slow rather than broken.
-- ============================================================================

-- JavaScript truthiness for a jsonb value.
--
-- Absent (SQL NULL), JSON null, false, 0 and "" are falsy. Everything else,
-- including objects and arrays, is truthy — which is what `if (x)` does.
CREATE OR REPLACE FUNCTION jsonb_truthy(v jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT v IS NOT NULL
       AND jsonb_typeof(v) <> 'null'
       AND v <> 'false'::jsonb
       AND v <> '0'::jsonb
       AND v <> '""'::jsonb;
$$;

-- Which segment one user's document falls into.
--
-- Mirrors categorizeUser() in src/lib/broadcast-logic.ts. The two are held
-- together by src/__tests__/pg/the-sql-segments-agree-with-the-javascript.test.ts,
-- which classifies the same users both ways and fails on any single
-- disagreement.
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

        -- hasStartedAny: `r.status && r.status !== "not_started"`.
        --
        -- The type tests are not defensive padding — they are the rule. JSONPath
        -- comparison BETWEEN DIFFERENT TYPES yields Unknown, not false, so a
        -- plain `@ != false` silently discards every string status and the whole
        -- predicate collapses. Each JavaScript-falsy value is therefore excluded
        -- within its own type, and objects and arrays are admitted because
        -- `if (x)` admits them.
        WHEN jsonb_path_exists(doc,
            '$.serviceRegistrations.*.status ? ((@.type() == "string" && @ != "" && @ != "not_started") || (@.type() == "number" && @ != 0) || (@.type() == "boolean" && @ == true) || @.type() == "object" || @.type() == "array")')
          -- hasBank: the verificationProfile branch excludes "N/A"; the
          -- top-level branch does not. broadcast-logic.ts:30, as written.
          OR (jsonb_truthy(doc->'verificationProfile'->'bankDetails'->'bankName')
              AND doc->'verificationProfile'->'bankDetails'->>'bankName' IS DISTINCT FROM 'N/A')
          OR jsonb_truthy(doc->'bankDetails'->'bankName')
          -- hasAddress: same asymmetry. broadcast-logic.ts:31.
          OR (jsonb_truthy(doc->'verificationProfile'->'address'->'state')
              AND doc->'verificationProfile'->'address'->>'state' IS DISTINCT FROM 'N/A')
          OR jsonb_truthy(doc->'address'->'state')
        THEN 'stalled'

        ELSE 'ghost'
    END;
$$;

-- ============================================================================
-- WHY THIS SHAPE, AND WHAT THE TWO REJECTED ONES COST — ALL THREE MEASURED
-- ============================================================================
--
-- Counting 50,009 users:
--
--   CTE + three EXISTS over jsonb_each      2,640 ms
--   one pass, three bool_or aggregates      2,811 ms
--   jsonb_path_exists, as above                35 ms
--
-- The obvious translation of `Object.values(regs).some(...)` is jsonb_each, and
-- BOTH jsonb_each versions are ~80x slower — not because expanding the object
-- is expensive (done set-based inline it takes 182 ms) but because a SQL
-- function containing a FROM clause CANNOT BE INLINED. Postgres calls it once
-- per row, 50,009 times. jsonb_path_exists is a scalar expression, so the whole
-- function inlines into the surrounding query and the per-call cost disappears.
--
-- THE FIRST VERSION WAS SHIPPED-SHAPED AND WRONG ANYWAY. It cut /admin from
-- 4.6 MB to 1 kB and 51 whole-table requests to 0 — and made the page SLOWER,
-- 2.3 s to 6.0 s, because a 2.6 s function had replaced the transfer. Fewer
-- round trips is not the same thing as a faster page, and the only way to know
-- which one happened is to load the page and look.
-- ============================================================================

-- The four counters, in ONE round trip, with no rows leaving the database.
--
-- Returns every segment even when its count is zero, so a caller never has to
-- tell "no such segment" from "none this time".
CREATE OR REPLACE FUNCTION count_user_segments()
RETURNS TABLE (active bigint, pending bigint, stalled bigint, ghost bigint)
LANGUAGE sql
STABLE
AS $$
    SELECT
        count(*) FILTER (WHERE seg = 'active')::bigint,
        count(*) FILTER (WHERE seg = 'pending')::bigint,
        count(*) FILTER (WHERE seg = 'stalled')::bigint,
        count(*) FILTER (WHERE seg = 'ghost')::bigint
    FROM (SELECT user_segment(raw_data) AS seg FROM public.users) s;
$$;

-- Grant to the PostgREST roles, IF THEY EXIST.
--
-- Postgres gives functions EXECUTE to PUBLIC by default, so these are belt and
-- braces against a database that has revoked it — no other migration here
-- grants at all, which is why they all work.
--
-- The guard is not decoration: scripts/test-migrations.sh applies every
-- migration to a THROWAWAY cluster that has no Supabase roles, and an
-- unguarded GRANT failed there with `role "anon" does not exist`. That harness
-- is the only automatic check that these files apply in order, so a migration
-- it cannot run is a migration nothing verifies.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION jsonb_truthy(jsonb) TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION user_segment(jsonb) TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION count_user_segments() TO %I', r);
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- AND TELL PostgREST THE FUNCTION EXISTS.
-- ============================================================================
--
-- Creating a function is not enough to make it callable over the REST API.
-- PostgREST serves RPC from a CACHED schema, and until that cache is reloaded
-- the call fails with
--
--     Could not find the function public.count_user_segments without
--     parameters in the schema cache
--
-- This was not reasoned about — it was MEASURED. The application change was
-- made, the migration applied, the admin page loaded in a real browser, and the
-- page still made all 51 whole-table requests: the RPC had failed and the
-- fallback had quietly carried it. A fix that silently degrades to the thing it
-- replaced looks exactly like a fix that works, which is why the before/after
-- was taken from the page rather than from the migration applying cleanly.
--
-- Supabase installs an event trigger that usually issues this itself after DDL.
-- "Usually" is not a guarantee worth resting the fix on, and the notify is free
-- and idempotent.
NOTIFY pgrst, 'reload schema';
