-- Migration: 018_nested_path_creation.sql
--
-- Fixes a silent no-op in every function that writes a dotted path.
--
-- WHAT WENT WRONG
-- ---------------
-- `jsonb_set(target, path, value, create_missing => true)` creates the LEAF of
-- the path. It does NOT create intermediate parents. When the parent object is
-- absent, jsonb_set returns the target **unchanged** — no error, no warning:
--
--   jsonb_set('{}'::jsonb, '{documents,passportPhoto}', '{"url":"x"}', true)
--     -> {}                                      -- nothing happened
--
-- 010, 016 and 017 all build dotted-path writes this way, so any write to a
-- nested field whose parent did not exist yet was discarded while reporting
-- success. That is worse than an error: the caller has no way to notice.
--
-- Found while restoring recovered passport photos: 14 calls to
-- apply_document_patch returned success and 9 of them wrote nothing, because
-- those members had no `documents` object for the path to hang from.
--
-- WHY IT IS A REGRESSION
-- ----------------------
-- Before 017, dotted paths were resolved in JavaScript by setNestedValue, which
-- creates each missing level on the way down:
--
--   if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
--
-- Moving that work into SQL lost the behaviour. This restores it.
--
-- WHERE IT BITES HARDEST
-- ----------------------
-- `apply_increments` handles nested money paths — for example
-- `serviceRegistrations.wave.waveEarningsBalance`. A user whose
-- serviceRegistrations object had not been created yet would have earnings
-- credited to nothing, silently.

BEGIN;

-- ============================================================================
-- jsonb_set_deep
--
-- jsonb_set, but it creates the intermediate objects the path needs.
--
-- A level that exists but is not an object is replaced by one, which matches
-- what setNestedValue did in JavaScript. Assigning a.b.c over a scalar a.b was
-- always a caller mistake; the behaviour is preserved rather than changed, so
-- this migration cannot alter the outcome of any write that already worked.
-- ============================================================================

CREATE OR REPLACE FUNCTION jsonb_set_deep(
    p_target JSONB,
    p_path   TEXT[],
    p_value  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_result JSONB := COALESCE(p_target, '{}'::jsonb);
    v_prefix TEXT[];
    i        INT;
BEGIN
    IF p_path IS NULL OR array_length(p_path, 1) IS NULL THEN
        RETURN v_result;
    END IF;

    -- Walk the parents outermost first, creating any that are missing.
    FOR i IN 1 .. array_length(p_path, 1) - 1 LOOP
        v_prefix := p_path[1:i];
        IF v_result #> v_prefix IS NULL
           OR jsonb_typeof(v_result #> v_prefix) <> 'object' THEN
            v_result := jsonb_set(v_result, v_prefix, '{}'::jsonb, true);
        END IF;
    END LOOP;

    RETURN jsonb_set(v_result, p_path, p_value, true);
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging. Pure function, touches no table.
-- ============================================================================
--
--   SELECT jsonb_set_deep('{}'::jsonb, '{documents,passportPhoto}', '{"url":"x"}'::jsonb);
--   -- expect: {"documents": {"passportPhoto": {"url": "x"}}}
--   -- before this migration jsonb_set returned {} here
--
--   SELECT jsonb_set_deep('{"documents":{"validId":{"url":"v"}}}'::jsonb,
--                         '{documents,passportPhoto}', '{"url":"x"}'::jsonb);
--   -- expect BOTH keys — the sibling must survive
--
--   SELECT jsonb_set_deep('{"a":1}'::jsonb, '{a,b}', '2'::jsonb);
--   -- expect: {"a": {"b": 2}} — a scalar parent is replaced by an object,
--   -- matching what setNestedValue did in JavaScript
--
--   SELECT jsonb_set_deep('{"x":1}'::jsonb, '{y}', '2'::jsonb);
--   -- expect: {"x": 1, "y": 2} — single-element paths still work

-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- Dropping this reverts 010/016/017 to discarding nested writes whose parent
-- does not exist. Re-apply the previous definitions of those functions first.
--
-- DROP FUNCTION IF EXISTS jsonb_set_deep(JSONB, TEXT[], JSONB);
