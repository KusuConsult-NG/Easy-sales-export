-- Cooperative population — READ ONLY. No writes, updates or deletes.
--
-- PASTE INTO THE SUPABASE SQL EDITOR AND RUN. Returns one table.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  THIS REPLACES AN EARLIER VERSION OF THIS FILE WHOSE SECTIONS 2, 4 AND 5 WERE
--  STRUCTURALLY INCAPABLE OF RETURNING A TRUE ANSWER.
--
--  They read membership rows as
--
--      FROM document_collections WHERE collection_name = 'cooperative_members'
--
--  and `cooperative_members` is NOT in document_collections. It is one of the
--  ten collections in lib/supabase-table-map.ts's DEDICATED_TABLE_MAP, so every
--  read and write goes to a table of its own. No row with that collection_name
--  has ever existed, and the query returned 0 BY CONSTRUCTION — not because the
--  table is empty.
--
--  The earlier run therefore reported "members page — COOPERATIVE_MEMBERS rows:
--  0", and its LEFT JOIN, joining against that always-empty set, put all 36,678
--  registered accounts in the "NO membership row" bucket and 747 in "role only,
--  neither record". Those three figures are artefacts of the query. Nothing
--  should be concluded from them.
--
--  Sections 1 and 3 read only `users` and were correct; their results stand.
--
--  It is the same defect this audit keeps finding in the application — an
--  assertion answered by the wrong occurrence — committed in the instrument
--  used to look for it. Two further consequences, corrected below: the
--  dedicated table keeps `membershipStatus` in a NATIVE `status` column via
--  FIELD_TO_COLUMN, so `raw_data->>'membershipStatus'` was the wrong path too;
--  and `userId` likewise has a native `user_id`. Both spellings are indexed,
--  which means both are in use, so section 4 now measures whether they AGREE.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cooperative pass 2 of docs/module-audit-checklist.md, settling the two items
-- pass 1 left open as QUESTIONS rather than claimed defects:
--
--   A3.1  Three surfaces can answer "how many cooperative members": the
--         dashboard pie (register-based), the admin dashboard (register when
--         unscoped, else COOPERATIVE_MEMBERS) and the members page (a
--         COOPERATIVE_MEMBERS window). They answer legitimately different
--         questions. What is NOT established is that they never disagree about
--         the same one — and on WAVE, two admin screens differed by 16,000.
--
--   A1.1  Whether a member holding `cooperative_member` with no
--   A1.2  COOPERATIVE_MEMBERS row exists, and which screens would miss her.
--
-- Section 2 is the one that decides both.

SELECT * FROM (

-- ── 1. The dual-spelling keys. The importer writes BOTH to the same user. ──
-- If the same account carries both, any count that SUMS them double-counts.
SELECT 1 AS sort, 'REGISTRATION KEYS' AS section,
       CASE
           WHEN u.raw_data->'serviceRegistrations'->'cooperative' IS NOT NULL
                AND u.raw_data->'serviceRegistrations'->'cooperatives' IS NOT NULL
               THEN 'BOTH spellings on one account'
           WHEN u.raw_data->'serviceRegistrations'->'cooperatives' IS NOT NULL
               THEN 'plural only (cooperatives)'
           WHEN u.raw_data->'serviceRegistrations'->'cooperative' IS NOT NULL
               THEN 'singular only (cooperative)'
           ELSE 'neither'
       END AS label,
       count(*)::bigint AS people
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'cooperative' IS NOT NULL
   OR u.raw_data->'serviceRegistrations'->'cooperatives' IS NOT NULL
   OR 'cooperative_member' = ANY(u.roles)
GROUP BY 3

UNION ALL

-- ── 2. A1.1 / A1.2 — THE DECIDING ONE. ─────────────────────────────────────
-- Registration object vs membership row vs role. The members page counts the
-- middle column; the admin dashboard and the pie count the first and third.
--
-- The join tries all three ways a row is linked to an account, because both
-- `user_id` and `raw_data->>'userId'` carry indexes — so both are written —
-- and payments/service.ts:720 and :1302 address the row BY the user's id.
SELECT 2, 'REGISTRATION vs MEMBERSHIP ROW',
       CASE
           WHEN reg.has_reg AND reg.member_rows > 0 THEN 'has BOTH — consistent'
           WHEN reg.has_reg AND reg.member_rows = 0
               THEN 'registration but NO membership row  <-- members page misses her'
           WHEN NOT reg.has_reg AND reg.member_rows > 0
               THEN 'membership row but NO registration  <-- dashboard/pie miss her'
           ELSE 'role only, neither record'
       END,
       count(*)::bigint
FROM (
    SELECT u.id,
           (u.raw_data->'serviceRegistrations'->'cooperatives'->>'status' IS NOT NULL
            OR u.raw_data->'serviceRegistrations'->'cooperative'->>'status' IS NOT NULL) AS has_reg,
           (SELECT count(*) FROM cooperative_members m
             WHERE m.user_id = u.id
                OR m.raw_data->>'userId' = u.id
                OR m.id = u.id) AS member_rows
    FROM users u
    WHERE u.raw_data->'serviceRegistrations'->'cooperative' IS NOT NULL
       OR u.raw_data->'serviceRegistrations'->'cooperatives' IS NOT NULL
       OR 'cooperative_member' = ANY(u.roles)
) reg
GROUP BY 3

UNION ALL

-- ── 2b. The other direction: membership rows whose account cannot be found. ─
-- userMetrics.service.ts:143 records "48 cooperative_members references with no
-- matching profile" from an earlier measurement. This re-checks that number
-- rather than carrying it forward as an assumption.
SELECT 2, 'MEMBERSHIP ROWS',
       CASE WHEN u.id IS NULL THEN 'row whose account does not exist  <-- orphan'
            ELSE 'row with a matching account' END,
       count(*)::bigint
FROM cooperative_members m
LEFT JOIN users u
       ON u.id = m.user_id OR u.id = m.raw_data->>'userId' OR u.id = m.id
GROUP BY 3

UNION ALL

-- ── 3. Status values. `not_started` inflated WAVE by 16,997 and marketplace ──
-- by 34,184; `legacy_pending_onboarding` is written by three live cooperative
-- paths and was missing from the canonical list until #840; `pending_repair` is
-- written by cooperatives/(member)/layout.tsx and was missing until #847.
SELECT 3, 'REGISTRATION STATUS',
       coalesce(u.raw_data->'serviceRegistrations'->'cooperatives'->>'status',
                u.raw_data->'serviceRegistrations'->'cooperative'->>'status',
                '(none)'),
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'cooperative' IS NOT NULL
   OR u.raw_data->'serviceRegistrations'->'cooperatives' IS NOT NULL
GROUP BY 3

UNION ALL

-- ── 4. The membership rows' own status — in BOTH places it is stored. ──────
-- FIELD_TO_COLUMN maps cooperative_members.membershipStatus → the native
-- `status` column, but buildDedicatedRow only projects it when that field is
-- present in the write, so a partial update can move one and not the other.
-- Both are indexed. If they disagree, a query that filters by membershipStatus
-- and one that reads the row return different answers about the same member.
SELECT 4, 'MEMBERSHIP ROW STATUS (native vs raw_data)',
       coalesce(m.status, '(null)') || '  |  '
         || coalesce(m.raw_data->>'membershipStatus', '(null)')
         || CASE WHEN m.status IS DISTINCT FROM m.raw_data->>'membershipStatus'
                 THEN '   <-- DISAGREE' ELSE '' END,
       count(*)::bigint
FROM cooperative_members m
GROUP BY 3

UNION ALL

-- ── 5. Totals, so the three surfaces can be compared directly. ─────────────
SELECT 5, 'WHAT EACH SURFACE WOULD REPORT', 'members page — cooperative_members rows',
       count(*)::bigint
FROM cooperative_members

UNION ALL

SELECT 5, 'WHAT EACH SURFACE WOULD REPORT', 'applicant register — any coop registration',
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'cooperatives'->>'status' IS NOT NULL
   OR u.raw_data->'serviceRegistrations'->'cooperative'->>'status' IS NOT NULL

UNION ALL

-- The same register with `not_started` removed — #841. This is the figure the
-- compliance and admin cards report after that fix, and the one to compare the
-- other two rows against.
SELECT 5, 'WHAT EACH SURFACE WOULD REPORT', 'applicant register — excluding not_started',
       count(*)::bigint
FROM users u
WHERE coalesce(u.raw_data->'serviceRegistrations'->'cooperatives'->>'status',
               u.raw_data->'serviceRegistrations'->'cooperative'->>'status') IS NOT NULL
  AND coalesce(u.raw_data->'serviceRegistrations'->'cooperatives'->>'status',
               u.raw_data->'serviceRegistrations'->'cooperative'->>'status') <> 'not_started'

UNION ALL

SELECT 5, 'WHAT EACH SURFACE WOULD REPORT', 'accounts holding cooperative_member',
       count(*)::bigint
FROM users u WHERE 'cooperative_member' = ANY(u.roles)

) x
ORDER BY sort, label;
