-- Migration: 003_atomic_profile_sync.sql
-- Description: Executes multi-collection document patch updates atomically inside a single transaction.

CREATE OR REPLACE FUNCTION atomic_profile_sync(
    p_updates JSONB   -- array of {table: TEXT, id: TEXT, patch: JSONB, native: JSONB}
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    upd JSONB;
    v_table TEXT;
    v_id TEXT;
    v_patch JSONB;
    v_native JSONB;
BEGIN
    FOR upd IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
        v_table := upd->>'table';
        v_id    := upd->>'id';
        v_patch := upd->'patch';
        v_native := upd->'native';

        IF v_table = 'document_collections' THEN
            UPDATE document_collections
               SET raw_data = raw_data || v_patch,
                   updated_at = now()
             WHERE id = split_part(v_id, '::', 2)
               AND collection_name = split_part(v_id, '::', 1);
        ELSE
            EXECUTE format(
                'UPDATE %I SET raw_data = raw_data || $1, updated_at = now() WHERE id = $2',
                v_table
            ) USING v_patch, v_id;

            -- Update native columns if present
            IF v_native IS NOT NULL AND v_native != '{}'::jsonb THEN
                EXECUTE format(
                    'UPDATE %I SET %s WHERE id = $1',
                    v_table,
                    (SELECT string_agg(quote_ident(key) || ' = ' || quote_literal(value), ', ')
                     FROM jsonb_each_text(v_native))
                ) USING v_id;
            END IF;
        END IF;
    END LOOP;
END;
$$;
