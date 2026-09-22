-- ============================================================================
--  WHY IS THE DASHBOARD SLOW — run this against production, read the answer
-- ============================================================================
--
--  THE OWNER: "the main dashboard takes more than 10 seconds to load", and
--  later, "the app is still very very slow".
--
--  Every expensive read on the admin dashboard has a FAST PATH and a FALLBACK.
--  The fast path is a Postgres function or an index; the fallback is the slow
--  thing it replaced. The application chooses between them AT RUNTIME and logs
--  which it took — so a deployment missing one migration is slow rather than
--  broken, and silently so.
--
--  That silence is the problem this script exists for. Migration 022's nine
--  indexes were absent from production for MONTHS without anybody noticing.
--  There is no screen that says "you are on the slow path"; there is only a log
--  line, in a container that restarts.
--
--  So: run this in the Supabase SQL Editor. Every row it returns is something
--  the dashboard is paying for. NO ROWS MEANS NOTHING IS MISSING.
--
--  It is READ-ONLY. It creates nothing, changes nothing, and touches no data.
--
--  ── HOW TO READ IT ─────────────────────────────────────────────────────────
--
--    status    MISSING  the fast path is not there; the cost column says what
--                       the fallback does instead
--              present  nothing to do
--    fix       the migration file to apply, in supabase/migrations/
--
--  Every cost figure below was MEASURED on PostgreSQL 16 against a table shaped
--  like production's (42,845 rows, raw_data genuinely in TOAST), not estimated.
-- ============================================================================

WITH required_functions(fn, fix, cost) AS (
    VALUES
    ('count_module_registrations',
     '049_count_module_registrations.sql',
     'The dashboard falls back to EIGHT sequential scans of users, each one '
     || 'detoasting raw_data per row. Measured: ~1,037,000 buffers and ~1.3s '
     || 'WARM, against 1,262 buffers and 42ms with the function. This is the '
     || 'single biggest item on the admin dashboard.'),

    ('count_user_segments',
     '029_user_segment_counts.sql',
     'The user-segment tiles fall back to PAGING THE WHOLE users TABLE — 51 '
     || 'requests of ~92 kB fired at once, which also saturates the connection '
     || 'pool so everything else on the page queues behind it. #473 measured '
     || 'the cold admin load at 96 round trips and 8.8s before this existed.'),

    ('module_registration_counts',
     '044_registration_rollup_reads_each_row_once.sql and 045',
     'The registration rollup falls back to fifteen separate scans. If the '
     || 'function exists but 045 was not applied it reads raw_data instead of '
     || 'service_regs: measured at 480,560 buffers against 1,216, and on '
     || 'production it took 9,948ms and hit the 8s statement_timeout.'),

    ('user_segment',
     '029_user_segment_counts.sql',
     'count_user_segments() cannot classify without it.')
)
SELECT
    'FUNCTION'                                         AS kind,
    rf.fn                                              AS name,
    CASE WHEN p.oid IS NULL THEN 'MISSING' ELSE 'present' END AS status,
    rf.fix                                             AS fix,
    rf.cost                                            AS what_it_costs
FROM required_functions rf
LEFT JOIN pg_proc p
       ON p.proname = rf.fn
      AND p.pronamespace = 'public'::regnamespace
WHERE p.oid IS NULL

UNION ALL

-- ── The generated column 045 added, which 049 also depends on ───────────────
SELECT
    'COLUMN',
    'users.service_regs',
    'MISSING',
    '045_registration_rollup_reads_a_narrow_column.sql',
    'Without it every registration count reads through raw_data and detoasts '
    || '~2.5 kB per row to get one short string. 045 measured the difference '
    || 'at 790x fewer buffers. NOTE: adding it REWRITES the table under an '
    || 'ACCESS EXCLUSIVE lock — seconds on 106 MB, but authenticator carries '
    || 'lock_timeout=8s, so run it in a quiet window.'
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'service_regs'
)

UNION ALL

-- ── The indexes every hot read depends on ───────────────────────────────────
SELECT
    'INDEX',
    ri.idx,
    'MISSING',
    ri.fix,
    ri.cost
FROM (VALUES
    ('idx_dc_collection_status',   '048_the_indexes_022_could_not_deploy.sql',
     'Any collection filtered by status scans document_collections. Measured '
     || 'at 200k rows: 16,185 buffers / 153ms -> 53 buffers.'),
    ('idx_dc_collection_user',     '048_the_indexes_022_could_not_deploy.sql',
     'A person''s own rows in a collection scan the table. Measured at 200k '
     || 'rows: 23,963 buffers / 187ms -> 4 buffers.'),
    ('idx_mo_payment_reference',   '048_the_indexes_022_could_not_deploy.sql',
     'Every payment verification looks its order up by reference. Measured: '
     || '2,223 buffers / 19ms -> 4 buffers.'),
    ('idx_pp_status',              '048_the_indexes_022_could_not_deploy.sql',
     'The revenue aggregates filter processed_payments by status.'),
    ('idx_users_created_at',       '027_created_at_indexes.sql',
     'The six monthly user-growth counts on the dashboard.'),
    ('idx_users_roles',            '022 (apply BY HAND — see its header)',
     'Every roles-based count, including the module breakdown fallback.'),
    ('idx_users_migrated_to',      '047_user_search_and_purge_indexes.sql',
     'countLivePeople reads every superseded row to compute Total Users.'),
    ('idx_users_supabase_auth_id', '047_user_search_and_purge_indexes.sql',
     'Every sign-in resolves the profile through this.')
) AS ri(idx, fix, cost)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ri.idx
)

ORDER BY 1, 2;

-- ============================================================================
--  AND THE OTHER HALF: is the statement timeout what is cutting reads off?
--
--  044's header records it — "every query this platform makes runs under
--  statement_timeout=8s, inherited at login from the `authenticator` role,
--  which SET ROLE does not reset". A read that exceeds it does not come back
--  slow, it comes back as SQLSTATE 57014, and the dashboard renders the tile
--  as unavailable.
--
--  Run this separately; it reports the settings actually in force.
-- ============================================================================

-- SELECT r.rolname,
--        s.setting
-- FROM pg_roles r
-- LEFT JOIN LATERAL unnest(r.rolconfig) AS s(setting) ON true
-- WHERE r.rolname IN ('authenticator', 'authenticated', 'anon', 'service_role')
-- ORDER BY r.rolname, s.setting;

-- ============================================================================
--  AND THE TABLE SIZES, so a future measurement has a baseline.
-- ============================================================================

-- SELECT c.relname AS table_name,
--        pg_size_pretty(pg_total_relation_size(c.oid))      AS total,
--        pg_size_pretty(pg_relation_size(c.oid))            AS heap,
--        pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS toast,
--        c.reltuples::bigint                                AS approx_rows
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
-- ORDER BY pg_total_relation_size(c.oid) DESC
-- LIMIT 15;
