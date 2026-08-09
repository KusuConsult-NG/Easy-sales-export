-- Migration: 017_targeted_document_patch.sql
--
-- Lets a write send ONLY the fields it changes.
--
-- WHY THIS EXISTS
-- ---------------
-- `processWriteData(data, existing, true)` starts from `{ ...existingData }`, so
-- every update() sent the WHOLE document back — not just the changed fields:
--
--     await ref.update({ keep: 2 })
--     -- patch actually sent: {"id":"u1","keep":2,"doomed":"x", ...everything}
--
-- Two concurrent updates to completely unrelated fields therefore clobber one
-- another. Whoever writes second reverts the other's change, using a snapshot
-- taken moments earlier. Nothing errors.
--
-- This is not specific to money, arrays or counters. It applies to every field
-- in every collection, and it is the mechanism behind fixes that "keep
-- breaking": a value is corrected, and an unrelated concurrent write reverts it.
--
-- It was also silently undermining 010 and 016 until stripAtomicPaths was added,
-- because the stale copy of a counter or array rode along in that patch.
--
-- WHY THE WHOLE DOCUMENT WAS SENT
-- -------------------------------
-- merge_raw_data (002) does `raw_data || p_patch`, a SHALLOW merge. A nested
-- change like {"a.b.c": 1} therefore had to carry the whole `a` object or `a`'s
-- other keys would be dropped. Sending everything was the simplest way to be
-- correct, and it was correct — just not concurrent.
--
-- WHAT THIS DOES
-- --------------
-- Splits a write into the three shapes Firestore actually distinguishes, so the
-- patch can carry only what changed:
--
--   p_patch    top-level fields, shallow-merged.
--              update({a: {x: 1}}) REPLACES a — Firestore semantics.
--
--   p_paths    dotted paths, applied with jsonb_set.
--              update({"a.b": 1}) sets a.b and leaves a's siblings alone.
--
--   p_deletes  paths to remove, top-level or dotted.
--
-- FieldValue.delete WAS BROKEN
-- ----------------------------
-- Worth stating plainly, because it looked like it worked. Deleting a field
-- produced a patch with the key simply ABSENT, and `raw_data || patch` only
-- adds and replaces — it never removes. So FieldValue.delete() has been a no-op
-- on this path for as long as it has existed. p_deletes is what actually
-- removes the key.

BEGIN;

-- ============================================================================
-- apply_document_patch
--
-- Applies patch, then paths, then deletes, as ONE statement.
--
-- Order matters: an explicit delete must win over a value set in the same
-- write, and a dotted path must apply on top of the shallow merge rather than
-- being overwritten by it.
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_document_patch(
    p_table      TEXT,
    p_id         TEXT,
    p_collection TEXT  DEFAULT NULL,        -- set for document_collections only
    p_patch      JSONB DEFAULT '{}'::jsonb, -- {"status": "paid"}
    p_paths      JSONB DEFAULT '{}'::jsonb, -- {"a.b.c": 1}
    p_deletes    JSONB DEFAULT '[]'::jsonb  -- ["tempField", "a.b"]
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_key      TEXT;
    v_val      JSONB;
    v_raw      TEXT := 'raw_data';
    v_path     TEXT[];
    v_sql      TEXT;
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
    END IF;

    -- 2. Dotted paths. create_missing = true so a path whose parent does not
    --    exist yet is created rather than silently skipped.
    FOR v_key, v_val IN
        SELECT k, v FROM jsonb_each(COALESCE(p_paths, '{}'::jsonb)) AS t(k, v)
    LOOP
        v_path := string_to_array(v_key, '.');
        v_raw := format('jsonb_set(%s, %L::text[], %L::jsonb, true)', v_raw, v_path, v_val);
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
    END LOOP;

    IF v_raw = 'raw_data' THEN
        RETURN; -- nothing to do
    END IF;

    IF p_table = 'document_collections' THEN
        v_sql := format(
            'UPDATE document_collections SET raw_data = %s, updated_at = NOW() '
            'WHERE id = %L AND collection_name = %L',
            v_raw, p_id, p_collection
        );
    ELSE
        v_sql := format(
            'UPDATE %I SET raw_data = %s, updated_at = NOW() WHERE id = %L',
            p_table, v_raw, p_id
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
--   INSERT INTO users (id, email, raw_data)
--   VALUES ('patch-check-1', 'patch-check-1@example.com',
--           '{"id":"patch-check-1","keep":1,"doomed":"x",
--             "profile":{"name":"Ada","city":"Jos"}}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
--
-- 1. A top-level field changes and nothing else moves.
--
--   SELECT apply_document_patch('users','patch-check-1',NULL,'{"keep":2}'::jsonb);
--   SELECT raw_data FROM users WHERE id = 'patch-check-1';
--   -- expect keep = 2, doomed and profile untouched
--
-- 2. A dotted path keeps its siblings.
--
--   SELECT apply_document_patch('users','patch-check-1',NULL,'{}'::jsonb,
--                               '{"profile.city":"Abuja"}'::jsonb);
--   SELECT raw_data -> 'profile' FROM users WHERE id = 'patch-check-1';
--   -- expect {"name":"Ada","city":"Abuja"} — name MUST survive
--
-- 3. Delete actually deletes. This never worked before.
--
--   SELECT apply_document_patch('users','patch-check-1',NULL,'{}'::jsonb,
--                               '{}'::jsonb,'["doomed"]'::jsonb);
--   SELECT raw_data ? 'doomed' FROM users WHERE id = 'patch-check-1';
--   -- expect: f
--
-- 4. Nested delete.
--
--   SELECT apply_document_patch('users','patch-check-1',NULL,'{}'::jsonb,
--                               '{}'::jsonb,'["profile.city"]'::jsonb);
--   SELECT raw_data -> 'profile' FROM users WHERE id = 'patch-check-1';
--   -- expect {"name":"Ada"}
--
-- 5. THE ONE THAT MATTERS — two sessions, unrelated fields, interleaved:
--
--   -- session A                                  -- session B
--   BEGIN;                                        BEGIN;
--   SELECT apply_document_patch('users',
--     'patch-check-1',NULL,'{"fieldA":1}');
--                                                 SELECT apply_document_patch('users',
--                                                   'patch-check-1',NULL,'{"fieldB":2}');
--   COMMIT;                                       COMMIT;
--
--   SELECT raw_data -> 'fieldA', raw_data -> 'fieldB' FROM users
--    WHERE id = 'patch-check-1';
--   -- expect BOTH 1 and 2. Before this, one of them was reverted.
--
--   DELETE FROM users WHERE id = 'patch-check-1';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- The adapter falls back to merge_raw_data plus a JavaScript read-merge-write
-- when this function is absent, so dropping it degrades behaviour to what it
-- was rather than breaking writes.
--
-- DROP FUNCTION IF EXISTS apply_document_patch(TEXT, TEXT, TEXT, JSONB, JSONB, JSONB);
