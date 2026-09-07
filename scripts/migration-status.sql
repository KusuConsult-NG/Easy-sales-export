-- ============================================================================
-- WHICH MIGRATIONS ARE ACTUALLY APPLIED TO THIS DATABASE.
-- ============================================================================
--
-- Paste into the Supabase SQL Editor. Every row says APPLIED or *** MISSING ***.
--
-- WHY THIS EXISTS
-- ---------------
-- There is no migration table here — migrations are pasted into the SQL Editor
-- by hand, so nothing records what has been run. Over this audit that produced
-- the same confusion three separate times:
--
--   #469  027 was written with CREATE INDEX CONCURRENTLY, could not be applied
--         by the SQL Editor at all, and sat unapplied while everything else
--         suggested it had shipped.
--
--   #473  029 applied cleanly, the code was correct, and the feature still did
--         not work — PostgREST had not reloaded its schema cache, the RPC was
--         failing, and a fallback carried it silently.
--
--   and the owner's local checkout was two migrations behind the branch while
--   we were both discussing whether those migrations were live.
--
-- The answer is not to remember. It is to ask the database.
--
-- This checks for the OBJECT each migration creates, not for a record that it
-- ran, so it cannot be fooled by a half-applied paste: a migration that errored
-- partway shows MISSING for the thing it did not finish creating.
--
-- Safe to run any time. It reads catalogue tables and nothing else.
-- ============================================================================

SELECT m.n AS migration, m.what,
       CASE WHEN m.present THEN 'APPLIED' ELSE '*** MISSING ***' END AS state
FROM (VALUES
  ('027', 'created_at indexes on the 8 dedicated tables',
     (SELECT count(*) FROM pg_indexes
       WHERE schemaname='public' AND indexname IN (
         'idx_users_created_at','idx_marketplace_orders_created_at','idx_processed_payments_created_at',
         'idx_transactions_created_at','idx_cooperative_members_created_at','idx_cooperative_loans_created_at',
         'idx_academy_applications_created_at','idx_wallets_created_at')) = 8),
  ('028', 'GIN index on users.roles',
     EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_roles')),
  ('029', 'count_user_segments()',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname='count_user_segments')),
  ('030', 'find_users_by_normalised_email()',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname='find_users_by_normalised_email')),
  ('031', 'find_users_by_normalised_emails() [batch]',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname='find_users_by_normalised_emails')),
  ('032', 'users.email_normalised column + index',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='users' AND column_name='email_normalised')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_email_normalised_col'))
) AS m(n, what, present)
ORDER BY m.n;
