-- ============================================================================
-- #850's ROLLUP EXTRACTED THE SAME JSONB TWICE PER ROW, AND DETOASTED IT BOTH
-- TIMES.
--
-- From the owner's production log:
--
--     module_registration_counts ... [57014] canceling statement due to
--     statement timeout
--
-- EXPLAIN ANALYZE on production, ARRAY['cooperative','cooperatives']:
--
--     HashAggregate (actual time=9946.365..9946.477 rows=15)
--       Group Key: (SubPlan 1)
--       Buffers: shared hit=11324
--       ->  Seq Scan on users u (actual time=1.916..9913.411 rows=36687)
--             Filter: ((SubPlan 2) IS NOT NULL)
--             SubPlan 1  ->  Aggregate (loops=36687)
--             SubPlan 2  ->  Aggregate (loops=42846)
--     Execution Time: 9948.463 ms
--
-- Every query this platform makes runs under statement_timeout=8s — inherited
-- at login from the `authenticator` role, which SET ROLE does not reset
-- (service_role carries no setting of its own). 9.95s does not fit in 8s, so
-- this function never returns in production.
--
-- ── TWO SUBPLANS FOR ONE EXPRESSION ─────────────────────────────────────────
--
-- The scalar subquery is written once and evaluated twice: Postgres pulls the
-- inner subquery up, and the expression then appears both in the outer
-- `WHERE statuses IS NOT NULL` (SubPlan 2) and in `GROUP BY statuses`
-- (SubPlan 1). It does not eliminate the common subexpression across a filter
-- and a grouping key. 42,846 + 36,687 = 79,533 evaluations to read 42,846
-- rows.
--
-- AND EACH EVALUATION DETOASTS raw_data. That is the cost, not the scan.
-- Measured locally at 40,000 rows sized like production's (~1.5 kB of
-- incompressible payload, so raw_data is genuinely out of line):
--
--     current                     960,642 buffers    988 ms
--     with the fence below        480,560 buffers    522 ms
--
-- Exactly half the buffers, because exactly half the detoasting. The two
-- SubPlans become one.
--
-- ── WHY `OFFSET 0` ──────────────────────────────────────────────────────────
--
-- It is Postgres's optimisation fence: a subquery carrying OFFSET 0 is not
-- pulled up into the parent. The expression is then computed ONCE per row
-- inside the subquery, materialised as a column, and the outer filter and
-- grouping both read that column instead of recomputing it.
--
-- It returns the same rows in the same order — OFFSET 0 skips nothing — and
-- the plan proves the rest: one SubPlan at 40,001 loops where there were two
-- at 40,000 and 40,001.
--
-- ALTERNATIVES MEASURED AND NOT TAKEN:
--
--   * Restructuring to CROSS JOIN LATERAL + GROUP BY u.id reads each row once
--     too (480,682 buffers) but is slower at 560 ms, because grouping 74,286
--     rows by id spills to disk (temp read=590 written=591). The fence costs
--     one token and no spill.
--
--   * An expression index on (raw_data->'serviceRegistrations') does NOT
--     help: the planner sequential-scans anyway, even with enable_seqscan
--     off, because the extraction sits inside a correlated subplan rather
--     than in the target list. Measured slower (1422 ms).
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
--
-- It does not stop this being a full scan. `WHERE p_since_iso IS NULL OR ...`
-- must read every row by construction, and 5.2s on production's current
-- 42,845 rows is inside the 8s cap with headroom that shrinks as the table
-- grows.
--
-- THE MEASURED WAY OUT, recorded rather than taken here: a narrow generated
-- column,
--
--     ALTER TABLE public.users ADD COLUMN service_regs jsonb
--       GENERATED ALWAYS AS (raw_data->'serviceRegistrations') STORED;
--
-- takes the same query from 960,642 buffers to 1,216 and 988 ms to 210 ms —
-- 790x less buffer traffic — because a small inline column needs no
-- detoasting at all. supabase-db's _mapRow builds documents from raw_data
-- plus an explicit allowlist of native columns, so an unknown column is
-- ignored and no document changes. It is not in this migration because
-- ADD COLUMN ... GENERATED ... STORED REWRITES THE TABLE under an ACCESS
-- EXCLUSIVE lock, and `authenticator` carries lock_timeout=8s — every app
-- query would fail for the duration. That is a deliberate decision about a
-- maintenance window, not a line to slip into a performance patch.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE of one STABLE, read-only function. No table, column, row
-- or index is touched, and the signature is unchanged, so callers and the
-- PostgREST schema cache are unaffected. Equivalence is asserted by
-- __tests__/pg/fifteen-scans-to-answer-one-question, which compares every
-- bucket against the fifteen-query arithmetic this function replaced.
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
            --   is the common case — yields a one-element array.
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
        --   THE FENCE. Without it this subquery is pulled up and the scalar
        --   subquery above is evaluated TWICE per row — once for the outer
        --   filter, once for the grouping key — detoasting raw_data both
        --   times. See the header.
        OFFSET 0
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
    'the dual-spelling keys. The OFFSET 0 is an optimisation fence, not a '
    'no-op: without it the status extraction is evaluated twice per row.';
