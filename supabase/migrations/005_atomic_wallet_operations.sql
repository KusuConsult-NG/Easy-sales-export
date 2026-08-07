-- Migration: 005_atomic_wallet_operations.sql
--
-- Atomic credit and debit for wallets, replacing the read-then-write pattern
-- that every money path currently uses.
--
-- WHY THIS EXISTS
-- ---------------
-- supabaseDb.runTransaction is not a transaction:
--
--     async runTransaction(fn) {
--         const tx = new SupabaseTransaction();
--         const result = await fn(tx);   // reads, unisolated
--         await tx._commit();            // writes replayed afterwards
--         return result;
--     }
--
-- There is no BEGIN, no row lock, no rollback and no retry. Callers read a
-- balance, add to it in JavaScript, and write the absolute result back. That
-- gives two distinct defects on live money:
--
--   LOST UPDATE (credits)
--     Two payments crediting the same wallet at once both read balance 1000,
--     both compute 1000 + their own amount, and the second write overwrites
--     the first. One payment is silently swallowed — the user is short, and
--     nothing errors.
--
--   OVERDRAFT (debits)
--     Two checkouts both read balance 1000, both pass a "balance >= amount"
--     check, and both debit. The wallet goes negative, or goes to whichever
--     absolute value landed last.
--
-- Idempotency has the same hole. Callers check whether a payment reference was
-- already processed and then write the processed_payments row later, so two
-- deliveries of the same Paystack webhook can both pass the check.
--
-- THE FIX
-- -------
-- Both functions below do the whole operation in one statement inside one
-- real transaction:
--
--   * The payment reference is claimed with INSERT ... ON CONFLICT DO NOTHING
--     against processed_payments.id, which is the PRIMARY KEY. Exactly one
--     concurrent caller can win that insert. That is the idempotency gate, and
--     it is decided by Postgres rather than by an application-level check.
--
--   * The balance moves with `balance = balance + delta` computed inside the
--     database, never read into JavaScript and written back. Concurrent
--     credits therefore sum instead of overwriting each other.
--
--   * Debits take FOR UPDATE on the wallet row before checking sufficiency, so
--     concurrent debits serialise and cannot both pass the check.
--
-- NOTE ON processed_payments.reference
--   The `reference` column is deliberately not UNIQUE — schema.sql records that
--   Firestore allowed duplicate references. The PRIMARY KEY on `id` is what
--   these functions rely on, and every caller writes the reference as the
--   document id (`db.collection(PROCESSED_PAYMENTS).doc(reference)`), so id and
--   reference agree. If a caller ever writes a random id with a reference in
--   the body, idempotency will not hold for that caller.
--
-- SAFE TO APPLY
--   This migration only adds two functions. It creates no table, alters no
--   column, and changes no existing row. Applying it has no effect until code
--   calls the functions. Dropping them again is the rollback, at the bottom.

BEGIN;

-- ============================================================================
-- credit_wallet_once
--
-- Claims a payment reference and credits the wallet, or reports that the
-- reference was already claimed and changes nothing.
--
-- Returns:
--   claimed  TRUE  when this call claimed the reference and applied the credit
--            FALSE when the reference was already processed (no-op)
--   balance  the wallet balance after this call
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_wallet_once(
    p_reference    TEXT,
    p_user_id      TEXT,
    p_amount       NUMERIC,
    p_payment_type TEXT DEFAULT NULL,
    p_source       TEXT DEFAULT NULL,
    p_raw_data     JSONB DEFAULT '{}'::jsonb
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

    -- Claim the reference. Only one concurrent caller can win this insert.
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
                'status',      'completed',
                'processedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        -- Already processed. Report the current balance without touching it.
        SELECT w.balance INTO v_balance FROM wallets w WHERE w.id = p_user_id;
        RETURN QUERY SELECT FALSE, COALESCE(v_balance, 0::NUMERIC);
        RETURN;
    END IF;

    -- Apply the credit in the database. Concurrent credits sum.
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
-- debit_wallet_once
--
-- Claims a reference and debits the wallet, refusing when funds are short.
--
-- The wallet row is locked FOR UPDATE before the sufficiency check, so two
-- concurrent debits cannot both decide there is enough money.
--
-- Returns:
--   ok       TRUE when the debit was applied
--   balance  balance after this call (unchanged when ok is FALSE)
--   reason   NULL on success, otherwise 'already_processed',
--            'insufficient_funds' or 'no_wallet'
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

    -- Lock the wallet row first: this is what serialises concurrent debits.
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
                'status',      'completed',
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

COMMIT;

-- ============================================================================
-- VERIFICATION — run after applying.
-- ============================================================================
--
--   SELECT proname, pronargs
--     FROM pg_proc
--    WHERE proname IN ('credit_wallet_once', 'debit_wallet_once');
--
-- Both should be listed. To prove idempotency on a scratch row:
--
--   SELECT * FROM credit_wallet_once('test-ref-1', 'test-user', 100);  -- t, 100
--   SELECT * FROM credit_wallet_once('test-ref-1', 'test-user', 100);  -- f, 100
--   DELETE FROM processed_payments WHERE id = 'test-ref-1';
--   DELETE FROM wallets WHERE id = 'test-user';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS credit_wallet_once(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB);
-- DROP FUNCTION IF EXISTS debit_wallet_once(TEXT, TEXT, NUMERIC, TEXT, JSONB);
