-- Migration: 014_debit_nested_jsonb_balance.sql
--
-- Extends debit_jsonb_balance (013) to balances held at a NESTED path.
--
-- WHY
-- ---
-- 013 addressed `cooperative_members.savingsBalance` — a top-level key in
-- raw_data. WAVE earnings are not top-level:
--
--     serviceRegistrations.wave.waveEarningsBalance
--
-- and `_withdrawEarningsAction` debits it with the same defect, in a slightly
-- worse form: the sufficiency check happens BEFORE the transaction entirely
--
--     // PHASE 1: Balance Calculation (Snapshot)
--     if (earnings.data.paidAmount < amount) return "Insufficient available balance";
--     ...
--     transaction.update(userRef, {
--         'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(-amount),
--     });
--
-- so the balance is read, released, and only then decremented. Two withdrawals
-- submitted at once both pass the check against the same snapshot and both
-- debit.
--
-- The `hasPendingWithdrawal` flag was intended to prevent exactly this, and is
-- itself a check-then-write inside the same lock-free transaction, so it does
-- not.
--
-- WHAT CHANGES
-- ------------
-- p_field is now treated as a dotted path and split on '.', so a single-segment
-- field behaves exactly as before. Existing callers are unaffected.
--
-- SAFE TO APPLY
--   Replaces one function. No table, column or row is touched. Backward
--   compatible: 'savingsBalance' still resolves to the same single-element path.

BEGIN;

CREATE OR REPLACE FUNCTION debit_jsonb_balance(
    p_table      TEXT,
    p_id         TEXT,
    p_field      TEXT,
    p_amount     NUMERIC,
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
        RAISE EXCEPTION 'debit_jsonb_balance: table % is not allowed', p_table;
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'debit_jsonb_balance: amount must be positive, got %', p_amount;
    END IF;

    -- A dotted field becomes a JSONB path. A single segment yields a
    -- one-element array, which is what 013 used, so existing callers are
    -- unchanged.
    v_path := string_to_array(p_field, '.');

    -- Lock the row and read the balance under the lock.
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

    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, v_balance, 'insufficient_funds'::TEXT;
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

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- Nested path:
--
--   INSERT INTO users (id, email, raw_data)
--   VALUES ('t-wave-1', 't-wave-1@example.com',
--           '{"serviceRegistrations":{"wave":{"waveEarningsBalance":10000}}}'::jsonb)
--   ON CONFLICT (id) DO UPDATE
--     SET raw_data = '{"serviceRegistrations":{"wave":{"waveEarningsBalance":10000}}}'::jsonb;
--
--   SELECT * FROM debit_jsonb_balance(
--       'users', 't-wave-1', 'serviceRegistrations.wave.waveEarningsBalance', 6000);
--   -- expect: t, 4000, NULL
--
--   SELECT * FROM debit_jsonb_balance(
--       'users', 't-wave-1', 'serviceRegistrations.wave.waveEarningsBalance', 6000);
--   -- expect: f, 4000, insufficient_funds   <-- the second withdrawal that used to go through
--
--   SELECT raw_data #> '{serviceRegistrations,wave}' FROM users WHERE id = 't-wave-1';
--   -- confirm only waveEarningsBalance changed; siblings intact
--
--   DELETE FROM users WHERE id = 't-wave-1';
--
-- Single-segment path still behaves as in 013:
--
--   SELECT * FROM debit_jsonb_balance('cooperative_members', '<id>', 'savingsBalance', 100);

-- ============================================================================
-- ROLLBACK — re-apply 013 to restore the single-segment version.
-- ============================================================================
