-- WAVE population breakdown — READ ONLY. Nothing here writes, updates or deletes.
--
-- Run this against production and paste the output back. It answers, with no
-- inference, the question this audit keeps getting wrong: WHO COUNTS AS HAVING
-- APPLIED TO WAVE.
--
-- Why it exists: the compliance screen reported 36,748 where ~15-20k was
-- expected. 14,668 approved + 5,083 pending = 19,751, leaving ~17,000 counted
-- by a signal that may or may not mean "applied". These four groups are
-- mutually exclusive, so the right total is a choice between sums of them
-- rather than a guess.

\echo '=== 1. The four populations, mutually exclusive ==='
SELECT
    CASE
        WHEN raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
             AND 'wave_participant' = ANY(roles)
            THEN 'A · registration object AND role'
        WHEN raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
            THEN 'B · registration object, NO role'
        WHEN 'wave_participant' = ANY(roles)
            THEN 'C · role only, NO registration object'
        ELSE 'D · neither (not a WAVE person)'
    END AS population,
    count(*) AS people
FROM users
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== 2. Status breakdown of everyone WITH a registration object (A + B) ==='
SELECT
    coalesce(raw_data->'serviceRegistrations'->'wave'->>'status', '(none)') AS wave_status,
    count(*) AS people
FROM users
WHERE raw_data->'serviceRegistrations'->'wave'->>'status' IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo '=== 3. Are the role-only accounts (C) legacy imports, or something else? ==='
-- The legacy importer writes BOTH a registration object and the role, so a
-- legacy member should NOT appear in C at all. If C is largely _isLegacy, that
-- assumption is wrong and these people belong in the count.
SELECT
    coalesce(raw_data->>'_isLegacy', 'not marked legacy') AS legacy_flag,
    count(*) AS people,
    min(created_at)::date AS earliest,
    max(created_at)::date AS latest
FROM users
WHERE 'wave_participant' = ANY(roles)
  AND raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo '=== 4. Do the role-only accounts have WAVE data anywhere else? ==='
-- If they have an application row or a member row, they applied and the
-- registration object is simply missing — which would make excluding them wrong.
SELECT
    'role-only WITH a wave_applications row' AS finding, count(*) AS people
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND EXISTS (SELECT 1 FROM document_collections d
              WHERE d.collection_name = 'wave_applications'
                AND d.raw_data->>'userId' = u.id)
UNION ALL
SELECT
    'role-only WITH a wave_members row', count(*)
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND EXISTS (SELECT 1 FROM document_collections d
              WHERE d.collection_name = 'wave_members'
                AND d.id = u.id)
UNION ALL
SELECT
    'role-only WITH NEITHER', count(*)
FROM users u
WHERE 'wave_participant' = ANY(u.roles)
  AND u.raw_data->'serviceRegistrations'->'wave'->>'status' IS NULL
  AND NOT EXISTS (SELECT 1 FROM document_collections d
                  WHERE d.collection_name = 'wave_applications'
                    AND d.raw_data->>'userId' = u.id)
  AND NOT EXISTS (SELECT 1 FROM document_collections d
                  WHERE d.collection_name = 'wave_members'
                    AND d.id = u.id);

\echo ''
\echo '=== 5. The detail collections, for reference ==='
SELECT 'wave_applications rows' AS collection, count(*) AS rows
FROM document_collections WHERE collection_name = 'wave_applications'
UNION ALL
SELECT 'wave_members rows', count(*)
FROM document_collections WHERE collection_name = 'wave_members'
UNION ALL
SELECT 'wave_briefing_registrations rows', count(*)
FROM document_collections WHERE collection_name = 'wave_briefing_registrations';
