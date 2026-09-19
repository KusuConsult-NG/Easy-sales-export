-- ============================================================================
-- 043 — The buyer's own rows, indexed the way 041 indexed the seller's
-- ============================================================================
--
-- WHY
-- ---
-- #904's buyer side gave a buyer back everything filed under a profile they no
-- longer sign in as: orders, purchase requests, disputes, export orders, land
-- offers, quotes, reviews. Every one of those screens filters on `buyerId`.
--
-- 041 did this for the seller and said what it was fixing:
--
--     "022 indexed `status` and `userId` on document_collections — the two
--      that cover most of the application. Neither is what a seller's own two
--      screens filter on."
--
-- `buyerId` is the third such field, and it was in neither list. Six of the
-- seven collections a buyer's screens read are GENERIC — they live in
-- document_collections — so nothing indexed the column at all:
--
--     disputes            export_orders        land_offers
--     marketplace_quotes  seller_reviews       farm_nation_transactions
--
-- This is 039's finding rather than a new one: the query is not wrong, its
-- cost grows with the whole collection instead of with the buyer's own rows,
-- and it ends as a timeout that reaches the buyer as an empty screen.
--
-- ============================================================================
-- MEASURED, on a real PostgreSQL 16 at 20,000 rows
-- ============================================================================
--
-- PART 1 — the generic collections.
--
--   SELECT id FROM document_collections
--    WHERE collection_name = 'disputes'
--      AND raw_data->>'buyerId' = ANY($1);
--
--   BEFORE  3 runs   2.303 / 2.337 / 2.323 ms   cost 406.30
--   AFTER   3 runs   0.164 / 0.169 / 0.139 ms   cost  73.26
--
-- AND THE "BEFORE" IS NOT A SEQUENTIAL SCAN, which is worth recording rather
-- than overstating. The planner reaches for idx_dc_collection_seller and uses
-- only its LEADING column, `collection_name` — so it narrows to the collection
-- and then examines every row in it: 4,000 read to return 20. The cost grows
-- with the collection rather than with the buyer, which is the same shape 041
-- fixed and a smaller number than 041 measured.
--
-- PART 2 — marketplace_orders, which is a DEDICATED table.
--
--   SELECT id FROM marketplace_orders WHERE raw_data->>'buyerId' = ANY($1);
--
--   WITHOUT  2 runs   4.972 / 4.885 ms   Seq Scan     cost 546.00
--   WITH               0.152 ms          Index Scan   cost  71.92
--
-- That one is a true sequential scan, and it is the busiest buyer screen there
-- is.
--
-- WHY PART 2 EXISTS WHEN 022 ALREADY WROTE IT
-- -------------------------------------------
-- 022 creates idx_mo_buyer_id — with CONCURRENTLY, which is why 022 is in
-- build-deploy-sql's EXCLUDED list and has to be applied BY HAND, on its own.
-- Whether that ever happened on any given database is not knowable from here,
-- and 027's header records what that uncertainty cost last time: a migration
-- that "could not be applied by the SQL Editor ... AND IT SAT UNAPPLIED".
--
-- So Part 2 is `IF NOT EXISTS` on the same index name: a no-op where 022
-- landed, and the repair where it did not. It creates nothing 022 would not
-- have created, and it is the same relationship 041 has to 022 — the plain
-- form, in the consolidated file, of something CONCURRENTLY put out of reach.
--
-- ============================================================================
-- HOW TO APPLY  (#469)
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor, or let it arrive in the
-- consolidated deploy. PLAIN `CREATE INDEX` under a lock_timeout, never
-- CONCURRENTLY — which cannot run inside a transaction, and the Editor always
-- opens one. The build takes a ShareLock: reads are unaffected, writes to the
-- table pause for its duration, and the lock_timeout turns queueing behind an
-- open transaction into a clean, re-runnable abort.
--
-- Additive only: it creates indexes and reads, alters and deletes nothing.
-- Safe to re-run: every statement is IF NOT EXISTS.
--
-- NOT REQUIRED FOR CORRECTNESS. The code is right without it and merely
-- slower, so deploying ahead of this migration is safe.
-- ============================================================================

SET lock_timeout = '5s';


-- ─── PART 1 — the generic collections a buyer's screens read. ───────────────
--
-- (collection_name, buyerId), in that order and for 041's reason: every one of
-- these queries names the collection, and a shared table's index is useless to
-- one collection if it cannot narrow to it first.

CREATE INDEX IF NOT EXISTS idx_dc_collection_buyer
    ON public.document_collections (collection_name, (raw_data->>'buyerId'));


-- ─── PART 2 — the dedicated table, where 022 may never have run. ────────────
--
-- Same name 022 uses, so this is a no-op wherever 022 was applied by hand.

CREATE INDEX IF NOT EXISTS idx_mo_buyer_id
    ON public.marketplace_orders ((raw_data->>'buyerId'));


RESET lock_timeout;


-- ─── VERIFY. Read-only. Run after the indexes exist. ────────────────────────
--
-- Both must say Index Scan or Bitmap Index Scan on the named index. A Seq Scan
-- on a table this size means stale statistics — run ANALYZE on it.
--
--   EXPLAIN SELECT id FROM public.document_collections
--    WHERE collection_name = 'disputes'
--      AND raw_data->>'buyerId' = 'any-buyer-id';
--
--   EXPLAIN SELECT id FROM public.marketplace_orders
--    WHERE raw_data->>'buyerId' = 'any-buyer-id';
--
-- And that both exist and are valid:
--
--   SELECT c.relname, i.indisvalid
--     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE c.relname IN ('idx_dc_collection_buyer', 'idx_mo_buyer_id');
