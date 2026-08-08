-- Migration: 009_claim_payment_once.sql
--
-- Claims a payment reference without moving any money.
--
-- WHY THIS EXISTS
-- ---------------
-- 005 gave us credit_wallet_once and debit_wallet_once, which claim a reference
-- AND change a balance. Most payment fulfilment does not change a balance: it
-- marks an order paid, creates escrow rows, writes a ledger entry, sends a
-- receipt. What it needs is only the claim.
--
-- src/infrastructure/payments/service.ts has seven of these, all the same shape:
--
--     const processedSnap = await transaction.get(processedRef);
--     if (processedSnap.exists && processedSnap.data()?.status === "completed") {
--         return { alreadyProcessed: true };
--     }
--     ... do the fulfilment ...
--     transaction.set(processedRef, { status: "completed", ... });
--
-- runTransaction takes no lock, so two deliveries of the same Paystack webhook
-- both read "not completed", both fulfil, and both write the marker. The order
-- is fulfilled twice: duplicate escrow rows, duplicate ledger entries,
-- duplicate seller credits. Paystack retries webhooks, so this is not a rare
-- race — it is the documented behaviour of the payment provider.
--
-- claim_payment_once decides the winner in Postgres, using the same
-- INSERT ... ON CONFLICT DO NOTHING against the processed_payments primary key
-- that 005 uses. Exactly one caller proceeds.
--
-- USAGE
--   Claim FIRST, then fulfil. If the claim is lost, return early and do
--   nothing — the work is already done or in flight.
--
--   A claim is not a transaction around the fulfilment that follows it. If
--   fulfilment fails after a successful claim, the reference stays claimed and
--   the payment will not be retried automatically. That is deliberate: for
--   money, a stuck payment that someone has to look at beats one that silently
--   fulfils twice. Log loudly on failure so it can be found.
--
-- SAFE TO APPLY
--   Adds one function. No table, column or row is touched. Inert until called.

BEGIN;

-- ============================================================================
-- claim_payment_once
--
-- Returns:
--   claimed  TRUE  when this call claimed the reference and should fulfil
--            FALSE when it was already claimed — do nothing
--   status   the status recorded on the existing row when claimed is FALSE,
--            so a caller can distinguish "already completed" from a row left
--            behind in some other state.
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_payment_once(
    p_reference TEXT,
    p_user_id   TEXT,
    p_amount    NUMERIC,
    p_type      TEXT DEFAULT NULL,
    p_source    TEXT DEFAULT NULL,
    p_raw_data  JSONB DEFAULT '{}'::jsonb,
    p_status    TEXT DEFAULT 'completed'
)
RETURNS TABLE (claimed BOOLEAN, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows    INT;
    v_current TEXT;
BEGIN
    IF p_reference IS NULL OR TRIM(p_reference) = '' THEN
        RAISE EXCEPTION 'claim_payment_once: reference is required';
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
                'type',        p_type,
                'source',      p_source,
                'status',      COALESCE(p_status, 'completed'),
                'processedAt', to_char(NOW() AT TIME ZONE 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
        RETURN QUERY SELECT TRUE, COALESCE(p_status, 'completed');
        RETURN;
    END IF;

    SELECT p.raw_data->>'status' INTO v_current
      FROM processed_payments p
     WHERE p.id = p_reference;

    RETURN QUERY SELECT FALSE, v_current;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
--   SELECT * FROM claim_payment_once('t-claim-1', 't-user', 500, 'marketplace_order');
--   -- expect: t, completed
--
--   SELECT * FROM claim_payment_once('t-claim-1', 't-user', 500, 'marketplace_order');
--   -- expect: f, completed   <-- the duplicate webhook that used to fulfil twice
--
--   DELETE FROM processed_payments WHERE id = 't-claim-1';
--
-- Revenue check — a claim marked completed IS counted as revenue by
-- global-aggregation, which is correct for an inbound payment. Pass a
-- different p_status for anything that is not money in.

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS claim_payment_once(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB, TEXT);
