-- Migration: 007_status_transition_cas.sql
--
-- A compare-and-swap for document status, so a state machine cannot be
-- advanced twice.
--
-- WHY THIS EXISTS
-- ---------------
-- Withdrawal approval moves a record pending → payout_initiated → completed,
-- and each step was a check-then-write inside runTransaction:
--
--     const fresh = await t.get(txnRef);
--     if (fresh.data()?.status !== "pending") throw ...;
--     t.update(txnRef, { status: "payout_initiated" });
--
-- runTransaction takes no lock, so two admins approving the same withdrawal at
-- once both read "pending", both write "payout_initiated", and both continue to
-- the Paystack transfer call. The user is paid twice, out of the business's
-- money, and nothing errors.
--
-- No balance is involved — the wallet was already debited when the withdrawal
-- was requested — so the wallet functions in 005/006 do not cover this. What is
-- needed is a conditional update: change the status ONLY IF it is still the
-- value we expect, and report whether we were the one who changed it.
--
--     UPDATE ... WHERE raw_data->>'status' = p_from
--
-- A single UPDATE takes a row lock for its duration and re-reads under it, so
-- exactly one of two concurrent callers matches the WHERE clause. The loser
-- gets 0 rows and knows to stop.
--
-- GENERAL, DELIBERATELY
-- ---------------------
-- Written against document_collections rather than withdrawals specifically,
-- because the same check-then-write shape appears throughout this codebase
-- (order fulfilment, escrow release, loan approval). Reuse it rather than
-- writing another one.
--
-- SAFE TO APPLY
--   Adds one function. No table, column or row is touched. Inert until called.

BEGIN;

-- ============================================================================
-- claim_status_transition
--
-- Advances a document_collections row from one status to another, but only if
-- it currently holds the expected status.
--
-- Arguments:
--   p_collection  collection_name, e.g. 'wallet_transactions'
--   p_id          document id
--   p_from        the status the caller believes the row is in
--   p_to          the status to move it to
--   p_patch       additional raw_data fields to merge in (optional)
--
-- Returns:
--   claimed  TRUE  when this call performed the transition
--            FALSE when the row was missing, or was not in p_from — meaning
--                  somebody else already moved it
--   status   the row's status after the call, or NULL when the row is missing.
--            Use it to tell "already advanced" from "never existed".
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_status_transition(
    p_collection TEXT,
    p_id         TEXT,
    p_from       TEXT,
    p_to         TEXT,
    p_patch      JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (claimed BOOLEAN, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows    INT;
    v_current TEXT;
BEGIN
    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'claim_status_transition: from and to are required';
    END IF;

    -- The whole mechanism. Two concurrent callers cannot both match this
    -- WHERE clause: the UPDATE locks the row and re-evaluates under the lock.
    UPDATE document_collections
       SET raw_data   = raw_data
                        || COALESCE(p_patch, '{}'::jsonb)
                        || jsonb_build_object(
                             'status',    p_to,
                             'updatedAt', to_char(NOW() AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                           ),
           updated_at = NOW()
     WHERE id              = p_id
       AND collection_name = p_collection
       AND raw_data->>'status' = p_from;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
        RETURN QUERY SELECT TRUE, p_to;
        RETURN;
    END IF;

    -- We lost, or the row is not there. Report which.
    SELECT d.raw_data->>'status' INTO v_current
      FROM document_collections d
     WHERE d.id = p_id
       AND d.collection_name = p_collection;

    RETURN QUERY SELECT FALSE, v_current;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging after applying.
-- ============================================================================
--
-- Set up a row:
--
--   INSERT INTO document_collections (id, collection_name, raw_data)
--   VALUES ('test-cas-1', 'wallet_transactions', '{"status":"pending"}'::jsonb);
--
-- First caller wins:
--
--   SELECT * FROM claim_status_transition(
--       'wallet_transactions', 'test-cas-1', 'pending', 'payout_initiated');
--   -- expect: t, payout_initiated
--
-- Second caller loses — this is the double-payout that used to get through:
--
--   SELECT * FROM claim_status_transition(
--       'wallet_transactions', 'test-cas-1', 'pending', 'payout_initiated');
--   -- expect: f, payout_initiated
--
-- Missing row is distinguishable:
--
--   SELECT * FROM claim_status_transition(
--       'wallet_transactions', 'nope', 'pending', 'payout_initiated');
--   -- expect: f, NULL
--
-- Clean up:
--
--   DELETE FROM document_collections WHERE id = 'test-cas-1';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS claim_status_transition(TEXT, TEXT, TEXT, TEXT, JSONB);
