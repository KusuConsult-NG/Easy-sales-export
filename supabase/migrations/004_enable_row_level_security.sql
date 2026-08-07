-- Migration: 004_enable_row_level_security.sql
--
-- ⚠️  READ THE NOTES BELOW BEFORE APPLYING. Apply STEP 1 only.
--     The code side is ready; the rollout is not tested anywhere yet.
--
-- WHY THIS EXISTS
-- ---------------
-- schema.sql creates nine tables and never enables row-level security, and
-- there is not a single CREATE POLICY anywhere in the repository. The browser
-- authenticates to Supabase with the anon key (src/lib/supabase.ts), which is
-- public by design — it ships inside the JavaScript bundle.
--
-- With RLS disabled, that key can read and write EVERY row of EVERY table
-- directly against the Supabase REST endpoint: users, wallets, transactions,
-- processed_payments. The application's own permission checks are irrelevant,
-- because an attacker does not have to go through the application.
--
-- WHAT THIS MIGRATION ASSUMES
-- ---------------------------
-- 1. All server-side access uses the SERVICE ROLE key (supabaseAdmin in
--    src/lib/supabase.ts). The service role bypasses RLS entirely, so server
--    actions, API routes and cron jobs are unaffected by these policies.
--
-- 2. Client-side access uses the ANON key and is limited to what
--    src/lib/supabase-client-db.ts reads today:
--      - users            : own row only          (Sidebar, DashboardNav, dashboard)
--      - document_collections:
--          notifications  : own rows              (dashboard, notifications page)
--          conversations  : rows the user is a participant in (unread badges)
--      - wallets          : own row only          (dashboard balance)
--    Everything else the browser touches should move to a Server Action.
--
-- 3. The application authenticates users with NextAuth, NOT Supabase Auth
--    sessions. auth.uid() is therefore NULL for browser requests, so the
--    per-user policies in STEP 2 would deny everything and must stay
--    commented out. That is fine — see below.
--
-- WHICH OPTION THIS FILE IS NOW SET UP FOR
-- ----------------------------------------
-- OPTION A, and the code side of it is COMPLETE. Nothing in the browser
-- queries the database any more: the client components moved to Server
-- Actions first, and the three polling hooks that were missed in that pass
-- (useMembershipStatus, usePendingApplicationStatus, useUnreadNotifications)
-- followed. src/app/actions/my-data.ts holds the replacements.
--
-- So STEP 1 alone is what you apply. RLS on, no policies, anon key locked out
-- entirely. STEP 2 stays commented out unless someone later chooses Option B
-- (issue a Supabase session alongside the NextAuth one, and accept two session
-- lifetimes to keep in sync).
--
-- Confirm the precondition still holds before applying — this comment ages,
-- the grep does not:
--
--   grep -rn "from ['\"]@/lib/supabase['\"]" src/
--
-- Expect only supabaseAdmin (the service role, server-side). Any hit importing
-- the plain `supabase` client from a component or hook is a browser reader,
-- and applying this migration will silently break it.
--
-- HOW TO TEST
--   1. Restore a production backup into a staging Supabase project.
--
--      NOTE: no staging project exists today. .env.staging defines no Supabase
--      variables, and .env.local and .env.production.local point at the SAME
--      project. Until that changes, production is the first place this runs.
--
--   2. Apply this migration there.
--   3. Exercise: sign in, dashboard, notification bell, unread message badge,
--      wallet balance, cooperative pages, admin portal.
--   4. Confirm with the anon key that a signed-out client can read nothing:
--        curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON_KEY"
--      Expect an empty array, not rows.
--   5. Only then schedule production, during a low-traffic window.
--
-- WHAT FAILURE LOOKS LIKE
--   Not an error. With RLS on and no policy, Postgres returns ZERO ROWS to the
--   anon key rather than raising. If a browser reader was missed, it shows up
--   as members reported as non-members, empty dashboards and notification
--   counts stuck at zero — with nothing in the logs. Watch the app directly
--   after applying, and keep the rollback at the bottom of this file to hand.
--
-- ROLLBACK
--   Each ENABLE has a matching DISABLE at the bottom of this file, commented
--   out. Disabling RLS restores the current (insecure) behaviour immediately.

BEGIN;

-- ============================================================================
-- STEP 1 — Enable RLS on every table.
-- With RLS on and no policy attached, the anon key can do nothing. The service
-- role key still has full access, so the application keeps working.
-- ============================================================================

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_loans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_applications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_collections   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2 — Per-user read policies.
--
-- APPLY THESE ONLY IF YOU CHOSE OPTION B (browser holds a Supabase session).
-- Under Option A, leave this whole section commented out: no policy means no
-- anon access, which is what you want.
--
-- Note every policy is SELECT only. The browser has never needed to write
-- directly, and it should not be able to.
-- ============================================================================

-- CREATE POLICY users_select_own ON users
--     FOR SELECT TO anon, authenticated
--     USING (id = auth.uid()::text);

-- CREATE POLICY wallets_select_own ON wallets
--     FOR SELECT TO anon, authenticated
--     USING (id = auth.uid()::text);

-- -- Notifications: rows in document_collections belonging to the caller.
-- CREATE POLICY doc_notifications_select_own ON document_collections
--     FOR SELECT TO anon, authenticated
--     USING (
--         collection_name = 'notifications'
--         AND raw_data->>'userId' = auth.uid()::text
--     );

-- -- Conversations: rows where the caller is listed as a participant.
-- -- This is the query that currently returns EVERY conversation on the
-- -- platform to EVERY signed-in browser, because the client adapter silently
-- -- dropped the array-contains filter (fixed separately in the adapter).
-- CREATE POLICY doc_conversations_select_participant ON document_collections
--     FOR SELECT TO anon, authenticated
--     USING (
--         collection_name = 'conversations'
--         AND raw_data->'participants' ? (auth.uid()::text)
--     );

COMMIT;

-- ============================================================================
-- VERIFICATION — run after applying.
-- ============================================================================
--
-- Every table should report rowsecurity = true:
--
--   SELECT tablename, rowsecurity
--     FROM pg_tables
--    WHERE schemaname = 'public'
--    ORDER BY tablename;
--
-- List whatever policies ended up attached:
--
--   SELECT tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;

-- ============================================================================
-- ROLLBACK — uncomment and run to restore current behaviour.
-- ============================================================================
--
-- ALTER TABLE users                DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE cooperative_members  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE cooperative_loans    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE processed_payments   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketplace_orders   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE wallets              DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE academy_applications DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE document_collections DISABLE ROW LEVEL SECURITY;
