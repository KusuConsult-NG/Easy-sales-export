-- Migration: 021_single_open_loan_application.sql
--
-- One open loan application per borrower, enforced where it can actually hold.
--
-- THE DEFECT
--
-- Two actions refuse a borrower who already has an open application:
--
--   cooperative/_actions.ts  _applyForLoanAction   -> writes COOPERATIVE_LOANS
--   loan-actions.ts          submitLoanApplication -> writes LOAN_APPLICATIONS
--
-- Both read BOTH collections, filter to the open statuses, and refuse if either
-- is non-empty. Neither read takes a lock, so two applications submitted
-- together both see an empty result and both insert. docs/audit/
-- atomic-money-migration.md records this twice and declines to patch it, for a
-- good reason: "Closing it needs a uniqueness constraint on a borrower's open
-- applications, not a wrapper."
--
-- WHY NOT A UNIQUE INDEX
--
-- A partial unique index is the obvious answer and does not fit:
--
--   * The rule spans TWO tables — cooperative_loans (dedicated) and
--     document_collections filtered to collection_name = 'loan_applications'.
--     No single index can span both.
--   * CREATE UNIQUE INDEX fails outright if the existing data already violates
--     it, and the very defect being fixed is what would have produced the
--     duplicates. A migration that cannot be applied until production data is
--     cleaned is a migration that does not get applied.
--
-- WHY AN ADVISORY LOCK WORKS
--
-- The problem is a phantom: there is no row to lock, because the thing being
-- guarded is the ABSENCE of rows. Locking a row cannot help; the check and the
-- insert have to be inseparable.
--
-- pg_advisory_xact_lock, taken on a key derived from the borrower, serialises
-- every caller for that borrower for the rest of the transaction. Because the
-- check AND the insert both happen inside this function, and a function call is
-- its own transaction, the lock is held across both. A second caller for the
-- same borrower blocks until the first commits, then sees the row it wrote.
--
-- The lock is per-borrower, so applications from different borrowers do not
-- contend at all. It is released automatically at transaction end, including on
-- error — there is no leak path, which is why xact and not session.
--
-- SAFETY
--   Adds one function. No table, column, row or index is altered, and it does
--   nothing until code calls it. Inert on apply, and it imposes no precondition
--   on existing data: a borrower who already has duplicates simply cannot add
--   a third.

BEGIN;

-- ---------------------------------------------------------------------------
-- claim_single_open_loan_application
--
-- Inserts p_row as a new loan application, but only if the borrower has no open
-- application in EITHER collection.
--
-- p_target_table       'cooperative_loans' or 'document_collections'
-- p_target_collection  NULL for a dedicated table; 'loan_applications' for the
--                      generic one
--
-- Returns
--   claimed      TRUE when the row was inserted
--   existing_id  the id of the open application that blocked it, when not
--
-- Note the two different user fields. COOPERATIVE_LOANS keys the borrower as
-- `memberId` and LOAN_APPLICATIONS as `userId`; the actions already query them
-- that way. Getting this wrong would make the guard silently match nothing,
-- which is indistinguishable from working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_single_open_loan_application(
    p_user_id           TEXT,
    p_id                TEXT,
    p_target_table      TEXT,
    p_row               JSONB,
    p_target_collection TEXT DEFAULT NULL
)
RETURNS TABLE (claimed BOOLEAN, existing_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_open    TEXT[] := ARRAY['pending', 'reviewing', 'approved', 'partially_approved', 'disbursed'];
    v_found   TEXT;
BEGIN
    IF p_user_id IS NULL OR p_user_id = '' THEN
        RAISE EXCEPTION 'claim_single_open_loan_application: user id is required';
    END IF;
    IF p_target_table NOT IN ('cooperative_loans', 'document_collections') THEN
        RAISE EXCEPTION 'claim_single_open_loan_application: table % is not allowed', p_target_table;
    END IF;
    IF p_target_table = 'document_collections' AND COALESCE(p_target_collection, '') = '' THEN
        RAISE EXCEPTION 'claim_single_open_loan_application: collection is required for document_collections';
    END IF;

    -- Serialise every application for THIS borrower. Held to the end of the
    -- implicit transaction around this function, so it covers the checks below
    -- and the insert together — which is the whole point, since the thing being
    -- guarded is the absence of a row and there is nothing to lock with
    -- FOR UPDATE.
    PERFORM pg_advisory_xact_lock(hashtext('loan_application:' || p_user_id));

    -- Open cooperative loan? Borrower is `memberId` here.
    SELECT id INTO v_found
      FROM cooperative_loans
     WHERE raw_data ->> 'memberId' = p_user_id
       AND raw_data ->> 'status' = ANY(v_open)
     LIMIT 1;

    IF v_found IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, v_found;
        RETURN;
    END IF;

    -- Open general loan application? Borrower is `userId` here.
    SELECT id INTO v_found
      FROM document_collections
     WHERE collection_name = 'loan_applications'
       AND raw_data ->> 'userId' = p_user_id
       AND raw_data ->> 'status' = ANY(v_open)
     LIMIT 1;

    IF v_found IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, v_found;
        RETURN;
    END IF;

    IF p_target_table = 'cooperative_loans' THEN
        INSERT INTO cooperative_loans (id, raw_data, created_at, updated_at)
        VALUES (p_id, p_row, NOW(), NOW());
    ELSE
        INSERT INTO document_collections (id, collection_name, raw_data, created_at, updated_at)
        VALUES (p_id, p_target_collection, p_row, NOW(), NOW());
    END IF;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify after applying
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'claim_single_open_loan_application';
--
-- Basic behaviour:
--   SELECT * FROM claim_single_open_loan_application(
--     't-usr-1', 't-loan-1', 'cooperative_loans',
--     '{"memberId":"t-usr-1","status":"pending","amount":1000}'::jsonb);
--   -- expect claimed = true
--
--   SELECT * FROM claim_single_open_loan_application(
--     't-usr-1', 't-loan-2', 'document_collections',
--     '{"userId":"t-usr-1","status":"pending","amount":1000}'::jsonb,
--     'loan_applications');
--   -- expect claimed = false, existing_id = 't-loan-1'
--   -- CROSS-COLLECTION: the cooperative loan blocks the general application.
--
-- Concurrency — the property the unit tests cannot cover:
--   Tab A:  BEGIN;
--           SELECT * FROM claim_single_open_loan_application(
--             't-usr-2', 't-loan-3', 'cooperative_loans',
--             '{"memberId":"t-usr-2","status":"pending"}'::jsonb);
--           -- leave open
--   Tab B:  SELECT * FROM claim_single_open_loan_application(
--             't-usr-2', 't-loan-4', 'cooperative_loans',
--             '{"memberId":"t-usr-2","status":"pending"}'::jsonb);
--           -- expect B to BLOCK. Blocking is the fix working: under the old
--           -- code both read an empty result and both inserted.
--   Tab A:  COMMIT;
--           -- B then returns claimed = false, existing_id = 't-loan-3'
--
--   DELETE FROM cooperative_loans WHERE id IN ('t-loan-1','t-loan-3','t-loan-4');
--   DELETE FROM document_collections WHERE id = 't-loan-2';
--
-- Rollback
--   DROP FUNCTION IF EXISTS claim_single_open_loan_application(TEXT,TEXT,TEXT,JSONB,TEXT);
-- ---------------------------------------------------------------------------
