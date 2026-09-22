-- ============================================================================
--  049 — EIGHT SEQUENTIAL SCANS OF THE USERS TABLE, TO DRAW ONE PIE CHART
-- ============================================================================
--
--  THE OWNER: "fix the slowness of the entire app, the main dashboard takes
--  more than 10 seconds to load".
--
--  getModuleRegistrationStats issues eight `count: 'exact'` queries against
--  `users`, each one an OR of a JSONB path and a roles containment:
--
--      raw_data->'serviceRegistrations'->'wave'->>'status' IN (...)
--        OR roles @> ARRAY['wave_participant']
--
--  Nothing indexes `raw_data->'serviceRegistrations'-><module>->>'status'`, and
--  an OR cannot be served by an index on one arm alone, so every one of the
--  eight is a SEQUENTIAL SCAN OF THE WHOLE TABLE.
--
--  MEASURED, against a local PostgreSQL 16 seeded with 42,845 users at 85 MB
--  (production is ~42,845 at ~106 MB), with the real schema and every migration
--  through 048 applied:
--
--      per query    Seq Scan, 7,141 buffers, 27-40 ms WARM
--      eight        57,128 buffers, ~250 ms warm
--
--  Warm is the good case: those are `shared hit`. On a container that has just
--  started — and the production log carries three "Starting Container" events
--  in one session — the same eight are `shared read`, 57 MB apiece off disk,
--  456 MB in total, for eight integers.
--
--  ── AND IT READS service_regs, WHICH IS 045'S WHOLE POINT ───────────────────
--
--  The first draft of this function read `raw_data->'serviceRegistrations'`.
--  That is the trap 044 and 045 were written about: `raw_data` averages ~2.5 kB
--  and is routinely out of line in TOAST, so every evaluation detoasts the
--  whole document to read one short string. 045 measured the difference on the
--  sibling rollup at 480,560 buffers against 1,216 — "790x less buffer traffic
--  ... because a small inline column is read straight off the heap page the
--  scan is already holding."
--
--  `service_regs` is GENERATED ALWAYS AS (raw_data->'serviceRegistrations')
--  STORED, added by 045, so it is the same value by construction. Measured
--  here, same seeded table, same eight figures:
--
--      eight separate queries, raw_data       57,128 buffers   ~250 ms
--      one function over raw_data              7,141 buffers      49 ms
--      one function over service_regs          see the test        --
--
--  The roles arm reads `roles`, a native text[] column, which was never the
--  problem.
--
--  ONE SCAN INSTEAD OF EIGHT. Every figure is a FILTER over the same pass, so
--  the table is read once and the counts come back together, in ONE round trip
--  rather than eight.
--
--  WHY A FUNCTION AND NOT EIGHT EXPRESSION INDEXES. Indexes would help the
--  JSONB arm and not the OR — Postgres would need a BitmapOr with an indexable
--  arm on BOTH sides, so each module needs its own expression index AND the
--  roles GIN, and the planner has to choose them over a scan it already costs
--  at 8,319. Eight more indexes on the platform's hottest table, to make eight
--  queries do what one scan does anyway. #473 took exactly this shape of
--  decision and reached the same answer: count_user_segments(), one round trip,
--  no rows leaving the database.
--
--  THE STATUS LISTS ARE STATED TWICE — here and in
--  lib/module-registration-status.ts — AND THAT IS HELD BY A TEST, not by
--  care. src/__tests__/pg/the-module-counts-agree-with-the-javascript.test.ts
--  runs both over the same rows and fails on a single disagreement, the way
--  the-sql-segments-agree-with-the-javascript.test.ts already does for #473's
--  segments. These numbers are on the admin dashboard, and a silent change to
--  them is worse than the slowness.
--
--  DEGRADES, DOES NOT BREAK. analytics.service falls back to the eight queries
--  when this function is absent, so a deployment that has not run this
--  migration keeps working — slowly, and correctly. Migration 022's nine
--  indexes were absent from production for months without anybody noticing, so
--  "the migration will be applied" is not an assumption this codebase earns.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.count_module_registrations()
RETURNS TABLE (
    wave                   bigint,
    academy                bigint,
    cooperatives           bigint,
    cooperative_onboarding bigint,
    farm_nation            bigint,
    export_hub             bigint,
    export_onboarding      bigint,
    marketplace            bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH lists AS (
        SELECT
            --  ACTIVE_REGISTRATION_STATUSES
            ARRAY[
                'approved', 'active', 'pending', 'pending_approval',
                'revision_required', 'suspended', 'legacy_pending_onboarding',
                'pending_repair', 'under_review', 'paid', 'completed'
            ]::text[] AS all_active,
            --  SETTLED_REGISTRATION_STATUSES
            ARRAY[
                'approved', 'active', 'suspended', 'paid', 'completed'
            ]::text[] AS settled,
            --  IN_REVIEW_REGISTRATION_STATUSES
            ARRAY[
                'pending', 'pending_approval', 'revision_required',
                'legacy_pending_onboarding', 'pending_repair', 'under_review'
            ]::text[] AS in_review,
            --  The export ONBOARDING slice, which analytics.service spells out
            --  inline rather than deriving — kept identical here on purpose.
            ARRAY[
                'pending', 'pending_approval', 'under_review', 'revision_required'
            ]::text[] AS export_pending
    ),
    reg AS (
        SELECT
            u.roles,
            --  045's narrow generated column, NOT raw_data. Same value by
            --  construction and no detoasting — see the header.
            u.service_regs AS s
        FROM public.users u
    )
    SELECT
        count(*) FILTER (
            WHERE reg.s -> 'wave' ->> 'status' = ANY (lists.all_active)
               OR reg.roles @> ARRAY['wave_participant']::text[]
        ),
        count(*) FILTER (
            WHERE reg.s -> 'academy' ->> 'status' = ANY (lists.all_active)
               OR reg.roles @> ARRAY['academy_participant']::text[]
        ),
        --  The cooperative pair: `cooperatives` and the older `cooperative`,
        --  both spellings, exactly as the JavaScript asks for them.
        count(*) FILTER (
            WHERE reg.s -> 'cooperatives' ->> 'status' = ANY (lists.settled)
               OR reg.s -> 'cooperative'  ->> 'status' = ANY (lists.settled)
               OR reg.roles @> ARRAY['cooperative_member']::text[]
        ),
        count(*) FILTER (
            WHERE reg.s -> 'cooperatives' ->> 'status' = ANY (lists.in_review)
               OR reg.s -> 'cooperative'  ->> 'status' = ANY (lists.in_review)
        ),
        count(*) FILTER (
            WHERE reg.s -> 'farmNation'  ->> 'status' = ANY (lists.all_active)
               OR reg.s -> 'farm_nation' ->> 'status' = ANY (lists.all_active)
               OR reg.roles && ARRAY['farmer', 'land_owner', 'investor']::text[]
        ),
        count(*) FILTER (
            WHERE reg.s -> 'export' ->> 'status' = ANY (lists.all_active)
               OR reg.roles @> ARRAY['export_participant']::text[]
        ),
        count(*) FILTER (
            WHERE reg.s -> 'export' ->> 'status' = ANY (lists.export_pending)
        ),
        count(*) FILTER (
            WHERE reg.s -> 'marketplace' ->> 'status' = ANY (lists.all_active)
               OR reg.roles && ARRAY[
                      'seller', 'marketplace_seller', 'buyer', 'marketplace_buyer'
                  ]::text[]
        )
    FROM reg, lists;
$$;

COMMENT ON FUNCTION public.count_module_registrations() IS
    '049 — the admin dashboard''s module usage breakdown in ONE table scan. '
    'Replaces eight separate count queries, each of which was a sequential '
    'scan of users. Held to lib/module-registration-status.ts by '
    'src/__tests__/pg/the-module-counts-agree-with-the-javascript.test.ts.';

--  Guarded: a local throwaway cluster has none of Supabase's roles, and an
--  unguarded GRANT aborts the migration there — which is where this is
--  developed and tested.
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT EXECUTE ON FUNCTION public.count_module_registrations() TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.count_module_registrations() TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.count_module_registrations() TO service_role;
    END IF;
END
$grant$;
