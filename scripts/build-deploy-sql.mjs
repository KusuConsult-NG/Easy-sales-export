#!/usr/bin/env node
/**
 * Builds a single, ordered SQL file to apply every migration to a database.
 *
 * WHY THIS EXISTS
 * ---------------
 * There are now fourteen migrations, applied by pasting into the Supabase SQL
 * Editor because neither psql nor the Supabase CLI is installed. Three facts
 * make pasting them by hand risky:
 *
 *   1. 014 REPLACES the function 013 creates, to add nested-path support.
 *      Applying 013 after 014 silently reverts that.
 *
 *   2. 011 corrects the wallet functions from 005/006, which as written update
 *      a column the application never reads. Skipping it leaves wallet credits
 *      invisible.
 *
 *   3. 010 (atomic increments) makes several unguarded checks WORSE until the
 *      code guarding them is deployed. It belongs with that code, not ahead of
 *      it. See docs/audit/atomic-money-migration.md.
 *
 * Generating the file from the directory means the script cannot drift from the
 * migrations, and a missing one is an error rather than a silent gap.
 *
 * Usage:
 *   node scripts/build-deploy-sql.mjs                 # write to stdout
 *   node scripts/build-deploy-sql.mjs --out deploy.sql
 *   node scripts/build-deploy-sql.mjs --skip-rls      # omit 004
 *   node scripts/build-deploy-sql.mjs --migrations DIR  # read from DIR (tests)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the migrations are read from.
 *
 *   `--migrations <dir>` EXISTS SO THE TESTS STOP MUTATING THE REAL DIRECTORY.
 *
 *   The #469 suite proves this script REFUSES two things — a migration it does
 *   not know about, and a statement that cannot run in a transaction — and the
 *   only way to prove a refusal is to present the thing being refused. It did
 *   that by writing `999_temp_469_probe.sql` into supabase/migrations and by
 *   rewriting 027 in place, restoring both afterwards.
 *
 *   Which works, right up until something else reads the directory at the same
 *   moment. Jest runs suites in parallel workers, and two of them list these
 *   files: the deploy-file suite asserts every migration on disk is named in
 *   DEPLOY.sql, and this suite's own last section scans them all. Either could
 *   see the probe, or see 027 mid-rewrite. The result was a test that failed
 *   perhaps one run in three, naming a file nobody had written, in a suite that
 *   passed in isolation every time — and because the pre-push hook runs the
 *   same suite, it could reject a push for it.
 *
 *   A flag rather than an environment variable: the other options this script
 *   takes are flags, an env var is inherited by accident where an argument
 *   never is, and `--migrations` says what it does at the call site.
 *
 *   Read straight from argv because MIGRATIONS_DIR is needed above the
 *   arg-parsing block further down, and join() is happy with an absolute path.
 */
const migrationsFlag = process.argv.indexOf("--migrations");
const MIGRATIONS_DIR = migrationsFlag !== -1 && process.argv[migrationsFlag + 1]
    ? process.argv[migrationsFlag + 1]
    : "supabase/migrations";

/**
 * Every migration expected in a complete deployment, in application order.
 *
 * The order is the numeric order — but it is written out explicitly rather than
 * sorted, so that a dependency between two of them is visible here rather than
 * implied by a filename.
 */
const EXPECTED = [
    { n: "002", why: "jsonb merge helper used by the adapter's partial updates" },
    { n: "003", why: "atomic profile sync" },
    { n: "018", why: "jsonb_set_deep — MUST come before 010/016/017, which call it" },
    { n: "005", why: "wallet credit/debit — superseded in part by 011" },
    { n: "006", why: "keeps wallet debits out of the revenue total" },
    { n: "007", why: "compare-and-swap for status transitions" },
    { n: "008", why: "narrows the member-status trigger that blocked signups" },
    { n: "009", why: "claim a payment reference without moving money" },
    { n: "010", why: "atomic FieldValue.increment — MUST ship with the code that guards it" },
    { n: "011", why: "corrects 005/006 to write the value the app actually reads" },
    { n: "012", why: "platform revenue totals" },
    { n: "013", why: "locked debit for raw_data balances" },
    { n: "014", why: "extends 013 to nested paths — MUST come after 013" },
    { n: "015", why: "bounded counters — MUST ship with the code that guards stock and capacity" },
    { n: "016", why: "atomic arrayUnion/arrayRemove — MUST ship with the adapter change that calls it" },
    { n: "017", why: "targeted patches — makes every write send only changed fields; also the first working FieldValue.delete" },
    { n: "019", why: "claim an idempotency key — platform.ts and export.ts throw without it" },
    { n: "020", why: "floored debit + versioned CAS — the withdrawal floor and every versionedUpdate caller" },
    { n: "021", why: "one open loan application per borrower (advisory lock)" },
    {
        n: "023",
        why: "repairs the academy rows autoEnrollPaidUser wrote as `resolvedUserId` — " +
             "a DATA migration, not a function. Order does not matter against the " +
             "others; it is here rather than excluded because the rows it fixes are " +
             "invisible to every reader until it runs, and the code fix in #148 stops " +
             "the damage without repairing what is already stored.",
    },
    {
        n: "024",
        why: "backfills the date of birth WAVE validated onto the user record — a DATA " +
             "migration, like 023. Independent of the others; it is here rather than " +
             "excluded because until it runs, forensics.ts cannot age-check any " +
             "participant who enrolled before #157.",
    },
    {
        n: "025",
        why: "claim_status_transition_in — the CAS that can reach the eight DEDICATED " +
             "tables. MUST ship with the code that calls it: status-transition.ts " +
             "routes marketplaceOrders and cooperative_loans through it, and without " +
             "this function every order transition returns claimed=false, which the " +
             "callers report as a conflict rather than as a missing function.",
    },
    {
        n: "026",
        why: "apply_document_patch mirroring the native typed columns — MUST come " +
             "after 017, which it REPLACES. Applied in the other order, the mirroring " +
             "disappears and a .where() list disagrees with the document it links to.",
    },
    {
        n: "027",
        why: "the created_at indexes the eight DEDICATED tables were promoted without. " +
             "Order does not matter against the others — they are indexes, not " +
             "functions — but it belongs IN this file rather than beside it. Its " +
             "first draft used CREATE INDEX CONCURRENTLY, which cannot run in a " +
             "transaction, so it could not be applied by the SQL Editor this header " +
             "says is the only route available here, and it sat unapplied. It is now " +
             "the plain form under a lock_timeout: ShareLock, reads unaffected, 718 ms " +
             "of blocked writes on 50,009 rows. See #469 in its header.",
    },
    {
        n: "028",
        why: "the GIN index on users.roles. Order does not matter against the " +
             "others; it is here because without it EVERY one of the 27 places " +
             "that filters users by role is a full scan of the users table, and " +
             "one of them — the Farm Nation forensic — hit the statement timeout " +
             "in production and reported a whole check as unrunnable. Plain " +
             "CREATE INDEX under a lock_timeout, per #469.",
    },
    {
        n: "029",
        why: "user_segment / count_user_segments — the four admin dashboard counters. " +
             "MUST ship with the code that calls them: analytics.service.ts asks for " +
             "the RPC first and falls back to reading the WHOLE users table when it " +
             "is missing, which is #473 itself (4.6 MB and 51 simultaneous requests " +
             "per cold /admin load). Without this file the deploy is slow rather " +
             "than broken, and says so in the logs.",
    },
    {
        n: "030",
        why: "find_users_by_normalised_email + the index it needs. MUST ship with the " +
             "code that calls it: lib/auth.ts falls back to it when the exact email " +
             "match finds nothing, and WITHOUT it a profile stored with different case " +
             "or surrounding space stays invisible and login auto-provisions a blank " +
             "profile over the top — #476, which is the owner's 'account not found / " +
             "missing details even when fully registered'.",
    },
    {
        n: "031",
        why: "find_users_by_normalised_emails — the BATCH form, for the ghost scan and " +
             "the orphan repair. MUST ship with lib/auth-profile-link.ts: without it " +
             "people whose profile is stored with odd case or spacing are reported as " +
             "orphaned AND the repair may write them a duplicate (#478).",
    },
    {
        n: "032",
        why: "users.email_normalised, the generated column every email filter is routed " +
             "to. MUST ship with the adapter change in supabase-db.ts — the two are one " +
             "fix. Applied WITHOUT the code, nothing changes; the code WITHOUT this " +
             "sends email_normalised=eq.… to a column that does not exist and every " +
             "email lookup fails, so keep them together and apply this first.",
    },
    {
        n: "033",
        why: "idx_users_supabase_auth_id and find_users_by_supabase_auth_ids — the fourth " +
             "and only email-free route from an auth account to its profile. Without it, a " +
             "profile carrying no email address (49 of them, minted by two admin approvals " +
             "before #489) cannot be linked to its owner: the forensic scan reports those " +
             "people as ghosts and the repair beside it may write each of them a duplicate " +
             "profile. Measured 23.608 ms -> 0.298 ms on the batch of 100 the scan issues.",
    },
    {
        n: "034",
        why: "user_segment, WIDENED — #536. The four dashboard counters read two " +
             "spellings of address and two of bank while the platform's own writers " +
             "use seven and four, so a member carrying stateOfOrigin and a verified " +
             "bankAccountNumber was counted under 'minimal data'. MUST ship with the " +
             "matching change to categorizeUser in lib/broadcast-logic.ts: the two " +
             "are one rule and a parity suite fails on a single disagreement. Applied " +
             "without the code the dashboard and the broadcast segments disagree; the " +
             "code without this leaves the dashboard exactly as it was, because it " +
             "reads the RPC. CREATE OR REPLACE over 029, transaction-safe.",
    },
    {
        n: "035",
        why: "decrement_many_or_fail, AGGREGATING DUPLICATES — #652. The guard " +
             "against overselling oversold: pass 1 compared each LINE against the " +
             "undecremented value, so two lines of 3 against a stock of 5 both " +
             "passed and pass 2 subtracted 3 twice — ok: true, stock -1, measured " +
             "against a real PostgreSQL. Every caller maps order lines to " +
             "decrement items one for one and nothing between the cart and the " +
             "function merges them. Amounts are summed per row before anything is " +
             "locked; the id-order locking that stops concurrent orders " +
             "deadlocking is unchanged. CREATE OR REPLACE over 015, " +
             "transaction-safe, and it takes effect the moment it is applied — " +
             "the code needs no change to benefit, though marketplace-cart.ts " +
             "aggregates too so a member is refused before Paystack rather than " +
             "after.",
    },
    {
        n: "036",
        why: "the expression index on users.raw_data->>'sellerVerificationStatus'. " +
             "Order does not matter against the others; it is here for the same " +
             "reason 028 is, one field along. getMarketplaceStatsAction counts " +
             "approved sellers on the PUBLIC, uncached /marketplace page, the field " +
             "is not native so the adapter emits a JSONB path, and nothing indexed " +
             "it — measured on 50,024 rows, a Seq Scan over 9,914 buffers versus 3 " +
             "with the index, and in production it is the `count users:` statement " +
             "timeout in the log. The GIN index already on raw_data cannot serve " +
             "`->>` equality and is why this looked covered. Plain CREATE INDEX " +
             "under a lock_timeout, per #469; transaction-safe, and it takes effect " +
             "the moment it is applied — the code needs no change to benefit.",
    },
    {
        n: "037",
        why: "the segment counts exclude erased and superseded accounts. It must " +
             "come AFTER 029 and 034, which create user_segment() and " +
             "count_user_segments(); this replaces the latter and adds " +
             "is_live_person(). #756 added the same exclusion to the JavaScript " +
             "fallback and that is NOT the live path — analytics.service.ts calls " +
             "this function first and only falls back when it is unavailable — so " +
             "until this is applied the owner goes on reading deleted accounts in " +
             "the Ghost bucket. A scrub leaves no application, bank details or " +
             "address, which is the exact definition of that segment, so every " +
             "erasure honoured made the figure larger.",
    },
    {
        n: "038",
        why: "the expression indexes on users.raw_data->>'phone' and " +
             "->>'phoneNumber'. Order does not matter against the others; it is " +
             "here for the same reason 036 is, one field along, and 022's header " +
             "predicted it in as many words — \"the expression-index habit did not " +
             "travel with them\". registerAction's dedup guard is " +
             "`where(\"phone\",\"in\",variants).limit(1)`, and LIMIT stops at the " +
             "first MATCH, so a phone nobody has registered before reads every row " +
             "before it can answer no: the guard is fast for the duplicate it " +
             "exists to reject and slowest for the genuine registration it exists " +
             "to admit. Measured on 50,122 rows, a Seq Scan over 1,319 buffers " +
             "versus 8 with the index, and in production it is the " +
             "`[57014] canceling statement due to statement timeout` under " +
             "\"Registration error\" in the log. Seven live sites filter a phone " +
             "spelling on users — two registration entry points, the WAVE duplicate " +
             "scan, the bulk import, the cooperative identity check and admin " +
             "search, the last using ranges, which one btree expression index also " +
             "serves. Plain CREATE INDEX under a lock_timeout, per #469; " +
             "transaction-safe, and it takes effect the moment it is applied — the " +
             "code needs no change to benefit.",
    },
    {
        n: "039",
        why: "module_registration_counts — one scan of `users` returning how many " +
             "accounts carry each SET of module-registration statuses. Order does " +
             "not matter against the others; it creates a function and depends on " +
             "no earlier one. It replaces the 5-15 SEQUENTIAL SCANS per admin page " +
             "load that #835's applicant register introduced and that are already " +
             "deployed: one count() per bucket per key spelling plus one per " +
             "overlapping pair, each filtering a JSONB status path no index serves. " +
             "An index does not solve it — the `total` bucket filters `<> " +
             "'not_started'`, and `<>` is not a btree strategy, so the planner " +
             "scans with an expression index exactly as without one (3,475 buffers " +
             "either way, measured on 50,122 rows). Rewriting that as an inclusion " +
             "list would make it indexable and would reintroduce what #824 cost " +
             "this audit. So the queries are made FEWER rather than cheaper. The " +
             "status vocabulary stays in lib/module-registration-status; this " +
             "function groups by what is in the column and knows nothing about " +
             "what the values mean. lib/module-applicant-count falls back to its " +
             "existing per-bucket queries when the function is absent, so code " +
             "deployed ahead of this migration behaves exactly as it does today.",
    },
    {
        n: "040",
        why: "land_listing ownerId backfill — repairs the rows /api/farm-nation/" +
             "create-listing wrote before it was fixed, which carry the seller as " +
             "`userId` while every reader asks for `ownerId`, so a listing was " +
             "invisible to the person who created it. Order does not matter " +
             "against the others: it touches rows, not functions, and depends on " +
             "no earlier migration. It only ADDS `ownerId` to land_listings rows " +
             "that lack it — unlike 023 it removes nothing, because `userId` is a " +
             "legitimate key written across the database and idx_dc_collection_user " +
             "is an index on it. Idempotent; a second run matches no rows.",
    },
    {
        n: "041",
        why: "expression indexes for `ownerId` and `sellerId` on " +
             "document_collections. 022 indexed `status` and `userId`; the two " +
             "screens a seller opens to see their own things filter on neither, so " +
             "both were sequential scans of the whole table (measured: cost 695.52 " +
             "seq vs 12.73 indexed, at 20k rows). Order does not matter — they are " +
             "indexes, not functions. Unlike 022 this is IN the consolidated file " +
             "because it uses the PLAIN form under a lock_timeout rather than " +
             "CONCURRENTLY: #469 records that a CONCURRENTLY migration cannot be " +
             "applied by the Supabase SQL Editor, which is the only route available " +
             "here, and therefore sat unapplied.",
    },
    {
        n: "042",
        why: "expression index on `users.raw_data->>'_migratedTo'`. #904's second " +
             "cause made the supersession pointer READ BACKWARD — which ids point " +
             "at me — on a seller's own screens, where every existing reader walks " +
             "it forward by primary key. 033 added the same index on the other " +
             "pointer field, `supabaseAuthId`, and quoted #465 on what its absence " +
             "cost: `canceling statement due to statement timeout`. The backward " +
             "search queries BOTH fields, so after 033 one half was an index scan " +
             "and this half was not (measured: 9.550 ms Seq Scan vs 0.107 ms Index " +
             "Scan, 50,000 users with 5,000 carrying the pointer; 432 kB, and a " +
             "btree indexes no NULLs so it covers only those 5,000). Order does " +
             "not matter — it is an index, not a function, and depends on no " +
             "earlier migration. NOT REQUIRED FOR CORRECTNESS, unlike 040: the " +
             "code is right without it and merely slower, so code deployed ahead " +
             "of this migration behaves correctly. Plain CREATE INDEX under a " +
             "lock_timeout rather than CONCURRENTLY, for the reason #469 records.",
    },
    {
        n: "043",
        why: "expression indexes for `buyerId` — the third field 022's \"status " +
             "and userId\" and 041's \"ownerId and sellerId\" both missed, and the " +
             "one every screen #904's buyer side widened filters on. PART 1 covers " +
             "document_collections, where six of the seven buyer collections live " +
             "(disputes, export_orders, land_offers, marketplace_quotes, " +
             "seller_reviews, farm_nation_transactions) and nothing indexed the " +
             "column at all: measured 2.303 ms / cost 406.30 before vs 0.164 ms / " +
             "cost 73.26 after, at 20k rows. The before is NOT a seq scan — the " +
             "planner uses idx_dc_collection_seller's leading `collection_name` and " +
             "then reads every row in the collection, 4,000 to return 20. PART 2 is " +
             "idx_mo_buyer_id on the DEDICATED marketplace_orders table, which 022 " +
             "already declares with CONCURRENTLY and therefore by hand — whether " +
             "that ever ran is unknowable from here, and without it that query IS a " +
             "seq scan (4.972 ms / cost 546.00 vs 0.152 ms / cost 71.92). Same name " +
             "and IF NOT EXISTS, so it is a no-op where 022 landed and the repair " +
             "where it did not; the same relationship 041 has to 022. Order does " +
             "not matter — they are indexes, not functions. NOT REQUIRED FOR " +
             "CORRECTNESS: the code is right without it and merely slower.",
    },
    {
        n: "044",
        why: "module_registration_counts extracted the same JSONB TWICE per row " +
             "and detoasted it both times. Production EXPLAIN: two SubPlans, " +
             "42,846 + 36,687 = 79,533 evaluations to read 42,846 rows, " +
             "Execution Time 9948 ms against a statement_timeout of 8s — so the " +
             "function never returned and the caller fell back to the fifteen " +
             "scans it exists to replace. The scalar subquery is written once " +
             "and evaluated twice because Postgres pulls the subquery up and " +
             "does not eliminate the common subexpression across a WHERE and a " +
             "GROUP BY. `OFFSET 0` fences the pull-up, so it is computed once " +
             "and read twice: 960,642 buffers -> 480,560 and 988 ms -> 522 ms, " +
             "measured at 40k production-sized rows. MUST come after 039, which " +
             "creates the function. NOT REQUIRED FOR CORRECTNESS — identical " +
             "rows either way; 039's behaviour is unchanged and only its cost " +
             "moves.",
    },
    {
        n: "045",
        why: "the same rollup, reading a NARROW GENERATED COLUMN instead of " +
             "detoasting raw_data. `users` is 106 MB over 42,845 rows, so " +
             "raw_data averages ~2.5 kB and lives in TOAST; extracting one " +
             "nested key from it detoasts the whole column. Measured at 40k " +
             "production-sized rows: 960,642 buffers (039), 480,560 (044), " +
             "1,216 (045) — 790x less traffic than 039, 988 ms -> 210 ms. " +
             "Production confirmed 044 at 9,948 ms -> 6,302 ms, which fits the " +
             "8s statement_timeout only just. ADD COLUMN ... GENERATED ... " +
             "STORED REWRITES THE TABLE under ACCESS EXCLUSIVE and " +
             "authenticator carries lock_timeout=8s, so RUN IT IN A QUIET " +
             "WINDOW. IF NOT EXISTS because it is already applied on " +
             "production by hand — a no-op there, the real thing elsewhere, " +
             "the same relationship 043 has to 022. MUST come after 044; the " +
             "column must exist before the function that reads it, which is " +
             "why both statements are in the one file. NOT REQUIRED FOR " +
             "CORRECTNESS — identical rows either way.",
    },
    {
        n: "046",
        why: "the way OUT of a stranded wallet balance — one filed under a " +
             "profile nobody signs in as, which no member, checkout or " +
             "withdrawal can reach. Money moves at the LIVE id and nowhere " +
             "else: 005's credit and debit both key on p_user_id, and a " +
             "session id is live by construction (#490). The repair has to be " +
             "ONE function because a credit and a debit as two calls are each " +
             "idempotent but NOT atomic as a pair, and a credit that lands " +
             "without its debit mints money. It carries its own " +
             "authorisation — the _migratedTo / supabaseAuthId pointer is " +
             "re-read inside the same transaction and any pair the platform " +
             "does not already call one person is refused — so it can never " +
             "be a general transfer primitive. Writes both copies of the " +
             "balance, per 011. MUST come after 011, whose pattern it " +
             "follows. Applying it moves nothing; it is only callable " +
             "deliberately.",
    },
    {
        n: "047",
        why: "the two `users` scans that time out. 044 and 045 fixed the " +
             "rollup; these are the other two 57014s. searchUserIdsByQuery " +
             "fires up to SEVENTEEN queries per admin search, TWELVE of them " +
             "name prefix ranges across fullName/firstName/lastName — none of " +
             "which is a native column and none of which had an index, while " +
             "036 had indexed the phone half of the same helper. The GDPR " +
             "purge filters deletedAt <= threshold AND gdprPurgedAt IS NULL, " +
             "both inside raw_data, neither indexed. Measured at 40k rows, " +
             "54 MB: name prefix 8,635 buffers -> 32 (270x), purge 6,667 -> " +
             "11 (600x). The purge index is PARTIAL on being soft-deleted, " +
             "because nearly every row has a null gdprPurgedAt and indexing " +
             "that alone would cover the table — 16 kB against 1,248 kB for " +
             "each name index. Order does not matter: four indexes, no table " +
             "rewritten, no row touched, every statement IF NOT EXISTS.",
    },
    {
        n: "048",
        why: "the six indexes 022 declared and no deploy could ever apply. 022 " +
             "writes all nine with CREATE INDEX CONCURRENTLY, which cannot run " +
             "inside a transaction block, which is why 022 is in EXCLUDED and " +
             "has to be applied BY HAND. 041 and 043 each rescued ONE into the " +
             "plain form under 022's own name; six were never rescued, among " +
             "them the (collection_name, status) and (collection_name, userId) " +
             "pair 041's own header calls \"the two that cover most of the " +
             "application\", and the reference every payment looks a " +
             "marketplace order up by. Measured at 200k document_collections " +
             "rows: a user's own rows in a collection 23,963 buffers -> 4, an " +
             "order by reference 2,223 -> 4. NOT rescued: 022's two " +
             "cooperative_members indexes, because FIELD_TO_COLUMN routes both " +
             "names to native columns so the JSONB path is never emitted and " +
             "neither could be reached. Order does not matter: six indexes, no " +
             "table rewritten, no row touched, every statement IF NOT EXISTS " +
             "on 022's own names, so it is a no-op wherever 022 was applied.",
    },
    {
        n: "049",
        why: "count_module_registrations — the admin dashboard's module usage " +
             "breakdown in ONE table scan. analytics.service issued EIGHT " +
             "count queries against users, each an OR of a JSONB path and a " +
             "roles containment; nothing indexes the JSONB path and an OR " +
             "cannot be served by an index on one arm, so all eight were " +
             "sequential scans that ALSO detoasted the whole of raw_data per " +
             "row to read one short string — 044 and 045's finding, which " +
             "this path never learned from. Measured at 42,845 rows with " +
             "raw_data genuinely in TOAST: one of the eight 129,642 buffers " +
             "/ 162 ms, all eight ~1,037,000 / ~1.3 s, this function 1,262 / " +
             "42 ms. Reads 045's generated service_regs column, so no row is " +
             "detoasted. MUST come after 045, which adds that column. The " +
             "status lists are stated here AND in " +
             "lib/module-registration-status.ts, held together by " +
             "__tests__/pg/the-module-counts-agree-with-the-javascript, " +
             "which rebuilds all eight predicates from the TypeScript and " +
             "fails on a single disagreement. analytics.service falls back " +
             "to the eight queries when the function is absent, so a deploy " +
             "landing before this migration is slow rather than broken.",
    },
    {
        n: "050",
        why: "idx_dc_collection_email — the claim-by-email lookup every " +
             "module's status check makes, which nothing indexed. MEASURED " +
             "rather than guessed: #261's [slow-action] timing produced its " +
             "first production log and named the whole family — " +
             "checkCooperativeStatusAction 2,156-3,585 ms, " +
             "checkWaveStatusAction 784-2,784 ms, checkAcademyStatusAction " +
             "1,828 ms, checkFarmNationStatusAction 1,715 ms — and every " +
             "module entry runs one. Each walks a claim-by-email path for " +
             "application rows written before the member had an account, " +
             "which carry userEmail and no userId; nine call sites do it, " +
             "three of them in module-access-check, which every module " +
             "layout calls. 048 indexed (collection_name, status) and " +
             "(collection_name, userId) on document_collections and stopped " +
             "there, so each lookup scanned its whole collection inside the " +
             "shared table and detoasted every raw_data it passed — the " +
             "2026-08-10 audit's measured mechanism, on the hottest user " +
             "path. Against 20,000 seeded rows: seq scan 514 buffers / 15.6 " +
             "ms, index scan 4 buffers / 0.03 ms. (collection_name, key) in " +
             "that order for 041's and 048's reason. Changes no row and is " +
             "not required for correctness, so a deploy landing before it is " +
             "slow rather than broken.",
    },
    {
        n: "051",
        why: "idx_users_raw_created_at — the admin dashboard's user-growth " +
             "chart, six month buckets at once, every one of which timed out " +
             "in production: '[DashboardStats] user growth count failed ... " +
             "canceling statement due to statement timeout'. 027 already put " +
             "(created_at DESC) on this table, and it CANNOT serve this " +
             "query: `createdAt` is in neither FIELD_TO_COLUMN['users'] nor " +
             "NATIVE_COLUMNS['users'], so supabase-db emits " +
             "raw_data->>'createdAt' and a btree on the column cannot answer " +
             "a predicate on the JSON key. Mapping the field to the column " +
             "instead would be the WRONG fix: _mapRow reads " +
             "raw_data?.createdAt ?? created_at, so the key is authoritative " +
             "and the chart would silently bucket by a different value from " +
             "the one each row displays. Measured on 40,000 seeded users in " +
             "a 107 MB table (production is 42,845 / 106 MB): seq scan " +
             "10,000 buffers / 20.9 ms, bitmap index 1,115 buffers / 2.6 ms, " +
             "and the planner's estimate for the bucket went from rows=200 " +
             "to rows=4,065 against an actual 3,996 — an expression index " +
             "carries statistics a bare JSONB expression does not. Changes " +
             "no row and is not required for correctness, so a deploy " +
             "landing before it is slow rather than broken.",
    },
    {
        n: "052",
        why: "missing_schema_objects — the function that answers 'is the " +
             "schema this code was written against the schema it is running " +
             "against?', which nothing could answer. The day it was written: " +
             "a `count users` fix merged at midday, the admin dashboard " +
             "reading 'Total Users — could not be read' all afternoon, and " +
             "the reason being that the fix had two halves. The app half " +
             "shipped; the other half was 051, one CREATE INDEX, and nothing " +
             "applies these migrations to production — not the Dockerfile, " +
             "not deploy-production.yml, not a start script. CI runs them " +
             "against a throwaway cluster, so every suite was green against a " +
             "database that had all of them while the real one was missing " +
             "two. Takes the names lib/migration-manifest expects and " +
             "returns the ones pg_indexes and pg_proc do not have; " +
             "api/cron/migration-audit answers 503 while any are missing, " +
             "naming the files to paste. Reads catalogs only, writes " +
             "nothing, and MUST come last of the additive steps so that its " +
             "own first run reports on a database the rest of this file has " +
             "already brought up to date. Its absence is the most " +
             "informative answer it has: the audit reports cannot-tell and " +
             "names this file.",
    },
    { n: "004", why: "row-level security — LAST, and in a low-traffic window" },
];

/**
 * Migrations deliberately NOT in the consolidated file, and why.
 *
 * This list exists so that "not in EXPECTED" can mean "somebody forgot" rather
 * than "it is handled elsewhere". Without it the check below could not tell the
 * two apart, and would have to let both through.
 */
const EXCLUDED = [
    {
        n: "022",
        why: "CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and " +
             "every other migration here opens one. Concatenating it would fail — or " +
             "worse, take an ACCESS EXCLUSIVE lock on live tables if the CONCURRENTLY " +
             "were dropped to make it fit. Apply it on its own, and only after the " +
             "EXPLAIN ANALYZE in its header shows the indexes are worth having.",
    },
];

const args = process.argv.slice(2);

// --order prints the application order, one migration number per line, for
// scripts that need to apply the files individually rather than as one blob.
// scripts/test-migrations.sh uses it so the order cannot drift from this file.
if (args.includes("--order")) {
    const list = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    for (const step of EXPECTED) {
        const f = list.find((x) => x.startsWith(`${step.n}_`));
        if (f) console.log(f);
    }
    process.exit(0);
}
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const skipRls = args.includes("--skip-rls");

/**
 * --only 030,031,032 — just those migrations, in this file's order.
 *
 *   #479 THERE WAS NO WAY TO GET THE SQL FOR *SOME* MIGRATIONS.
 *
 *        This script emitted the whole deployment or nothing. That is right for
 *        a fresh database and wrong for the situation the owner is actually in
 *        every time: a live database that already has 002-029, and three new
 *        files to apply. Their only options were to paste 30 migrations again
 *        (safe, because every one is idempotent, but slow and frightening) or
 *        to open three files and paste them by hand in the right order — which
 *        is the manual step this script exists to remove.
 *
 *        The ORDER still comes from EXPECTED, so a subset cannot be pasted in
 *        the wrong sequence, and an unknown number is refused rather than
 *        silently skipped.
 */
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0
    ? String(args[onlyIdx + 1] ?? "").split(",").map((n) => n.trim()).filter(Boolean)
    : null;

if (only && only.length > 0) {
    const known = new Set(EXPECTED.map((e) => e.n));
    const unknown = only.filter((n) => !known.has(n));
    if (unknown.length > 0) {
        console.error(
            `\n[build-deploy-sql] REFUSING — not in the application order: ${unknown.join(", ")}\n\n` +
            `Every migration this script can emit is listed in EXPECTED, which is also what\n` +
            `defines the order they must be applied in. A number that is not there is either a\n` +
            `typo or a migration nobody added to the list — and emitting it anyway would be\n` +
            `pasting SQL in an order this script cannot vouch for.\n`
        );
        process.exit(1);
    }
}

const available = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

function findMigration(prefix) {
    return available.find((f) => f.startsWith(`${prefix}_`)) ?? null;
}

const missing = [];
const chosen = [];

for (const step of EXPECTED) {
    if (skipRls && step.n === "004") continue;
    if (only && !only.includes(step.n)) continue;
    const file = findMigration(step.n);
    if (!file) {
        missing.push(step);
        continue;
    }
    chosen.push({ ...step, file });
}

// The check that was not here.
//
// The loop above finds migrations EXPECTED but absent. It could not find the
// opposite — a migration present on disk that nobody added to EXPECTED — so
// four of them (019-022) were silently dropped from the consolidated file while
// the code on main called the functions they create. A guard that checks one
// direction only is how that happens.
const accountedFor = new Set([
    ...EXPECTED.map((e) => e.n),
    ...EXCLUDED.map((e) => e.n),
]);
const unaccounted = available
    .map((f) => f.slice(0, f.indexOf("_")))
    .filter((n) => /^\d+$/.test(n) && !accountedFor.has(n))
    .sort();

if (unaccounted.length > 0) {
    console.error("\n[build-deploy-sql] REFUSING TO BUILD — migrations on disk that this script does not know about:\n");
    for (const n of unaccounted) {
        console.error(`  ${n}  ${findMigration(n)}`);
    }
    console.error(
        "\nAdd each to EXPECTED (with its ordering reason) or to EXCLUDED (with why\n" +
        "it is applied separately). Dropping it silently is what this check exists\n" +
        "to prevent: the generated file would look complete and be missing the\n" +
        "functions the application calls.\n"
    );
    process.exit(1);
}

if (missing.length > 0) {
    console.error("\n[build-deploy-sql] REFUSING TO BUILD — migrations are missing:\n");
    for (const m of missing) {
        console.error(`  ${m.n}  ${m.why}`);
    }
    console.error(
        "\nA partial deployment is worse than none: the code on main calls functions\n" +
        "these files create. Merge the branch that carries them, then run this again.\n"
    );
    process.exit(1);
}

/**
 * #469 — NOTHING IN THIS FILE MAY BE A STATEMENT THAT CANNOT RUN IN A
 * TRANSACTION.
 *
 * The generated file is pasted into the Supabase SQL Editor, which wraps every
 * submission in a transaction and offers no way not to. A handful of Postgres
 * statements refuse to run inside one, and a single one of them makes the WHOLE
 * paste fail at that line — the migrations after it never run, and the operator
 * is left with a partial deployment reported as one error.
 *
 * 027's first draft was CREATE INDEX CONCURRENTLY. It was correctly kept OUT of
 * this file for exactly that reason, and then it could not be applied any other
 * way either, because this project has no psql and no Supabase CLI — so the fix
 * it carried sat unapplied while three places in the repository recorded an
 * instruction nobody could follow.
 *
 * Excluding such a file is therefore not a solution; it only moves the problem
 * somewhere with no route out. This check names the statement AND says so, so
 * the next person rewrites it into a transactional form rather than adding
 * another entry to EXCLUDED.
 */
const NON_TRANSACTIONAL = [
    { re: /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i, what: "CREATE INDEX CONCURRENTLY" },
    { re: /\bDROP\s+INDEX\s+CONCURRENTLY\b/i, what: "DROP INDEX CONCURRENTLY" },
    { re: /\bREINDEX\s+(?:\w+\s+)*CONCURRENTLY\b/i, what: "REINDEX CONCURRENTLY" },
    { re: /\bVACUUM\b/i, what: "VACUUM" },
    { re: /\bCREATE\s+DATABASE\b/i, what: "CREATE DATABASE" },
    { re: /\bALTER\s+SYSTEM\b/i, what: "ALTER SYSTEM" },
    { re: /\bALTER\s+TYPE\s+.*\bADD\s+VALUE\b/i, what: "ALTER TYPE ... ADD VALUE" },
];

const untransactional = [];
for (const step of chosen) {
    const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, step.file), "utf8"));
    for (const { re, what } of NON_TRANSACTIONAL) {
        if (re.test(body)) untransactional.push({ file: step.file, what });
    }
}

if (untransactional.length > 0) {
    console.error("\n[build-deploy-sql] REFUSING TO BUILD — a migration here cannot run inside a transaction:\n");
    for (const u of untransactional) {
        console.error(`  ${u.file}  ->  ${u.what}`);
    }
    console.error(
        "\nThe Supabase SQL Editor wraps every submission in a transaction, and there\n" +
        "is no setting for that. One of these statements fails the WHOLE paste at\n" +
        "that line, leaving everything after it unapplied.\n" +
        "\n" +
        "Do NOT just move it to EXCLUDED. That is what happened to 027, and this\n" +
        "project has no psql and no Supabase CLI, so 'apply it separately' meant it\n" +
        "was never applied at all. Rewrite it into a form that runs in a transaction\n" +
        "— for an index, the plain build under a lock_timeout; see 027's header for\n" +
        "what that actually costs, measured.\n"
    );
    process.exit(1);
}

/** SQL comments, so a statement NAMED in a header is not read as one written. */
function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*--.*$/gm, " ");
}

/**
 * Every function the chosen migrations actually create, READ OUT OF THEM.
 *
 * The verification list used to be typed by hand below, and it drifted three
 * separate ways at once: the prose said "expect 19 rows" over a list of 20, the
 * list was missing everything from 019 onward, and when 025 and 026 arrived it
 * did not gain claim_status_transition_in — the one function whose absence
 * makes every marketplace order transition report a conflict.
 *
 * A hand-kept list of what a generated file contains is a second statement of
 * the same fact, and this repository's whole failure mode is two statements of
 * one fact drifting apart. So it is derived, and the count is derived with it:
 * neither can disagree with the file this script emits, because both are read
 * from it.
 */
function functionsCreatedBy(files) {
    const found = new Set();
    for (const file of files) {
        const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_]+)"?/gi;
        for (const m of body.matchAll(re)) found.add(m[1]);
    }
    return [...found].sort();
}

const shippedFunctions = functionsCreatedBy(chosen.map((c) => c.file));

/**
 * NO TIMESTAMP — #660.
 *
 * The header used to carry the moment of generation, which made every
 * regeneration a different file. The output is COMMITTED now (supabase/deploy.sql)
 * so the owner can paste it without running Node, and a committed generated file
 * needs a ratchet that regenerates and compares — which a clock defeats.
 *
 * The migration count is the honest stamp: it changes when the content does.
 */
const stamp = `${chosen.length} migrations`;

/**
 * What the bundle leaves out, said IN the bundle — #660.
 *
 * EXCLUDED migrations were named only on stderr while the file was being
 * generated, so the artefact a person actually reads did not mention them. A
 * deploy file that silently omits a migration is the failure this generator was
 * written to prevent, one level up: the output looks complete and is not.
 */
const exclusionNotice = EXCLUDED.length === 0
    ? "--   Nothing. Every migration in supabase/migrations is included below.\n"
    : EXCLUDED.map((e) => {
        const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith(`${e.n}_`));
        const name = files[0] ?? `${e.n}_*.sql`;
        const why = e.why.match(/.{1,68}(\s|$)/g) ?? [e.why];
        return `--   ${name}\n` + why.map((l) => `--     ${l.trim()}`).join("\n") + "\n";
    }).join("--\n");

const header = `-- ============================================================================
-- CONSOLIDATED DEPLOY — ${stamp}
-- Generated by scripts/build-deploy-sql.mjs. Do not edit; regenerate it.
--
-- RE-RUNNING THIS FILE IS SAFE. MEASURED, NOT ASSUMED — #660.
--   Applied to a fresh PostgreSQL 16 carrying supabase/schema.sql and then
--   applied TWICE MORE. Every run completed with no error, and the definitions
--   of all 45 functions were byte-identical after the third. So the answer to
--   "has migration NNN been applied?" is not a question anyone has to research:
--   run this file. It costs one paste and it cannot apply anything twice.
--
-- Apply by pasting into the Supabase SQL Editor of the TARGET project.
-- Run it ONCE, top to bottom. Every migration is idempotent (CREATE OR REPLACE
-- / IF NOT EXISTS), so a re-run is safe, but the ORDER is not optional:
--
--   013 then 014   — 014 replaces the function 013 creates. Reversed, the
--                    nested-path support disappears.
--   005/006 then 011 — 011 corrects both to write the value the application
--                    actually reads. Without it, wallet credits are invisible.
--   004 LAST       — row-level security. Failures are silent (empty rows, not
--                    errors), so apply it in a low-traffic window with the
--                    rollback at the bottom of that file to hand.
--
-- WHAT THIS FILE DOES NOT CONTAIN — #660
${exclusionNotice}
-- BEFORE YOU RUN THIS
--   Confirm the project. These statements create functions and enable RLS on
--   the database they are pasted into. There is no undo button.
--
-- BEFORE OR AFTER, TO ASK WHAT A DATABASE ALREADY HAS
--   supabase/status.sql — read-only, one paste, and it names which migrations
--   are present and whether row-level security took. #664.
--
-- AFTER YOU RUN THIS
--   The verification block at the end lists what should exist. Run it.
--   Then run \`npm run test:db\` against the same database.
-- ============================================================================

`;

const sections = chosen
    .map(({ n, why, file }) => {
        const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        return `
-- ============================================================================
-- ${n} — ${file}
-- ${why}
-- ============================================================================

${body.trim()}
`;
    })
    .join("\n");

const verification = `

-- ============================================================================
-- VERIFICATION — run this after the statements above.
-- ============================================================================

-- 1. Every function should be listed. Expect ${shippedFunctions.length} rows.
--
--    THIS LIST AND THIS COUNT ARE GENERATED from the migrations above, not
--    typed. Both drifted before: the count said 9 over a list of 16, then 19
--    over a list of 20, and the list was twice missing functions the deployed
--    code calls — everything from 019 onward, and later
--    claim_status_transition_in, whose absence makes every marketplace order
--    transition report a conflict instead of an error. A verification step that
--    can pass on a database missing the functions is not a verification step.
SELECT proname
  FROM pg_proc
 WHERE proname IN (
${shippedFunctions.map((f) => `    '${f}'`).join(",\n")}
 )
 ORDER BY proname;

-- 1b. And nothing above should be MISSING. This returns the shortfall
--     directly, so you do not have to count the rows yourself.
SELECT unnest(ARRAY[
${shippedFunctions.map((f) => `    '${f}'`).join(",\n")}
 ]) AS expected_function
EXCEPT
SELECT proname FROM pg_proc;
--     Expect ZERO rows. Any row is a function the application calls and this
--     database does not have.

-- 2. debit_jsonb_balance must be the NESTED-path version from 014.
--    Expect: t, 4000  — if this errors or returns the wrong balance, 013 was
--    applied after 014 and the nested-path support was reverted.
--
--   INSERT INTO users (id, email, raw_data)
--   VALUES ('deploy-check-1', 'deploy-check-1@example.com',
--           '{"serviceRegistrations":{"wave":{"waveEarningsBalance":10000}}}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM debit_jsonb_balance(
--       'users', 'deploy-check-1', 'serviceRegistrations.wave.waveEarningsBalance', 6000);
--
--   DELETE FROM users WHERE id = 'deploy-check-1';

-- 3. Wallet functions must move BOTH copies of the balance (011).
--    Expect both columns equal. If native_col moves and shown_to_user does not,
--    011 was not applied and wallet credits are invisible to the application.
--
--   INSERT INTO wallets (id, balance, raw_data)
--   VALUES ('deploy-check-2', 100, '{"id":"deploy-check-2","balance":100}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET balance = 100, raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM credit_wallet_once('deploy-check-ref', 'deploy-check-2', 50);
--
--   SELECT balance AS native_col, (raw_data->>'balance')::numeric AS shown_to_user
--     FROM wallets WHERE id = 'deploy-check-2';
--
--   DELETE FROM processed_payments WHERE id = 'deploy-check-ref';
--   DELETE FROM wallets WHERE id = 'deploy-check-2';

-- 4. RLS: every table on, no policies (Option A).
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
 ORDER BY tablename;

SELECT count(*) AS policies_attached
  FROM pg_policies
 WHERE schemaname = 'public';

-- 5. The check the SQL Editor CANNOT make: it runs as service_role, which
--    bypasses RLS. Run this in a terminal with the ANON key. Expect [].
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON_KEY"
`;

const output = header + sections + verification;

if (outFile) {
    writeFileSync(outFile, output);
    console.error(`[build-deploy-sql] wrote ${outFile}`);
    console.error(`[build-deploy-sql] ${chosen.length} migrations, in order:`);
    for (const c of chosen) console.error(`  ${c.n}  ${c.file}`);
} else {
    process.stdout.write(output);
}
