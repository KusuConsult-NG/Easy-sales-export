-- ============================================================================
-- #478  EVERY EMAIL LOOKUP ON users COMPARES A NORMALISED VALUE, ONCE.
-- ============================================================================
--
-- #476 found the LOGIN missing a profile stored as '  Ada@Example.COM ':
--
--     where email = 'ada@example.com'                ->  0 rows
--     where lower(btrim(email)) = 'ada@example.com'  ->  1 row
--
-- and the branch below it then wrote a BLANK profile over the top, losing the
-- person's roles and registrations. #477 found the same shape in the ghost scan
-- and the orphan repair — where the repair CREATES profiles — and #478 found a
-- third copy in preValidateLoginAction, the one that decides which profile the
-- JIT migration copies FROM.
--
-- A grep then found twenty-four more: session-guard.ts, password-reset.ts,
-- module-access-check.ts, six cooperative lookups, the briefing flow, the admin
-- search. Patching them one at a time is precisely how this reached three
-- copies without anybody noticing, so it is fixed at the one place they all
-- pass through — the adapter — and this column is what lets the adapter do it.
--
-- WHY A GENERATED COLUMN AND NOT AN EXPRESSION INDEX ALONE. 030 already adds
-- `users (lower(btrim(email)))`, and Postgres will use it — but PostgREST can
-- only filter on COLUMNS, so the adapter has nothing to send. A stored
-- generated column gives it one, and the index below makes the lookup a single
-- index scan.
--
-- MEASURED on 50,017 rows: the ALTER rewrites the table in 762 ms, and the
-- lookup afterwards is
--
--     Index Scan using idx_users_email_normalised_col  (rows=1)  0.019 ms
--
-- Under a lock_timeout, for #469's reason: the rewrite takes an ACCESS
-- EXCLUSIVE lock — genuinely, unlike a plain CREATE INDEX — so it must not
-- queue behind an open transaction and take every reader down with it. A
-- timed-out run changes nothing and can simply be run again.
--
-- NOTHING IS REWRITTEN IN THE EMAIL COLUMN ITSELF. The stored values are left
-- exactly as they are; this adds a normalised VIEW of them beside the original.
-- The raw address is still what the platform displays and sends mail to.
--
-- AND IT IS NOT ADDED TO NATIVE_COLUMNS in the adapter, deliberately: that list
-- drives the WRITE path, and a generated column cannot be written. It is a
-- read-side routing target only.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS email_normalised text
    GENERATED ALWAYS AS (lower(btrim(email))) STORED;

CREATE INDEX IF NOT EXISTS idx_users_email_normalised_col
    ON public.users (email_normalised);

RESET lock_timeout;

-- PostgREST must learn the new column before it can filter on it. Without this
-- the adapter sends `email_normalised=eq.…` and PostgREST answers "column does
-- not exist" — #473's lesson, and this time it would break every email lookup
-- rather than degrade one counter.
NOTIFY pgrst, 'reload schema';
