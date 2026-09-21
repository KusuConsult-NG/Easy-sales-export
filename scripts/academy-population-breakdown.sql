-- Academy population — READ ONLY. No writes, updates or deletes.
--
-- PASTE INTO THE SUPABASE SQL EDITOR AND RUN. Returns one table.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  THE OWNER: "check all the Academy approved users — are they legacy members
--  or paid members? if not remove them from having access and gate them to the
--  payment until they pay."
--
--  THE SECOND HALF NEEDS NO DATA CHANGE. checkModuleAccess now refuses any
--  Academy place that is neither paid nor legacy, at Layers 1, 2, 2.5 and 2.7 —
--  so an unpaid learner loses the module on their next request and is sent to
--  the payment flow, with nothing deleted and nothing to undo if a figure below
--  turns out to be wrong. THIS QUERY IS THE FIRST HALF: who that will be,
--  counted before anyone is surprised by it.
--
--  It is the Academy twin of cooperative-population-breakdown.sql, which is how
--  #497's numbers were taken before the cooperative gate moved — 77 unpaid, 74
--  of them legacy. There is no equivalent count for Academy, and the gate was
--  written without one. This is how to get it.
--
-- ── THE MISTAKE THIS FILE IS WRITTEN TO AVOID ───────────────────────────────
--
--  The cooperative version's own header records it: three of its sections read
--
--      FROM document_collections WHERE collection_name = 'cooperative_members'
--
--  and that table is DEDICATED, so the query returned 0 BY CONSTRUCTION and put
--  36,678 accounts in the wrong bucket. `academy_applications` and
--  `processed_payments` are dedicated too — both are in
--  lib/supabase-table-map.ts's DEDICATED_TABLE_MAP — so they are read as
--  tables here, never through document_collections.
--
--  AND THE COLUMNS DIFFER BETWEEN THE TWO. Per NATIVE_COLUMNS:
--
--      academy_applications   id, user_id, status  are NATIVE
--                             paymentStatus, _isLegacy  are in raw_data
--
--      processed_payments     id, user_id, amount, reference  are NATIVE
--                             type AND status are in raw_data  <-- easy to miss
--
--  A payments filter written as `p.status = 'completed'` would therefore match
--  nothing and report every learner unpaid.
--
-- ── TWO DEFINITIONS OF "PAID", AND THIS MEASURES BOTH ───────────────────────
--
--  actions/academy/_payment.ts checkAcademyPaymentStatusAction accepts
--  `paymentStatus = "completed"`, `legacyOnboardedBy`, or a processed payment of
--  type `academy_registration`.
--
--  lib/module-access-check's gate additionally accepts `paymentStatus = "paid"`
--  — because _ac_admin_review's signature is "pending" | "completed" | "paid"
--  and stores whichever the admin chose — and `academy_enrollment`, a course
--  purchase, which is money paid to Academy even though it is not the
--  programme fee.
--
--  Section 3 reports the difference as its own bucket, so the cost of the
--  narrower rule is visible rather than argued about.
-- ─────────────────────────────────────────────────────────────────────────────

WITH cohort AS (
    -- Everyone the OLD rule would have admitted: an approved/active
    -- registration, the participant role, or an approved/active application.
    SELECT DISTINCT u.id, u.email, u.roles, u.raw_data
    FROM users u
    LEFT JOIN academy_applications a
           ON a.user_id = u.id OR a.raw_data->>'userId' = u.id
    WHERE u.raw_data->'serviceRegistrations'->'academy'->>'status' IN ('approved', 'active')
       OR 'academy_participant' = ANY(u.roles)
       OR coalesce(a.status, a.raw_data->>'status') IN ('approved', 'active')
),
judged AS (
    SELECT c.id,
           c.email,
           c.raw_data->'serviceRegistrations'->'academy'->>'status'        AS reg_status,
           c.raw_data->'serviceRegistrations'->'academy'->>'paymentStatus' AS reg_payment,

           -- ── EVERY BOOLEAN BELOW IS coalesce()d, AND THAT IS NOT TIDINESS.
           --
           --    `raw_data->>'isLegacy'` is NULL when the key is absent, so
           --    `NULL = 'true'` is NULL, and `false OR NULL` is NULL — not
           --    false. An uncoalesced `is_legacy` is therefore NULL for the
           --    ordinary learner, `WHERE NOT is_legacy` discards every one of
           --    them, and the two sections that filter on it return NOTHING.
           --
           --    Measured: before this, sections 2 and 3 returned 0 rows against
           --    a seeded database while section 1 counted all eight people —
           --    because a CASE treats a NULL condition as "not this branch" and
           --    fell through to the right answer by luck. A query that is right
           --    by luck in one place and silently empty in two others is the
           --    shape this file's header warns about, so it is written down
           --    rather than just fixed.

           -- Legacy, either marker, either document.
           coalesce(c.raw_data->>'legacyOnboardedBy' IS NOT NULL, false)
            OR coalesce(c.raw_data->>'isLegacy' = 'true', false)
            OR coalesce(c.raw_data->'serviceRegistrations'->'academy'->>'_isLegacy' = 'true', false)
            OR EXISTS (SELECT 1 FROM academy_applications a
                        WHERE (a.user_id = c.id OR a.raw_data->>'userId' = c.id)
                          AND (coalesce(a.raw_data->>'_isLegacy' = 'true', false)
                               OR coalesce(a.raw_data->>'isLegacy' = 'true', false)))
           AS is_legacy,

           -- Settled on either document, under either spelling.
           coalesce(c.raw_data->'serviceRegistrations'->'academy'->>'paymentStatus'
                IN ('completed', 'paid'), false)
            OR EXISTS (SELECT 1 FROM academy_applications a
                        WHERE (a.user_id = c.id OR a.raw_data->>'userId' = c.id)
                          AND coalesce(a.raw_data->>'paymentStatus' IN ('completed', 'paid'), false))
           AS field_says_paid,

           -- The narrower spelling, so the difference can be priced.
           coalesce(c.raw_data->'serviceRegistrations'->'academy'->>'paymentStatus' = 'completed', false)
            OR EXISTS (SELECT 1 FROM academy_applications a
                        WHERE (a.user_id = c.id OR a.raw_data->>'userId' = c.id)
                          AND coalesce(a.raw_data->>'paymentStatus' = 'completed', false))
           AS field_says_completed_only,

           -- `type` and `status` live in raw_data on this table. See the header.
           EXISTS (SELECT 1 FROM processed_payments p
                    WHERE p.user_id = c.id
                      AND coalesce(p.raw_data->>'type', '') = 'academy_registration'
                      AND coalesce(p.raw_data->>'status', '') = 'completed') AS has_registration_payment,

           EXISTS (SELECT 1 FROM processed_payments p
                    WHERE p.user_id = c.id
                      AND coalesce(p.raw_data->>'type', '') = 'academy_enrollment'
                      AND coalesce(p.raw_data->>'status', '') = 'completed') AS has_course_payment
    FROM cohort c
)

SELECT * FROM (

-- ── 1. THE ANSWER TO THE QUESTION ASKED. ───────────────────────────────────
-- Every account the old rule admitted, in exactly one bucket. "NEITHER" is the
-- set that loses Academy on their next request.
SELECT 1 AS sort, 'WHO IS IN ACADEMY TODAY' AS section,
       CASE
           WHEN is_legacy THEN 'LEGACY — exempt by design, keeps access'
           WHEN field_says_paid OR has_registration_payment
               THEN 'PAID — programme fee settled, keeps access'
           WHEN has_course_payment
               THEN 'PAID — course purchase only, keeps access under the gate'
           ELSE 'NEITHER  <-- loses access until they pay'
       END AS label,
       count(*)::bigint AS people
FROM judged
GROUP BY 3

UNION ALL

-- ── 2. How the paid ones are evidenced, for the ones who ARE paid. ─────────
-- A learner evidenced ONLY by a payment row is one whose paymentStatus field is
-- stale; that is the fallback earning its place.
SELECT 2, 'HOW A PAID PLACE IS EVIDENCED',
       CASE
           WHEN field_says_paid AND has_registration_payment THEN 'field AND payment row agree'
           WHEN field_says_paid AND NOT has_registration_payment THEN 'field only — no payment row'
           WHEN NOT field_says_paid AND has_registration_payment
               THEN 'payment row only — field is stale  <-- the fallback saves this one'
           ELSE 'neither'
       END,
       count(*)::bigint
FROM judged
WHERE NOT is_legacy
GROUP BY 3

UNION ALL

-- ── 3. WHAT THE WIDER RULE BUYS. ───────────────────────────────────────────
-- The learners admitted by the gate but NOT by checkAcademyPaymentStatusAction.
-- If this is zero the two definitions agree in practice and the difference is
-- academic; if it is not, this is the number of people the narrower rule would
-- have sent back to a payment page they had already settled.
SELECT 3, 'ADMITTED BY THE GATE BUT NOT BY THE OLDER RULE',
       CASE
           WHEN field_says_paid AND NOT field_says_completed_only
               THEN 'paymentStatus is "paid", not "completed"  <-- admin-recorded'
           WHEN has_course_payment AND NOT has_registration_payment
                AND NOT field_says_paid
               THEN 'course purchase only, no programme fee'
           ELSE 'no difference'
       END,
       count(*)::bigint
FROM judged
WHERE NOT is_legacy
GROUP BY 3

UNION ALL

-- ── 4. The registration status values present, for scale. ─────────────────
SELECT 4, 'REGISTRATION STATUS', coalesce(reg_status, '(none — role or application only)'),
       count(*)::bigint
FROM judged
GROUP BY 3

UNION ALL

-- ── 5. And the application's own status, in BOTH places it may be stored. ──
-- buildDedicatedRow projects `status` to the native column only when the field
-- is present in the write, so a partial update can move one and not the other.
-- If these disagree, two readers of the same application differ about it.
SELECT 5, 'APPLICATION STATUS (native vs raw_data)',
       coalesce(a.status, '(null)') || '  |  ' || coalesce(a.raw_data->>'status', '(null)')
         || CASE WHEN a.status IS DISTINCT FROM a.raw_data->>'status'
                 THEN '   <-- DISAGREE' ELSE '' END,
       count(*)::bigint
FROM academy_applications a
GROUP BY 3

) x
ORDER BY sort, label;

-- ─────────────────────────────────────────────────────────────────────────────
--  AND THE NAMES, once the counts above are understood.
--
--  Run this separately. It lists the accounts in the "NEITHER" bucket — the
--  people who lose Academy — so they can be looked at individually before
--  anyone is told their access changed. Capped, because a list is for reading.
-- ─────────────────────────────────────────────────────────────────────────────
--
--  WITH cohort AS ( … as above … ), judged AS ( … as above … )
--  SELECT id, email, reg_status, reg_payment
--  FROM judged
--  WHERE NOT is_legacy
--    AND NOT field_says_paid
--    AND NOT has_registration_payment
--    AND NOT has_course_payment
--  ORDER BY email
--  LIMIT 500;
