-- ============================================================================
-- #467  THE TABLES PROMOTED FOR SPEED LOST THE INDEX THE SLOW ONE KEPT.
-- ============================================================================
--
-- The owner reported the admin and user screens loading slowly. Measured, not
-- guessed, against a real PostgreSQL 16 with 50,009 users carrying a document
-- each — the exact query /admin/users issues through useAdminData:
--
--     select id, raw_data from users order by created_at desc limit 20;
--
--   BEFORE                                            26.496 ms
--     Limit  (cost=8081.81..8081.86 rows=20)
--       ->  Sort  (cost=8081.81..8206.83 rows=50009)
--             Sort Key: created_at DESC
--
--   AFTER  create index on users (created_at desc)     0.061 ms
--     Limit  (cost=0.29..3.16 rows=20)
--       ->  Index Scan using idx_users_created_at
--
-- 430x. The whole table was being sorted to find twenty rows, on every page
-- load, and the cost grows with the user base for as long as it keeps growing.
--
-- WHY THIS IS THE SHAPE THAT DESERVES AN INDEX, WHERE 022'S WAS NOT
-- -----------------------------------------------------------------
-- Migration 022 is marked DO NOT APPLY on its own measurements: those indexes
-- served `raw_data->>'membershipStatus' = 'active'`, a filter matching 96% of
-- its table, where an index scan is slower than the seq scan it replaces. Its
-- header states the trigger for revisiting it:
--
--     "Apply this only when the EXPLAIN ANALYZE in the header shows a seq scan
--      over a LARGE table returning a SMALL fraction of it."
--
-- ORDER BY created_at DESC LIMIT 20 over 50,009 rows returns 0.04% of the
-- table. That is the case 022 describes, and the plans above are the EXPLAIN
-- ANALYZE it asks for.
--
-- AND THE PROOF THAT THIS IS AN OVERSIGHT RATHER THAN A JUDGEMENT
-- ---------------------------------------------------------------
-- document_collections — the untyped catch-all everything USED to live in —
-- already carries exactly this:
--
--     idx_doc_collections_created_at ON document_collections (collection_name, created_at DESC)
--
-- Every table since PROMOTED out of it into a dedicated table, for performance,
-- was created without one. The optimisation left its own fast path behind. The
-- eight below are every dedicated table that has a created_at column and no
-- index on it, and there are 107 `orderBy("createdAt")` call sites in the
-- application reading them.
--
-- COST
-- ----
-- One btree per table on a column written once at insert and never updated.
-- That is the cheapest index there is to maintain: no update churn, no
-- expression to evaluate, and append-ordered inserts keep the tree balanced.
--
-- HOW TO APPLY
-- ------------
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so run this file
-- ON ITS OWN — not pasted after another migration, and not inside BEGIN/COMMIT.
-- CONCURRENTLY matters because the alternative takes an ACCESS EXCLUSIVE lock
-- and blocks every read and write to the table while it builds.
--
-- A failed CONCURRENTLY build leaves an INVALID index behind: unused by the
-- planner, still maintained on every write. Check afterwards with
--
--     SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;
--
-- and for anything listed, DROP INDEX CONCURRENTLY <name>; then re-run.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at
    ON public.users (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_orders_created_at
    ON public.marketplace_orders (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_payments_created_at
    ON public.processed_payments (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_at
    ON public.transactions (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cooperative_members_created_at
    ON public.cooperative_members (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cooperative_loans_created_at
    ON public.cooperative_loans (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_academy_applications_created_at
    ON public.academy_applications (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallets_created_at
    ON public.wallets (created_at DESC);
