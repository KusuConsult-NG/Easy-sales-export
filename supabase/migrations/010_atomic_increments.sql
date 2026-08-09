-- Migration: 010_atomic_increments.sql
--
-- Makes FieldValue.increment actually atomic.
--
-- WHY THIS EXISTS
-- ---------------
-- FieldValue.increment is the idiom you reach for SPECIFICALLY to avoid
-- read-modify-write. In this codebase it was one. SupabaseDocumentReference.update
-- read the document, resolved the sentinel in JavaScript against the value it had
-- just read, and wrote the result:
--
--     const snap = await this.get();
--     const existing = snap.data() ?? {};
--     ...
--     case 'FieldValue.increment':
--         return (typeof existing === 'number' ? existing : 0) + (fvObj._operand || 0);
--
-- Two concurrent increments read the same value, computed the same result, and
-- the second write overwrote the first. One increment was silently lost.
--
-- 142 call sites across 37 files went through that path, including seller wallet
-- credits on escrow release, dispute resolution credits, loan disbursement and
-- repayment, savings and locked balances, and WAVE earnings.
--
-- This function performs the addition inside the database, in one statement, so
-- concurrent increments sum instead of overwriting.
--
-- TWO KINDS OF TARGET
-- -------------------
-- Values live in two places and both must work:
--
--   native columns  wallets.balance, cooperative_loans.amount and so on — real
--                   typed SQL columns, listed in NATIVE_COLUMNS in supabase-db.ts
--
--   raw_data paths  everything else, inside the JSONB blob, including dotted
--                   paths like serviceRegistrations.wave.waveEarningsBalance
--
-- The caller decides which is which — supabase-db.ts already holds that mapping —
-- and passes them separately. Column names are quoted with quote_ident and the
-- table name is checked against a fixed allowlist, so a caller cannot reach
-- outside the schema.
--
-- A NATIVE COLUMN MUST BE WRITTEN IN BOTH PLACES
-- ----------------------------------------------
-- This is the part that is easy to get wrong, and it is not symmetric.
--
-- buildDedicatedRow writes the WHOLE document into raw_data and additionally
-- copies mapped fields into their native columns, so `balance` exists twice:
-- wallets.balance and wallets.raw_data->>'balance'.
--
-- Reads prefer raw_data. SupabaseDocumentReference.get() hydrates from raw_data
-- and never consults wallets.balance at all; SupabaseQuery.get() falls back to
-- the native column only when raw_data has no such key. Since every document
-- written through the adapter has the key, the native column is effectively
-- invisible to the application.
--
-- So updating only the native column produces a change nobody can see. Both are
-- written here, and both are derived from the raw_data value, which converges
-- the two if they have already drifted apart.
--
-- SAFE TO APPLY
--   Adds one function. No table, column or row is touched. Inert until called.

BEGIN;

CREATE OR REPLACE FUNCTION apply_increments(
    p_table      TEXT,
    p_id         TEXT,
    p_collection TEXT DEFAULT NULL,        -- set for document_collections only
    p_native     JSONB DEFAULT '{}'::jsonb, -- {"balance": 500}
    p_json       JSONB DEFAULT '{}'::jsonb  -- {"stats.count": 1, "a.b.c": -2}
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_key      TEXT;
    v_val      NUMERIC;
    v_sets     TEXT[] := ARRAY[]::TEXT[];
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
        RAISE EXCEPTION 'apply_increments: table % is not allowed', p_table;
    END IF;

    IF p_id IS NULL OR TRIM(p_id) = '' THEN
        RAISE EXCEPTION 'apply_increments: id is required';
    END IF;

    -- Native typed columns.
    --
    -- Written in BOTH places, and both derived from the raw_data value, because
    -- reads prefer raw_data and the native column is only a fallback. Updating
    -- the column alone would be invisible to the application.
    FOR v_key, v_val IN
        SELECT k, (v #>> '{}')::numeric FROM jsonb_each(COALESCE(p_native, '{}'::jsonb)) AS t(k, v)
    LOOP
        v_sets := v_sets || format(
            '%1$I = COALESCE((raw_data ->> %2$L)::numeric, %1$I, 0) + %3$L::numeric',
            v_key, v_key, v_val
        );

        v_raw := format(
            'jsonb_set(%1$s, ARRAY[%2$L], to_jsonb(COALESCE((%1$s ->> %2$L)::numeric, %3$I, 0) + %4$L::numeric), true)',
            v_raw, v_key, v_key, v_val
        );
    END LOOP;

    -- raw_data paths, applied left to right so several can land in one statement.
    -- jsonb_set with create_missing = true means a counter that does not exist
    -- yet starts from zero rather than failing.
    FOR v_key, v_val IN
        SELECT k, (v #>> '{}')::numeric FROM jsonb_each(COALESCE(p_json, '{}'::jsonb)) AS t(k, v)
    LOOP
        v_path := string_to_array(v_key, '.');
        v_raw := format(
            'jsonb_set_deep(%1$s, %2$L::text[], to_jsonb(COALESCE((%1$s #>> %2$L::text[])::numeric, 0) + %3$L::numeric))',
            v_raw, v_path, v_val
        );
    END LOOP;

    IF v_raw <> 'raw_data' THEN
        v_sets := v_sets || format('raw_data = %s', v_raw);
    END IF;

    IF array_length(v_sets, 1) IS NULL THEN
        RETURN; -- nothing to do
    END IF;

    -- Cast required. An untyped literal makes Postgres resolve || as
    -- array-concat-array and try to parse the string as TEXT[], which fails
    -- with "malformed array literal". The format() appends above are typed
    -- TEXT and so were unaffected, which is why this went unnoticed: the
    -- function errored only once it had something to write.
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

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- Native column:
--
--   INSERT INTO wallets (id, balance) VALUES ('t-inc-1', 100)
--     ON CONFLICT (id) DO UPDATE SET balance = 100;
--   SELECT apply_increments('wallets', 't-inc-1', NULL, '{"balance": 50}'::jsonb, '{}'::jsonb);
--   SELECT balance FROM wallets WHERE id = 't-inc-1';   -- expect 150
--
-- raw_data path, including one that does not exist yet:
--
--   INSERT INTO document_collections (id, collection_name, raw_data)
--   VALUES ('t-inc-2', 'test_counters', '{"seen": 5}'::jsonb)
--     ON CONFLICT (id, collection_name) DO UPDATE SET raw_data = '{"seen": 5}'::jsonb;
--   SELECT apply_increments('document_collections', 't-inc-2', 'test_counters',
--                           '{}'::jsonb, '{"seen": 3, "fresh": 7, "a.b": 2}'::jsonb);
--   SELECT raw_data FROM document_collections
--    WHERE id = 't-inc-2' AND collection_name = 'test_counters';
--   -- expect seen = 8, fresh = 7, a = {"b": 2}
--
-- THE CONCURRENCY TEST — two SQL Editor tabs. This is the point of the whole
-- migration, and the thing the old JavaScript path failed.
--
--   Tab A:  BEGIN;
--           SELECT apply_increments('wallets', 't-inc-1', NULL, '{"balance": 10}'::jsonb, '{}'::jsonb);
--           -- do not commit yet
--
--   Tab B:  SELECT apply_increments('wallets', 't-inc-1', NULL, '{"balance": 10}'::jsonb, '{}'::jsonb);
--           -- EXPECT: Tab B blocks on the row lock
--
--   Tab A:  COMMIT;
--
--   Then:   SELECT balance FROM wallets WHERE id = 't-inc-1';
--           -- expect 170 (150 + 10 + 10). BOTH increments applied.
--
--   Under the old JavaScript path this landed on 160: both read 150, both wrote
--   160, and one increment vanished.
--
-- Clean up:
--
--   DELETE FROM wallets WHERE id = 't-inc-1';
--   DELETE FROM document_collections WHERE id = 't-inc-2';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- DROP FUNCTION IF EXISTS apply_increments(TEXT, TEXT, TEXT, JSONB, JSONB);
--
-- The adapter falls back to the previous JavaScript behaviour when the RPC is
-- unavailable, so dropping this restores the old semantics rather than breaking
-- writes.
