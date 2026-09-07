-- ============================================================================
-- #467  THE TABLES PROMOTED FOR SPEED LOST THE INDEX THE SLOW ONE KEPT.
-- #469  AND THE FIRST DRAFT OF THIS FILE COULD NOT BE APPLIED BY THE ONLY
--       ROUTE THIS PROJECT HAS.
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
-- ============================================================================
-- #469  WHY THESE ARE NOT `CONCURRENTLY`, WHICH IS WHAT THIS FILE SAID FIRST
-- ============================================================================
--
-- The first draft used CREATE INDEX CONCURRENTLY and told the operator to "run
-- this file on its own". They ran it on its own, in the Supabase SQL Editor,
-- and got:
--
--     ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction
--     block
--
-- The SQL Editor wraps every submission in a transaction. There is no setting
-- for that. So "on its own" was never a route that existed here — and
-- scripts/build-deploy-sql.mjs says why, in its own header: this project applies
-- migrations by pasting into the SQL Editor "because neither psql nor the
-- Supabase CLI is installed". The file was written for a tool the operator does
-- not have, and the 430x fix sat unapplied while three separate places in this
-- repository recorded the instruction that could not be followed.
--
-- WHAT THE FIRST DRAFT CLAIMED THE ALTERNATIVE COSTS, AND WHAT IT ACTUALLY
-- COSTS. It said a plain CREATE INDEX "takes an ACCESS EXCLUSIVE lock and blocks
-- every read and write to the table". That is wrong, and it is the reason the
-- cheap route looked unacceptable. Asked directly, on the table in question:
--
--     BEGIN;
--     CREATE INDEX idx_probe ON public.users (created_at DESC);
--     SELECT mode FROM pg_locks ... WHERE pid = pg_backend_pid();
--     -> ShareLock
--
-- ShareLock, not AccessExclusiveLock. SELECTs take ACCESS SHARE, which does not
-- conflict with it: READS KEEP WORKING FOR THE WHOLE BUILD — verified by reading
-- 50,009 rows out of the table while an index build held it. What blocks is
-- WRITES, for as long as the build runs:
--
--     CREATE INDEX on users, 50,009 rows      718 ms   cold cache
--                                              28 ms   warm, repeated
--
-- Under a second of blocked INSERTs on the largest table here, once. Against
-- 26.496 ms of wasted sort on every admin page load, for as long as nobody can
-- apply the file.
--
-- AND THE ONE REAL RISK IS HANDLED, NOT ACCEPTED. The danger of a plain build is
-- not its own duration — it is that a ShareLock request QUEUES behind any open
-- transaction already holding the table, and every writer arriving afterwards
-- queues behind the request. One long-running transaction turns a 718 ms build
-- into a stall. `SET lock_timeout` below removes that: if the lock is not
-- granted within 5 seconds the statement ABORTS instead of queueing. Measured
-- against a held ROW EXCLUSIVE lock: waited 3.035 s at a 3 s setting, then
-- `ERROR: canceling statement due to lock timeout`, with reads unaffected
-- throughout.
--
-- A timed-out run leaves nothing behind and nothing half-built — every statement
-- is IF NOT EXISTS, so re-running it picks up where it stopped. If it times out
-- twice, something is holding a long transaction on that table and THAT is worth
-- finding before forcing an index in beside it.
--
-- IF A TABLE HERE EVER GROWS LARGE ENOUGH that a sub-second write pause is not
-- acceptable, the CONCURRENTLY form is still correct — it just needs a
-- connection that does not wrap statements in a transaction (psql, or the
-- Supabase CLI's `db execute`, neither of which is installed here):
--
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at
--         ON public.users (created_at DESC);
--
-- and then, because a failed CONCURRENTLY build leaves an INVALID index behind
-- that the planner ignores and every write still maintains:
--
--     SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;
--
-- dropping anything listed with DROP INDEX CONCURRENTLY before re-running.
--
-- ============================================================================
-- WHY THIS IS THE SHAPE THAT DESERVES AN INDEX, WHERE 022'S WAS NOT
-- ============================================================================
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
-- COST OF KEEPING THEM
-- --------------------
-- One btree per table on a column written once at insert and never updated.
-- That is the cheapest index there is to maintain: no update churn, no
-- expression to evaluate, and append-ordered inserts keep the tree balanced.
--
-- HOW TO APPLY
-- ------------
-- Paste this whole file into the Supabase SQL Editor and run it. That works —
-- it is what the file is now written for, and the pg suite proves it by
-- applying this exact file inside BEGIN/COMMIT. It is also included in the
-- consolidated deploy that scripts/build-deploy-sql.mjs generates, so a fresh
-- deployment gets these indexes without anyone remembering this file exists.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ============================================================================

-- Do not queue behind an open transaction and take every writer down with us.
-- See #469 above: this converts the one real risk into a clean, re-runnable
-- failure.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_users_created_at
    ON public.users (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_created_at
    ON public.marketplace_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_payments_created_at
    ON public.processed_payments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at
    ON public.transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cooperative_members_created_at
    ON public.cooperative_members (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cooperative_loans_created_at
    ON public.cooperative_loans (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_academy_applications_created_at
    ON public.academy_applications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallets_created_at
    ON public.wallets (created_at DESC);

RESET lock_timeout;
