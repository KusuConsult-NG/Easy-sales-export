-- Migration: 002_jsonb_merge_update.sql
-- Description: Provides atomic server-side JSONB patch merging to prevent N+1 reads and partial write corruption.

CREATE OR REPLACE FUNCTION merge_raw_data(
    p_table TEXT,
    p_id    TEXT,
    p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF p_table = 'document_collections' THEN
        -- Handle composite key (id, collection_name) encoded as "collection::id"
        UPDATE document_collections
           SET raw_data = raw_data || p_patch,
               updated_at = now()
         WHERE id = split_part(p_id, '::', 2)
           AND collection_name = split_part(p_id, '::', 1);
    ELSE
        EXECUTE format(
            'UPDATE %I SET raw_data = raw_data || $1, updated_at = now() WHERE id = $2',
            p_table
        ) USING p_patch, p_id;
    END IF;
END;
$$;
