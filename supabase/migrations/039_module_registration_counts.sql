-- ============================================================================
-- #850 THE FIX FOR #835 READ THE USERS TABLE FIFTEEN TIMES TO ANSWER ONE
--      QUESTION, AND I SHIPPED IT.
--
-- lib/module-applicant-count counts a module's applicants by issuing one
-- `count()` per bucket per registration-key spelling, plus one per overlapping
-- pair for inclusion-exclusion:
--
--     5 buckets x 1 key                      =  5 queries   wave, academy,
--                                                           export, marketplace
--     5 buckets x (2 keys + 1 overlap)       = 15 queries   cooperative,
--                                                           farmNation
--
-- Every one of them filters `raw_data->serviceRegistrations-><key>->>'status'`,
-- which no index serves, so every one is a SEQUENTIAL SCAN of `users`.
--
-- Five admin surfaces call it — the WAVE compliance route, the academy, export
-- and farm-nation admin actions, and the cooperative reports action. So one
-- cooperative admin page load reads the whole users table fifteen times, and
-- #835 IS ALREADY DEPLOYED. Before it, that screen counted rows in a dedicated
-- table with an index.
--
-- ── WHY THIS MATTERS BEYOND BEING WASTEFUL ──────────────────────────────────
--
-- The production log shows LOGINS timing out:
--
--     [ERROR] [PreValidate] Auth error: [supabase-db] query users:
--       [57014] canceling statement due to statement timeout
--
-- That query is `where("email","==",…) limit 1`, on an indexed native column.
-- A cheap query timing out is what a saturated database looks like.
--
-- THIS MIGRATION DOES NOT CLAIM TO BE THE CAUSE OF THAT. 022's header made the
-- same distinction and it is worth keeping: consistency is not proof. What is
-- certain is that this is a large, uncached, repeated load that did not exist
-- three weeks ago, that I added, and that a single scan can replace.
--
-- ── WHY A FUNCTION RATHER THAN AN INDEX ─────────────────────────────────────
--
-- Measured on 50,122 rows. An expression index on the status path serves the
-- four `IN` buckets well — 3,475 buffers down to 574 — and CANNOT serve the
-- `total` bucket, which filters
--
--     status IS NOT NULL AND status <> 'not_started'
--
-- because `<>` is not a btree strategy. The planner sequential-scans with the
-- index in place exactly as without it (3,475 buffers either way, measured).
--
-- Rewriting that filter as an inclusion list would make it indexable and would
-- reintroduce precisely what #824 cost this audit: a list cannot catch a status
-- nobody has invented yet, and `not_started`, `legacy_pending_onboarding` and
-- `pending_repair` are three values this platform added while the audit was
-- running. The `<>` is load-bearing.
--
-- So the queries are not made cheaper — they are made FEWER. One scan returns
-- every status combination present, and the caller buckets them.
--
-- ── WHAT IT RETURNS, AND WHY IT IS AN ARRAY ─────────────────────────────────
--
-- One row per distinct SET of statuses an account carries across the requested
-- keys, with how many accounts carry that set.
--
--     statuses            people
--     {approved}          14668
--     {not_started}       16997
--     {pending,approved}      3     <- the two spellings disagree on 3 accounts
--
-- The array is what makes inclusion-exclusion unnecessary rather than merely
-- cheaper. `cooperative`/`cooperatives` and `farmNation`/`farm_nation` are
-- written to the SAME account by actions/admin/_legacy.ts, so summing the two
-- spellings double-counts — the defect the caller's pairwise-overlap
-- subtraction exists to undo. Here each ACCOUNT contributes exactly one row's
-- worth of itself, whatever it carries, so no arithmetic can double-count it.
--
-- AND THE STATUS VOCABULARY STAYS IN TYPESCRIPT. This function knows nothing
-- about which statuses mean approved, pending or refused; it groups by what is
-- there. lib/module-registration-status remains the single list, which is
-- #756's whole point and would be undone by a function that hardcoded one half
-- of it in SQL.
--
-- ── THE `since` FILTER IS BYTE-FOR-BYTE WHAT THE CALLER ALREADY DOES ────────
--
-- `raw_data->>'createdAt'` compared as TEXT against an ISO-8601 string, because
-- that is what `where("createdAt", ">=", date)` resolves to today: `createdAt`
-- is not in users' FIELD_TO_COLUMN and the native column is spelled
-- `created_at`, so the adapter emits the JSONB path, and Dates are normalised
-- to toISOString() before comparison. Lexicographic ordering of ISO-8601 UTC
-- strings is chronological, so it is correct — verified against the data: 117
-- of 126 local rows hold a string of that shape and 9 hold no key at all.
--
-- USING THE NATIVE `created_at` COLUMN WOULD BE BETTER — typed, and indexed by
-- 027 — and it is deliberately NOT done here. It would include those 9 rows
-- that the JSONB path excludes, so the function and the JavaScript fallback
-- below it would disagree about the same question, and a performance change is
-- the wrong place to smuggle in a behaviour change. Recorded as a lead instead.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE, STABLE, read-only. It reads `users` and writes nothing.
-- The caller falls back to its existing per-bucket queries if this function is
-- absent, so code deployed before this migration behaves exactly as it does
-- today.
-- ============================================================================

CREATE OR REPLACE FUNCTION module_registration_counts(
    p_keys       text[],
    p_since_iso  text DEFAULT NULL
)
RETURNS TABLE (statuses text[], people bigint)
LANGUAGE sql
STABLE
AS $$
    SELECT s.statuses, count(*)::bigint
    FROM (
        SELECT (
            --   DISTINCT and ORDER BY so that {pending,approved} and
            --   {approved,pending} are ONE group rather than two, and so an
            --   account carrying the same status under both spellings — which
            --   is the common case, 36,662 of them for cooperative — yields a
            --   one-element array.
            SELECT array_agg(DISTINCT v.st ORDER BY v.st)
            FROM unnest(p_keys) AS k(key)
            CROSS JOIN LATERAL (
                SELECT u.raw_data->'serviceRegistrations'->k.key->>'status' AS st
            ) v
            WHERE v.st IS NOT NULL
        ) AS statuses
        FROM public.users u
        WHERE p_since_iso IS NULL
           OR (u.raw_data->>'createdAt') >= p_since_iso
    ) s
    --   An account with no registration for any requested key contributes NULL
    --   here and is not a row. That matches the caller: its `total` bucket
    --   requires the status path to be non-null.
    WHERE s.statuses IS NOT NULL
    GROUP BY s.statuses;
$$;

COMMENT ON FUNCTION module_registration_counts(text[], text) IS
    '#850 One scan of users, returning how many accounts carry each SET of '
    'module-registration statuses across the given serviceRegistrations keys. '
    'Replaces 5-15 sequential scans per admin page load. Knows nothing about '
    'which statuses mean what — lib/module-registration-status remains the one '
    'vocabulary. The array shape removes the need for inclusion-exclusion over '
    'the dual-spelling keys.';
