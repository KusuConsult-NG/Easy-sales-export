-- Migration: 019_claim_idempotency_key.sql
--
-- An insert-if-absent claim for idempotency_keys, so a form submitted twice
-- cannot be acted on twice.
--
-- WHY THIS EXISTS
-- ---------------
-- Two actions take an idempotencyKey from the client and "check" it like this:
--
--     const doc = await idempotencyRef.get();
--     if (doc.exists) throw new Error("Duplicate transaction detected.");
--     ... do the work ...
--     idempotencyRef.set({ ... });          // the key is written LAST
--
-- That is the same check-then-write this codebase has been unpicking
-- everywhere else. The read takes no lock and the key is written after the
-- work, so two submissions carrying the SAME key both read "absent" and both
-- proceed. The key made the duplicate look impossible without preventing it.
--
-- The two callers:
--
--   platform.ts        submitWithdrawalRequest — locks a member's savings and
--                      creates a withdrawal request. A double submission
--                      locked the funds TWICE.
--   export.ts          _createExportWindowAction — creates an export window.
--                      No money, so a duplicate costs a stray record.
--
-- THE FIX
-- -------
-- INSERT ... ON CONFLICT DO NOTHING against the primary key, which is the same
-- mechanism claim_payment_once (009) uses for processed_payments. Exactly one
-- concurrent caller wins the insert, and Postgres decides it rather than the
-- application.
--
-- The claim is taken BEFORE the work, not after. A caller that claims and then
-- fails leaves the key held, so the action cannot be retried with that key —
-- deliberate, and the same trade-off claim_payment_once documents: for money, a
-- stuck request somebody investigates beats one that silently runs twice. The
-- client generates a fresh key per attempt, so a genuine retry is unaffected.
--
-- WHERE THE ROWS LIVE
--   `idempotency_keys` is not in schema.sql, so it falls through to the generic
--   `document_collections` table, keyed by (collection_name, id). The function
--   below writes there and takes the collection name as a parameter rather than
--   assuming it, so it keeps working if the collection is ever promoted to a
--   dedicated table.
--
-- SAFE TO APPLY
--   Adds one function. Creates no table, alters no column, changes no row.
--   Applying it has no effect until code calls it. Rollback is at the bottom.

BEGIN;

-- ============================================================================
-- claim_idempotency_key
--
-- Returns:
--   claimed  TRUE  when this call inserted the key and should do the work
--            FALSE when the key was already held (a duplicate submission)
--   held_at  when the winning caller claimed it, for logging a duplicate
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_idempotency_key(
    p_key        TEXT,
    p_user_id    TEXT DEFAULT NULL,
    p_action     TEXT DEFAULT NULL,
    p_collection TEXT DEFAULT 'idempotency_keys'
)
RETURNS TABLE (claimed BOOLEAN, held_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows    INT;
    v_held_at TIMESTAMPTZ;
BEGIN
    IF p_key IS NULL OR TRIM(p_key) = '' THEN
        RAISE EXCEPTION 'claim_idempotency_key: key is required';
    END IF;

    INSERT INTO document_collections (id, collection_name, raw_data)
    VALUES (
        p_key,
        p_collection,
        jsonb_build_object(
            'id',        p_key,
            'userId',    p_user_id,
            'action',    p_action,
            'createdAt', to_char(NOW() AT TIME ZONE 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
    )
    -- Matches the declared PRIMARY KEY (id, collection_name) in schema.sql,
    -- in that column order, so the conflict target resolves to the PK index.
    ON CONFLICT (id, collection_name) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
        RETURN QUERY SELECT TRUE, NOW();
        RETURN;
    END IF;

    SELECT d.created_at INTO v_held_at
      FROM document_collections d
     WHERE d.collection_name = p_collection
       AND d.id = p_key;

    RETURN QUERY SELECT FALSE, v_held_at;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- First call claims, second does not:
--
--   SELECT * FROM claim_idempotency_key('test-key-1', 'user-1', 'unit_test');
--   -- expect claimed = true
--   SELECT * FROM claim_idempotency_key('test-key-1', 'user-1', 'unit_test');
--   -- expect claimed = false, held_at = the first call's timestamp
--
-- Clean up:
--   DELETE FROM document_collections
--    WHERE collection_name = 'idempotency_keys' AND id = 'test-key-1';
--
-- Concurrency — the property the unit tests cannot cover. In two sessions:
--   session A: BEGIN; SELECT * FROM claim_idempotency_key('race-1');
--   session B: SELECT * FROM claim_idempotency_key('race-1');   -- blocks
--   session A: COMMIT;
--   session B then returns claimed = false. Blocking is the fix working.
--
-- The ON CONFLICT target is (id, collection_name), matching the PRIMARY KEY
-- declared for document_collections in schema.sql. Confirm it is still that
-- before applying — if the key ever changes, the clause must follow it or the
-- insert will raise rather than claim:
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'document_collections'::regclass AND contype IN ('p','u');
--   -- expect: PRIMARY KEY (id, collection_name)

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS claim_idempotency_key(TEXT, TEXT, TEXT, TEXT);
