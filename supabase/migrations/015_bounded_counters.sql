-- Migration: 015_bounded_counters.sql
--
-- Counters that may only move while they stay within a bound.
--
-- WHY THIS EXISTS
-- ---------------
-- Two places check a bound and then change a counter, with no lock between:
--
--   marketplace stock      if (currentQty >= item.quantity)
--                              availableQuantity += -item.quantity
--
--   training capacity      if (currentParticipants >= maxParticipants) throw
--                              currentParticipants += 1
--
-- Two buyers taking the last unit both pass; two registrations for the last
-- seat both pass. Stock goes negative and the session is oversold.
--
-- Migration 010 makes both WORSE rather than better — the fourth and fifth
-- places that is true. The increments used to lose one another, which hid the
-- overshoot; once they apply correctly, both land.
--
-- WHY NOT debit_jsonb_balance (013/014)
-- -------------------------------------
-- It does exactly this for a single field, and stock could use it — except an
-- order decrements SEVERAL products, and it must be all-or-nothing. Calling a
-- single-item function per product would leave the first items decremented when
-- the third is short, which is worse than today: the current queued-write
-- behaviour at least writes nothing when the loop throws.
--
-- So stock needs a multi-item version, and capacity needs a ceiling rather than
-- a floor. Both are here.

BEGIN;

-- ============================================================================
-- decrement_many_or_fail
--
-- Decrements several counters, or none of them.
--
-- p_items is a JSONB array of objects:
--   [{"collection": "products", "id": "abc", "field": "availableQuantity", "amount": 2}, ...]
--
-- Rows are locked in id order, which matters: two orders containing the same
-- two products in different sequences would otherwise deadlock.
--
-- All rows are locked and checked BEFORE any is written, so a shortfall on the
-- last item leaves the first untouched.
--
-- Returns:
--   ok         TRUE when every decrement was applied
--   failed_id  the item that was short, when ok is FALSE
--   reason     'insufficient' or 'not_found'
-- ============================================================================

CREATE OR REPLACE FUNCTION decrement_many_or_fail(p_items JSONB)
RETURNS TABLE (ok BOOLEAN, failed_id TEXT, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_item      JSONB;
    v_id        TEXT;
    v_coll      TEXT;
    v_field     TEXT;
    v_amount    NUMERIC;
    v_current   NUMERIC;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'decrement_many_or_fail: p_items must be a JSONB array';
    END IF;

    -- Pass 1 — lock every row, in id order, and check it can afford the change.
    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
         ORDER BY value ->> 'id'
    LOOP
        v_id     := v_item ->> 'id';
        v_coll   := v_item ->> 'collection';
        v_field  := v_item ->> 'field';
        v_amount := (v_item ->> 'amount')::numeric;

        IF v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'decrement_many_or_fail: amount must be positive for %', v_id;
        END IF;

        SELECT COALESCE((raw_data ->> v_field)::numeric, 0)
          INTO v_current
          FROM document_collections
         WHERE id = v_id AND collection_name = v_coll
           FOR UPDATE;

        IF NOT FOUND THEN
            RETURN QUERY SELECT FALSE, v_id, 'not_found'::TEXT;
            RETURN;
        END IF;

        IF v_current < v_amount THEN
            RETURN QUERY SELECT FALSE, v_id, 'insufficient'::TEXT;
            RETURN;
        END IF;
    END LOOP;

    -- Pass 2 — every row is locked and sufficient, so these cannot fail.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_id     := v_item ->> 'id';
        v_coll   := v_item ->> 'collection';
        v_field  := v_item ->> 'field';
        v_amount := (v_item ->> 'amount')::numeric;

        UPDATE document_collections
           SET raw_data = jsonb_set(
                   raw_data,
                   ARRAY[v_field],
                   to_jsonb(COALESCE((raw_data ->> v_field)::numeric, 0) - v_amount),
                   true
               ),
               updated_at = NOW()
         WHERE id = v_id AND collection_name = v_coll;
    END LOOP;

    RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT;
END;
$$;

-- ============================================================================
-- increment_within_ceiling
--
-- Raises a counter only while it stays at or below a ceiling, where the ceiling
-- is held in another field on the same record.
--
-- For capacity: currentParticipants may rise only while it stays within
-- maxParticipants.
--
-- Returns:
--   ok       TRUE when the increment was applied
--   value    the counter after the call
--   reason   NULL, or 'at_capacity' / 'not_found'
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_within_ceiling(
    p_collection    TEXT,
    p_id            TEXT,
    p_field         TEXT,
    p_amount        NUMERIC,
    p_ceiling_field TEXT
)
RETURNS TABLE (ok BOOLEAN, value NUMERIC, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current NUMERIC;
    v_ceiling NUMERIC;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'increment_within_ceiling: amount must be positive, got %', p_amount;
    END IF;

    SELECT COALESCE((raw_data ->> p_field)::numeric, 0),
           COALESCE((raw_data ->> p_ceiling_field)::numeric, NULL)
      INTO v_current, v_ceiling
      FROM document_collections
     WHERE id = p_id AND collection_name = p_collection
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 'not_found'::TEXT;
        RETURN;
    END IF;

    -- No ceiling recorded means unbounded. Refusing here would break every
    -- event that simply has no cap set.
    IF v_ceiling IS NOT NULL AND v_current + p_amount > v_ceiling THEN
        RETURN QUERY SELECT FALSE, v_current, 'at_capacity'::TEXT;
        RETURN;
    END IF;

    UPDATE document_collections
       SET raw_data = jsonb_set(raw_data, ARRAY[p_field],
                                to_jsonb(v_current + p_amount), true),
           updated_at = NOW()
     WHERE id = p_id AND collection_name = p_collection;

    RETURN QUERY SELECT TRUE, v_current + p_amount, NULL::TEXT;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- Capacity:
--
--   INSERT INTO document_collections (id, collection_name, raw_data)
--   VALUES ('t-evt-1', 'wave_training_events',
--           '{"currentParticipants": 9, "maxParticipants": 10}'::jsonb)
--   ON CONFLICT (id, collection_name) DO UPDATE SET raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM increment_within_ceiling('wave_training_events','t-evt-1',
--                                          'currentParticipants',1,'maxParticipants');
--   -- expect: t, 10, NULL
--   SELECT * FROM increment_within_ceiling('wave_training_events','t-evt-1',
--                                          'currentParticipants',1,'maxParticipants');
--   -- expect: f, 10, at_capacity   <-- the eleventh registration that used to succeed
--
-- Multi-item stock, all-or-nothing:
--
--   INSERT INTO document_collections (id, collection_name, raw_data) VALUES
--     ('t-prod-a','products','{"availableQuantity": 5}'::jsonb),
--     ('t-prod-b','products','{"availableQuantity": 1}'::jsonb)
--   ON CONFLICT (id, collection_name) DO UPDATE SET raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM decrement_many_or_fail('[
--     {"collection":"products","id":"t-prod-a","field":"availableQuantity","amount":2},
--     {"collection":"products","id":"t-prod-b","field":"availableQuantity","amount":3}
--   ]'::jsonb);
--   -- expect: f, t-prod-b, insufficient
--
--   SELECT id, raw_data ->> 'availableQuantity' FROM document_collections
--    WHERE id IN ('t-prod-a','t-prod-b');
--   -- expect 5 and 1 — t-prod-a must NOT have been decremented
--
--   DELETE FROM document_collections WHERE id LIKE 't-prod-%' OR id = 't-evt-1';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS decrement_many_or_fail(JSONB);
-- DROP FUNCTION IF EXISTS increment_within_ceiling(TEXT, TEXT, TEXT, NUMERIC, TEXT);
