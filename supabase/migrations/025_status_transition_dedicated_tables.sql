-- Migration: 025_status_transition_dedicated_tables.sql
--
-- Lets claim_status_transition reach the eight DEDICATED TABLES.
--
-- WHAT WAS WRONG
-- --------------
-- 007 wrote the compare-and-swap against document_collections and nothing else:
--
--     UPDATE document_collections
--      WHERE id = p_id AND collection_name = p_collection
--        AND raw_data->>'status' = p_from;
--
-- Eight collections do not live there. DEDICATED_TABLE_MAP in supabase-db.ts
-- routes users, cooperative_members, cooperative_loans, transactions,
-- processed_payments, marketplace_orders, wallets and academy_applications to
-- their own tables. For any of those the UPDATE matched zero rows, the
-- follow-up SELECT found nothing, and the function returned
-- (claimed=false, status=NULL) — indistinguishable from losing a race.
--
-- Two such collections are passed to it today:
--
--   COLLECTIONS.COOPERATIVE_LOANS  = "cooperative_loans"  → dedicated
--   COLLECTIONS.MARKETPLACE_ORDERS = "marketplaceOrders"  → dedicated
--
-- MARKETPLACE_ORDERS is the serious one: four call sites drive the order state
-- machine through this function, so no order transition taken through the
-- claimed path has ever succeeded. Callers read claimed=false as "someone else
-- already did it" and returned a conflict, which is why this looked like
-- ordinary contention rather than a function that could not see the row.
--
-- Confirmed by measurement, not inference:
-- __tests__/db-integration/status-transition-dedicated-tables.test.ts writes a
-- row to marketplace_orders and to cooperative_loans and asks the real RPC to
-- advance it. Against 007 the document_collections control passes and both
-- dedicated cases return claimed=false.
--
-- WHY A NEW FUNCTION RATHER THAN AN EDIT
-- --------------------------------------
-- claim_status_transition keeps its exact signature and behaviour. Callers that
-- pass a generic collection are unaffected, and the rollout cannot change what
-- an existing call does. The new function takes the table explicitly, and
-- status-transition.ts resolves it the same way the adapter does, so there is
-- one mapping rather than two.
--
-- THE STATUS LIVES IN TWO PLACES ON A DEDICATED TABLE
-- --------------------------------------------------
-- These tables carry a native `status` column AND raw_data->>'status'. Reads
-- prefer raw_data, so the JSONB copy is authoritative and is what the CAS
-- predicate tests — matching apply_increments (010), which sets both for the
-- same reason. Both are written, so a native-column reader does not see a
-- stale value. Tables without a status column (wallets) are handled: the
-- column write is conditional on the column existing.
--
-- SAFE TO APPLY
--   Adds one function. No table, column or row is touched. Inert until called.

BEGIN;

-- ============================================================================
-- claim_status_transition_in
--
-- Same contract as claim_status_transition, but names the table.
--
--   p_table       one of the allow-listed tables, or 'document_collections'
--   p_collection  required ONLY for document_collections; ignored otherwise
--
-- Returns:
--   claimed  TRUE  when this call made the transition
--            FALSE when the row was not in p_from — or does not exist
--   status   the row's status after the call, or NULL when the row is missing.
--            The caller distinguishes "lost the race" from "no such row" by
--            testing status IS NULL, exactly as with the original.
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_status_transition_in(
    p_table      TEXT,
    p_id         TEXT,
    p_from       TEXT,
    p_to         TEXT,
    p_collection TEXT  DEFAULT NULL,
    p_patch      JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (claimed BOOLEAN, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rows      INT;
    v_current   TEXT;
    v_sql       TEXT;
    v_has_status BOOLEAN;
    v_allowed   TEXT[] := ARRAY[
        'users', 'cooperative_members', 'cooperative_loans', 'transactions',
        'processed_payments', 'marketplace_orders', 'wallets',
        'academy_applications', 'document_collections'
    ];
BEGIN
    IF NOT (p_table = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'claim_status_transition_in: table % is not allowed', p_table;
    END IF;

    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'claim_status_transition_in: from and to are required';
    END IF;

    IF p_id IS NULL OR TRIM(p_id) = '' THEN
        RAISE EXCEPTION 'claim_status_transition_in: id is required';
    END IF;

    -- document_collections is keyed by (id, collection_name); a claim without
    -- the collection could match a same-id row in a different collection.
    IF p_table = 'document_collections' AND (p_collection IS NULL OR TRIM(p_collection) = '') THEN
        RAISE EXCEPTION 'claim_status_transition_in: collection is required for document_collections';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'status'
    ) INTO v_has_status;

    -- The whole mechanism, unchanged from 007: two concurrent callers cannot
    -- both match this WHERE clause, because the UPDATE locks the row and
    -- re-evaluates the predicate under the lock.
    v_sql := format(
        'UPDATE %1$I
            SET raw_data = raw_data
                           || COALESCE($1, ''{}''::jsonb)
                           || jsonb_build_object(
                                ''status'', $2,
                                ''updatedAt'', to_char(NOW() AT TIME ZONE ''UTC'',
                                                       ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')
                              )%2$s,
                updated_at = NOW()
          WHERE id = $3
            AND raw_data->>''status'' = $4%3$s',
        p_table,
        CASE WHEN v_has_status THEN ', status = $2' ELSE '' END,
        CASE WHEN p_table = 'document_collections' THEN ' AND collection_name = $5' ELSE '' END
    );

    IF p_table = 'document_collections' THEN
        EXECUTE v_sql USING COALESCE(p_patch, '{}'::jsonb), p_to, p_id, p_from, p_collection;
    ELSE
        EXECUTE v_sql USING COALESCE(p_patch, '{}'::jsonb), p_to, p_id, p_from;
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
        RETURN QUERY SELECT TRUE, p_to;
        RETURN;
    END IF;

    -- Lost the race, or the row is not there. Report which.
    IF p_table = 'document_collections' THEN
        EXECUTE format('SELECT raw_data->>''status'' FROM %I WHERE id = $1 AND collection_name = $2', p_table)
            INTO v_current USING p_id, p_collection;
    ELSE
        EXECUTE format('SELECT raw_data->>''status'' FROM %I WHERE id = $1', p_table)
            INTO v_current USING p_id;
    END IF;

    RETURN QUERY SELECT FALSE, v_current;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging, or let the db-integration suite do it.
-- ============================================================================
--
--   INSERT INTO marketplace_orders (id, user_id, status, raw_data)
--   VALUES ('t-cas-1', 't-user', 'pending', '{"status":"pending"}'::jsonb);
--
--   SELECT * FROM claim_status_transition_in('marketplace_orders', 't-cas-1', 'pending', 'paid');
--   -- expect: t, paid
--   SELECT * FROM claim_status_transition_in('marketplace_orders', 't-cas-1', 'pending', 'paid');
--   -- expect: f, paid   (the second caller must lose)
--
--   SELECT status, raw_data->>'status' FROM marketplace_orders WHERE id = 't-cas-1';
--   -- expect: paid, paid   (both copies moved)
--
--   DELETE FROM marketplace_orders WHERE id = 't-cas-1';
