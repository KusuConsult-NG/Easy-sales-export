-- ============================================================================
-- #478  THE GHOST SCAN AND THE ORPHAN REPAIR HAD #476'S DEFECT TOO — AND THE
--       REPAIR IS THE HALF THAT WRITES.
-- ============================================================================
--
-- #476 fixed the LOGIN's profile lookup: it compared a lowercased input against
-- a stored column that is not normalised, so a row held as
--
--     [  Ada@Example.COM ]
--
-- was invisible to `where email = 'ada@example.com'`.
--
-- lib/auth-profile-link.ts has the same shape, one line down:
--
--     db.collection(USERS).where('email', 'in', chunk).get()
--     ...
--     const uid = uidByEmail.get(key(d.data()?.email));   // key() normalises
--
-- It normalises the stored value AFTER fetching — and never fetches the row,
-- because the `in` filter compares the raw column. So the normalisation reads
-- as though the case is handled, and it is not.
--
-- WHY THAT MATTERS MORE HERE THAN IT DID AT THE LOGIN. Three callers share this
-- resolution, and #466 is the finding that put them together:
--
--   forensics.ts            reports these people as "ghosts" — auth account,
--                           no profile — when they have one all along.
--
--   detectOrphanedUsers     lists them on /admin/orphaned-users.
--
--   repairOrphanedUser      guards on it and then CREATES A PROFILE. For
--                           somebody whose profile is merely stored with odd
--                           spacing, that guard passes and the repair writes a
--                           SECOND row — which is exactly the duplicate
--                           condition #477 exists to survive, manufactured by
--                           the button meant to fix it.
--
-- #466 closed this door for MIGRATED profiles. It is the same door, and the
-- badly-stored-email case walks straight through it. Sixth
-- fix-reaches-one-of-N in this audit.
--
-- WHY A BATCH FUNCTION. The scan resolves up to 100 accounts at a time and
-- already chunks its queries; calling the single-email function from #476 once
-- per outstanding account would turn one round trip into a hundred, on a scan
-- that #465 had to make cheaper because it was TIMING OUT. This takes the whole
-- outstanding list at once.
--
-- IT RETURNS THE EMAIL as well as the id, because the caller has to map the row
-- back to the auth account it was looking for, and the stored value is exactly
-- what it cannot assume.
--
-- The index from 030 — users (lower(btrim(email))) — serves this too.
--
-- Transaction-safe, per #469.
-- ============================================================================

CREATE OR REPLACE FUNCTION find_users_by_normalised_emails(p_emails text[])
RETURNS TABLE (id text, email text, raw_data jsonb)
LANGUAGE sql
STABLE
AS $$
    SELECT u.id, u.email, u.raw_data
      FROM public.users u
     WHERE lower(btrim(u.email)) = ANY (
               SELECT lower(btrim(e)) FROM unnest(p_emails) AS e
           )
     -- Bounded, like the single-email version. A scan resolving 100 accounts
     -- does not need an unbounded result, and an email on hundreds of rows is a
     -- finding rather than something to page through.
     LIMIT 500;
$$;

-- Guarded, per 029: scripts/test-migrations.sh applies every migration to a
-- throwaway cluster that has no Supabase roles.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION find_users_by_normalised_emails(text[]) TO %I', r);
        END IF;
    END LOOP;
END $$;

-- PostgREST serves RPC from a cached schema. #473 measured what skipping this
-- costs: the migration applies, the code is right, and the call fails while a
-- fallback silently carries it.
NOTIFY pgrst, 'reload schema';
