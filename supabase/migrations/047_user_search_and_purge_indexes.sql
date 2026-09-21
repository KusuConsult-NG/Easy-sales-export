-- ============================================================================
-- 047 — The two `users` scans that time out, indexed
-- ============================================================================
-- WHY
-- ---
-- Production logs report 57014 (statement_timeout) against `users` from two
-- places. 044 and 045 dealt with the third — module_registration_counts —
-- and their header records the conditions these two share:
--
--     "`users` is 42,845 rows and 106 MB, so `raw_data` averages ~2.5 kB and
--      is routinely out of line in TOAST. Every evaluation of a nested key
--      detoasts the whole column to read one short string."
--
-- and that `authenticator` imposes an 8s statement_timeout. A sequential scan
-- of that table which detoasts every row does not fit inside 8s, and both
-- queries below are exactly that.
--
-- ── 1. THE ADMIN SEARCH BOX ─────────────────────────────────────────────────
--
-- lib/admin-search-helper's searchUserIdsByQuery fires up to SEVENTEEN queries
-- for one search: an exact email, four on phone, and TWELVE name prefix ranges
-- — four case variations across `fullName`, `firstName` and `lastName`.
--
-- `users` already carries expression indexes for the phone half:
--
--     036  ON public.users ((raw_data ->> 'phone'))
--     036  ON public.users ((raw_data ->> 'phoneNumber'))
--
-- and nothing at all for the name half. None of the three is a native column
-- — NATIVE_COLUMNS['users'] is id, email, roles, created_at, updated_at — so
-- every one of those twelve is a full scan. Nine callers reach this helper;
-- the WAVE admin dashboard's name filter is the one #786 was reported against.
--
-- WHY A PLAIN b-tree IS THE RIGHT INDEX HERE, and not text_pattern_ops: the
-- adapter emits a RANGE, `raw_data->>'fullName' >= $1 AND < $2` (supabase-db
-- line 1391 builds the path, the caller builds the bound with
-- prefixUpperBound). A range on the default collation uses a plain b-tree.
-- text_pattern_ops is what `LIKE 'x%'` would need, and nothing here emits LIKE.
--
-- ── 2. THE GDPR PURGE ───────────────────────────────────────────────────────
--
-- api/cron/gdpr-purge filters
--
--     .where("deletedAt", "<=", threshold).where("gdprPurgedAt", "==", null)
--
-- which the adapter turns into `raw_data->>'deletedAt' <= $1` and, for the
-- null comparison, `raw_data->>'gdprPurgedAt' IS NULL` (supabase-db line
-- 1399: `if (value === null) return query.is(jsonPath, null)`).
--
-- THE INDEX IS PARTIAL, AND THE PREDICATE MATTERS MORE THAN THE KEY. Almost
-- every row in `users` has a null `gdprPurgedAt`, so indexing on that alone
-- would cover the whole table and save nothing. What is rare is being SOFT
-- DELETED: only those rows can ever be due. The partial predicate keeps the
-- index to that handful.
--
-- The query does not say `deletedAt IS NOT NULL` in so many words, but
-- `<=` is strict, so no NULL can satisfy it — and Postgres's predicate prover
-- handles exactly that implication, which is what lets it use this index for
-- the cron's query. Verified rather than assumed; see below.
--
-- ── MEASURED, NOT ASSERTED ──────────────────────────────────────────────────
--
-- Postgres 16, 40,000 rows, 54 MB, raw_data averaging 1,181 bytes — about half
-- production's 2.5 kB, so the real saving is larger than this, not smaller:
--
--     name prefix range     Seq Scan     8,635 buffers   16.4 ms
--                           Index Scan      32 buffers    0.2 ms     270x
--
--     gdpr purge due        Seq Scan     6,667 buffers   23.3 ms
--                           Index Scan      11 buffers    0.1 ms     600x
--
-- The search fires TWELVE name queries per admin search, so the first row is
-- ~104,000 buffers of sequential scanning for one search box. That is the 8s
-- statement_timeout, not a slow query.
--
-- Index sizes at this scale: 1,248 kB each for the three names, and 16 kB for
-- the purge — partial indexes are nearly free.
--
-- AND THE FIRST ATTEMPT AT THIS MEASUREMENT WAS WRONG, which is worth writing
-- down. Seeding `fullName` as 'Member ' || i makes the prefix 'Member 1'
-- match 11,120 of 40,000 rows, so the planner correctly chose a Seq Scan even
-- WITH the index and the numbers said the index was useless. The fault was the
-- data, not the index: real names come from a pool, so a prefix matches a
-- handful. Reseeded from twenty first names and twenty surnames — 400 distinct
-- full names, 100 rows per prefix — the plan flips. A benchmark whose
-- distribution does not resemble the thing it models measures nothing.
--
-- The plans are reproduced by
-- src/__tests__/pg/the-two-user-scans-that-timed-out.test.ts, against a real
-- Postgres. It asserts INDEX-versus-SEQUENTIAL rather than a duration or a
-- node name:
--
--   * a millisecond threshold on shared CI hardware is a flake generator, and
--     the plan is what actually changed;
--   * and the node name is the planner's business. Its first version demanded
--     "Index Scan" and failed on a Bitmap Heap Scan, which IS index-based —
--     Postgres picks between them by expected row count, choosing Index Scan
--     at 40,000 rows and a bitmap at the 8,000 the suite seeds. Both stop
--     reading the whole table, which is the only thing this migration claims.
--     A test that fails on a correct plan teaches everybody to ignore it.
--
-- ── NOT `CONCURRENTLY`, for #469's reason ───────────────────────────────────
--
-- 041 records it: CONCURRENTLY cannot run inside a transaction, the deploy
-- runner wraps each migration in one, and scripts/build-deploy-sql.mjs rejects
-- CONCURRENTLY outright. A CONCURRENTLY migration is not merely slower to
-- apply — it does not apply at all, and sits unapplied while everyone assumes
-- it is live.
--
-- ── SAFE TO APPLY ───────────────────────────────────────────────────────────
--
-- Adds four indexes. No table is rewritten, no column added, no row touched.
-- Every statement is IF NOT EXISTS, so a timed-out run leaves nothing
-- half-built and re-running is free. Building these takes an ACCESS SHARE
-- lock — reads and writes continue.
-- ============================================================================

-- ── 1. The admin search box ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_full_name
    ON public.users ((raw_data ->> 'fullName'));

CREATE INDEX IF NOT EXISTS idx_users_first_name
    ON public.users ((raw_data ->> 'firstName'));

CREATE INDEX IF NOT EXISTS idx_users_last_name
    ON public.users ((raw_data ->> 'lastName'));

-- ── 2. The GDPR purge ───────────────────────────────────────────────────────
--
--   Partial: only a soft-deleted, unpurged row can ever be due, and that is a
--   handful of the 42,845. The key is `deletedAt` because that is what the
--   cron orders its window by.

CREATE INDEX IF NOT EXISTS idx_users_gdpr_purge_due
    ON public.users ((raw_data ->> 'deletedAt'))
    WHERE raw_data ->> 'deletedAt' IS NOT NULL
      AND raw_data ->> 'gdprPurgedAt' IS NULL;
