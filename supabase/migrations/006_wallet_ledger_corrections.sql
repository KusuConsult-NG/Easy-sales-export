-- Migration: 006_wallet_ledger_corrections.sql
--
-- Corrects two things about the functions added in 005, and adds one more.
--
-- 1. DEBITS MUST NOT COUNT AS REVENUE
--
--    processed_payments is summed as revenue:
--
--      src/app/actions/global-aggregation.ts
--        db.collection(PROCESSED_PAYMENTS)
--          .where("status", "==", "completed")
--          .select("amount")
--
--    `status` is not a native column on processed_payments, so that filter
--    reads raw_data->>'status'. 005's debit_wallet_once wrote 'completed'
--    there, which would have counted every marketplace wallet checkout as
--    revenue — on top of the Paystack payment that funded the wallet in the
--    first place. The same money, banked twice.
--
--    The original checkout code never wrote to processed_payments at all, so
--    this was introduced by 005 rather than inherited. Debits now write
--    status 'wallet_debit', which the revenue query does not match.
--
-- 2. CREDITS NEED A STATUS THAT IS NOT ALWAYS 'completed'
--
--    A refund returning money to a wallet is not revenue either. credit_wallet_once
--    now takes p_status so callers can distinguish 'completed' (a real payment
--    in) from 'refund' (money going back).
--
-- 3. NOT EVERY DEBIT HAS AN IDEMPOTENCY KEY
--
--    A withdrawal request is a fresh intent each time — there is no stable
--    reference to claim, and two genuine requests should both succeed. What it
--    still needs is the row lock, so two concurrent requests cannot both pass
--    the sufficiency check and overdraw. debit_wallet_locked does the locking
--    without claiming a reference or writing a payment row.
--
-- SAFE TO APPLY
--   Replaces two functions and adds a third. No table, column or row is
--   touched. Inert until code calls it. If 005 was never applied, this file
--   still works — every function here is CREATE OR REPLACE.

BEGIN;

-- ============================================================================
-- credit_wallet_once — now with an explicit payment status.
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_wallet_once(
    p_reference    TEXT,
    p_user_id      TEXT,
    p_amount       NUMERIC,
    p_payment_type TEXT DEFAULT NULL,
    p_source       TEXT DEFAULT NULL,
    p_raw_data     JSONB DEFAULT '{}'::jsonb,
    p_status       TEXT DEFAULT 'completed'
)
RETURNS TABLE (claimed BOOLEAN, balance NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows    INT;
    v_balance NUMERIC;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'credit_wallet_once: amount must be positive, got %', p_amount;
    END IF;

    INSERT INTO processed_payments (id, user_id, amount, reference, raw_data)
    VALUES (
        p_reference,
        p_user_id,
        p_amount,
        p_reference,
        COALESCE(p_raw_data, '{}'::jsonb)
            || jsonb_build_object(
                'reference',   p_reference,
                'userId',      p_user_id,
                'amount',      p_amount,
                'type',        p_payment_type,
                'source',      p_source,
                'status',      COALESCE(p_status, 'completed'),
                'processedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        SELECT w.balance INTO v_balance FROM wallets w WHERE w.id = p_user_id;
        RETURN QUERY SELECT FALSE, COALESCE(v_balance, 0::NUMERIC);
        RETURN;
    END IF;

    INSERT INTO wallets (id, balance)
    VALUES (p_user_id, p_amount)
    ON CONFLICT (id) DO UPDATE
        SET balance    = wallets.balance + EXCLUDED.balance,
            updated_at = NOW()
    RETURNING wallets.balance INTO v_balance;

    RETURN QUERY SELECT TRUE, v_balance;
END;
$$;

-- ============================================================================
-- debit_wallet_once — records status 'wallet_debit' so revenue excludes it.
-- ============================================================================

CREATE OR REPLACE FUNCTION debit_wallet_once(
    p_reference TEXT,
    p_user_id   TEXT,
    p_amount    NUMERIC,
    p_purpose   TEXT DEFAULT NULL,
    p_raw_data  JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (ok BOOLEAN, balance NUMERIC, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows    INT;
    v_balance NUMERIC;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'debit_wallet_once: amount must be positive, got %', p_amount;
    END IF;

    SELECT w.balance INTO v_balance
      FROM wallets w
     WHERE w.id = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 'no_wallet'::TEXT;
        RETURN;
    END IF;

    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, v_balance, 'insufficient_funds'::TEXT;
        RETURN;
    END IF;

    INSERT INTO processed_payments (id, user_id, amount, reference, raw_data)
    VALUES (
        p_reference,
        p_user_id,
        p_amount,
        p_reference,
        COALESCE(p_raw_data, '{}'::jsonb)
            || jsonb_build_object(
                'reference',   p_reference,
                'userId',      p_user_id,
                'amount',      p_amount,
                'type',        'wallet_debit',
                'purpose',     p_purpose,
                -- NOT 'completed': global-aggregation sums those as revenue.
                'status',      'wallet_debit',
                'processedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        RETURN QUERY SELECT FALSE, v_balance, 'already_processed'::TEXT;
        RETURN;
    END IF;

    UPDATE wallets
       SET balance    = wallets.balance - p_amount,
           updated_at = NOW()
     WHERE wallets.id = p_user_id
    RETURNING wallets.balance INTO v_balance;

    RETURN QUERY SELECT TRUE, v_balance, NULL::TEXT;
END;
$$;

-- ============================================================================
-- debit_wallet_locked — atomic debit with no idempotency claim.
--
-- For debits that have no stable reference, such as a withdrawal request.
-- Locks the wallet row before the sufficiency check so concurrent debits
-- serialise; writes no payment row.
-- ============================================================================

CREATE OR REPLACE FUNCTION debit_wallet_locked(
    p_user_id TEXT,
    p_amount  NUMERIC
)
RETURNS TABLE (ok BOOLEAN, balance NUMERIC, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'debit_wallet_locked: amount must be positive, got %', p_amount;
    END IF;

    SELECT w.balance INTO v_balance
      FROM wallets w
     WHERE w.id = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 'no_wallet'::TEXT;
        RETURN;
    END IF;

    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, v_balance, 'insufficient_funds'::TEXT;
        RETURN;
    END IF;

    UPDATE wallets
       SET balance    = wallets.balance - p_amount,
           updated_at = NOW()
     WHERE wallets.id = p_user_id
    RETURNING wallets.balance INTO v_balance;

    RETURN QUERY SELECT TRUE, v_balance, NULL::TEXT;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
--
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('credit_wallet_once', 'debit_wallet_once', 'debit_wallet_locked');
--
-- Confirm a debit is not counted as revenue:
--
--   SELECT raw_data->>'status' FROM processed_payments WHERE id = '<a debit reference>';
--   -- expect 'wallet_debit', never 'completed'

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS debit_wallet_locked(TEXT, NUMERIC);
-- -- and re-apply 005 to restore the previous two definitions.
