-- ============================================================================
--  WHY IS THE DASHBOARD SLOW — paste the whole file, press Run, read the rows
-- ============================================================================
--
--  THE OWNER: "the main dashboard takes more than 10 seconds to load", and
--  later, "the app is still very very slow".
--
--  Every expensive read on the admin dashboard has a FAST PATH and a FALLBACK.
--  The fast path is a Postgres function or an index; the fallback is the slow
--  thing it replaced. The application chooses between them AT RUNTIME, so a
--  deployment missing one migration is slow rather than broken — silently.
--
--  That silence is what this exists for. Migration 022's nine indexes were
--  absent from production for MONTHS without anybody noticing.
--
--  Every row it returns is something the dashboard is paying for.
--  NO ROWS MEANS NOTHING IS MISSING.
--
--  READ-ONLY. It creates nothing, changes nothing, touches no data.
--
--    status  MISSING   the fast path is absent; `what_it_costs` says what the
--                      fallback does instead
--    fix     the file to apply, in supabase/migrations/
--
--  Every cost figure was MEASURED on PostgreSQL 16 against a table shaped like
--  production's (42,845 rows, raw_data genuinely in TOAST), not estimated.
--
--  ── WHY THIS FILE HAS NO BLANK LINES AND NO LINE BREAKS INSIDE STRINGS ─────
--
--  The first draft did, and the Supabase SQL Editor split the statement at a
--  blank line inside the VALUES list:
--
--      ERROR: 42601: syntax error at or near "'module_registration_counts'"
--      LINE 1:     ('module_registration_counts',
--
--  LINE 1 is the giveaway: the server was handed a fragment beginning there,
--  not the file. The editor's statement splitter is naive about blank lines in
--  a way psql is not, which is why this passed locally and failed there.
--
--  So the statement below is one unbroken block, every string on a single
--  line, plain ASCII only. Less pretty; it runs where it has to run.
-- ============================================================================
WITH required AS (
    SELECT * FROM (VALUES
    ('count_module_registrations', '049_count_module_registrations.sql', 'BIGGEST ITEM. The dashboard falls back to EIGHT sequential scans of users, each detoasting raw_data per row. Measured: ~1,037,000 buffers and ~1.3s WARM, against 1,262 buffers and 42ms with the function.'),
    ('count_user_segments', '029_user_segment_counts.sql', 'The user-segment tiles fall back to PAGING THE WHOLE users TABLE - 51 requests of ~92 kB fired at once, which also saturates the connection pool so everything else on the page queues behind it. Measured cold at 96 round trips and 8.8s.'),
    ('module_registration_counts', '044_registration_rollup_reads_each_row_once.sql and 045', 'The registration rollup falls back to fifteen separate scans. If it exists but 045 was not applied it reads raw_data instead of service_regs: 480,560 buffers against 1,216, and on production 9,948ms - past the 8s statement_timeout, so it never returned.'),
    ('user_segment', '029_user_segment_counts.sql', 'count_user_segments() cannot classify without it.')
    ) AS t(fn, fix, cost)
), required_indexes AS (
    SELECT * FROM (VALUES
    ('idx_dc_collection_status', '048_the_indexes_022_could_not_deploy.sql', 'Any collection filtered by status scans document_collections. Measured at 200k rows: 16,185 buffers / 153ms -> 53 buffers.'),
    ('idx_dc_collection_user', '048_the_indexes_022_could_not_deploy.sql', 'A person''s own rows in a collection scan the table. Measured at 200k rows: 23,963 buffers / 187ms -> 4 buffers.'),
    ('idx_mo_payment_reference', '048_the_indexes_022_could_not_deploy.sql', 'Every payment verification looks its order up by reference. Measured: 2,223 buffers / 19ms -> 4 buffers.'),
    ('idx_pp_status', '048_the_indexes_022_could_not_deploy.sql', 'The revenue aggregates filter processed_payments by status.'),
    ('idx_users_created_at', '027_created_at_indexes.sql', 'The six monthly user-growth counts on the dashboard.'),
    ('idx_users_roles', '022 - apply BY HAND, see its header', 'Every roles-based count, including the module breakdown fallback.'),
    ('idx_users_migrated_to', '047_user_search_and_purge_indexes.sql', 'countLivePeople reads every superseded row to compute Total Users.'),
    ('idx_users_supabase_auth_id', '047_user_search_and_purge_indexes.sql', 'Every sign-in resolves the profile through this.')
    ) AS t(idx, fix, cost)
)
SELECT 'FUNCTION' AS kind, r.fn AS name, 'MISSING' AS status, r.fix AS fix, r.cost AS what_it_costs
FROM required r
WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = r.fn AND p.pronamespace = 'public'::regnamespace)
UNION ALL
SELECT 'COLUMN', 'users.service_regs', 'MISSING', '045_registration_rollup_reads_a_narrow_column.sql', 'Without it every registration count reads through raw_data and detoasts ~2.5 kB per row to get one short string - 790x more buffer traffic. NOTE: adding it REWRITES the table under an ACCESS EXCLUSIVE lock (seconds on 106 MB), and authenticator carries lock_timeout=8s, so run it in a quiet window.'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'service_regs')
UNION ALL
SELECT 'INDEX', i.idx, 'MISSING', i.fix, i.cost
FROM required_indexes i
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes x WHERE x.schemaname = 'public' AND x.indexname = i.idx)
ORDER BY 1, 2;
-- ============================================================================
--  THE OTHER HALF — run these separately, one at a time, if the rows above
--  come back empty and the dashboard is STILL slow.
--
--  (A) IS THE STATEMENT TIMEOUT CUTTING READS OFF? A read that exceeds it does
--      not come back slow, it comes back as SQLSTATE 57014 and the tile
--      renders as unavailable.
--
--      SELECT r.rolname, s.setting FROM pg_roles r
--      LEFT JOIN LATERAL unnest(r.rolconfig) AS s(setting) ON true
--      WHERE r.rolname IN ('authenticator','authenticated','anon','service_role')
--      ORDER BY 1, 2;
--
--  (B) TABLE SIZES, so a later measurement has a baseline.
--
--      SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
--             pg_size_pretty(pg_relation_size(c.oid)) AS heap,
--             pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid),0)) AS toast
--      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname = 'public' AND c.relkind = 'r'
--      ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15;
-- ============================================================================
