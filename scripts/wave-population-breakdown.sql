-- WAVE population breakdown — READ ONLY. Nothing here writes, updates or deletes.
--
-- PASTE THIS WHOLE FILE INTO THE SUPABASE SQL EDITOR AND RUN IT.
-- (Supabase dashboard → SQL Editor → New query → paste → Run.)
-- It returns ONE table, so there is nothing to scroll between and no psql needed.
--
-- Why it exists: the compliance card reported 36,748 WAVE applicants against
-- 41,797 total accounts, of which only 21,902 have any application data at all.
-- Something was counting people who never applied. These rows say exactly who,
-- with no inference.

SELECT * FROM (

-- ── 1. The four populations. Mutually exclusive: they sum to every account. ──
SELECT 1 AS sort, 'POPULATION' AS section,
       CASE
           WHEN u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
                AND 'wave_participant' = ANY(u.roles)
               THEN 'A · has registration AND role'
           WHEN u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
               THEN 'B · has registration, no role'
           WHEN 'wave_participant' = ANY(u.roles)
               THEN 'C · role only, NO registration  <-- the disputed group'
           ELSE 'D · neither (not a WAVE person)'
       END AS label,
       count(*)::bigint AS people
FROM users u
GROUP BY 3

UNION ALL

-- ── 2. Every distinct wave status, with counts. ─────────────────────────────
-- If a status here is not one the app knows about, its holders are invisible in
-- the funnel. `legacy_pending_onboarding` is the one to look for.
SELECT 2, 'STATUS VALUES',
       coalesce(u.raw_data->'serviceRegistrations'->'wave'->>'status', '(none)'),
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
GROUP BY 3

UNION ALL

-- ── 3. Are the role-only accounts (group C) legacy imports? ─────────────────
-- The importer writes a registration object AND the role, so a legacy member
-- should never appear in C. If these are mostly legacy-flagged, that assumption
-- is wrong and they belong in the count.
SELECT 3, 'GROUP C — legacy flag',
       coalesce(u.raw_data->>'_isLegacy', 'not marked legacy'),
       count(*)::bigint
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
GROUP BY 3

UNION ALL

-- ── 4. Do the role-only accounts have WAVE data anywhere else? ──────────────
-- If they have an application or member row they DID apply, and the missing
-- piece is their registration object — a data repair, not a counting decision.
SELECT 4, 'GROUP C — other wave data', 'has a wave_applications row',
       count(*)::bigint
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND EXISTS (SELECT 1 FROM document_collections d
              WHERE d.collection_name = 'wave_applications'
                AND d.raw_data->>'userId' = u.id)

UNION ALL

SELECT 4, 'GROUP C — other wave data', 'has a wave_members row',
       count(*)::bigint
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND EXISTS (SELECT 1 FROM document_collections d
              WHERE d.collection_name = 'wave_members'
                AND d.id = u.id)

UNION ALL

SELECT 4, 'GROUP C — other wave data', 'has NEITHER (never applied)',
       count(*)::bigint
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND NOT EXISTS (SELECT 1 FROM document_collections d
                  WHERE d.collection_name = 'wave_applications'
                    AND d.raw_data->>'userId' = u.id)
  AND NOT EXISTS (SELECT 1 FROM document_collections d
                  WHERE d.collection_name = 'wave_members'
                    AND d.id = u.id)

UNION ALL

-- ── 5. The detail collections, for reference. ───────────────────────────────
SELECT 5, 'COLLECTIONS', d.collection_name, count(*)::bigint
FROM document_collections d
WHERE d.collection_name IN
      ('wave_applications', 'wave_members', 'wave_briefing_registrations')
GROUP BY 3

) x
ORDER BY sort, label;
