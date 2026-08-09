-- Migration: 016_atomic_array_ops.sql
--
-- Makes FieldValue.arrayUnion and FieldValue.arrayRemove atomic.
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 010 fixed FieldValue.increment by pulling it out of the JavaScript
-- write path and applying it in SQL. It fixed ONLY increment. `splitIncrements`
-- tests for exactly one sentinel type, so arrayUnion and arrayRemove still go
-- through `resolveFieldValue`, which is a read-modify-write:
--
--     case 'FieldValue.arrayUnion': {
--         const arr = Array.isArray(existing) ? [...existing] : [];
--         ...
--         return arr;                      // <-- computed from a stale read
--     }
--
-- Two concurrent writes read the same array, each appends its own element, and
-- the second write overwrites the first. One element is silently lost.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
-- ---------------------------------
-- 33 of the ~38 call sites are the same line:
--
--     roles: FieldValue.arrayUnion("<some_role>")
--
-- on the users collection, and `roles` is what every module-access check reads.
-- A user who joins two modules at once — or a webhook and a server action
-- landing together, which this codebase does constantly — keeps one role and
-- loses the other. The user is a paid cooperative member with no cooperative
-- access, and nothing errored.
--
-- That is also why it presents as "a fix that keeps breaking": granting the
-- role again works, right up until the next concurrent write drops it.
--
-- THE DUAL-STORAGE TRAP
-- ---------------------
-- `roles` is BOTH a native TEXT[] column on `users` and a key inside raw_data.
-- Reads prefer raw_data; `.where()` filters use the column. Migrations 005/006
-- updated only the native column for wallet balances and the fix was invisible
-- to the application — that is what 011 had to correct.
--
-- So the native column here is derived FROM the new raw_data value rather than
-- computed separately. One expression, two destinations, no way for them to
-- disagree.

BEGIN;

-- ============================================================================
-- jsonb_array_union / jsonb_array_remove
--
-- Pure helpers, so the main function stays readable.
--
-- Element equality is JSONB equality, not string equality. This differs from
-- the JavaScript path, which compared JSON.stringify output: JSONB normalises
-- key order, so {"a":1,"b":2} and {"b":2,"a":1} are correctly treated as the
-- same element here and were treated as different before. That is a fix, not a
-- regression, but it is a behaviour change worth knowing about.
--
-- Order is preserved: existing elements keep their positions and new ones are
-- appended, matching the JavaScript behaviour callers may rely on.
-- ============================================================================

CREATE OR REPLACE FUNCTION jsonb_array_union(p_current JSONB, p_elements JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_result JSONB;
    v_elem   JSONB;
BEGIN
    -- A field that does not exist yet, or holds a non-array, starts empty.
    -- Firestore's arrayUnion on a missing field creates one.
    v_result := CASE WHEN jsonb_typeof(p_current) = 'array' THEN p_current ELSE '[]'::jsonb END;

    IF jsonb_typeof(p_elements) <> 'array' THEN
        RETURN v_result;
    END IF;

    FOR v_elem IN SELECT value FROM jsonb_array_elements(p_elements)
    LOOP
        -- Checked against v_result, not p_current, so duplicates within the
        -- incoming batch are also collapsed.
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) x WHERE x = v_elem) THEN
            v_result := v_result || jsonb_build_array(v_elem);
        END IF;
    END LOOP;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION jsonb_array_remove(p_current JSONB, p_elements JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN jsonb_typeof(p_current) <> 'array' THEN '[]'::jsonb
        WHEN jsonb_typeof(p_elements) <> 'array' THEN p_current
        ELSE COALESCE(
            (SELECT jsonb_agg(x ORDER BY o)
               FROM jsonb_array_elements(p_current) WITH ORDINALITY t(x, o)
              WHERE NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(p_elements) e WHERE e = x
              )),
            '[]'::jsonb
        )
    END;
$$;

-- ============================================================================
-- apply_array_ops
--
-- Applies every array operation in one UPDATE, so concurrent writers serialise
-- on the row rather than racing on a value each read separately.
--
-- Shape deliberately mirrors apply_increments (010):
--
--   p_native  {"roles": {"union": ["seller"], "remove": []}}
--             fields that are ALSO native columns — written to both places
--   p_json    {"documents": {"union": [{...}]}, "a.b.c": {"remove": ["x"]}}
--             raw_data paths, dotted for nesting
--
-- Native array columns are TEXT[] in this schema, so their elements must be
-- JSON strings. An object element for a native field is a caller bug and is
-- rejected rather than silently stringified into the column.
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_array_ops(
    p_table      TEXT,
    p_id         TEXT,
    p_collection TEXT DEFAULT NULL,        -- set for document_collections only
    p_native     JSONB DEFAULT '{}'::jsonb,
    p_json       JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_key      TEXT;
    v_ops      JSONB;
    v_sets     TEXT[] := ARRAY[]::TEXT[];
    v_raw      TEXT := 'raw_data';
    v_path     TEXT[];
    v_sql      TEXT;
    v_elem     JSONB;
    v_allowed  TEXT[] := ARRAY[
        'users', 'cooperative_members', 'cooperative_loans', 'transactions',
        'processed_payments', 'marketplace_orders', 'wallets',
        'academy_applications', 'document_collections'
    ];
BEGIN
    IF NOT (p_table = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'apply_array_ops: table % is not allowed', p_table;
    END IF;

    IF p_id IS NULL OR TRIM(p_id) = '' THEN
        RAISE EXCEPTION 'apply_array_ops: id is required';
    END IF;

    -- raw_data paths first, so the accumulated expression already covers them
    -- if a native field is also touched below.
    FOR v_key, v_ops IN
        SELECT k, v FROM jsonb_each(COALESCE(p_json, '{}'::jsonb)) AS t(k, v)
    LOOP
        v_path := string_to_array(v_key, '.');

        IF v_ops ? 'union' THEN
            v_raw := format(
                'jsonb_set_deep(%1$s, %2$L::text[], jsonb_array_union(COALESCE(%1$s #> %2$L::text[], ''[]''::jsonb), %3$L::jsonb))',
                v_raw, v_path, v_ops -> 'union'
            );
        END IF;

        IF v_ops ? 'remove' THEN
            v_raw := format(
                'jsonb_set_deep(%1$s, %2$L::text[], jsonb_array_remove(COALESCE(%1$s #> %2$L::text[], ''[]''::jsonb), %3$L::jsonb))',
                v_raw, v_path, v_ops -> 'remove'
            );
        END IF;
    END LOOP;

    -- Native columns. The raw_data expression is extended the same way, then
    -- the column is derived from it — see the dual-storage note at the top.
    FOR v_key, v_ops IN
        SELECT k, v FROM jsonb_each(COALESCE(p_native, '{}'::jsonb)) AS t(k, v)
    LOOP
        -- A native TEXT[] column cannot hold an object.
        FOR v_elem IN
            SELECT value FROM jsonb_array_elements(COALESCE(v_ops -> 'union', '[]'::jsonb))
            UNION ALL
            SELECT value FROM jsonb_array_elements(COALESCE(v_ops -> 'remove', '[]'::jsonb))
        LOOP
            IF jsonb_typeof(v_elem) <> 'string' THEN
                RAISE EXCEPTION
                    'apply_array_ops: native column % takes text elements, got %',
                    v_key, jsonb_typeof(v_elem);
            END IF;
        END LOOP;

        IF v_ops ? 'union' THEN
            v_raw := format(
                'jsonb_set(%1$s, ARRAY[%2$L], jsonb_array_union(COALESCE(%1$s -> %2$L, to_jsonb(COALESCE(%3$I, ''{}''::text[])), ''[]''::jsonb), %4$L::jsonb), true)',
                v_raw, v_key, v_key, v_ops -> 'union'
            );
        END IF;

        IF v_ops ? 'remove' THEN
            v_raw := format(
                'jsonb_set(%1$s, ARRAY[%2$L], jsonb_array_remove(COALESCE(%1$s -> %2$L, to_jsonb(COALESCE(%3$I, ''{}''::text[])), ''[]''::jsonb), %4$L::jsonb), true)',
                v_raw, v_key, v_key, v_ops -> 'remove'
            );
        END IF;

        -- Derived from the same expression, so the two can never disagree.
        v_sets := v_sets || format(
            '%1$I = ARRAY(SELECT jsonb_array_elements_text(%2$s -> %3$L))',
            v_key, v_raw, v_key
        );
    END LOOP;

    IF v_raw <> 'raw_data' THEN
        v_sets := v_sets || format('raw_data = %s', v_raw);
    END IF;

    IF array_length(v_sets, 1) IS NULL THEN
        RETURN; -- nothing to do
    END IF;

    v_sets := v_sets || 'updated_at = NOW()';

    IF p_table = 'document_collections' THEN
        v_sql := format(
            'UPDATE document_collections SET %s WHERE id = %L AND collection_name = %L',
            array_to_string(v_sets, ', '), p_id, p_collection
        );
    ELSE
        v_sql := format(
            'UPDATE %I SET %s WHERE id = %L',
            p_table, array_to_string(v_sets, ', '), p_id
        );
    END IF;

    EXECUTE v_sql;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- 1. A role lands in BOTH raw_data and the native column.
--    Checking only one is how the wallet bug survived three separate reviews.
--
--   INSERT INTO users (id, email, roles, raw_data)
--   VALUES ('arr-check-1', 'arr-check-1@example.com', ARRAY['buyer'],
--           '{"id":"arr-check-1","roles":["buyer"]}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET roles = EXCLUDED.roles, raw_data = EXCLUDED.raw_data;
--
--   SELECT apply_array_ops('users', 'arr-check-1', NULL,
--                          '{"roles": {"union": ["seller"]}}'::jsonb);
--
--   SELECT roles, raw_data -> 'roles' FROM users WHERE id = 'arr-check-1';
--   -- expect: {buyer,seller}  and  ["buyer", "seller"]   -- BOTH, and equal
--
-- 2. No duplicate on a repeat.
--
--   SELECT apply_array_ops('users', 'arr-check-1', NULL,
--                          '{"roles": {"union": ["seller"]}}'::jsonb);
--   SELECT roles FROM users WHERE id = 'arr-check-1';
--   -- expect: {buyer,seller} — still two
--
-- 3. Removal.
--
--   SELECT apply_array_ops('users', 'arr-check-1', NULL,
--                          '{"roles": {"remove": ["buyer"]}}'::jsonb);
--   SELECT roles, raw_data -> 'roles' FROM users WHERE id = 'arr-check-1';
--   -- expect: {seller} and ["seller"]
--
-- 4. THE ONE THAT MATTERS — concurrency. Two sessions, interleaved:
--
--   -- session A                                  -- session B
--   BEGIN;                                        BEGIN;
--   SELECT apply_array_ops('users','arr-check-1',
--     NULL,'{"roles":{"union":["farmer"]}}');
--                                                 SELECT apply_array_ops('users','arr-check-1',
--                                                   NULL,'{"roles":{"union":["academy"]}}');
--                                                 -- B must BLOCK here
--   COMMIT;                                       -- B proceeds
--                                                 COMMIT;
--
--   SELECT roles FROM users WHERE id = 'arr-check-1';
--   -- expect BOTH farmer and academy. Before this migration one was lost.
--
-- 5. An object element for a native column is refused rather than mangled.
--
--   SELECT apply_array_ops('users','arr-check-1',NULL,
--                          '{"roles":{"union":[{"x":1}]}}'::jsonb);
--   -- expect: ERROR ... native column roles takes text elements, got object
--
--   DELETE FROM users WHERE id = 'arr-check-1';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- The adapter falls back to the previous read-modify-write when this function
-- is absent, so dropping it degrades behaviour to what it was rather than
-- breaking writes.
--
-- DROP FUNCTION IF EXISTS apply_array_ops(TEXT, TEXT, TEXT, JSONB, JSONB);
-- DROP FUNCTION IF EXISTS jsonb_array_union(JSONB, JSONB);
-- DROP FUNCTION IF EXISTS jsonb_array_remove(JSONB, JSONB);
