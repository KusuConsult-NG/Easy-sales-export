-- ============================================================================
-- THE ROLLUP DETOASTED 1.5 kB OF raw_data PER ROW TO READ ONE NESTED KEY.
--
-- 044 stopped it doing that TWICE per row. This stops it doing it at all.
--
-- ── WHERE THE TIME WAS GOING ────────────────────────────────────────────────
--
-- `users` is 42,845 rows and 106 MB, so `raw_data` averages ~2.5 kB and is
-- routinely out of line in TOAST. Every evaluation of
--
--     u.raw_data->'serviceRegistrations'->k.key->>'status'
--
-- detoasts the whole column to read one short string. Measured locally at
-- 40,000 rows carrying incompressible payload of production's size:
--
--     039  (two evaluations per row)     960,642 buffers    988 ms
--     044  (one, via the OFFSET 0 fence) 480,560 buffers    522 ms
--     045  (one, from a narrow column)     1,216 buffers    210 ms
--
-- 790x less buffer traffic than 039, because a small inline column is read
-- straight off the heap page the scan is already holding. The scan itself was
-- never the cost.
--
-- Production confirms the first step: 044 took the live function from
-- 9,948 ms to 6,302 ms and from two SubPlans to one. 6.3s fits inside the 8s
-- statement_timeout `authenticator` imposes, but with headroom that shrinks
-- every time somebody registers.
--
-- ── THE COLUMN ──────────────────────────────────────────────────────────────
--
-- GENERATED ALWAYS ... STORED, so Postgres maintains it. Nothing in the
-- application writes it and nothing needs to: the adapter writes `raw_data`
-- and the column follows.
--
-- NO DOCUMENT CHANGES. supabase-db's _mapRow builds each document from
-- `raw_data` plus an EXPLICIT ALLOWLIST of native columns (status, user_id,
-- email, roles, balance, amount, created_at, updated_at). `service_regs` is
-- not on it, so it is ignored on read. The write path is the same allowlist —
-- NATIVE_COLUMNS[tableName] — so nothing ever tries to write a generated
-- column, which would be an error.
--
-- ── APPLYING IT ─────────────────────────────────────────────────────────────
--
-- ADD COLUMN ... GENERATED ... STORED REWRITES THE TABLE under an ACCESS
-- EXCLUSIVE lock. On 106 MB that is seconds, but `authenticator` carries
-- lock_timeout=8s, so every application query fails while it runs. RUN IT IN A
-- QUIET WINDOW.
--
-- IF NOT EXISTS, because it is already applied on production — run there by
-- hand before this file existed. It is a no-op there and the real thing
-- everywhere else, which is the same relationship 043 has to 022.
--
-- ORDER MATTERS: the column must exist before the function that reads it.
-- Both statements are here, in that order, for that reason.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- The function is CREATE OR REPLACE, STABLE, read-only, same signature. The
-- only change from 044 is which column the extraction reads — the expression
-- `raw_data->'serviceRegistrations'` is by definition what `service_regs`
-- holds, so the rows are identical. Asserted, not argued:
-- __tests__/pg/fifteen-scans-to-answer-one-question compares every bucket
-- against the fifteen-query arithmetic this function replaced.
--
-- THE OFFSET 0 FENCE STAYS. It is cheaper to read the column once than twice
-- even now, and removing it would silently restore the double evaluation 044
-- exists to prevent.
-- ============================================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS service_regs jsonb
    GENERATED ALWAYS AS (raw_data->'serviceRegistrations') STORED;

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
                --   The narrow generated column, not raw_data. Same value by
                --   construction; no detoasting.
                SELECT u.service_regs->k.key->>'status' AS st
            ) v
            WHERE v.st IS NOT NULL
        ) AS statuses
        FROM public.users u
        WHERE p_since_iso IS NULL
           OR (u.raw_data->>'createdAt') >= p_since_iso
        --   044's fence. Without it this subquery is pulled up and the scalar
        --   subquery above is evaluated TWICE per row — once for the outer
        --   filter, once for the grouping key.
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
    'vocabulary. Reads the generated column service_regs, so no row is '
    'detoasted; the OFFSET 0 is an optimisation fence, not a no-op.';
