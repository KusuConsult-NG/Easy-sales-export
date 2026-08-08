-- Migration: 012_platform_metrics.sql
--
-- Totals computed in the database instead of by fetching rows.
--
-- WHY THIS EXISTS
-- ---------------
-- getPlatformMetricsAction computed total revenue like this:
--
--     const snap = await db.collection(PROCESSED_PAYMENTS)
--         .where("status", "==", "completed")
--         .select("amount")
--         .get();
--     snap.docs.forEach(d => { totalRevenue += Number(d.data().amount) || 0 });
--     totalTransactions = snap.docs.length;
--
-- Three problems in six lines:
--
-- 1. The query has no .limit(), so it inherited the 5,000-row default cap.
--    Total revenue was the sum of at most 5,000 payments regardless of how many
--    exist. A table cannot be totalled by fetching its rows.
--
-- 2. A .count() query on the same table ran alongside it and its result was
--    never used — totalTransactions came from the truncated docs.length.
--
-- 3. Promise.allSettled meant a rejected query left the totals at 0 while the
--    function still returned success: true, error: null. A failure displayed as
--    ₦0 revenue, indistinguishable from a genuinely quiet day.
--
-- WHICH AMOUNT IS AUTHORITATIVE
-- -----------------------------
-- `amount` exists twice on processed_payments: the native column and
-- raw_data->>'amount'. The adapter's reads prefer raw_data, so that is what the
-- application has been showing. This sums COALESCE(raw_data, column, 0) to match
-- what users see rather than what the column happens to hold — the same
-- distinction that made migrations 005/006 update a value nobody read.
--
-- `status` is not a native column, so it is filtered from raw_data. Note that
-- wallet debits record status 'wallet_debit' (migration 006) precisely so they
-- are not counted here as income.
--
-- SAFE TO APPLY
--   Adds one read-only function. No table, column or row is touched.

BEGIN;

-- ============================================================================
-- platform_revenue_totals
--
-- Returns:
--   total_revenue      sum of completed payment amounts
--   transaction_count  number of completed payments
--
-- Both computed over the whole table, in one statement.
-- ============================================================================

CREATE OR REPLACE FUNCTION platform_revenue_totals()
RETURNS TABLE (total_revenue NUMERIC, transaction_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT
        COALESCE(SUM(COALESCE((p.raw_data ->> 'amount')::numeric, p.amount, 0)), 0)::numeric,
        COUNT(*)::bigint
      FROM processed_payments p
     WHERE p.raw_data ->> 'status' = 'completed';
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
--   SELECT * FROM platform_revenue_totals();
--
-- Cross-check against the old, truncated approach. If the table holds more than
-- 5,000 completed payments these will differ, and the difference is exactly
-- what the dashboard was failing to report:
--
--   SELECT COUNT(*) AS completed_payments
--     FROM processed_payments
--    WHERE raw_data ->> 'status' = 'completed';
--
--   SELECT SUM(COALESCE((raw_data ->> 'amount')::numeric, amount, 0)) AS first_5000
--     FROM (SELECT raw_data, amount FROM processed_payments
--            WHERE raw_data ->> 'status' = 'completed' LIMIT 5000) t;
--
-- Confirm debits are excluded — they should never count as income:
--
--   SELECT raw_data ->> 'status' AS status, COUNT(*)
--     FROM processed_payments GROUP BY 1 ORDER BY 2 DESC;
--   -- 'wallet_debit' rows must not appear in the revenue total above

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS platform_revenue_totals();
