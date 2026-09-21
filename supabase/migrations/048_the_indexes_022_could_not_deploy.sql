-- ============================================================================
-- 048 — The six indexes 022 declared and no deploy could ever apply
-- ============================================================================
-- WHY
-- ---
-- 022 declares nine expression indexes. Every one of them uses
-- `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block —
-- and the Supabase SQL Editor always opens one, as does the deploy runner. So
-- 022 is in build-deploy-sql's EXCLUDED list, with this reason:
--
--     "CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
--      every other migration here opens one. ... Apply it on its own"
--
-- APPLY IT ON ITS OWN means a human, by hand, once, on each database. Whether
-- that ever happened is not knowable from this repository — and 027's header
-- records what the same uncertainty cost the last time: a migration that
-- "could not be applied by the SQL Editor ... AND IT SAT UNAPPLIED".
--
-- Two migrations have already treated 022 as unapplied and re-declared one of
-- its indexes apiece, in the plain form, under the SAME NAME so that the
-- statement is a no-op wherever 022 did land. 043 says exactly why:
--
--     "Part 2 is `IF NOT EXISTS` on the same index name: a no-op where 022
--      landed, and the repair where it did not."
--
-- 043 rescued idx_mo_buyer_id. 041 built the owner/seller pair beside it.
-- THE OTHER EIGHT WERE NEVER RESCUED, and two of them are the two that 041's
-- own header calls the load-bearing ones:
--
--     "022 indexed `status` and `userId` on document_collections — the two
--      that cover most of the application."
--
-- Those two are in this file. So is the reference the marketplace webhook
-- looks an order up by on every single payment.
--
-- ── WHY FIVE MIGRATIONS WENT BY WITHOUT ANYBODY NOTICING ────────────────────
--
-- Because the test databases are the one place 022 applies perfectly.
--
-- scripts/local-postgres.sh and scripts/ci-integration-db.sh apply every file
-- in migrations/ with `psql -f`, which runs in AUTOCOMMIT — and CONCURRENTLY
-- is fine there. So every local and CI database has carried all nine of 022's
-- indexes from the moment it was built, every plan test has measured a
-- database that has them, and every suite has been green.
--
-- The environments where 022 cannot apply are the Supabase SQL Editor and the
-- deploy runner, both of which open a transaction — which is to say, the real
-- ones. The bug is invisible precisely where it is tested and present only
-- where it is not, which is why it needed somebody to read EXCLUDED rather
-- than to run anything.
--
-- src/__tests__/pg/the-indexes-022-could-not-deploy.test.ts pins both halves:
-- 022 through a transaction-wrapping client still raises 25001, and this file
-- through the same client does not.
--
-- ── WHAT IS RESCUED, AND WHAT IS DELIBERATELY NOT ───────────────────────────
--
-- SIX of the eight. The two left behind are 022's
--
--     idx_cm_user_id             ON cooperative_members ((raw_data->>'userId'))
--     idx_cm_membership_status   ON cooperative_members ((raw_data->>'membershipStatus'))
--
-- and they are left behind because NOTHING CAN EVER USE THEM. supabase-db
-- resolves a filter field through FIELD_TO_COLUMN before it falls back to the
-- JSONB path, and cooperative_members maps both of those names to native
-- columns:
--
--     'userId' -> user_id        'membershipStatus' -> status
--
-- so the adapter emits `user_id = $1`, never `raw_data->>'userId' = $1`, and
-- an index on the JSONB path cannot be reached. Nothing else reads the table
-- by those keys — the only raw SQL against cooperative_members anywhere reads
-- `raw_data->>'email'`, in a diagnostic script.
--
-- An index nobody can use is not free: it is maintained on every INSERT and
-- UPDATE to a table on the cooperative signup path, and it is a line in every
-- future reader's mental model of what this table is indexed by. Creating it
-- to "match 022" would be tidiness bought with write amplification.
--
-- THIS IS LOAD-BEARING ON A MAPPING, so it is asserted rather than trusted:
-- src/__tests__/the-indexes-022-could-not-deploy.test.ts fails if either
-- FIELD_TO_COLUMN entry is removed, and says that removing it makes 022's
-- index live and this omission wrong.
--
-- ============================================================================
-- MEASURED, on a real PostgreSQL 16
-- ============================================================================
-- 200,000 document_collections rows over 25 collections (170 MB), 40,000
-- processed_payments (33 MB), 20,000 marketplace_orders (18 MB). The "BEFORE"
-- has 041's and 043's indexes already present, because that is the state a
-- production database is actually in — not a bare table.
--
--                                          before            after
--   dc  collection + userId          23,963 buf  187 ms      4 buf  0.09 ms
--   dc  collection + status          16,185 buf  153 ms     53 buf  0.26 ms
--   pp  type                          4,000 buf   35 ms  1,208 buf  6.8 ms
--   pp  status = 'pending_fulfilment' 4,000 buf   20 ms    805 buf  3.9 ms
--   mo  paymentReference              2,223 buf   19 ms      4 buf  0.06 ms
--   mo  paymentStatus IN (3 values)   2,223 buf   10 ms    856 buf  3.6 ms
--
-- AND THE TWO BIG ONES ARE NOT SEQUENTIAL SCANS, which is the same trap 043
-- documented and worth repeating. The planner reaches for whichever
-- (collection_name, …) index it has — idx_dc_collection_seller — and uses only
-- its LEADING column, so it narrows to the collection and then reads every row
-- in it. 23,963 buffers to return 40 rows. The cost grows with the collection
-- instead of with the user, which reaches the user as a timeout and an empty
-- screen.
--
-- ── THE HONEST HALF OF THE STATUS MEASUREMENT ───────────────────────────────
--
-- idx_pp_status AND idx_mo_payment_status DO NOT SPEED UP THE COMMON QUERY,
-- and that is correct rather than a disappointment. `status = 'completed'` is
-- 85% of processed_payments and `paymentStatus = 'completed'` is 70% of
-- marketplace_orders; the planner correctly keeps the sequential scan for
-- both, because a bitmap over most of a table is worse than reading it:
--
--   pp  status = 'completed' (85%)    4,000 buf   20 ms   4,000 buf  22 ms
--   mo  paymentStatus = 'completed'   2,223 buf   10 ms   2,223 buf  10 ms
--
-- What they serve is the RARE values, which is where the scans that hurt are:
-- the stranded-payment sweep (`status = 'pending_fulfilment'`, payments
-- service line 401) and the two broadcasts, which select the people who have
-- NOT paid (`paymentStatus in ('pending','unpaid','failed')`). Anybody adding
-- up these numbers expecting the revenue totals to get faster should know they
-- will not, from the file rather than from a week of wondering.
--
-- NOT MADE PARTIAL, though excluding 'completed' would be ~15% of the size.
-- The name has to stay bound to 022's definition: `IF NOT EXISTS` skips an
-- existing index without comparing it, so a partial index under 022's name
-- would be a FULL index on every database where 022 was applied by hand and a
-- partial one everywhere else — two different schemas answering to one name,
-- which is precisely the ambiguity this file exists to end. A narrower index
-- is a later migration under its own name, after this one has made every
-- database the same.
--
-- ============================================================================
-- HOW TO APPLY  (#469)
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor, or let it arrive in the
-- consolidated deploy — which, unlike 022, it can, because nothing here is
-- CONCURRENTLY. Plain `CREATE INDEX` under a lock_timeout takes a ShareLock:
-- reads are unaffected, writes to the table pause for the build, and the
-- lock_timeout turns queueing behind an open transaction into a clean,
-- re-runnable abort instead of a pile-up of every writer behind it.
--
-- Additive only: it creates indexes and alters, deletes and reads nothing.
-- Safe to re-run, and safe to run on a database where 022 was applied by hand
-- — every statement is IF NOT EXISTS on 022's own name, so there it does
-- nothing at all.
--
-- NOT REQUIRED FOR CORRECTNESS. The code is right without it and merely
-- slower, so deploying ahead of this migration is safe.
-- ============================================================================

-- Do not queue behind an open transaction and take every writer down with us.
SET lock_timeout = '5s';


-- ─── document_collections — "the two that cover most of the application" ────
--
-- (collection_name, key), in that order and for 041's reason: every one of
-- these queries names the collection, and a shared table's index is useless to
-- one collection if it cannot narrow to it first.

CREATE INDEX IF NOT EXISTS idx_dc_collection_status
    ON public.document_collections (collection_name, (raw_data->>'status'));

CREATE INDEX IF NOT EXISTS idx_dc_collection_user
    ON public.document_collections (collection_name, (raw_data->>'userId'));


-- ─── processed_payments — the ledger ────────────────────────────────────────
--
-- `type` and `status` are both in raw_data: NATIVE_COLUMNS['processed_payments']
-- is id, user_id, amount, reference, created_at, updated_at. Every revenue
-- rollup, every cooperative membership check and the stranded-payment sweep
-- filters on one or both.

CREATE INDEX IF NOT EXISTS idx_pp_status
    ON public.processed_payments ((raw_data->>'status'));

CREATE INDEX IF NOT EXISTS idx_pp_type
    ON public.processed_payments ((raw_data->>'type'));


-- ─── marketplace_orders — the webhook's idempotency lookup ──────────────────
--
-- `paymentReference` is how every marketplace, export, cooperative and farm
-- nation verify path finds the order a Paystack reference belongs to. It is
-- unique in practice and was a full scan on every payment.

CREATE INDEX IF NOT EXISTS idx_mo_payment_reference
    ON public.marketplace_orders ((raw_data->>'paymentReference'));

CREATE INDEX IF NOT EXISTS idx_mo_payment_status
    ON public.marketplace_orders ((raw_data->>'paymentStatus'));


-- 022's idx_cm_user_id and idx_cm_membership_status are deliberately absent.
-- See "WHAT IS RESCUED, AND WHAT IS DELIBERATELY NOT" above: FIELD_TO_COLUMN
-- routes both names to native columns, so the JSONB path is never emitted and
-- neither index could be reached.

RESET lock_timeout;
