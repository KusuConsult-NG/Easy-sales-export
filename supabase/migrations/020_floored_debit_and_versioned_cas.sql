-- Migration: 020_floored_debit_and_versioned_cas.sql
--
-- Two primitives, both recorded as open in docs/audit/atomic-money-migration.md
-- and neither expressible with the existing set.
--
-- 1. debit_jsonb_balance_with_floor
--
--    debit_jsonb_balance (013/014) checks `balance >= amount` and nothing more.
--    That is the right rule for "do not go negative", and it is what the
--    cooperative withdrawal and WAVE earnings paths needed. It is NOT enough for
--    a policy floor:
--
--        // platform.ts
--        const MIN_BALANCE = 5000;
--        if (currentBalance - amount < MIN_BALANCE) throw ...   // advisory
--        const debit = await debitJsonbBalance({ ... });         // floor-blind
--
--    The read is advisory and says so: two withdrawals that each leave 5,000
--    behind can together dip under it. The debit guarantees only that the
--    balance cannot go NEGATIVE. Closing the floor race needs the floor applied
--    under the same lock as the debit, which is this.
--
-- 2. claim_versioned_update
--
--    src/lib/optimistic-locking.ts reads _version inside runTransaction,
--    compares it, and writes:
--
--        const snap = await transaction.get(ref);
--        if (currentVersion !== expectedVersion) throw new Error("STALE_DATA...");
--        transaction.update(ref, { ...data, _version: currentVersion + 1 });
--
--    runTransaction takes no lock, so two callers read the same version, both
--    pass, and both write — the exact failure optimistic locking exists to
--    prevent. loan-actions.ts already dropped versionedUpdate from its approval
--    path for this reason; vendor-settings.ts (4 sites), admin.ts and
--    cooperative/_actions.ts `_updateMembershipAction` still use it.
--
--    This is the same compare-and-swap shape as claim_status_transition (007),
--    on a numeric version rather than a status string.
--
-- SAFETY
--   Adds two functions. No table, column or row is altered, and neither does
--   anything until code calls it. Inert on apply.

BEGIN;

-- ---------------------------------------------------------------------------
-- debit_jsonb_balance_with_floor
--
-- Deliberately a SEPARATE function rather than a floor parameter added to
-- debit_jsonb_balance. Adding a DEFAULTed parameter to an existing function
-- creates a NEW signature and leaves the old one resolvable — the precise trap
-- docs/audit/atomic-money-migration.md records under "proname alone proves
-- nothing about version". A distinct name cannot be ambiguous.
--
-- Returns
--   ok       TRUE when the debit was applied
--   balance  the balance AFTER a successful debit; the current balance on
--            refusal, so the caller can report the real number rather than a
--            stale pre-read
--   reason   'insufficient_funds' | 'below_floor' | 'not_found'
--
-- 'below_floor' is distinct from 'insufficient_funds' on purpose: the member has
-- the money, they are just not allowed to take it all. Telling them "insufficient
-- funds" would be false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION debit_jsonb_balance_with_floor(
    p_table      TEXT,
    p_id         TEXT,
    p_field      TEXT,
    p_amount     NUMERIC,
    p_floor      NUMERIC,
    p_collection TEXT DEFAULT NULL
)
RETURNS TABLE (ok BOOLEAN, balance NUMERIC, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
    v_path    TEXT[];
    v_sql     TEXT;
    v_allowed TEXT[] := ARRAY[
        'users', 'cooperative_members', 'cooperative_loans', 'transactions',
        'processed_payments', 'marketplace_orders', 'wallets',
        'academy_applications', 'document_collections'
    ];
BEGIN
    IF NOT (p_table = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'debit_jsonb_balance_with_floor: table % is not allowed', p_table;
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'debit_jsonb_balance_with_floor: amount must be positive, got %', p_amount;
    END IF;
    IF p_floor IS NULL OR p_floor < 0 THEN
        RAISE EXCEPTION 'debit_jsonb_balance_with_floor: floor must be >= 0, got %', p_floor;
    END IF;

    v_path := string_to_array(p_field, '.');

    IF p_table = 'document_collections' THEN
        v_sql := format(
            'SELECT COALESCE((raw_data #>> %L::text[])::numeric, 0) FROM document_collections '
            'WHERE id = %L AND collection_name = %L FOR UPDATE',
            v_path, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'SELECT COALESCE((raw_data #>> %L::text[])::numeric, 0) FROM %I WHERE id = %L FOR UPDATE',
            v_path, p_table, p_id
        );
    END IF;

    EXECUTE v_sql INTO v_balance;

    IF v_balance IS NULL THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 'not_found'::TEXT;
        RETURN;
    END IF;

    -- Order matters. A member with 200 who asks for 5,000 against a floor of
    -- 5,000 has insufficient funds, not a floor problem; reporting the floor
    -- first would tell them to keep a balance they never had.
    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, v_balance, 'insufficient_funds'::TEXT;
        RETURN;
    END IF;

    IF v_balance - p_amount < p_floor THEN
        RETURN QUERY SELECT FALSE, v_balance, 'below_floor'::TEXT;
        RETURN;
    END IF;

    IF p_table = 'document_collections' THEN
        v_sql := format(
            'UPDATE document_collections SET raw_data = jsonb_set(raw_data, %L::text[], to_jsonb(%L::numeric), true), '
            'updated_at = NOW() WHERE id = %L AND collection_name = %L',
            v_path, v_balance - p_amount, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'UPDATE %I SET raw_data = jsonb_set(raw_data, %L::text[], to_jsonb(%L::numeric), true), '
            'updated_at = NOW() WHERE id = %L',
            p_table, v_path, v_balance - p_amount, p_id
        );
    END IF;

    EXECUTE v_sql;

    RETURN QUERY SELECT TRUE, v_balance - p_amount, NULL::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_versioned_update
--
-- Compare-and-swap on _version. A single conditional UPDATE locks the row and
-- re-reads it under the lock, so exactly one of two concurrent callers matches
-- the WHERE and the other is told the version moved.
--
-- Returns
--   claimed  TRUE when this caller made the change
--   version  the version now on the row: the NEW one on success, the CURRENT
--            one on a lost claim, NULL when the record does not exist
--
-- version IS NULL means "no such record", which is a different failure from a
-- lost claim — the same distinction claim_status_transition draws with
-- status IS NULL. Confusing the two turns a missing record into a spurious
-- "someone else edited this".
--
-- NOTE: the patch is applied as JSONB and FieldValue sentinels are NOT resolved,
-- exactly as in claim_status_transition (007). An increment placed in the patch
-- is stored as an object rather than applied. Issue those as a separate update
-- after a successful claim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_versioned_update(
    p_table      TEXT,
    p_id         TEXT,
    p_expected   NUMERIC,
    p_patch      JSONB DEFAULT '{}'::jsonb,
    p_collection TEXT DEFAULT NULL
)
RETURNS TABLE (claimed BOOLEAN, version NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current NUMERIC;
    v_sql     TEXT;
    v_allowed TEXT[] := ARRAY[
        'users', 'cooperative_members', 'cooperative_loans', 'transactions',
        'processed_payments', 'marketplace_orders', 'wallets',
        'academy_applications', 'document_collections'
    ];
BEGIN
    IF NOT (p_table = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'claim_versioned_update: table % is not allowed', p_table;
    END IF;

    -- Lock the row and read the version under that lock. A missing _version is
    -- 0, matching optimistic-locking.ts's backfill behaviour — records written
    -- before versioning existed must remain updatable.
    IF p_table = 'document_collections' THEN
        v_sql := format(
            'SELECT COALESCE((raw_data ->> ''_version'')::numeric, 0) FROM document_collections '
            'WHERE id = %L AND collection_name = %L FOR UPDATE',
            p_id, p_collection
        );
    ELSE
        v_sql := format(
            'SELECT COALESCE((raw_data ->> ''_version'')::numeric, 0) FROM %I WHERE id = %L FOR UPDATE',
            p_table, p_id
        );
    END IF;

    EXECUTE v_sql INTO v_current;

    IF v_current IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::NUMERIC;
        RETURN;
    END IF;

    -- A NULL expectation means "I am not asserting a version", which
    -- optimistic-locking.ts already permitted for initialisation. It still takes
    -- the lock, so two such callers serialise rather than racing.
    IF p_expected IS NOT NULL AND v_current <> p_expected THEN
        RETURN QUERY SELECT FALSE, v_current;
        RETURN;
    END IF;

    IF p_table = 'document_collections' THEN
        v_sql := format(
            'UPDATE document_collections SET raw_data = raw_data || %L::jsonb || '
            'jsonb_build_object(''_version'', %L::numeric), updated_at = NOW() '
            'WHERE id = %L AND collection_name = %L',
            COALESCE(p_patch, '{}'::jsonb), v_current + 1, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'UPDATE %I SET raw_data = raw_data || %L::jsonb || '
            'jsonb_build_object(''_version'', %L::numeric), updated_at = NOW() '
            'WHERE id = %L',
            p_table, COALESCE(p_patch, '{}'::jsonb), v_current + 1, p_id
        );
    END IF;

    EXECUTE v_sql;

    RETURN QUERY SELECT TRUE, v_current + 1;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify after applying
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc
--    WHERE proname IN ('debit_jsonb_balance_with_floor', 'claim_versioned_update');
--
-- Floor behaviour:
--   INSERT INTO cooperative_members (id, raw_data)
--     VALUES ('t-flr-1', '{"savingsBalance": 10000}')
--     ON CONFLICT (id) DO UPDATE SET raw_data = '{"savingsBalance": 10000}';
--
--   SELECT * FROM debit_jsonb_balance_with_floor(
--     'cooperative_members', 't-flr-1', 'savingsBalance', 6000, 5000);
--   -- expect ok = false, reason = 'below_floor', balance = 10000 (unchanged)
--
--   SELECT * FROM debit_jsonb_balance_with_floor(
--     'cooperative_members', 't-flr-1', 'savingsBalance', 5000, 5000);
--   -- expect ok = true, balance = 5000
--
--   SELECT * FROM debit_jsonb_balance_with_floor(
--     'cooperative_members', 't-flr-1', 'savingsBalance', 99999, 5000);
--   -- expect ok = false, reason = 'insufficient_funds' (NOT below_floor)
--
-- Concurrency — the property the unit tests cannot cover:
--   Tab A:  BEGIN;
--           SELECT * FROM debit_jsonb_balance_with_floor(
--             'cooperative_members', 't-flr-1', 'savingsBalance', 1000, 0);
--           -- leave open
--   Tab B:  SELECT * FROM debit_jsonb_balance_with_floor(
--             'cooperative_members', 't-flr-1', 'savingsBalance', 1000, 0);
--           -- expect B to BLOCK until A commits. Blocking is the fix working.
--   Tab A:  COMMIT;
--
-- Versioned CAS:
--   SELECT * FROM claim_versioned_update('cooperative_members', 't-flr-1', 0,
--                                        '{"note":"first"}'::jsonb);
--   -- expect claimed = true, version = 1
--   SELECT * FROM claim_versioned_update('cooperative_members', 't-flr-1', 0,
--                                        '{"note":"second"}'::jsonb);
--   -- expect claimed = false, version = 1, and note still 'first'
--   SELECT * FROM claim_versioned_update('cooperative_members', 'nope', 0);
--   -- expect claimed = false, version IS NULL
--
--   DELETE FROM cooperative_members WHERE id = 't-flr-1';
--
-- Rollback
--   DROP FUNCTION IF EXISTS debit_jsonb_balance_with_floor(TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT);
--   DROP FUNCTION IF EXISTS claim_versioned_update(TEXT,TEXT,NUMERIC,JSONB,TEXT);
-- ---------------------------------------------------------------------------
