-- Migration: 011_wallet_balance_raw_data_sync.sql
--
-- Corrects the wallet functions from 005/006, which updated a column the
-- application does not read.
--
-- WHAT WENT WRONG
-- ---------------
-- credit_wallet_once, debit_wallet_once and debit_wallet_locked all move money
-- by updating wallets.balance — the native SQL column. That is the obvious
-- thing to do, and it is wrong here.
--
-- buildDedicatedRow in supabase-db.ts writes the WHOLE document into raw_data
-- and additionally copies mapped fields into native columns, so a wallet
-- carries its balance twice: wallets.balance and wallets.raw_data->>'balance'.
--
-- Reads prefer raw_data:
--
--   SupabaseDocumentReference.get()  hydrates from raw_data and never consults
--                                    wallets.balance at all
--   SupabaseQuery.get()              falls back to the native column ONLY when
--                                    raw_data has no such key
--
-- Every wallet created through the adapter has raw_data.balance, so the native
-- column is effectively invisible to the application. A credit applied to it
-- alone changes nothing the user or the app can see.
--
-- HOW THIS WAS MISSED
-- -------------------
-- 005/006 were verified on staging with SELECT balance FROM wallets and by
-- reading the functions' own return values — both the native column. Neither
-- check went through the application's read path, so both agreed with each
-- other and with nothing else.
--
-- THE FIX
-- -------
-- Every balance write updates both places, and both are derived from the
-- raw_data value. Deriving from raw_data rather than the column means a wallet
-- whose two copies have already drifted converges on the value the application
-- has been showing the user, rather than silently adopting the other one.
--
-- SAFE TO APPLY
--   Replaces three functions. No table, column or row is touched. If 005/006
--   were applied and any balance moved through them, see the reconciliation
--   query at the bottom before running this.

BEGIN;

-- ============================================================================
-- credit_wallet_once — writes raw_data.balance and wallets.balance together.
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
        p_reference, p_user_id, p_amount, p_reference,
        COALESCE(p_raw_data, '{}'::jsonb)
            || jsonb_build_object(
                'reference', p_reference, 'userId', p_user_id, 'amount', p_amount,
                'type', p_payment_type, 'source', p_source,
                'status', COALESCE(p_status, 'completed'),
                'processedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        SELECT COALESCE((w.raw_data ->> 'balance')::numeric, w.balance, 0)
          INTO v_balance FROM wallets w WHERE w.id = p_user_id;
        RETURN QUERY SELECT FALSE, COALESCE(v_balance, 0::NUMERIC);
        RETURN;
    END IF;

    INSERT INTO wallets (id, balance, raw_data)
    VALUES (
        p_user_id,
        p_amount,
        jsonb_build_object('id', p_user_id, 'userId', p_user_id,
                           'balance', p_amount, 'currency', 'NGN')
    )
    ON CONFLICT (id) DO UPDATE
        SET balance    = COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) + p_amount,
            raw_data   = jsonb_set(
                             COALESCE(wallets.raw_data, '{}'::jsonb),
                             ARRAY['balance'],
                             to_jsonb(COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) + p_amount),
                             true
                         ),
            updated_at = NOW()
    RETURNING COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) INTO v_balance;

    RETURN QUERY SELECT TRUE, v_balance;
END;
$$;

-- ============================================================================
-- debit_wallet_once
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

    SELECT COALESCE((w.raw_data ->> 'balance')::numeric, w.balance, 0)
      INTO v_balance
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
        p_reference, p_user_id, p_amount, p_reference,
        COALESCE(p_raw_data, '{}'::jsonb)
            || jsonb_build_object(
                'reference', p_reference, 'userId', p_user_id, 'amount', p_amount,
                'type', 'wallet_debit', 'purpose', p_purpose,
                -- NOT 'completed': global-aggregation sums those as revenue.
                'status', 'wallet_debit',
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
       SET balance    = v_balance - p_amount,
           raw_data   = jsonb_set(COALESCE(raw_data, '{}'::jsonb), ARRAY['balance'],
                                  to_jsonb(v_balance - p_amount), true),
           updated_at = NOW()
     WHERE wallets.id = p_user_id;

    RETURN QUERY SELECT TRUE, v_balance - p_amount, NULL::TEXT;
END;
$$;

-- ============================================================================
-- debit_wallet_locked
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

    SELECT COALESCE((w.raw_data ->> 'balance')::numeric, w.balance, 0)
      INTO v_balance
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
       SET balance    = v_balance - p_amount,
           raw_data   = jsonb_set(COALESCE(raw_data, '{}'::jsonb), ARRAY['balance'],
                                  to_jsonb(v_balance - p_amount), true),
           updated_at = NOW()
     WHERE wallets.id = p_user_id;

    RETURN QUERY SELECT TRUE, v_balance - p_amount, NULL::TEXT;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — the check that 005/006 should have had.
-- ============================================================================
--
-- Set up a wallet the way the ADAPTER writes one, with the balance in both
-- places. This is the shape that exposed the bug; a wallet created with only
-- the native column would have hidden it.
--
--   INSERT INTO wallets (id, balance, raw_data)
--   VALUES ('t-sync-1', 100, '{"id":"t-sync-1","balance":100,"currency":"NGN"}'::jsonb)
--   ON CONFLICT (id) DO UPDATE
--     SET balance = 100, raw_data = '{"id":"t-sync-1","balance":100,"currency":"NGN"}'::jsonb;
--
--   SELECT * FROM credit_wallet_once('t-sync-ref-1', 't-sync-1', 50);
--   -- expect: t, 150
--
-- BOTH copies must now read 150. Before this migration the second was 100.
--
--   SELECT balance AS native_col,
--          (raw_data ->> 'balance')::numeric AS raw_data_value
--     FROM wallets WHERE id = 't-sync-1';
--   -- expect: 150, 150
--
-- raw_data_value is what the application actually shows the user. If it says
-- 100, the credit is invisible in the app no matter what the column says.
--
--   DELETE FROM processed_payments WHERE id LIKE 't-sync-%';
--   DELETE FROM wallets WHERE id = 't-sync-1';

-- ============================================================================
-- RECONCILIATION — only if 005/006 were applied and money moved through them.
-- ============================================================================
--
-- Wallets whose two copies disagree, worst first. raw_data is what the user has
-- been shown, so the difference is what the column gained invisibly:
--
--   SELECT id,
--          (raw_data ->> 'balance')::numeric AS shown_to_user,
--          balance                            AS native_column,
--          balance - (raw_data ->> 'balance')::numeric AS drift
--     FROM wallets
--    WHERE raw_data ? 'balance'
--      AND balance IS DISTINCT FROM (raw_data ->> 'balance')::numeric
--    ORDER BY abs(balance - (raw_data ->> 'balance')::numeric) DESC;
--
-- Decide deliberately which copy is right before correcting anything. Do not
-- assume: a credit that never reached the user is a different problem from a
-- debit that never did.

-- ============================================================================
-- ROLLBACK — re-apply 005 then 006 to restore the previous definitions.
-- ============================================================================
