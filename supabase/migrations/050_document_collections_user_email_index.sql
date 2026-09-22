-- ============================================================================
-- 050 — THE LOOKUP EVERY MODULE'S STATUS CHECK MAKES, AND NOTHING INDEXED IT
--
-- MEASURED, not guessed. #261 put [slow-action] timing into the two server
-- action wrappers, and the first production log it produced named the whole
-- check*StatusAction family:
--
--     checkCooperativeStatusAction   2156 - 3585 ms
--     checkWaveStatusAction           784 - 2784 ms
--     checkAcademyStatusAction              1828 ms
--     checkFarmNationStatusAction           1715 ms
--
-- Every module has one and every module entry runs it.
--
-- Each of those walks a claim-by-email path: an application row written before
-- the member had an account carries `userEmail` and no `userId`, so the status
-- check looks it up by address and adopts it. Nine call sites do this --
-- module-access-check.ts alone has three, and checkModuleAccess runs in every
-- module layout.
--
--     .where("userEmail", "==", userEmail)
--
-- 048 indexed (collection_name, raw_data->>'status') and
-- (collection_name, raw_data->>'userId') on this table, and stopped there.
-- `userEmail` was never indexed, so each of those lookups falls back to
-- scanning every row of its collection inside document_collections -- the
-- shared table that holds them all -- and detoasts each raw_data it passes.
-- That is the 2026-08-10 audit's measured mechanism ("598 ms to scan ~1,830
-- rows ... large JSONB being detoasted"), on the hottest path the user side
-- has.
--
-- (collection_name, key), in that order, for 041's and 048's reason: every one
-- of these queries names its collection, and a shared table's index is useless
-- to one collection if it cannot narrow to it first. The three collections
-- that use this path -- wave_applications, farm_nation_applications and
-- export_applications -- all live here rather than in a dedicated table.
--
-- NOT REQUIRED FOR CORRECTNESS. The code is right without it and merely slow,
-- so deploying ahead of this migration is safe, and applying it changes no
-- row.
--
-- HOW TO APPLY
-- ------------
-- Paste into the Supabase SQL Editor, or let it arrive in the consolidated
-- deploy. Transaction-safe, per #469: a plain CREATE INDEX under a
-- lock_timeout, never CONCURRENTLY, which cannot run inside the transaction
-- block the editor and the deploy runner both open -- the mistake that left
-- 022 unapplied for months and needed 048 to rescue it.
-- ============================================================================

-- Do not queue behind an open transaction and take every writer down with us.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_dc_collection_user_email
    ON public.document_collections (collection_name, (raw_data->>'userEmail'));

RESET lock_timeout;
