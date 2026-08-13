-- ============================================================================
-- 023 — Repair the rows autoEnrollPaidUser wrote under the wrong field name
-- ============================================================================
--
-- WHAT HAPPENED
-- -------------
-- autoEnrollPaidUser was changed to take the caller from the session, and its
-- local was renamed userId -> resolvedUserId. The rename was applied inside the
-- query string literals and the written field names as well:
--
--     .where("resolvedUserId", "==", resolvedUserId)
--     await progressRef.set({ resolvedUserId, courseId, ... })
--
-- Nothing else in the codebase writes a field called `resolvedUserId`;
-- course-actions.ts, the real enrolment path, writes `userId`. So the rows this
-- function created carry a key no reader looks at, and its own dedup queries
-- matched nothing, every time.
--
-- The code fix (#148) stops the damage and makes that one function read both
-- names. It does NOT make the existing rows visible to everything else — the
-- learner's course list, the dashboard and the certificate check all query
-- `userId` alone. That is what this migration is for.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT
-- -----------------------------------------
--   Part 1  renames the key on affected rows. Safe and idempotent.
--
--   Part 2  restores the course progress the bug zeroed, recomputed from the
--           per-lesson records it never touched.
--
--           It restores the PERCENTAGE ONLY. It does not restore `completed` or
--           `completedAt`, because generateCourseCertificate reads exactly
--           those, and a migration that guesses a learner finished a course
--           mints a credential the platform then vouches for publicly. Getting
--           that wrong is worse than a learner re-completing a course, so
--           completion is left to completeCourse, which verifies every lesson.
--
--   Part 3  reports duplicate enrolments. It deletes NOTHING. The bug added a
--           second enrolment row for learners who had already enrolled
--           properly; which of a pair to keep is a judgement about live data,
--           not something a migration should decide silently.
--
-- WHY A GLOBAL WHERE IS SAFE HERE
-- ------------------------------
-- Part 1 does not name the affected collections. `resolvedUserId` is written by
-- nothing in this codebase except the defect — verified by grep across src —
-- so any row carrying it came from this bug, whichever collection it landed in.
-- That matters because the function wrote to three places: course_progress,
-- course_enrollments, and the user_progress/<uid>/courses subcollection.
-- Enumerating them risks missing one; the key itself is the reliable marker.
--
-- RUN THE PREFLIGHT FIRST
-- -----------------------
-- Every statement below is idempotent and safe to re-run, but run the SELECTs
-- in Part 0 before the UPDATEs and keep the numbers. Part 2 cannot be undone by
-- re-running it, and the counts are the only record of what it touched.
-- ============================================================================


-- ─── PART 0 — PREFLIGHT. Read-only. Run this first and keep the output. ─────

-- How many rows carry the wrong key, and where?
--
--   SELECT collection_name, COUNT(*) AS rows_to_rename
--   FROM document_collections
--   WHERE raw_data ? 'resolvedUserId'
--   GROUP BY collection_name
--   ORDER BY 2 DESC;

-- How many course_progress rows look zeroed while the learner has real lesson
-- progress? This is the population Part 2 restores.
--
--   WITH lesson_rollup AS (
--       SELECT raw_data->>'userId' AS user_id,
--              raw_data->>'courseId' AS course_id,
--              AVG((raw_data->>'progressPercent')::numeric) AS avg_pct
--       FROM document_collections
--       WHERE collection_name = 'lesson_video_progress'
--         AND raw_data ? 'userId' AND raw_data ? 'courseId'
--         AND (raw_data->>'progressPercent') ~ '^[0-9]+(\.[0-9]+)?$'
--       GROUP BY 1, 2
--   )
--   SELECT COUNT(*) AS rows_to_restore
--   FROM document_collections cp
--   JOIN lesson_rollup lr
--     ON cp.raw_data->>'userId' = lr.user_id
--    AND cp.raw_data->>'courseId' = lr.course_id
--   WHERE cp.collection_name = 'course_progress'
--     AND COALESCE(NULLIF(cp.raw_data->>'progressPercent', '')::numeric, 0) = 0
--     AND lr.avg_pct > 0;


-- ─── PART 1 — Rename the key ────────────────────────────────────────────────

-- 1a. Rows carrying only the wrong key: move the value across.
UPDATE document_collections
SET raw_data = (raw_data - 'resolvedUserId')
               || jsonb_build_object('userId', raw_data->'resolvedUserId')
WHERE raw_data ? 'resolvedUserId'
  AND NOT (raw_data ? 'userId');

-- 1b. Rows carrying both: keep `userId`, drop the stray.
--
-- These should not exist — the defect wrote one or the other — but a row that
-- was later patched by a correct writer would have both, and leaving the stray
-- key in place would keep this migration reporting work forever.
UPDATE document_collections
SET raw_data = raw_data - 'resolvedUserId'
WHERE raw_data ? 'resolvedUserId'
  AND raw_data ? 'userId';


-- ─── PART 2 — Restore the progress the bug zeroed ───────────────────────────
--
-- The bug merged progressPercent: 0 over course_progress at
-- `<userId>_<courseId>`. It never touched lesson_video_progress, which holds one
-- row per lesson with its own progressPercent — written by updateLessonProgress,
-- the path with the watch-rate guard. So the course figure is recomputable from
-- records the defect could not reach.
--
-- The reconstruction is the mean of the learner's lesson percentages for that
-- course. That is an approximation: it averages only the lessons they have
-- actually started, so a learner who finished 2 of 10 lessons is restored to
-- 100% rather than 20%. It is deliberately generous in the direction that costs
-- nothing — the figure drives a progress bar, and completion is decided
-- elsewhere by counting every lesson of the course.
--
-- Only rows sitting at zero are touched, so a learner who has made progress
-- since is left alone.
WITH lesson_rollup AS (
    SELECT
        raw_data->>'userId'   AS user_id,
        raw_data->>'courseId' AS course_id,
        AVG((raw_data->>'progressPercent')::numeric) AS avg_pct
    FROM document_collections
    WHERE collection_name = 'lesson_video_progress'
      AND raw_data ? 'userId'
      AND raw_data ? 'courseId'
      -- Guard the cast: a non-numeric value would abort the whole migration.
      AND (raw_data->>'progressPercent') ~ '^[0-9]+(\.[0-9]+)?$'
    GROUP BY 1, 2
)
UPDATE document_collections cp
SET raw_data = cp.raw_data || jsonb_build_object(
        'progressPercent',      LEAST(100, ROUND(lr.avg_pct))::int,
        'completionPercentage', LEAST(100, ROUND(lr.avg_pct))::int,
        -- An audit trail on the row itself. Nothing reads this; it exists so
        -- that "why is this 47?" has an answer in six months.
        'restoredFromLessonsAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
FROM lesson_rollup lr
WHERE cp.collection_name = 'course_progress'
  AND cp.raw_data->>'userId'   = lr.user_id
  AND cp.raw_data->>'courseId' = lr.course_id
  AND COALESCE(NULLIF(cp.raw_data->>'progressPercent', '')::numeric, 0) = 0
  AND lr.avg_pct > 0;


-- ─── PART 3 — Duplicate enrolments: REPORT ONLY ─────────────────────────────
--
-- The bug added a second course_enrollments row for learners who had already
-- enrolled through enrollInCourse. After Part 1 both rows carry `userId`, so
-- they are now findable.
--
-- Nothing is deleted here on purpose. Both rows are real records with real
-- timestamps, readers use `.docs[0]`, and choosing which to keep is a judgement
-- about live data. Run this, look at the result, and decide:
--
--   SELECT raw_data->>'userId'   AS user_id,
--          raw_data->>'courseId' AS course_id,
--          COUNT(*)              AS enrolment_rows,
--          MIN(created_at)       AS first_seen,
--          MAX(created_at)       AS last_seen
--   FROM document_collections
--   WHERE collection_name = 'course_enrollments'
--     AND raw_data ? 'userId' AND raw_data ? 'courseId'
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1
--   ORDER BY 3 DESC;
--
-- If you decide to collapse them, the oldest row is the genuine enrolment —
-- the duplicate was written later, by a dashboard load. Keeping MIN(created_at)
-- per (userId, courseId) is the conservative choice, and it should be a
-- separate migration that says so in its own header.
