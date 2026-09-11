-- 035 — THE GUARD AGAINST OVERSELLING OVERSOLD.
--
--   #652. `decrement_many_or_fail` (migration 015) is the single thing standing
--   between two buyers and the last unit of stock. Every purchase door in the
--   marketplace reserves through it, and so do the export catalogue and
--   actions/orders.ts. Its own call sites explain why it exists:
--
--       "runTransaction in this codebase takes no lock — it replays queued
--        writes after the callback returns. So two buyers ordering the last
--        unit both read availableQuantity 1, both pass the check, and both
--        write 0. Two orders, one unit: overselling."
--
--   IT DID THAT ITSELF WHENEVER ONE CALL NAMED THE SAME ROW TWICE.
--
--   Pass 1 locked each row and compared its CURRENT value against that line's
--   amount. Nothing had been decremented yet, so two lines of 3 against a stock
--   of 5 both passed — 3 ≤ 5, twice — and pass 2 then subtracted 3 twice.
--
--       stock 5, two lines of 3  ->  ok: true, stock: -1
--
--   Measured against a real PostgreSQL 16 with this schema, not reasoned about.
--   Six units taken from a stock of five, reported as success, so the order
--   completes, escrow is written and the seller is credited for goods they
--   cannot ship. The negative figure then leaks into everything downstream: the
--   card's "Only N left", the `availableQuantity === 0` tests, and the next
--   buyer's reservation, which succeeds against a number that is already a lie.
--
-- HOW A CALL COMES TO NAME ONE ROW TWICE
-- -------------------------------------
--   Every caller maps its order lines to decrement items ONE FOR ONE —
--   _payment_orders.ts in three places, _payment_verify.ts, export-payment.ts
--   and orders.ts — and nothing between the cart and here merges lines. The
--   checkout screen happens to merge on ADD, but the cart itself is localStorage
--   JSON and the action is a reachable endpoint that takes the array it is
--   given; negative-price-cart.test.ts already exercises a two-line cart for one
--   product, so the shape is not hypothetical.
--
-- THE FIX, AND WHY IT IS HERE RATHER THAN IN THE CALLERS
-- -----------------------------------------------------
--   The amounts are summed PER ROW before anything is locked, so one row is
--   locked once, compared once against the total it is being asked for, and
--   written once. A caller that sends the same product on five lines now gets
--   the same answer as one that sends it on one.
--
--   Fixing it in the callers would mean fixing it in six places and remembering
--   it in the seventh. This function's contract is "all of it or none of it, and
--   never below zero"; a contract that holds only for callers who deduplicate
--   first is not the contract its call sites believe they have.
--
-- WHAT IS UNCHANGED
-- -----------------
--   Rows are still locked in id order, so two orders naming the same products in
--   different sequences cannot deadlock. A shortfall still refuses ALL of it and
--   writes nothing. A missing field still reads as zero — an unrecorded stock is
--   not an unlimited one, and #582 records what happens when it is treated as
--   one. A non-positive amount is still an exception, raised now before any row
--   is locked rather than part-way through the walk.

CREATE OR REPLACE FUNCTION public.decrement_many_or_fail(p_items jsonb)
 RETURNS TABLE(ok boolean, failed_id text, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_row       RECORD;
    v_current   NUMERIC;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'decrement_many_or_fail: p_items must be a JSONB array';
    END IF;

    -- Every amount is checked BEFORE anything is locked. A bad line part-way
    -- through the array used to raise after earlier rows were already held.
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF (v_row.value ->> 'amount')::numeric IS NULL
           OR (v_row.value ->> 'amount')::numeric <= 0 THEN
            RAISE EXCEPTION 'decrement_many_or_fail: amount must be positive for %',
                v_row.value ->> 'id';
        END IF;
    END LOOP;

    -- Pass 1 — lock every DISTINCT row, in id order, and check it can afford
    -- the TOTAL being asked of it. The GROUP BY is the fix: without it, two
    -- lines naming one row were each compared against the undecremented value.
    FOR v_row IN
        SELECT value ->> 'collection'                AS coll,
               value ->> 'id'                        AS id,
               value ->> 'field'                     AS field,
               SUM((value ->> 'amount')::numeric)    AS amount
          FROM jsonb_array_elements(p_items)
         GROUP BY 1, 2, 3
         ORDER BY 2
    LOOP
        SELECT COALESCE((raw_data ->> v_row.field)::numeric, 0)
          INTO v_current
          FROM document_collections
         WHERE id = v_row.id AND collection_name = v_row.coll
           FOR UPDATE;

        IF NOT FOUND THEN
            RETURN QUERY SELECT FALSE, v_row.id, 'not_found'::TEXT;
            RETURN;
        END IF;

        IF v_current < v_row.amount THEN
            RETURN QUERY SELECT FALSE, v_row.id, 'insufficient'::TEXT;
            RETURN;
        END IF;
    END LOOP;

    -- Pass 2 — every row is locked and sufficient, so these cannot fail. One
    -- write per row rather than one per line.
    FOR v_row IN
        SELECT value ->> 'collection'                AS coll,
               value ->> 'id'                        AS id,
               value ->> 'field'                     AS field,
               SUM((value ->> 'amount')::numeric)    AS amount
          FROM jsonb_array_elements(p_items)
         GROUP BY 1, 2, 3
    LOOP
        UPDATE document_collections
           SET raw_data = jsonb_set(
                   raw_data,
                   ARRAY[v_row.field],
                   to_jsonb(COALESCE((raw_data ->> v_row.field)::numeric, 0) - v_row.amount),
                   true
               ),
               updated_at = NOW()
         WHERE id = v_row.id AND collection_name = v_row.coll;
    END LOOP;

    RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT;
END;
$function$;
