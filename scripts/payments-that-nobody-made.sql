-- Fabricated payment rows in the ledger — READ ONLY. No writes, updates or deletes.
--
-- PASTE INTO THE SUPABASE SQL EDITOR AND RUN. Returns one table.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  WHY THIS EXISTS
--
--  The Academy population audit turned up a learner holding a paid place on
--  this evidence:
--
--      academyuser02@gmail.com    ₦50,000    ref TEST_E2E_REF_123456
--
--  Nobody paid that. It is the exact output of a mock that used to sit at the
--  top of verifyPaystackPayment in lib/paystack-server.ts:
--
--      const isTestRef = reference.startsWith('TEST_E2E_REF_') ||
--                        reference.startsWith('T') ||
--                        reference.startsWith('E2E_') ||
--                        reference === 'INVALID_REF' ||
--                        process.env.NODE_ENV === 'test' ||
--                        process.env.PLAYWRIGHT_TEST === 'true';
--
--  which returned, without contacting Paystack, a success for 5,000,000 kobo —
--  ₦50,000 — with type `academy_registration` and the CALLER'S OWN session id
--  echoed back as metadata.userId, so every "does this payment belong to you"
--  check compared the caller against themselves.
--
--  Two facts make that reach production rather than stay in a test run:
--
--    · e2e/helpers/auth.ts logged in as REAL PRODUCTION ACCOUNTS with their
--      real passwords — `academyuser02@gmail.com` among the five — and its own
--      header records that the suite "could only ever pass against production,
--      because those accounts exist nowhere else".
--
--    · tests/e2e/payment-callback.spec.ts sends `TEST_E2E_REF_123456`.
--
--  So the suite ran the payment callback against the live database as a live
--  user, the mock fabricated the success, and the row was written for keeps.
--
--  BOTH HALVES ARE ALREADY FIXED — the mock was removed in cc50b3b8
--  (2026-09-16) and the personas are seeded local identities now. WHAT WAS
--  NEVER CLEANED UP IS THE RESIDUE: rows already in the ledger. They matter
--  more than they did last week, because checkModuleAccess now reads
--  processed_payments as proof of payment. A fabricated row is now an
--  entitlement.
--
--  And the mock served EVERY verify path, not Academy's — cooperative
--  registration and contribution, wave, export investment, marketplace escrow,
--  farm-nation purchase. This query looks at the whole ledger.
--
-- ── WHAT THIS CAN AND CANNOT SETTLE ─────────────────────────────────────────
--
--  Section 1 is proof. Those reference shapes have no innocent explanation.
--
--  Section 2 IS NOT PROOF EITHER WAY, and that is the trap. Paystack really
--  does issue references of the form T + fifteen digits, and production carries
--  genuine ones — T457550806738035, T232223621495674, T750250345181632, all on
--  cooperative membership records. `startsWith('T')` caught those too. So a
--  T-reference is ambiguous by construction and cannot be judged from this
--  database at all.
--
--  THE ONLY AUTHORITY IS PAYSTACK. Export the transaction list from the
--  Paystack dashboard for the period and anti-join it on reference: a
--  reference Paystack has never heard of was never paid, whatever this table
--  says. Everything below narrows down what to check — it does not replace the
--  check.
--
--  NOTHING IS DELETED HERE. A fabricated row may sit under a real fulfilment
--  somebody has been using for months, and revoking it is a decision about a
--  person, not a row.
--
-- ── COLUMNS ────────────────────────────────────────────────────────────────
--
--  Per NATIVE_COLUMNS, on processed_payments:
--      id, user_id, amount, reference, created_at, updated_at   are NATIVE
--      type AND status live in raw_data                          <-- easy to miss
--
--  A filter written as `p.status = 'completed'` matches nothing.
-- ─────────────────────────────────────────────────────────────────────────────

WITH payments AS (
    SELECT p.id,
           p.user_id,
           p.reference,
           p.amount,
           p.created_at,
           coalesce(p.raw_data->>'type', '(none)')   AS ptype,
           coalesce(p.raw_data->>'status', '(none)') AS pstatus,

           -- The mock's amount, in either unit. It always returned 5,000,000
           -- kobo / ₦50,000 regardless of what the caller was buying, so a
           -- ₦50,000 row on a plan that does not cost ₦50,000 is a tell.
           coalesce(p.amount IN (50000, 5000000), false) AS mock_amount,

           -- Written before the mock was removed in cc50b3b8.
           --
           --   coalesce'd to TRUE, not false, and the direction is the whole
           --   point: a row with no created_at is a row whose age is unknown,
           --   and `WHERE predates_fix` would silently drop every one of them
           --   from the two sections that filter on it. An audit hunting for
           --   something must not disappear the rows it cannot date — they are
           --   shown and judged by hand instead.
           coalesce(p.created_at < DATE '2026-09-16', true) AS predates_fix
    FROM processed_payments p
)

SELECT * FROM (

-- ── 1. FABRICATED. No innocent reading of these. ───────────────────────────
SELECT 1 AS sort,
       'FABRICATED — reference shape is test-only' AS section,
       ptype || '  |  ₦' || coalesce(amount::text, '?')
           || '  |  ' || coalesce(reference, '(no reference)') AS label,
       count(*)::bigint AS rows_found
FROM payments
WHERE reference = 'INVALID_REF'
   OR reference LIKE 'E2E\_%'
   OR reference LIKE 'TEST\_E2E\_REF\_%'
GROUP BY 3

UNION ALL

-- ── 2. AMBIGUOUS. T-form, which the mock and Paystack both produce. ────────
-- Split by whether the reference has Paystack's actual T-shape. A T-reference
-- that is NOT T + exactly fifteen digits was not minted by Paystack.
SELECT 2,
       'T-REFERENCE — check these against the Paystack dashboard',
       CASE
           WHEN reference ~ '^T[0-9]{15}$' AND mock_amount
               THEN 'Paystack T-shape, but ₦50,000 exactly  <-- check first'
           WHEN reference ~ '^T[0-9]{15}$'
               THEN 'Paystack T-shape, amount is not the mock''s'
           --   T + THIRTEEN digits is a JavaScript Date.now(). Section 5
           --   proves it per row by decoding the digits and comparing them
           --   with the row's own created_at.
           WHEN reference ~ '^T[0-9]{13}$'
               THEN 'T + 13 digits — a Date.now() timestamp; see section 5'
           ELSE 'starts with T but NOT Paystack''s shape  <-- check first'
       END,
       count(*)::bigint
FROM payments
WHERE reference LIKE 'T%'
  AND predates_fix
  --   Section 1 already reports these as certain, and `TEST_E2E_REF_…`
  --   also starts with T. Without this they are counted in both sections
  --   and the same fabricated row reads as two.
  AND reference NOT LIKE 'TEST\_E2E\_REF\_%'
  AND reference NOT LIKE 'E2E\_%'
  AND reference <> 'INVALID_REF'
GROUP BY 3

UNION ALL

-- ── 3. The amount fingerprint, independent of the reference. ───────────────
-- NODE_ENV='test' triggered the mock for ANY reference, so a run with that set
-- would leave an ordinary-looking reference behind. What it could not vary is
-- the amount.
--
--   THIS SECTION ACCUSES INNOCENT ROWS AND IS MEANT TO. ₦50,000 is a price
--   somebody really pays: Sanusi Ruth Adenike settled ₦50,000 against a genuine
--   card reference (y6c3who31k) and will appear here every time this is run.
--   Read it as "same amount as the mock", never as "fabricated" — sections 1
--   and 2 are where the reference shape carries evidence. What earns a second
--   look is a row whose TYPE does not cost ₦50,000, because the mock returned
--   that figure regardless of what was being bought.
SELECT 3,
       'EXACTLY ₦50,000 AND OLDER THAN THE FIX, BY TYPE',
       ptype || '  (' || pstatus || ')',
       count(*)::bigint
FROM payments
WHERE mock_amount AND predates_fix
GROUP BY 3

UNION ALL

-- ── 4. Every Academy payment row, so the audit's 20 can be eyeballed. ──────
-- These are the rows that put people in the PAID bucket on evidence stronger
-- than a field. If one of them appears in section 1 or 2, that bucket is wrong.
SELECT 4,
       'ACADEMY PAYMENT ROWS IN FULL',
       coalesce(to_char(created_at, 'YYYY-MM-DD'), '(undated)')
         || '  |  ₦' || coalesce(amount::text, '?')
         || '  |  ' || coalesce(reference, '(no reference)')
         || '  |  ' || pstatus,
       count(*)::bigint
FROM payments
WHERE ptype IN ('academy_registration', 'academy_enrollment')
GROUP BY 3

UNION ALL

-- ── 5. THE T-REFERENCE THAT ENCODES ITS OWN INSERT TIME. ───────────────────
--
--   Section 2 can only call a T + 13 reference suspicious. This settles it.
--
--   tests/e2e/financial-workflow.spec.ts mints its reference as
--
--       const reference = `T${Date.now()}`;
--
--   so the thirteen digits ARE the millisecond the row was created. Decode
--   them and compare with the row's own created_at: if they agree to within a
--   few minutes, the reference was minted by our own client at insert time.
--
--   PAYSTACK CANNOT PRODUCE THAT. Its T-form is fifteen digits, and no
--   reference it issues could encode the moment OUR INSERT ran. This is a
--   proof about provenance, not a guess about shape, which is why it can
--   promote a row from "check first" to fabricated without ever risking a
--   real payer — the risk that kept section 2 ambiguous in the first place.
--
--   The live sweep found two: T1783690499905 decodes to 13:34:59.905 against
--   a created_at of 13:35, and T1783698149704 to 15:42:29.704 against 15:42.
--
--   MATERIALIZED is load-bearing. Without it the planner may hoist the
--   substring cast above the regex filter and try to read a bigint out of a
--   reference that is not all digits, failing the whole sweep.
SELECT 5,
       'T-REFERENCE THAT ENCODES ITS OWN INSERT TIME — fabricated, not ambiguous',
       reference
         || '  |  ₦' || coalesce(amount::text, '?')
         || '  |  reference says ' || to_char(minted_at, 'YYYY-MM-DD HH24:MI:SS')
         || '  |  row says ' || coalesce(to_char(created_at, 'YYYY-MM-DD HH24:MI:SS'), '(undated)')
         || '  |  ' || CASE
                WHEN created_at IS NULL THEN 'undated row — compare by hand'
                WHEN abs(extract(epoch FROM (created_at - minted_at))) <= 600
                    THEN 'AGREE to within 10 minutes — minted by our own client'
                ELSE 'disagree by '
                     || round(abs(extract(epoch FROM (created_at - minted_at))) / 60)::text
                     || ' minutes — still a Date.now() shape'
            END,
       count(*)::bigint
FROM (
    SELECT reference, amount, created_at,
           to_timestamp(substring(reference FROM 2)::bigint / 1000.0) AT TIME ZONE 'UTC' AS minted_at
    FROM (
        SELECT reference, amount, created_at
        FROM payments
        WHERE reference ~ '^T[0-9]{13}$'
    ) guarded
) decoded
GROUP BY reference, amount, created_at, minted_at

) x
ORDER BY sort, label;

-- ─────────────────────────────────────────────────────────────────────────────
--  AND THE PEOPLE BEHIND THE FABRICATED ROWS.
--
--  Run separately, once the counts above are understood. Joins the section 1
--  rows to the account holding them, so the question stops being "how many
--  rows" and becomes "who has been let in on one, and for how long".
-- ─────────────────────────────────────────────────────────────────────────────
--
--  SELECT p.reference,
--         p.amount,
--         p.created_at,
--         p.raw_data->>'type'   AS type,
--         p.raw_data->>'status' AS status,
--         u.email,
--         u.roles
--  FROM processed_payments p
--  LEFT JOIN users u ON u.id = p.user_id
--  WHERE p.reference = 'INVALID_REF'
--     OR p.reference LIKE 'E2E\_%'
--     OR p.reference LIKE 'TEST\_E2E\_REF\_%'
--     OR (p.reference LIKE 'T%' AND p.reference !~ '^T[0-9]{15}$')
--  ORDER BY p.created_at;

-- ─────────────────────────────────────────────────────────────────────────────
--  REMOVING THE THREE, IF THAT IS WHAT YOU DECIDE.
--
--  THE GENERAL RULE IS STILL "DO NOT DELETE". A fabricated row may have had
--  something fulfilled against it months ago, and deleting it revokes whatever
--  that was from whoever has been using it. That is a decision about a person.
--
--  THESE THREE ARE THE EXCEPTION, AND ONLY BECAUSE BOTH HALVES ARE PROVEN:
--
--    * fabricated — TEST_E2E_REF_123456 is a test-only shape, and the other
--      two encode their own insert time (section 5), which Paystack cannot do;
--    * and held by test accounts — academyuser02@gmail.com and
--      e2e.user@easysalesexport.com, not customers.
--
--  Neither half alone is enough. A real payer on a fabricated row keeps it.
--
--  WHAT THIS DOES NOT DO: it removes the RECORD OF PAYMENT, not the
--  ENTITLEMENT. `academy_participant` lives on the user document, in roles and
--  serviceRegistrations.academy — deleting the ledger row leaves those test
--  accounts holding Academy access with nothing behind it, which is a
--  different wrong answer than the one you started with. Decide both together.
--
--  RUN THE SELECT FIRST. If it does not return exactly these three rows, stop:
--  something has changed since this was written and the DELETE is not safe.
-- ─────────────────────────────────────────────────────────────────────────────
--
--  SELECT p.reference, p.amount, p.created_at, u.email, u.roles
--  FROM processed_payments p
--  LEFT JOIN users u ON u.id = p.user_id
--  WHERE p.reference IN ('TEST_E2E_REF_123456','T1783690499905','T1783698149704');
--
--  -- Then, with the three confirmed, inside a transaction that refuses to
--  -- commit if the count is not exactly three:
--  BEGIN;
--
--  DELETE FROM processed_payments
--   WHERE reference IN ('TEST_E2E_REF_123456','T1783690499905','T1783698149704');
--
--  -- psql prints "DELETE 3". Anything else and the next line aborts.
--  DO $$
--  DECLARE remaining int;
--  BEGIN
--      SELECT count(*) INTO remaining FROM processed_payments
--       WHERE reference IN ('TEST_E2E_REF_123456','T1783690499905','T1783698149704');
--      IF remaining <> 0 THEN
--          RAISE EXCEPTION 'expected none left, found %', remaining;
--      END IF;
--  END $$;
--
--  COMMIT;   -- or ROLLBACK; if the count surprised you
