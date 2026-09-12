-- ============================================================================
-- IS THIS DATABASE UP TO DATE?  —  #664
--
-- Paste into the Supabase SQL Editor of the project you want to ask about.
-- READ-ONLY: it reads pg_tables, pg_policies and pg_proc and writes nothing.
--
-- WHY THIS EXISTS
--   deploy.sql answers "apply everything"; this answers "what is there now".
--   The owner-side list carried "confirm migrations 034 and 035 are applied"
--   for weeks because nothing in the repository could answer it, and the only
--   route to an answer was a Node toolchain the person pasting SQL does not
--   have.
--
-- VALIDATED AGAINST BOTH CONTROLS, because a status query that always says YES
-- is worse than none:
--   a database with every migration      → every row YES / 9 / 0 / 45
--   a database missing 033, 034, 035     → those three NO, RLS 0 of 9, 43
--
-- WHAT THE ANSWERS MEAN
--   RLS ON should be 9 and OFF should be 0. If OFF is 9, migration 004 has not
--   been applied and the public anon key can read every row of every table.
--
--   POLICIES ATTACHED SHOULD BE 0. That is not a mistake — it is Option A from
--   004: row-level security on with no policy, so the anon key can do nothing
--   and the service role (which the application uses) is unaffected. A number
--   above zero means STEP 2 was uncommented and the browser has been granted
--   direct table access.
--
--   035 is #652's overselling fix. While it says NO, a cart carrying the same
--   product on two lines can take more stock than exists.
-- ============================================================================

SELECT 'RLS: tables with it ON'  AS check, count(*)::text AS result
  FROM pg_tables WHERE schemaname='public' AND rowsecurity
UNION ALL
SELECT 'RLS: tables with it OFF', count(*)::text
  FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity
UNION ALL
SELECT 'policies attached (0 is correct)', count(*)::text
  FROM pg_policies WHERE schemaname='public'
UNION ALL
SELECT '035 overselling fix applied',
       coalesce((SELECT CASE WHEN prosrc LIKE '%GROUP BY 1, 2, 3%' THEN 'YES' ELSE 'NO - stock can be oversold' END
                   FROM pg_proc WHERE proname='decrement_many_or_fail' LIMIT 1), 'NO - function missing')
UNION ALL
SELECT '034 widened segments applied',
       coalesce((SELECT CASE WHEN prosrc LIKE '%jsonb_present%' THEN 'YES' ELSE 'NO - 034 missing' END
                   FROM pg_proc WHERE proname='user_segment' LIMIT 1), 'NO - function missing')
UNION ALL
SELECT '033 auth-id lookup applied',
       coalesce((SELECT 'YES' FROM pg_proc WHERE proname='find_users_by_supabase_auth_ids' LIMIT 1), 'NO')
UNION ALL
-- ── #666 — APPLICATION FUNCTIONS ONLY. ──────────────────────────────────────
-- The first version of this line counted every function in `public` and said
-- "expect 45", which was the number on the machine it was written on. Supabase
-- keeps extensions in the `extensions` schema; the local stack had uuid-ossp in
-- `public`, contributing exactly ten. So a COMPLETE production database
-- reported 35 of 45 and looked like it was missing ten money functions.
-- Extension-owned functions are excluded by pg_depend now, and the expectation
-- is the application's own.
-- count(DISTINCT proname), not count(*): credit_wallet_once and
-- debit_jsonb_balance are OVERLOADED, so a row count and the list below
-- disagree by two and the expectation cannot match both.
SELECT 'application functions present (expect 34)', count(DISTINCT p.proname)::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
 WHERE n.nspname = 'public' AND d.objid IS NULL
UNION ALL
-- ── And WHICH ones are missing, by name. ────────────────────────────────────
-- A count cannot be acted on: "35 of 45" says something is wrong and not what,
-- which is the same defect as a warning nobody can act on (#658) and a flag no
-- screen renders (#665). Expect NO rows below this line.
SELECT 'MISSING FUNCTION', expected.name
  FROM (VALUES ('apply_array_ops'),
               ('apply_document_patch'),
               ('apply_increments'),
               ('atomic_profile_sync'),
               ('claim_idempotency_key'),
               ('claim_payment_once'),
               ('claim_single_open_loan_application'),
               ('claim_status_transition'),
               ('claim_status_transition_in'),
               ('claim_versioned_update'),
               ('count_user_segments'),
               ('credit_wallet_once'),
               ('debit_jsonb_balance'),
               ('debit_jsonb_balance_with_floor'),
               ('debit_wallet_locked'),
               ('debit_wallet_once'),
               ('decrement_many_or_fail'),
               ('enforce_member_active_on_paid'),
               ('find_users_by_normalised_email'),
               ('find_users_by_normalised_emails'),
               ('find_users_by_supabase_auth_ids'),
               ('increment_within_ceiling'),
               ('jsonb_array_remove'),
               ('jsonb_array_union'),
               ('jsonb_numeric_or_null'),
               ('jsonb_present'),
               ('jsonb_set_deep'),
               ('jsonb_text_array_or_null'),
               ('jsonb_truthy'),
               ('merge_raw_data'),
               ('native_column_map'),
               ('platform_revenue_totals'),
               ('update_updated_at_column'),
               ('user_segment')) AS expected(name)
 WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = expected.name
 );
