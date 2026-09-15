-- #761  THE SEGMENT COUNTS INCLUDED ERASED AND SUPERSEDED ACCOUNTS, AND PUT
--       THEM IN THE GHOST BUCKET.
--
-- Reported by the owner, twice. First as two different populations on one
-- screen — "41,696 Unique Accounts" beside "Total Analyzed 42,566" — and then,
-- after #756 was pushed, as the figure not moving: "why do i still see this?
-- Ghost 19,981 (46.9%)".
--
-- THE SECOND REPORT IS THE IMPORTANT ONE, BECAUSE #756 FIXED THE WRONG COPY.
--
-- #756 added the tombstone exclusion to `calculateUserSegments` in
-- analytics.service.ts. That function's own docstring says what it is:
--
--     "The pre-#473 implementation, kept as the fallback ONLY. It runs when
--      migration 029 has not been applied yet."
--
-- The live path is THIS function. So the fix landed on the copy that does not
-- run in production — which is the defect class this whole audit exists for,
-- committed inside a fix for it. The JS fallback keeps its exclusion so the two
-- agree whichever one answers; that was the half that was right.
--
-- WHAT IT COSTS
--
-- #735 and #747 established that this platform has two tombstones and that
-- neither is a person:
--
--     deleted: true    an account ERASED at the person's request. The scrub
--                      leaves the row so referring records do not dangle.
--     _migratedTo      a profile SUPERSEDED by #724's duplicate resolver. It
--                      and its target are ONE person.
--
-- A scrub removes the application, the bank details and the address. That is
-- the EXACT definition of `ghost` in user_segment() — "no application, bank
-- details or address on record" — so every erasure the platform honoured, and
-- every duplicate an admin resolved, made the Ghost figure larger. The owner
-- has been reading deleted accounts as a problem to fix.
--
-- WHY A PREDICATE AND NOT A CHANGE TO user_segment()
--
-- user_segment(raw_data) answers "what kind of member is this", and a deleted
-- account is not a kind of member — it is not a member. Teaching that function
-- a fifth segment would put the distinction in the wrong place and change every
-- other caller of it. The row is excluded from the POPULATION instead, which is
-- what countLivePeople does in TypeScript for exactly the same reason.
--
-- THE NULL TRAP, WHICH THIS CODEBASE HAS ALREADY BEEN CAUGHT BY
--
-- `raw_data->>'deleted' <> 'true'` is NULL — and therefore NOT TRUE — for a row
-- with no `deleted` key, so it would exclude almost every live user. The same
-- is true of `_migratedTo`. Both tests are written as "is null OR is not the
-- tombstone value", which is what lib/user-population.ts spells out at length
-- and what fake-db-matches-postgres pins.

-- A row that is still a person: not erased, not superseded.
--
-- Written as its own function so the definition exists once. count_user_segments
-- below is not the only figure that needs it, and the next one should not have
-- to rediscover the NULL handling.
CREATE OR REPLACE FUNCTION is_live_person(u_raw jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        --   Erased. NULL (no key) means "not erased", which is the common case.
        (u_raw->>'deleted' IS DISTINCT FROM 'true')
        --   Superseded. #724 writes the id of the surviving profile here; an
        --   absent key or an empty string is a live row.
        AND coalesce(u_raw->>'_migratedTo', '') = '';
$$;

COMMENT ON FUNCTION is_live_person(jsonb) IS
    '#761 True when this user row is a current person: neither erased '
    '(deleted: true) nor superseded by the duplicate resolver (_migratedTo). '
    'NULL-safe in both tests — see the migration for why that matters.';

-- The counts, over live people only.
--
-- Every segment is still returned even when its count is zero, so a caller
-- never has to tell "no such segment" from "none this time" — 029's property,
-- kept.
CREATE OR REPLACE FUNCTION count_user_segments()
RETURNS TABLE (active bigint, pending bigint, stalled bigint, ghost bigint)
LANGUAGE sql
STABLE
AS $$
    SELECT
        count(*) FILTER (WHERE seg = 'active')::bigint,
        count(*) FILTER (WHERE seg = 'pending')::bigint,
        count(*) FILTER (WHERE seg = 'stalled')::bigint,
        count(*) FILTER (WHERE seg = 'ghost')::bigint
    FROM (
        SELECT user_segment(raw_data) AS seg
        FROM public.users
        WHERE is_live_person(raw_data)
    ) s;
$$;

COMMENT ON FUNCTION count_user_segments() IS
    '#761 Segment counts over LIVE PEOPLE only. Erased and superseded rows are '
    'excluded, because a scrub leaves no application, bank details or address '
    'and therefore landed every one of them in the ghost bucket.';

GRANT EXECUTE ON FUNCTION is_live_person(jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION count_user_segments() TO PUBLIC;
