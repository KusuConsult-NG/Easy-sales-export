-- ============================================================================
-- 040 — Give back the listings whose owner key was written under the old name
-- ============================================================================
--
-- WHAT HAPPENED
-- -------------
-- The owner, twice, across two sessions:
--
--     "when they click on my properties nothing is shown"
--     "My properties are not listed under my property tab"
--
-- /api/farm-nation/create-listing originally wrote the seller onto the listing
-- as `userId`. Every READER of land_listings asks for `ownerId`:
--
--     land-actions.ts   .where('ownerId', '==', session.user.id)   — My Properties
--     admin-content.ts  .doc(id).get()).data()?.ownerId            — the owner of a row
--
-- and the collection's other writer, _listPropertyAction, writes `ownerId`. So
-- a listing created through that route was invisible to the person who created
-- it — the route's own note records the finding: "a listing created here was
-- invisible to its own owner, never entered the verification queue, and
-- therefore could never become verified and appear in the marketplace. It
-- existed and nothing could see it."
--
-- THE CODE HALF IS ALREADY DONE AND IS NOT WHAT THIS FIXES. That route writes
-- `ownerId` today. A fix to a writer only helps rows written after it, and the
-- listings the owner is looking for were written before. That is what this
-- migration is for, and it is the same division of labour as 023.
--
-- WHY THE OLD KEY IS KEPT, UNLIKE 023
-- -----------------------------------
-- 023 could DELETE the stray key, because `resolvedUserId` was written by
-- nothing but the defect, so any row carrying it came from the bug.
--
-- `userId` is not that. It is a legitimate field written across this whole
-- database, it is still written deliberately by that route ("kept alongside
-- rather than renamed, in case a row already exists that something reads by
-- them"), and idx_dc_collection_user is an INDEX ON IT. So this migration only
-- ADDS `ownerId`. It removes nothing and overwrites nothing.
--
-- That is also why the WHERE is scoped to `collection_name = 'land_listings'`
-- and 023's was not. 023's marker key was unique to its defect and could be
-- swept globally; `userId` is everywhere, and a global sweep here would invent
-- an `ownerId` on rows of every other collection in the platform.
--
-- SAFETY
--   * Only rows that HAVE `userId` and LACK `ownerId` are touched — a row that
--     already has an owner is never rewritten, so a correct value cannot be
--     replaced by a stale one.
--   * Idempotent: after one run the WHERE matches nothing, so re-running is a
--     no-op. Safe to apply while the app is running.
--   * Adds one key. No row is deleted, no key is removed, no existing value is
--     changed.
--
-- RUN THE PREFLIGHT FIRST AND KEEP THE NUMBER. It is the only record of how
-- many listings this returned to their owners.
-- ============================================================================


-- ─── PART 0 — PREFLIGHT. Read-only. Run this first and keep the output. ─────

-- How many land listings are invisible to their own owner, and to whom?
--
--   SELECT raw_data->>'userId' AS owner,
--          COUNT(*)            AS listings_to_repair
--   FROM document_collections
--   WHERE collection_name = 'land_listings'
--     AND raw_data ? 'userId'
--     AND NOT (raw_data ? 'ownerId')
--   GROUP BY 1
--   ORDER BY 2 DESC;
--
-- ZERO ROWS IS A RESULT, NOT A FAILURE. It means the empty My Properties has a
-- different cause and this migration is not it — say so rather than looking for
-- something to change.
--
-- And the rows nothing can repair, which this migration deliberately leaves:
--
--   SELECT COUNT(*) AS listings_with_no_owner_at_all
--   FROM document_collections
--   WHERE collection_name = 'land_listings'
--     AND NOT (raw_data ? 'userId')
--     AND NOT (raw_data ? 'ownerId');
--
-- A row with neither key names nobody. Guessing an owner for a land listing
-- would hand somebody else's property to the wrong account, so these are
-- reported and left alone — 023's Part 3 reasoning, applied to land.


-- ─── PART 1 — Copy the owner onto the key every reader asks for. ────────────

UPDATE document_collections
SET raw_data = raw_data || jsonb_build_object('ownerId', raw_data->'userId')
WHERE collection_name = 'land_listings'
  AND raw_data ? 'userId'
  AND NOT (raw_data ? 'ownerId');


-- ─── PART 2 — VERIFY. Read-only. Run after Part 1. ──────────────────────────

-- This must return 0. If it does not, Part 1 did not commit.
--
--   SELECT COUNT(*) AS still_unreachable
--   FROM document_collections
--   WHERE collection_name = 'land_listings'
--     AND raw_data ? 'userId'
--     AND NOT (raw_data ? 'ownerId');
--
-- And the two keys must agree everywhere they both appear — a mismatch would
-- mean something other than this migration wrote one of them:
--
--   SELECT COUNT(*) AS disagreeing
--   FROM document_collections
--   WHERE collection_name = 'land_listings'
--     AND raw_data ? 'userId'
--     AND raw_data ? 'ownerId'
--     AND raw_data->>'userId' IS DISTINCT FROM raw_data->>'ownerId';
--
-- That count is NOT required to be 0 and nothing here changes those rows: a
-- listing transferred between accounts would legitimately disagree. It is a
-- number to look at, not a number to fix.
