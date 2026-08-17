# Runbooks: the two money repairs

Two separate operations. They are independent — either order, or only one.

|   | What it changes | Reversible? |
|---|---|---|
| A. Savings-balance repair | **Increases** `cooperative_members.savingsBalance` for members who lost a race | Only by a reversal procedure (§A6). Treat as one-way. |
| B. Fixed-savings ledger backfill | Writes missing `cooperative_transactions` rows. **No balances touched.** | Yes, cleanly (§B6) |

B is the safe one: it records debits that already happened and changes nothing
spendable. A moves money members can spend. Do A deliberately, and read its
report first.

---

## READ THIS BEFORE EITHER — the wrong-database footgun

Both scripts load environment files in this order:

```ts
if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });
```

`dotenv` does **not** override an already-set variable. So
`.env.development.local` **wins over** `.env.local`. If a local stack file is
present, these scripts talk to `127.0.0.1` no matter what is in `.env.local` —
and a report saying "nothing to do" would be true of the wrong database.

So, before running anything:

```bash
# 1. Move the local-stack env out of the way.
mv .env.development.local .env.development.local.OFF

# 2. Put production credentials in .env.local  (already gitignored via .env*)
#    NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

**Both scripts print the database host before doing anything. Read that line
every single time.** If it says `127.0.0.1`, stop — step 1 did not happen.

When finished, put it back: `mv .env.development.local.OFF .env.development.local`

Why the tested scripts rather than hand-written SQL: each has been executed
against a real Postgres with its rows inspected afterwards (6 tests and 9 tests
respectively), and each was mutation-checked — the idempotency guard was deleted
to prove the tests catch a double-apply. Equivalent SQL typed into an editor has
none of that behind it. The SQL below is therefore **read-only inspection**; the
writes go through the scripts.

---

# A. Savings-balance repair

## A1. What it fixes

A cooperative contribution has two confirmation paths. The Paystack webhook
credited `totalContributions` **and** `savingsBalance`; the browser redirect after
checkout credited only `totalContributions`. They are mutually exclusive —
whichever arrived first claimed the payment — so whether a member's **spendable**
balance went up was decided by a race between their browser and Paystack.

`savingsBalance` is what withdrawals debit, what loan-repayment-from-savings
debits, what the dashboard shows, and what the borrowing limit is a multiple of.
A member who lost that race has money in their lifetime total, in every ledger and
in every admin report that they cannot withdraw and that earns them no borrowing
headroom.

## A2. Pre-flight — see the scope, read-only

```sql
-- How many payments are affected, and how much money.
SELECT count(*)                                   AS affected_payments,
       count(DISTINCT p.raw_data->>'userId')       AS members,
       sum((p.raw_data->>'amount')::numeric)       AS total_naira,
       count(*) FILTER (WHERE t.id IS NOT NULL)    AS repairable,
       count(*) FILTER (WHERE t.id IS NULL)        AS stranded
FROM processed_payments p
LEFT JOIN transactions t ON t.id = p.id
WHERE p.raw_data->>'type'   = 'cooperative_contribution'
  AND p.raw_data->>'source' = 'client_verify'
  AND p.raw_data->>'savingsBalanceRepairedAt' IS NULL;
```

- **repairable** — has a unified-ledger row, proving the `totalContributions`
  credit ran. These get repaired.
- **stranded** — no ledger row, so fulfilment failed and *neither* field was
  credited. The script reports and refuses these: crediting `savingsBalance`
  alone would leave `totalContributions` short and swap one inconsistency for
  another. They need a person.

If `affected_payments` is 0, stop — there is nothing to repair.

Per-member breakdown, useful for sanity-checking the amounts:

```sql
SELECT p.raw_data->>'userId'                 AS member,
       count(*)                              AS payments,
       sum((p.raw_data->>'amount')::numeric) AS will_be_credited
FROM processed_payments p
JOIN transactions t ON t.id = p.id
WHERE p.raw_data->>'type'   = 'cooperative_contribution'
  AND p.raw_data->>'source' = 'client_verify'
  AND p.raw_data->>'savingsBalanceRepairedAt' IS NULL
GROUP BY 1 ORDER BY 3 DESC;
```

## A3. Report only — writes nothing

```bash
npm run repair:savings
```

Check the printed `Database:` line. Then read the report and confirm its totals
match the SQL above. The report is the same work as the apply; only the write is
withheld.

## A4. Apply

```bash
npm run repair:savings -- --apply
```

Each repaired payment is stamped `raw_data.savingsBalanceRepairedAt`, and stamped
rows are skipped on any later run — so a re-run cannot double-credit. Verified by
test, and mutation-checked: with that guard removed a second run took a test
balance from 6,000 to 11,000 and a third to 16,000.

If it fails partway, re-running is safe: members already credited are stamped and
skipped. The one exception is printed loudly by the script itself — if it credits
a member and then fails to stamp, it tells you not to re-run until that row is
stamped by hand.

## A5. Verify

```sql
-- Should now be 0: everything repairable has been stamped.
SELECT count(*) AS still_unrepaired
FROM processed_payments p
JOIN transactions t ON t.id = p.id
WHERE p.raw_data->>'type'   = 'cooperative_contribution'
  AND p.raw_data->>'source' = 'client_verify'
  AND p.raw_data->>'savingsBalanceRepairedAt' IS NULL;

-- The stranded ones remain, deliberately, and still need a person.
SELECT p.id, p.raw_data->>'userId' AS member, p.raw_data->>'amount' AS amount
FROM processed_payments p
LEFT JOIN transactions t ON t.id = p.id
WHERE p.raw_data->>'type'   = 'cooperative_contribution'
  AND p.raw_data->>'source' = 'client_verify'
  AND t.id IS NULL;
```

Then re-run `npm run repair:savings` (no `--apply`). It should report nothing to
do. That is the idempotency guarantee, observed rather than trusted.

Finally, have one affected member's dashboard checked: their savings balance
should now match their contribution history.

## A6. Reversal — last resort

There is no rollback flag, because the repair increments a balance. This reverses
it using the stamps, which is why the stamps exist. **Run once.** It reverses
every payment stamped by any run, so if you have applied the repair more than
once deliberately, do not use it.

```sql
BEGIN;

WITH per_member AS (
    SELECT raw_data->>'userId'                 AS member,
           sum((raw_data->>'amount')::numeric) AS credited
    FROM processed_payments
    WHERE raw_data->>'type'   = 'cooperative_contribution'
      AND raw_data->>'source' = 'client_verify'
      AND raw_data->>'savingsBalanceRepairedAt' IS NOT NULL
    GROUP BY 1
)
UPDATE cooperative_members m
SET raw_data = jsonb_set(
        m.raw_data, '{savingsBalance}',
        to_jsonb(GREATEST(0, COALESCE((m.raw_data->>'savingsBalance')::numeric, 0) - pm.credited))
    )
FROM per_member pm
WHERE m.id = pm.member;

-- Clear the stamps, so a future run treats these as outstanding again.
UPDATE processed_payments
SET raw_data = raw_data - 'savingsBalanceRepairedAt'
WHERE raw_data->>'type'   = 'cooperative_contribution'
  AND raw_data->>'source' = 'client_verify'
  AND raw_data->>'savingsBalanceRepairedAt' IS NOT NULL;

-- INSPECT the results, then COMMIT or ROLLBACK.
COMMIT;
```

Reversing re-creates the defect for those members. It is a way out of a mistake,
not a resolution.

---

# B. Fixed-savings ledger backfill

## B1. What it fixes

Creating a fixed savings plan debits `savingsBalance` and should write a
cooperative-ledger entry saying where the money went. That entry did not exist.
Unlike a withdrawal the debit does not move the money into `lockedBalance`, so it
left the member's held total lower with nothing accounting for it.

`forensics.ts` reconciles `savingsBalance + lockedBalance` against completed
`cooperative_transactions` rows, so **every member holding a fixed savings plan
reported as a balance mismatch** — permanently, and correctly. A reconciliation
check that always fails for a whole class of member is a check nobody reads, and
that is the real damage: it hides the mismatches that matter.

The route writes both rows now. This repairs plans that predate the fix.

## B2. Pre-flight — read-only

```sql
SELECT count(*)                                        AS plans,
       count(*) FILTER (WHERE led.id IS NOT NULL)      AS have_ledger_row,
       count(*) FILTER (WHERE led.id IS NULL)          AS missing_ledger_row,
       sum((plan.raw_data->>'amount')::numeric)
         FILTER (WHERE led.id IS NULL)                 AS unaccounted_naira
FROM document_collections plan
LEFT JOIN document_collections led
       ON led.collection_name = 'cooperative_transactions'
      AND led.id = 'fixsav_' || plan.id
WHERE plan.collection_name = 'fixed_savings_plans';
```

Plans the script will refuse, because a ledger entry invented from a malformed
plan would be permanent and wrong:

```sql
SELECT id,
       raw_data->>'memberId' AS member_id,
       raw_data->>'amount'   AS amount
FROM document_collections
WHERE collection_name = 'fixed_savings_plans'
  AND (raw_data->>'memberId' IS NULL
       OR COALESCE((raw_data->>'amount')::numeric, 0) <= 0);
```

## B3. Report only

```bash
npm run backfill:fixsav
```

Check the `Database:` line, then confirm `MISSING a ledger row` matches
`missing_ledger_row` above.

## B4. Apply

```bash
npm run backfill:fixsav -- --apply
```

Safe to re-run by construction: the row id is deterministic
(`fixsav_<planId>`, the same value the live route uses), so the row's existence
*is* the idempotency check. There is no stamp to maintain and no window where a
crash causes a double write.

**It writes no balances.** Only the missing rows, describing debits that already
happened.

## B5. Verify

```sql
-- Should be 0.
SELECT count(*) AS still_missing
FROM document_collections plan
LEFT JOIN document_collections led
       ON led.collection_name = 'cooperative_transactions'
      AND led.id = 'fixsav_' || plan.id
WHERE plan.collection_name = 'fixed_savings_plans'
  AND led.id IS NULL
  AND plan.raw_data->>'memberId' IS NOT NULL
  AND COALESCE((plan.raw_data->>'amount')::numeric, 0) > 0;

-- What was written. `date` must be the PLAN's start date, not today —
-- a ledger records when money moved.
SELECT id,
       raw_data->>'userId'        AS member,
       raw_data->>'amount'        AS amount,
       raw_data->>'date'          AS dated,
       raw_data->>'backfilledAt'  AS written_at
FROM document_collections
WHERE collection_name = 'cooperative_transactions'
  AND raw_data->>'backfillSource' = 'scripts/backfill-fixed-savings-ledger.ts'
ORDER BY 4 DESC LIMIT 20;
```

Then run the admin integrity/forensics check. Members holding fixed savings plans
should stop reporting as balance mismatches — which is the whole point.

## B6. Rollback — clean

Every row the script wrote carries a provenance marker, so the reversal touches
nothing the application wrote:

```sql
BEGIN;

-- Look first.
SELECT count(*) FROM document_collections
WHERE collection_name = 'cooperative_transactions'
  AND raw_data->>'backfillSource' = 'scripts/backfill-fixed-savings-ledger.ts';

DELETE FROM document_collections
WHERE collection_name = 'cooperative_transactions'
  AND raw_data->>'backfillSource' = 'scripts/backfill-fixed-savings-ledger.ts';

COMMIT;
```

No balances were changed, so nothing else needs undoing.

---

## Afterwards

Restore the local stack env so local development and the test suites keep working:

```bash
mv .env.development.local.OFF .env.development.local
```

And consider deleting `.env.local` once finished, rather than leaving production
service-role credentials on disk.
