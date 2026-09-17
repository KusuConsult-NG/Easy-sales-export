-- Marketplace account-type vs capability — READ ONLY. No writes, updates or deletes.
--
-- PASTE INTO THE SUPABASE SQL EDITOR AND RUN. Returns one table.
--
-- The question: marketplace signup accepts "buyer", "seller" or "both", but the
-- code branches on `isBuyerOnly = accountType === "buyer"`, so "both" takes the
-- SELLER path — which grants no role at signup, and grants only `seller` on
-- admin approval. `marketplace_buyer` is never granted to a "both" account.
--
-- So what someone signed up as and what they can actually do may disagree. These
-- rows say how many people that is, before any code changes.

SELECT * FROM (

-- ── 1. What people signed up as. ────────────────────────────────────────────
SELECT 1 AS sort, 'SIGNED UP AS' AS section,
       coalesce(u.raw_data->'serviceRegistrations'->'marketplace'->>'accountType',
                '(no accountType recorded)') AS label,
       count(*)::bigint AS people
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'marketplace' IS NOT NULL
GROUP BY 3

UNION ALL

-- ── 2. THE ONE THAT MATTERS: "both" accounts, and what they can actually do. ─
SELECT 2, 'ACCOUNT TYPE "both"',
       CASE
           WHEN ('buyer' = ANY(u.roles) OR 'marketplace_buyer' = ANY(u.roles))
                AND ('seller' = ANY(u.roles) OR 'marketplace_seller' = ANY(u.roles))
               THEN 'can do BOTH — correct'
           WHEN 'seller' = ANY(u.roles) OR 'marketplace_seller' = ANY(u.roles)
               THEN 'can only SELL — buyer role missing'
           WHEN 'buyer' = ANY(u.roles) OR 'marketplace_buyer' = ANY(u.roles)
               THEN 'can only BUY — seller role missing'
           ELSE 'NEITHER role — no marketplace capability at all'
       END,
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'marketplace'->>'accountType' = 'both'
GROUP BY 3

UNION ALL

-- ── 3. The same question for plain sellers, as a control. ───────────────────
-- If sellers are also missing their role, the defect is broader than "both".
SELECT 3, 'ACCOUNT TYPE "seller"',
       CASE
           WHEN 'seller' = ANY(u.roles) OR 'marketplace_seller' = ANY(u.roles)
               THEN 'has a seller role — correct'
           ELSE 'NO seller role'
       END,
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'marketplace'->>'accountType' = 'seller'
GROUP BY 3

UNION ALL

-- ── 4. Which role spellings are actually in use. ────────────────────────────
-- module-access-check lists ["buyer","seller","marketplace_buyer"] and omits
-- `marketplace_seller`. If that spelling exists in the data, those accounts are
-- refused marketplace access by Layer 1.
SELECT 4, 'ROLE SPELLINGS IN USE', r.role, count(*)::bigint
FROM users u, unnest(u.roles) AS r(role)
WHERE r.role IN ('buyer', 'seller', 'marketplace_buyer', 'marketplace_seller')
GROUP BY 3

UNION ALL

-- ── 5. Marketplace registration statuses, for the count fix. ────────────────
-- `not_started` here means the same as it did for WAVE: never began.
SELECT 5, 'MARKETPLACE STATUS',
       coalesce(u.raw_data->'serviceRegistrations'->'marketplace'->>'status', '(none)'),
       count(*)::bigint
FROM users u
WHERE u.raw_data->'serviceRegistrations'->'marketplace' IS NOT NULL
GROUP BY 3

) x
ORDER BY sort, label;
