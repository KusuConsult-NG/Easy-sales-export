-- Migration: 013_debit_jsonb_balance.sql
--
-- A locked, checked debit for balances that live inside raw_data.
--
-- WHY THIS EXISTS
-- ---------------
-- 005/006/011 gave wallets an atomic debit, but they are specific to the
-- `wallets` table and its native `balance` column. Cooperative savings are not
-- there: `cooperative_members.savingsBalance` lives in the raw_data JSONB blob,
-- and two paths debit it with the same read-check-write that wallets used to
-- have:
--
--     const currentBalance = membershipDoc.data()?.savingsBalance || 0;
--     if (amount > currentBalance) throw new Error("Insufficient savings balance");
--     transaction.update(ref, { savingsBalance: FieldValue.increment(-amount) });
--
-- The check takes no lock, so two withdrawals submitted at once both read the
-- same balance, both pass, and both debit. A member's savings goes negative.
--
-- Migration 010 made the increment itself atomic, which means both debits now
-- definitely land — before, one was likely lost, accidentally masking the
-- overdraft. Same interaction as the escrow cron: making increments correct
-- makes an unguarded check worse, not better.
--
-- WHAT THIS DOES
-- --------------
-- Locks the row with FOR UPDATE, re-reads the balance under that lock, refuses
-- if funds are short, and decrements — all in one statement inside one
-- transaction. Two concurrent callers serialise; the second sees the first's
-- result and is refused.
--
-- Deliberately generic over table and field: the same shape appears on
-- cooperative savings, locked balances and WAVE earnings. One primitive rather
-- than one per balance.
--
-- SAFE TO APPLY
--   Adds one function. No table, column or row is touched. Inert until called.

BEGIN;

CREATE OR REPLACE FUNCTION debit_jsonb_balance(
    p_table      TEXT,
    p_id         TEXT,
    p_field      TEXT,
    p_amount     NUMERIC,
    p_collection TEXT DEFAULT NULL   -- required for document_collections
)
RETURNS TABLE (ok BOOLEAN, balance NUMERIC, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
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

    -- Lock the row and read the balance under the lock. This is the whole
    -- mechanism: the check and the write cannot be separated by another caller.
    IF p_table = 'document_collections' THEN
        v_sql := format(
            'SELECT COALESCE((raw_data ->> %L)::numeric, 0) FROM document_collections '
            'WHERE id = %L AND collection_name = %L FOR UPDATE',
            p_field, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'SELECT COALESCE((raw_data ->> %L)::numeric, 0) FROM %I WHERE id = %L FOR UPDATE',
            p_field, p_table, p_id
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
            'UPDATE document_collections SET raw_data = jsonb_set(raw_data, ARRAY[%L], to_jsonb(%L::numeric), true), '
            'updated_at = NOW() WHERE id = %L AND collection_name = %L',
            p_field, v_balance - p_amount, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'UPDATE %I SET raw_data = jsonb_set(raw_data, ARRAY[%L], to_jsonb(%L::numeric), true), '
            'updated_at = NOW() WHERE id = %L',
            p_table, p_field, v_balance - p_amount, p_id
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
--   INSERT INTO cooperative_members (id, user_id, status, raw_data)
--   VALUES ('t-deb-1', 't-user', 'active', '{"savingsBalance": 1000}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET raw_data = '{"savingsBalance": 1000}'::jsonb;
--
--   SELECT * FROM debit_jsonb_balance('cooperative_members', 't-deb-1', 'savingsBalance', 400);
--   -- expect: t, 600, NULL
--
--   SELECT * FROM debit_jsonb_balance('cooperative_members', 't-deb-1', 'savingsBalance', 900);
--   -- expect: f, 600, insufficient_funds   <-- the overdraft that used to go through
--
-- THE CONCURRENCY TEST — two SQL Editor tabs.
--
--   Tab A:  BEGIN;
--           SELECT * FROM debit_jsonb_balance('cooperative_members','t-deb-1','savingsBalance',400);
--           -- stop, do not commit
--
--   Tab B:  SELECT * FROM debit_jsonb_balance('cooperative_members','t-deb-1','savingsBalance',400);
--           -- EXPECT: Tab B blocks on the row lock
--
--   Tab A:  COMMIT;
--           -- Tab B then returns f, 200, insufficient_funds
--
--   Under the old read-check-write both would have succeeded, leaving -200.
--
--   DELETE FROM cooperative_members WHERE id = 't-deb-1';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS debit_jsonb_balance(TEXT, TEXT, TEXT, NUMERIC, TEXT);
