-- ============================================================================
-- #476  A PROFILE STORED WITH DIFFERENT CASE OR SURROUNDING SPACE IS INVISIBLE
--       TO LOGIN, AND LOGIN THEN CREATES A BLANK ONE OVER THE TOP.
-- ============================================================================
--
-- lib/auth.ts finds the caller's profile with
--
--     db.collection(USERS).where('email', '==', email.toLowerCase())
--
-- The INPUT is lowercased. The STORED VALUE is not normalised at all. Proven
-- against a real PostgreSQL, with a row stored exactly as legacy data is:
--
--     stored:  [  Ada@Example.COM ]   roles: wave_participant, academy_participant
--
--     where email = 'ada@example.com'                    ->  0 rows
--     where lower(btrim(email)) = 'ada@example.com'      ->  1 row
--
-- WHAT HAPPENS TO THAT PERSON. Supabase Auth verifies them — they typed the
-- right password, they are who they say. The profile query returns empty, and
-- auth.ts takes the branch immediately below it:
--
--     logger.info("... no profile found in database. Auto-provisioning ...")
--     const defaultProfile = {
--         roles: ['general_user'],
--         fullName: email.split('@')[0],
--         profileComplete: false,
--         ...
--     };
--     await db.collection(USERS).doc(newUid).set(defaultProfile, { merge: true });
--
-- They log in and their name, their roles and their approved registrations are
-- gone. That is the owner's report, in the owner's words: "account not found or
-- missing details even when they are fully registered", "missing details after
-- they got enrolled successfully".
--
-- AND IT COMPOUNDS. The auto-provision writes a SECOND row, under the auth id,
-- while the real profile stays under its legacy id. Both now match the email
-- query, neither identifies with the auth account by the first two rules, and
-- every later login falls to auth.ts's last resort — `?? userSnap.docs[0]` —
-- which picks whichever row comes back first. One person, two profiles, and
-- which one they get is arbitrary.
--
-- THIS REPOSITORY ALREADY KNEW. #465's authAccountsWithProfiles normalises BOTH
-- sides — `email.trim().toLowerCase()` — and its test asserts that
-- '  Ada@Example.COM ' matches 'ada@example.com'. The forensic scan was taught
-- this and the LOGIN was not. Fifth time in this audit that a fix reached some
-- of the doors, and this door is the front one.
--
-- WHY A FUNCTION AND NOT `ilike`
-- ------------------------------
-- The obvious patch is a case-insensitive match, and it is wrong twice over.
-- Measured against the real PostgREST:
--
--     email=ilike.ada@example.com      ->  []          (the spaces defeat it)
--     email=ilike.*ada@example.com*    ->  the row     (and much else)
--
-- Only the WILDCARD form finds it, and a wildcard on an identity lookup is a
-- security defect: `*ada@example.com*` also matches `xada@example.com.attacker`
-- — a different account, containing this address as a substring. A login must
-- not resolve identity by substring. `lower(btrim(...))` is an exact match on a
-- normalised value, which is what was meant all along.
--
-- NOTHING IS REWRITTEN. The stored emails are left exactly as they are. This
-- adds a way to FIND them, not a migration that edits identity data on a live
-- table — the owner's standing instruction, and the right call regardless:
-- rewriting the email column is a change to how every other row is matched, and
-- it is not needed to fix this.
--
-- THE INDEX IS WHAT KEEPS IT HONEST. Without it this is a sequential scan of
-- 42,141 users on every login that reaches the fallback. With it, an index scan.
-- Same shape as #471, and the same test 022 asks for: a large table returning
-- one row.
--
-- HOW TO APPLY
-- ------------
-- Paste into the Supabase SQL Editor, or let it arrive in the consolidated
-- deploy. Transaction-safe, per #469.
-- ============================================================================

-- Exact match on the normalised value, indexed.
CREATE INDEX IF NOT EXISTS idx_users_email_normalised
    ON public.users (lower(btrim(email)));

/**
 * Every profile whose email matches, ignoring case and surrounding space.
 *
 * Returns rows, not ids, so the caller does not need a second round trip — the
 * login path is latency-sensitive and this only runs when the exact match has
 * already failed.
 */
CREATE OR REPLACE FUNCTION find_users_by_normalised_email(p_email text)
RETURNS TABLE (id text, raw_data jsonb)
LANGUAGE sql
STABLE
AS $$
    SELECT u.id, u.raw_data
      FROM public.users u
     WHERE lower(btrim(u.email)) = lower(btrim(p_email))
     -- Bounded. A caller resolving ONE identity does not need an unbounded
     -- list, and an email matching hundreds of rows is a finding of its own
     -- rather than something to page through during a login.
     LIMIT 50;
$$;

-- Grant to the PostgREST roles, IF THEY EXIST — see 029 for why this is
-- guarded: scripts/test-migrations.sh applies every migration to a throwaway
-- cluster that has no Supabase roles.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION find_users_by_normalised_email(text) TO %I', r);
        END IF;
    END LOOP;
END $$;

-- PostgREST serves RPC from a cached schema and will not see this function
-- until told. #473 measured what skipping this costs: the migration applies
-- cleanly, the code is correct, and the call fails with "could not find the
-- function ... in the schema cache" while the fallback quietly carries it.
NOTIFY pgrst, 'reload schema';
