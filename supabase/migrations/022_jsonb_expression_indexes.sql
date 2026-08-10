-- ============================================================================
-- MEASURED 2026-08-10 — DO NOT APPLY. The numbers do not support it.
-- ============================================================================
--
-- The header below argues these indexes are needed. The mechanism it describes
-- is real: EXPLAIN ANALYZE against production confirms the seq scan and the
-- filter, exactly as predicted --
--
--   Seq Scan on cooperative_members  (cost=0.00..521.47 rows=9 ...)
--     Filter: ((raw_data ->> 'membershipStatus') = 'active')
--
-- The magnitude is what the header said was unverified, and measuring it says
-- no:
--
--   document_collections   18,534 rows   (already indexed on collection_name)
--   processed_payments      1,229 rows
--   cooperative_members     ~1,830 rows  (the query matched 1,754 of them — 96%)
--
-- Postgres will sequential-scan tables this size whatever indexes exist, and it
-- is right to. The membershipStatus query returns 96% of its table; an index
-- scan would be slower than the seq scan it would replace. Creating these would
-- cost write throughput and disk on every insert and update, and buy nothing.
--
-- ONE THING THE MEASUREMENT DID SHOW, which an index would half-fix:
--   the planner estimated 9 rows and got 1,754 — out by 195x, because there are
--   no statistics for an expression like raw_data->>'field'. That mis-estimate
--   will produce bad plans once these tables are joined at size. If that starts
--   happening, an expression index fixes the STATISTICS even when it is never
--   scanned. Not a reason to apply this today.
--
-- AND ONE THING IT SHOWED THAT NO INDEX FIXES:
--   598 ms to scan ~1,830 rows. That is roughly 0.3 ms per row on a small
--   table. The likely cause is large JSONB being detoasted by SELECT *, or
--   shared-tier I/O. Selecting fewer columns is the fix; indexing is not.
--
-- RE-MEASURE, DO NOT ASSUME. Apply this only when the EXPLAIN ANALYZE in the
-- header shows a seq scan over a LARGE table returning a SMALL fraction of it.
-- A reasonable trigger is document_collections passing ~100,000 rows, or any
-- single collection_name passing ~50,000.
-- ============================================================================

-- Migration: 022_jsonb_expression_indexes.sql
--
-- Make filtered JSONB reads use an index instead of scanning the table.
--
-- THE DEFECT
--
-- schema.sql defines GIN indexes on raw_data for all nine tables, which looks
-- like coverage and is not. The adapter generates this for any field that is not
-- a native column (src/lib/supabase-db.ts:1074):
--
--     raw_data->>'status' = 'pending'
--
-- A GIN index with the default jsonb_ops serves CONTAINMENT (@>, ?). It cannot
-- serve `->>` text extraction compared with `=`. Postgres will not use
-- idx_doc_collections_raw_data for that predicate and falls back to a sequential
-- scan.
--
-- document_collections is the fallback table for every collection outside the
-- 10-entry DEDICATED_TABLE_MAP — loan_applications, cooperative_withdrawals,
-- export_windows, notifications, conversations, land_listings, products and
-- more — so most filtered reads in the application scan one shared table.
--
-- Being in a dedicated table is not sufficient either. Native columns only help
-- when the QUERIED FIELD NAME matches one:
--
--   cooperative_members  has a native `status`, but the code filters
--                        `membershipStatus` -> raw_data -> scan
--   processed_payments   native id/user_id/amount/reference, but filtered on
--                        `status` and `type` -> raw_data -> scan
--
-- WHAT IS INDEXED, AND WHY THESE
--
-- Counted from .where("field", …) call sites across src/, attributed to the
-- collection they follow. `status` (171 uses) and `userId` (137) are 308 of
-- roughly 450 filtered reads, so two composite indexes on document_collections
-- cover most of the codebase. collection_name leads because every query against
-- that table already filters on it, which makes the index selective per
-- collection rather than global.
--
-- The rest are the dedicated-table fields whose names miss their native column.
--
-- NO TRANSACTION BLOCK — DELIBERATE, AND UNLIKE EVERY OTHER MIGRATION HERE
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. Every other
-- migration in this directory wraps itself in BEGIN/COMMIT; this one must not,
-- and adding them will make it fail.
--
-- CONCURRENTLY matters because the alternative takes an ACCESS EXCLUSIVE lock
-- for the duration of the build — on live tables, on a platform that moves
-- money. It is slower and uses more resources; that is the correct trade here.
--
-- IF A BUILD FAILS
--
-- A failed CONCURRENTLY build leaves an INVALID index behind. It is not used by
-- the planner and it does not block anything, but it also does not go away on
-- its own, and re-running this file will not replace it (IF NOT EXISTS sees the
-- name and skips). Find and drop them:
--
--   SELECT c.relname
--     FROM pg_class c
--     JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE i.indisvalid = false;
--
--   DROP INDEX CONCURRENTLY <name>;   -- then re-run this migration
--
-- SAFETY
--   Adds indexes only. No table, column or row is altered, and no application
--   behaviour changes — queries return exactly what they returned before, just
--   without the scan. Safe to apply while the app is running.

-- ── document_collections: the two that cover most of the application ────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dc_collection_status
    ON document_collections (collection_name, (raw_data->>'status'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dc_collection_user
    ON document_collections (collection_name, (raw_data->>'userId'));

-- ── dedicated tables, where the queried name is not a native column ─────────

-- Filtered on status/type by the reconcilers, the revenue paths and the webhook.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_status
    ON processed_payments ((raw_data->>'status'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_type
    ON processed_payments ((raw_data->>'type'));

-- NOT the native `status` column: the code filters `membershipStatus`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cm_membership_status
    ON cooperative_members ((raw_data->>'membershipStatus'));

-- `userId` in raw_data, distinct from the native user_id column the adapter
-- only uses when the caller happens to query that exact name.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cm_user_id
    ON cooperative_members ((raw_data->>'userId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mo_buyer_id
    ON marketplace_orders ((raw_data->>'buyerId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mo_payment_status
    ON marketplace_orders ((raw_data->>'paymentStatus'));

-- Used by the order-fulfilment reconciler check and the payment paths.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mo_payment_reference
    ON marketplace_orders ((raw_data->>'paymentReference'));

-- ---------------------------------------------------------------------------
-- MEASURE BEFORE AND AFTER — the magnitude here is NOT established
--
-- The mechanism is certain: these predicates cannot use a GIN index. The size of
-- the win is not, and was not measurable from the repository. On a small table
-- Postgres will choose a sequential scan regardless and the index will change
-- nothing; these indexes then cost write throughput and disk for no gain.
--
-- Run this BEFORE applying, on production or a database loaded like it:
--
--   EXPLAIN ANALYZE
--   SELECT * FROM document_collections
--    WHERE collection_name = 'loan_applications'
--      AND raw_data->>'status' = 'pending';
--
--   EXPLAIN ANALYZE
--   SELECT * FROM processed_payments WHERE raw_data->>'status' = 'completed';
--
-- Expect `Seq Scan` and a row count worth indexing. Then apply, ANALYZE, and
-- run the same statements again expecting `Index Scan` / `Bitmap Index Scan`:
--
--   ANALYZE document_collections;
--   ANALYZE processed_payments;
--   ANALYZE cooperative_members;
--   ANALYZE marketplace_orders;
--
-- If a table is small enough that the planner still prefers a seq scan, drop
-- that index rather than leaving it: an unused index is write cost with no read
-- benefit.
--
-- Rollback (each is independent and safe to drop while running)
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dc_collection_status;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dc_collection_user;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_pp_status;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_pp_type;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_cm_membership_status;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_cm_user_id;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_mo_buyer_id;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_mo_payment_status;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_mo_payment_reference;
-- ---------------------------------------------------------------------------
