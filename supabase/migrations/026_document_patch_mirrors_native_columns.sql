-- Migration: 026_document_patch_mirrors_native_columns.sql
--
-- apply_document_patch was the one patch RPC that did not keep the native
-- typed columns in step with raw_data, so a list query and the document it
-- links to could disagree.
--
-- THE DUAL STORAGE THIS IS ABOUT
-- ------------------------------
-- Eight collections live in their own tables rather than in
-- document_collections, and those tables store the same value TWICE: once in
-- `raw_data` and once in a typed column. lib/supabase-db.ts sends reads down
-- whichever of the two suits the query —
--
--     doc.data()                      →  raw_data, always
--     .where("status", "==", "paid")   →  the `status` COLUMN
--                                        (applyFilter: FIELD_TO_COLUMN, then
--                                         NATIVE_COLUMNS, then raw_data)
--
-- so the two copies disagreeing is not a tidiness problem. It means an admin
-- queue built from `.where("status", ...)` lists an order whose own page shows a
-- different status, or omits one that has moved on. That is the exact shape of
-- "we fix it and it breaks again": the fix lands in raw_data, the list keeps
-- reading the column.
--
-- Three of the four write RPCs already knew this. apply_increments (010) and
-- apply_array_ops (016) both write the column AND raw_data in a single UPDATE,
-- and both derive the column from raw_data — their comments say so in as many
-- words:
--
--     -- Written in BOTH places, and both derived from the raw_data value,
--     -- because reads prefer raw_data and the native column is only a
--     -- fallback. Updating the column alone would be invisible to the
--     -- application.
--
-- claim_status_transition_in (007/025) does the same: `SET raw_data = …,
-- status = $2` in one statement.
--
-- WHAT apply_document_patch DID INSTEAD
-- -------------------------------------
-- It updated raw_data only, and the mirroring was left to a SECOND statement
-- issued from JavaScript afterwards (supabasePartialUpdate's nativeOverrides).
-- Three consequences, in increasing order of how much they matter:
--
-- 1. NOT ATOMIC. Two statements, no transaction around them. If the second
--    fails — a dropped connection, a PostgREST timeout, a statement timeout —
--    raw_data has moved and the column has not. The caller sees an error and
--    reasonably assumes nothing was written. The row stays divergent for good;
--    nothing ever re-derives it.
--
-- 2. TWO CONCURRENT PATCHES INTERLEAVE. A writes raw_data, B writes raw_data,
--    B writes the column, A writes the column. raw_data now says B and the
--    column says A, and every list query reads A. Each statement individually
--    succeeded, so nothing is logged and nothing errors.
--
-- 3. A DELETION NEVER REACHED THE COLUMN. nativeOverrides is derived from the
--    patch's keys, and a FieldValue.delete() is not a patch key — it travels in
--    p_deletes. So deleting a mapped field removed it from raw_data and left the
--    column holding the old value, permanently. (No call site deletes a mapped
--    field today — checked, all fourteen FieldValue.delete() sites target
--    unmapped fields — so this one is latent rather than live. It is closed here
--    because the next one will not be.)
--
-- THE FIX
-- -------
-- Mirror inside the same UPDATE, exactly as the three sibling functions do, and
-- derive each column from the FINAL raw_data expression so the two cannot
-- differ. The JavaScript second statement becomes redundant; it is left in
-- place deliberately, because it is also the only mirror on a database that has
-- not had this migration applied yet, and re-asserting a value that is already
-- correct changes nothing.
--
-- ONLY THE COLUMNS THIS CALL ACTUALLY TOUCHES
-- -------------------------------------------
-- A column is re-derived only when the patch, a dotted path, or a deletion
-- names its source field. Re-deriving every mapped column on every patch would
-- be simpler, and wrong: a legacy row whose raw_data never had `status` but
-- whose column does would have that column nulled by the next unrelated write,
-- and vanish from the queue it currently appears in.
--
-- SIGNATURE UNCHANGED
-- -------------------
-- No new parameter, so there is no second overload. Postgres resolves
-- overloads by arity, and this codebase already has one function
-- (credit_wallet_once) existing as two overloads that differ by a single
-- trailing argument — a six-argument call silently picks the shorter one. One
-- definition of this function is worth more than a tidier parameter list.

-- ─── casts that cannot fail ──────────────────────────────────────────────────
--
-- A mapped column is typed and raw_data is not, so the value being mirrored may
-- not fit. Erroring would abort a write whose raw_data half is perfectly valid,
-- so an unconvertible value mirrors as NULL — the same answer the column gives
-- for a field that is absent.

CREATE OR REPLACE FUNCTION jsonb_numeric_or_null(p_value JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
        RETURN NULL;
    END IF;
    IF jsonb_typeof(p_value) = 'number' THEN
        RETURN (p_value #>> '{}')::numeric;
    END IF;
    IF jsonb_typeof(p_value) = 'string' THEN
        BEGIN
            RETURN (p_value #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
            RETURN NULL;
        END;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION jsonb_text_array_or_null(p_value JSONB)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_out TEXT[];
BEGIN
    IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
        RETURN NULL;
    END IF;
    SELECT array_agg(elem #>> '{}' ORDER BY ord)
      INTO v_out
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS t(elem, ord)
     WHERE jsonb_typeof(elem) = 'string';
    RETURN COALESCE(v_out, ARRAY[]::TEXT[]);
END;
$$;

-- ─── the mapping, in one place ───────────────────────────────────────────────
--
-- The same pairs as FIELD_TO_COLUMN in lib/supabase-db.ts, in the same order,
-- because that order decides which source field wins when two map to one column
-- (cooperative_members maps both `membershipStatus` and `status` onto `status`,
-- and the JavaScript loop lets the later one win). Kinds: 't' text, 'n'
-- numeric, 'a' text[].
--
-- src/__tests__/pg/native-column-mirror.test.ts asserts this list against
-- FIELD_TO_COLUMN, so the two cannot drift apart silently.

CREATE OR REPLACE FUNCTION native_column_map(p_table TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_table
        WHEN 'users' THEN '[
            ["email","email","t"],
            ["roles","roles","a"]
        ]'::jsonb
        WHEN 'cooperative_members' THEN '[
            ["userId","user_id","t"],
            ["membershipStatus","status","t"],
            ["status","status","t"]
        ]'::jsonb
        WHEN 'cooperative_loans' THEN '[
            ["userId","user_id","t"],
            ["status","status","t"],
            ["amount","amount","n"]
        ]'::jsonb
        WHEN 'transactions' THEN '[
            ["userId","user_id","t"],
            ["type","type","t"],
            ["status","status","t"],
            ["amount","amount","n"]
        ]'::jsonb
        WHEN 'processed_payments' THEN '[
            ["userId","user_id","t"],
            ["reference","reference","t"],
            ["amount","amount","n"]
        ]'::jsonb
        WHEN 'marketplace_orders' THEN '[
            ["userId","user_id","t"],
            ["status","status","t"],
            ["totalAmount","total_amount","n"]
        ]'::jsonb
        WHEN 'wallets' THEN '[
            ["balance","balance","n"]
        ]'::jsonb
        WHEN 'academy_applications' THEN '[
            ["userId","user_id","t"],
            ["status","status","t"]
        ]'::jsonb
        ELSE '[]'::jsonb
    END;
$$;

CREATE OR REPLACE FUNCTION apply_document_patch(
    p_table      TEXT,
    p_id         TEXT,
    -- The defaults are 017's, kept verbatim. Dropping them is not a cosmetic
    -- change: CREATE OR REPLACE refuses to remove parameter defaults from an
    -- existing function ("cannot remove parameter defaults"), and dropping the
    -- function first to get around that would leave a window in which any
    -- concurrent write fails.
    p_collection TEXT  DEFAULT NULL,        -- set for document_collections only
    p_patch      JSONB DEFAULT '{}'::jsonb, -- {"status": "paid"}
    p_paths      JSONB DEFAULT '{}'::jsonb, -- {"a.b.c": 1}
    p_deletes    JSONB DEFAULT '[]'::jsonb  -- ["tempField", "a.b"]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_key      TEXT;
    v_val      JSONB;
    v_raw      TEXT := 'raw_data';
    v_path     TEXT[];
    v_sql      TEXT;
    v_touched  JSONB := '{}'::jsonb;   -- json field name -> true
    v_chosen   JSONB := '{}'::jsonb;   -- column -> [source field, kind]
    v_pair     JSONB;
    v_sets     TEXT[] := ARRAY[]::TEXT[];
    v_field    TEXT;
    v_column   TEXT;
    v_kind     TEXT;
    v_allowed  TEXT[] := ARRAY[
        'users', 'cooperative_members', 'cooperative_loans', 'transactions',
        'processed_payments', 'marketplace_orders', 'wallets',
        'academy_applications', 'document_collections'
    ];
BEGIN
    IF NOT (p_table = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'apply_document_patch: table % is not allowed', p_table;
    END IF;

    IF p_id IS NULL OR TRIM(p_id) = '' THEN
        RAISE EXCEPTION 'apply_document_patch: id is required';
    END IF;

    -- 1. Shallow merge of top-level fields. Same semantics as merge_raw_data,
    --    which is what makes this a safe replacement for it.
    IF p_patch IS NOT NULL AND p_patch <> '{}'::jsonb THEN
        v_raw := format('(%s || %L::jsonb)', v_raw, p_patch);
        FOR v_key IN SELECT k FROM jsonb_each(p_patch) AS t(k, v) LOOP
            v_touched := v_touched || jsonb_build_object(v_key, true);
        END LOOP;
    END IF;

    -- 2. Dotted paths. create_missing = true so a path whose parent does not
    --    exist yet is created rather than silently skipped.
    FOR v_key, v_val IN
        SELECT k, v FROM jsonb_each(COALESCE(p_paths, '{}'::jsonb)) AS t(k, v)
    LOOP
        v_path := string_to_array(v_key, '.');
        -- jsonb_set_deep, not jsonb_set: the parent may not exist yet, and
        -- jsonb_set would silently discard the write. See migration 018.
        v_raw := format('jsonb_set_deep(%s, %L::text[], %L::jsonb)', v_raw, v_path, v_val);
        -- The ROOT segment is what a native column mirrors, so `a.b` touches `a`.
        v_touched := v_touched || jsonb_build_object(v_path[1], true);
    END LOOP;

    -- 3. Deletes, last, so they win.
    FOR v_key IN
        SELECT value #>> '{}' FROM jsonb_array_elements(COALESCE(p_deletes, '[]'::jsonb))
    LOOP
        v_path := string_to_array(v_key, '.');
        IF array_length(v_path, 1) = 1 THEN
            v_raw := format('(%s - %L)', v_raw, v_key);
        ELSE
            v_raw := format('(%s #- %L::text[])', v_raw, v_path);
        END IF;
        v_touched := v_touched || jsonb_build_object(v_path[1], true);
    END LOOP;

    IF v_raw = 'raw_data' THEN
        RETURN; -- nothing to do
    END IF;

    v_sets := ARRAY[format('raw_data = %s', v_raw)];

    -- 4. The native typed columns, in the SAME statement, each derived from the
    --    final raw_data expression above. Only the columns whose source field
    --    this call actually touched — see the migration header.
    --
    --    Deduplicated on the COLUMN, last pair winning, because two source
    --    fields can map onto one column and assigning a column twice in one
    --    UPDATE is an error rather than a last-wins.
    IF p_table <> 'document_collections' THEN
        FOR v_pair IN SELECT value FROM jsonb_array_elements(native_column_map(p_table))
        LOOP
            v_field := v_pair ->> 0;
            IF v_touched ? v_field THEN
                v_chosen := v_chosen || jsonb_build_object(
                    v_pair ->> 1, jsonb_build_array(v_field, v_pair ->> 2));
            END IF;
        END LOOP;

        FOR v_column, v_val IN SELECT k, v FROM jsonb_each(v_chosen) AS t(k, v)
        LOOP
            v_field := v_val ->> 0;
            v_kind := v_val ->> 1;
            IF v_kind = 'n' THEN
                v_sets := v_sets || format(
                    '%1$I = jsonb_numeric_or_null((%2$s) -> %3$L)', v_column, v_raw, v_field);
            ELSIF v_kind = 'a' THEN
                v_sets := v_sets || format(
                    '%1$I = jsonb_text_array_or_null((%2$s) -> %3$L)', v_column, v_raw, v_field);
            ELSE
                v_sets := v_sets || format(
                    '%1$I = (%2$s) ->> %3$L', v_column, v_raw, v_field);
            END IF;
        END LOOP;
    END IF;

    v_sets := v_sets || 'updated_at = NOW()'::TEXT;

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

COMMENT ON FUNCTION apply_document_patch(TEXT, TEXT, TEXT, JSONB, JSONB, JSONB) IS
    'Targeted JSONB patch. Mirrors the mapped native typed columns in the same '
    'UPDATE (migration 026), because reads take .where() to the column and '
    'doc.data() to raw_data, so the two disagreeing shows up as a list that '
    'contradicts the document it links to.';
