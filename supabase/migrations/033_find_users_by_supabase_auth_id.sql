-- ============================================================================
-- #489  A PROFILE WITH NO EMAIL CAN ONLY BE FOUND BY A POINTER, AND THE
--       POINTER HAD NO INDEX.
-- ============================================================================
--
-- authAccountsWithProfiles joins an auth account to its profile three ways:
-- by document id, by `email`, and by normalised email (migration 031). Every
-- one of those needs either the right key or an address.
--
-- A profile with NO email answers to none of them. Forty-nine of those exist,
-- minted by two admin approvals that wrote `email: ""` — see
-- lib/profile-email-resolution.ts. Where such a profile is ALSO not keyed by
-- the auth id (a migrated account: user-migration.ts leaves the profile under
-- its original Firebase-era id), the person is unreachable by every route the
-- platform has, and the forensic scan reports them as a GHOST.
--
-- That is the link between the owner's two standing findings. They are one
-- defect seen from two sides.
--
-- THE FOURTH ROUTE IS THE POINTER MIGRATION ALREADY WRITES.
-- user-migration.ts sets `supabaseAuthId` on the legacy profile, and
-- profile-choice.ts and password-reset.ts both read it. It is the strongest
-- link of the four — an explicit statement that this profile belongs to that
-- auth account — and it is the only one that works without an email.
--
-- WHY IT WAS NOT USED. auth-profile-link.ts records the reason plainly:
--
--     "deliberately not by `supabaseAuthId`: that field lives inside raw_data
--      with no index, and #465 measured what querying it costs —
--      `canceling statement due to statement timeout`."
--
-- The reason was the missing index, not the field. This adds it.
--
-- ============================================================================
-- MEASURED, on a real PostgreSQL 16: 50,017 users, 5,000 carrying the pointer
-- ============================================================================
--
-- The query the scan actually issues is a BATCH of up to 100 ids, not one:
--
--   SELECT id, raw_data->>'supabaseAuthId' FROM users
--   WHERE raw_data->>'supabaseAuthId' = ANY($1);
--
--   BEFORE                          23.608 ms   Seq Scan, 49,917 rows removed
--   AFTER   3 runs                   0.298 ms   Index Scan
--                                    0.254 ms
--                                    0.289 ms
--
-- ~80x, and the shape matters more than the ratio: the seq scan's cost grows
-- with the whole user table on every scan, while the index scan's grows with
-- the 100 ids asked about. A single-id lookup goes 19.019 ms -> 0.046 ms.
--
-- A btree on an EXPRESSION, not a GIN over raw_data: this is an equality test
-- on one extracted text value, which is exactly what a btree serves.
--
-- COST OF KEEPING IT. 480 kB, over a value written once at migration and never
-- updated. A btree does not index NULLs, so it covers only the rows that carry
-- the pointer — 5,000 here, not all 50,017.
--
-- ============================================================================
-- HOW TO APPLY  (#469)
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor and run it. The Editor
-- always opens a transaction, so nothing here uses CONCURRENTLY; a plain
-- CREATE INDEX takes a ShareLock, which blocks WRITES to `users` for the build
-- and leaves reads working throughout. `SET lock_timeout` below turns the one
-- real risk — queueing behind an open transaction — into a clean, re-runnable
-- failure.
--
-- Safe to re-run: every statement is IF NOT EXISTS or CREATE OR REPLACE.
-- ============================================================================

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_users_supabase_auth_id
    ON public.users ((raw_data->>'supabaseAuthId'));

RESET lock_timeout;

-- ============================================================================
-- The batch lookup the scan calls.
-- ============================================================================
--
-- BATCH, like migration 031 and for the same reason: the ghost scan resolves
-- up to 100 auth accounts at a time, and 100 round trips is what #465 measured
-- as a timeout. One call, one index scan per id.
--
-- Returns the pointer alongside the profile id so the caller can map a row back
-- to the account that asked for it without a second pass.
CREATE OR REPLACE FUNCTION find_users_by_supabase_auth_ids(p_auth_ids text[])
RETURNS TABLE (id text, supabase_auth_id text)
LANGUAGE sql
STABLE
AS $$
    SELECT u.id::text, (u.raw_data->>'supabaseAuthId')::text
    FROM public.users u
    WHERE u.raw_data->>'supabaseAuthId' = ANY(p_auth_ids);
$$;

-- Guarded like migration 029's: `anon` and `authenticated` do not exist in the
-- bare PostgreSQL the migration suite runs against, and an unguarded GRANT
-- fails the whole file there.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT EXECUTE ON FUNCTION find_users_by_supabase_auth_ids(text[]) TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION find_users_by_supabase_auth_ids(text[]) TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION find_users_by_supabase_auth_ids(text[]) TO service_role;
    END IF;
END
$$;

-- #473: PostgREST caches its schema, and a new function is invisible until it
-- reloads. Without this the RPC fails with "could not find the function ... in
-- the schema cache", the caller falls back, and the page looks fixed while
-- nothing has changed.
NOTIFY pgrst, 'reload schema';
