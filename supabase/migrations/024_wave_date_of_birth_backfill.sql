-- ============================================================================
-- 024 — Put the date of birth WAVE validated onto the user record
-- ============================================================================
--
-- WHY
-- ---
-- The WAVE application computes an age from a declared date of birth, refuses
-- anyone under 18, and cross-checks that date against a separately declared
-- age. Until #157 the date went onto the wave_applications row and nowhere
-- else, so the user document had none — and forensics.ts, which sweeps WAVE
-- participants for under-age enrolment, had nothing to read. #156 made that
-- sweep say "could not age-check" instead of passing them silently.
--
-- #157 fixed it going forward. This is the population that enrolled before it.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT
-- -----------------------------------------
--   Part 1  copies the date from the application onto the user, ONLY where the
--           user has none and ONLY where every application for that user
--           declares the same date.
--
--   Part 2  reports the users whose applications disagree. It changes nothing
--           for them. Two records declaring different dates of birth for one
--           person is a finding, not a merge conflict to resolve by picking the
--           newest — and picking one would erase exactly the signal the
--           forensic sweep exists to surface. It is the same choice #157 makes
--           at write time and #149 Part 3 makes for duplicate enrolments.
--
--   It does NOT touch anyone who already has a date on record. Set-once is the
--   rule in the application code (#155, #157) and a migration is not the place
--   to make an exception to it.
--
--   It does NOT backfill from kyc.dateOfBirth. The forensic already falls back
--   to that field, so those users are checkable; copying it up would duplicate
--   a value with no reader asking for it.
--
-- SHAPE OF THE DATA
-- -----------------
-- `users` is a dedicated table and dateOfBirth is not one of its columns, so it
-- lives in raw_data. wave_applications is not a dedicated table, so its rows are
-- in document_collections under that collection_name, fields in raw_data.
--
-- RUN THE PREFLIGHT FIRST
-- -----------------------
-- Every statement is idempotent and safe to re-run, but Part 1 cannot be undone
-- by re-running it. Run the Part 0 SELECTs, keep the numbers, and read Part 2's
-- output before deciding whether the conflicts need attention.
-- ============================================================================


-- ─── PART 0 — PREFLIGHT. Read-only. Run first and keep the output. ──────────

-- How many users have a WAVE application carrying a usable date, and how does
-- that split between "will be backfilled", "already has one", and "conflicting"?
--
--   WITH app_dob AS (
--       SELECT raw_data->>'userId'                        AS user_id,
--              COUNT(DISTINCT raw_data->>'dateOfBirth')   AS distinct_dobs,
--              MIN(raw_data->>'dateOfBirth')              AS dob
--       FROM document_collections
--       WHERE collection_name = 'wave_applications'
--         AND COALESCE(raw_data->>'userId', '') <> ''
--         AND raw_data->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$'
--       GROUP BY 1
--   )
--   SELECT
--       COUNT(*) FILTER (WHERE a.distinct_dobs > 1)                        AS conflicting,
--       COUNT(*) FILTER (WHERE a.distinct_dobs = 1
--                          AND COALESCE(u.raw_data->>'dateOfBirth','') <> '') AS already_set,
--       COUNT(*) FILTER (WHERE a.distinct_dobs = 1
--                          AND COALESCE(u.raw_data->>'dateOfBirth','') = '')  AS will_backfill
--   FROM app_dob a
--   JOIN users u ON u.id = a.user_id;

-- And how many WAVE participants will STILL have no date afterwards — no
-- application row, or one with no usable date on it? Those stay unchecked, and
-- the sweep will keep saying so, which is correct.
--
--   SELECT COUNT(*)
--   FROM users u
--   WHERE 'wave_participant' = ANY(u.roles)
--     AND COALESCE(u.raw_data->>'dateOfBirth', '') = ''
--     AND COALESCE(u.raw_data#>>'{kyc,dateOfBirth}', '') = ''
--     AND NOT EXISTS (
--         SELECT 1 FROM document_collections d
--         WHERE d.collection_name = 'wave_applications'
--           AND d.raw_data->>'userId' = u.id
--           AND d.raw_data->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$'
--     );


-- ─── PART 1 — Backfill, where unambiguous and absent ────────────────────────
--
-- The date is required to look like YYYY-MM-DD and to fall in a sane range.
-- forensics.ts does `new Date(dob)` and an unparseable value yields NaN, whose
-- comparisons are all false — so a malformed date would pass the under-18 test
-- exactly the way a missing one used to. Copying rubbish across would recreate
-- the defect this migration exists to close, while making it look fixed.
--
-- The year bound is deliberately wide. It is here to catch a typo or a
-- placeholder, not to judge how old a participant may be.
WITH app_dob AS (
    SELECT
        raw_data->>'userId'                      AS user_id,
        COUNT(DISTINCT raw_data->>'dateOfBirth') AS distinct_dobs,
        MIN(raw_data->>'dateOfBirth')            AS dob
    FROM document_collections
    WHERE collection_name = 'wave_applications'
      AND COALESCE(raw_data->>'userId', '') <> ''
      AND raw_data->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$'
      AND (raw_data->>'dateOfBirth')::date BETWEEN DATE '1900-01-01' AND CURRENT_DATE
    GROUP BY 1
)
UPDATE users u
SET raw_data = u.raw_data || jsonb_build_object(
        'dateOfBirth', a.dob,
        -- Provenance on the row itself. Nothing reads this; it exists so that
        -- "where did this date come from?" has an answer in six months, and so
        -- a later reconciliation can tell a backfilled value from a declared
        -- one. Same reasoning as restoredFromLessonsAt in 023.
        'dateOfBirthSource', 'wave_application_backfill_024'
    )
FROM app_dob a
WHERE u.id = a.user_id
  AND a.distinct_dobs = 1
  AND COALESCE(NULLIF(u.raw_data->>'dateOfBirth', ''), '') = '';


-- ─── PART 2 — Conflicting declarations: REPORT ONLY ─────────────────────────
--
-- A user whose applications declare more than one date of birth is left
-- untouched. Picking the newest, or the one on the approved application, would
-- resolve a discrepancy that somebody should look at — and the whole reason
-- #156 and #157 exist is that these records were never being looked at.
--
-- Run this and read it:
--
--   SELECT raw_data->>'userId' AS user_id,
--          ARRAY_AGG(DISTINCT raw_data->>'dateOfBirth' ORDER BY raw_data->>'dateOfBirth') AS declared_dates,
--          COUNT(*) AS applications
--   FROM document_collections
--   WHERE collection_name = 'wave_applications'
--     AND COALESCE(raw_data->>'userId', '') <> ''
--     AND raw_data->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$'
--   GROUP BY 1
--   HAVING COUNT(DISTINCT raw_data->>'dateOfBirth') > 1
--   ORDER BY 3 DESC;
--
-- If one of the dates would put the applicant under 18 at the time they
-- applied, that is the case worth reading first.
