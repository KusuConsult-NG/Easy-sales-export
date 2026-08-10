# Outstanding work

Everything still to be done, and who is blocking each item.
Written to be handed to a developer as-is.

Last updated 2026-08-10. Type-check clean, **664 tests passing**, production
build succeeding.

**Everything below is on `main` and none of it is running.** Production serves a
build from 2026-07-23. That single fact outranks every item in this document:
the work is done, merged and unavailable to users. See §0.

## 0. The critical path, in order

Nothing else in this file matters until these are done, and the order is not
cosmetic — steps 3 and 4 are actively harmful if run against the July build.

| # | Step | Why the order |
|---|---|---|
| 1 | **Rotate the Paystack `sk_live_` key** and update Railway **in the same sitting** | Public in git history since 2026-04-16. The old key dies the moment it is rotated, so a gap between the two means an outage. |
| 2 | **Deploy.** Confirm `/api/health` reports a new `buildTime` | Everything below assumes the new code is live. Verify rather than assume — this is exactly how three weeks of fixes came to be merged and not running. |
| 3 | **Apply RLS migration `004`** | Browser readers moved to server actions on 2026-08-07, *after* the live build. Applied against the July build, RLS returns **empty rows silently** — a paying member reads as a non-member, with nothing in the log. |
| 4 | **Set `CRON_SECRET` and `PRODUCTION_URL`** | `release-escrow`'s double-credit fix landed 2026-08-08. Enabling the scheduler before that ships **pays sellers twice**. |

Migrations `019`, `020` and `021` are already applied. `022` was measured and
declined — see `performance-2026-08-10.md`.

---

## 1. You can do these yourself — no technical skill needed

| Task | Where | Why it matters |
|---|---|---|
| Get the 18 commits onto GitHub | See `HOW-TO-GET-THE-COMMITS-ONTO-GITHUB.md` | Nothing else ships until this happens |
| Download `exports/all_users.xlsx` | GitHub → `exports` folder | 41,105 user records. Your safety net if data is missing |
| Check database backups | Supabase → Database → Backups | Retention expires. Tells us what is recoverable |
| Run one query | Supabase → SQL Editor:<br>`select count(*) from public.users;` | Decides whether users were lost, or simply never given logins |
| Take legal advice | — | Separate from the code, and the larger exposure |

---

## 2. Blocked on a decision only you can make

### Business loan at `/loans/apply` — RESOLVED 2026-08-07

Rate confirmed by the business owner: **10% per month**. Implemented in
`src/lib/loan-terms.ts`; applications now store `interestRate`,
`monthlyPayment`, `totalRepayment` and `totalInterest` at submission time.

Two corrections to what this file previously said:

- **Term and amount bounds already existed** in `loanApplicationSchema` —
  3–24 months, ₦1,000–₦5,000,000, with collateral, business details and
  documents required. Only the rate was missing.
- **Applications did not fail.** They were saved silently with no rate and no
  schedule. Any application submitted before this change has no repayment terms
  recorded — see below.

**Term capped at 12 months**, decided 2026-08-07 once the rate and the term were
considered together. The schema previously allowed 24, which had been set before
any rate existed; at 10% per month that would have repaid 2.67× principal.

| Term | Monthly on ₦1m | Total repaid | × principal |
|---|---|---|---|
| 3 months | ₦402,115 | ₦1,206,344 | 1.21× |
| 6 months | ₦229,607 | ₦1,377,644 | 1.38× |
| 9 months | ₦173,641 | ₦1,562,765 | 1.56× |
| 12 months (max) | ₦146,763 | ₦1,761,160 | 1.76× |

At the ₦5,000,000 ceiling over 12 months: ₦8,805,799 repaid.

**One thing still needs a decision:**

- **Existing applications have no terms.** Records created before this change
  carry an amount and a term but no rate. Decide whether to backfill them at
  10%/month or leave them for manual handling; do not assume the borrower was
  told a number that was never stored. Any with a term above 12 months predates
  the cap and needs handling either way.

### Savings interest — RESOLVED 2026-08-07: annual, as the code has it

`cooperatives/(member)/my-savings` displays `{rate}% APR` for fixed savings
plans. Confirmed correct. Savings interest is **14% per year**:

```js
// src/app/api/cooperative/create-fixed-savings/route.ts
const interestRate = 14; // 14% annual interest for fixed savings
const projectedProfit = (amount * interestRate * (durationMonths / 12)) / 100;
```

The `/12` is annual simple interest pro-rated by months. Label and calculation
agree; nothing to do.

Recorded because the question is easy to reopen by mistake. Loans are monthly
and savings are annual, so anyone moving between the two will feel like one of
them must be wrong. It is not. For scale, had savings been monthly, ₦1,000,000
over 12 months would pay ₦1,680,000 rather than ₦140,000 — which is why this
was confirmed rather than inferred.

### Marketplace payout — RESOLVED 2026-08-10: wallet credit at 100%

Sellers are paid the **full amount as a wallet credit** when an admin releases
the escrow. The 2.5% commission and the Paystack bank-transfer route in
`confirmDeliveryAction` are a **rejected** model — do not wire that function up.

Accepted consequence: **no commission is taken on marketplace sales.** If that
is ever revisited, it belongs on `releaseEscrowFunds`, and two questions the old
code never answered come with it: where the withheld percentage goes (it
credited nobody), and whether it is recorded as revenue. See
`marketplace-payout-2026-08-10.md`.

### Repaying a loan from savings — RESOLVED 2026-08-10: the ₦5,000 floor applies

A member may not repay themselves below the minimum balance. Built, and the
floor is now shared with the withdrawal route via `src/lib/cooperative-limits.ts`
rather than declared separately in each.

### `interestRate` means different things on different records

A trap worth knowing before touching either area. `interestRate` is a **monthly**
percentage on loans (see `src/lib/cooperative-tiers.ts`) and an **annual** one on
fixed savings plans. Same field name, same value range, different meaning. Any
shared formatter or report that treats them alike will be wrong for one of them.

### Push notifications
Have never worked. The messaging layer was a stub that returned a fake success
id for every send, so nothing was ever delivered while the logs reported
success. Restoring them requires choosing and paying for a notification service.

### A database trigger — FIXED 2026-08-07 (migration 008)

`enforce_member_active_on_paid` blocked far more than intended. It checked for
**any** payment by the user anywhere on the platform — wallet top-ups,
marketplace purchases, academy fees — and fired on **INSERT** as well as UPDATE.
A cooperative application starts at `pending`, so anyone who had ever paid for
anything could not apply to the cooperative at all. There was also no path for a
refund, reversal or admin correction; support could not fix a mistake without
dropping the trigger.

Migration `008` keeps the intent — a paid-up member should not be silently
reverted — and removes the false positives:

- UPDATE only; applications may start at `pending`
- Only a real downgrade (`active`/`paid` → `pending`)
- Only `type = 'contribution'` payments count as cooperative dues
- `raw_data.statusChangeReason` permits and records an override, so the rule is
  "say why", not "you may not"

Note this also mattered for the wallet work: `debit_wallet_once` (005/006) now
writes a `processed_payments` row for every marketplace checkout, where checkout
previously wrote none. Under the old trigger that would have caught more users
once deployed, not fewer.

**Verified on staging, 2026-08-07.** A user holding a marketplace payment but no
cooperative contribution could be inserted at `pending` — which the old trigger
refused — and a member with a real `contribution` on record still raised on an
unexplained downgrade. Both halves confirmed: the false positive is gone and the
protection is intact.

---

## 3. Ready to build — no input needed

### Phase 2b — enable row-level security *(highest value)*
No table has row-level security and the browser holds a publicly visible key, so
that key can currently read and write every table without anyone signing in.

The code side is now done. An earlier revision of this file claimed it already
was, which was wrong: three polling hooks — `useMembershipStatus`,
`usePendingApplicationStatus` and `useUnreadNotifications` — were still reading
Supabase with the anon key, on the academy and wave dashboards, four onboarding
pending pages, and the notification badge on every dashboard. They now go
through server actions. Verify before applying, rather than trusting this
paragraph:

```
grep -rn "from ['\"]@/lib/supabase['\"]" src/     # expect only supabaseAdmin
```

What remains is applying `supabase/migrations/004_enable_row_level_security.sql`
(Option A — step 1 only, policies left commented out) and confirming the anon
key can no longer read anything.

**Verified on staging, 2026-08-07.** A staging Supabase project now exists (see
`docs/staging-setup.md`), and this migration was applied and exercised there:

- 9 tables report `rowsecurity = true`, with 0 policies attached — Option A,
  deny-all, as intended.
- The anon key returns `[]` from `/rest/v1/users`. The public key can no longer
  read the database.
- The app was run against staging and exercised: sign-in, dashboard, the
  notification bell and unread badge, wallet balance, the academy and wave
  member dashboards, and the onboarding pending pages all loaded correctly.

That last point is what proves Option A is genuinely complete. Failures here are
silent — RLS with no policy returns zero rows rather than raising — so a missed
browser reader would have shown as a paying member reported as a non-member, not
as an error in the log. Nothing of the kind appeared.

**Still to do:** apply to production during a low-traffic window, keeping the
one-line rollback at the bottom of the migration to hand. Production is a
different database with real row volumes; staging proves the mechanism, not the
data.


### The cron endpoints were never scheduled

Found 2026-08-09, while tracing why eight paid cooperative registrations were
never fulfilled.

`src/app/api/cron/` contains four endpoints written to run on a schedule.
**Nothing scheduled them.** There is no `cron` block in `railway.json`, no
`vercel.json`, and no workflow that called them. They existed as HTTP endpoints
that nothing invoked.

| Endpoint | What its absence meant |
|---|---|
| `reconcile-paystack` | The safety net for payments the webhook missed. It would NOT have caught the eight unfulfilled registrations — see the correction below. |
| `release-escrow` | Escrow auto-release. Without it a seller is paid only when the buyer explicitly confirms delivery; otherwise funds sit in escrow indefinitely. |
| `process-email-queue` | Queued mail sent only when something else happens to drain the queue. |
| `gdpr-purge` | Data retention — a legal obligation rather than a convenience. |

`.github/workflows/scheduled-jobs.yml` now invokes all four. **It does nothing
until two repository secrets are set:** `CRON_SECRET` (matching what the app
checks) and `PRODUCTION_URL`. Until they are, every run fails loudly at a
preflight step rather than silently no-opping — a scheduler that quietly does
nothing is how this went unnoticed.

### Correction: reconcile-paystack would not have caught the eight

Claimed above, and in PR #53, that this job was the safety net that would have
caught the eight unfulfilled cooperative registrations. **That was wrong**, and
running it proved it.

First run, 2026-08-09 23:18 UTC, against production:

```json
{"status":"ok","paystackTotal":215,"firebaseTotal":1221,
 "missingInFirebase":[],"discrepancies":0,"durationMs":43442}
```

Zero discrepancies — over a 30-day window that contains eight registrations
known to be broken, because they had been repaired by hand hours earlier.

The reason is structural. The job compares **payment references**: Paystack's
list of successful transactions against `processed_payments`. All eight had
their `processed_payments` row; the payment was recorded correctly. What was
missing was the `cooperative_members` row. A payment that is *recorded but not
fulfilled* is invisible to a reference-level comparison.

**The real gap is that nothing reconciles FULFILMENT.** Every check in this
codebase asks "was the payment recorded?", and none asks "did the thing the
payment paid for actually happen?" A fulfilment reconciler would join
`processed_payments` to the artefact each payment type should have produced —
the shape of the SQL used to find the eight:

```sql
SELECT p.id, p.raw_data->>'type'
FROM processed_payments p
WHERE p.raw_data->>'type' = 'cooperative_membership_registration'
  AND p.raw_data->>'status' = 'completed'
  AND NOT EXISTS (SELECT 1 FROM cooperative_members m WHERE m.id = p.user_id);
```

...and equivalently for marketplace orders (an order at `escrow_held`), academy
enrolments, export investments and farm-nation purchases.

**Built 2026-08-10** — `src/app/api/cron/reconcile-fulfilment/route.ts`. It
scans each payment type for the artefact that payment should have produced, and
reports `incompleteScans` and `refundsOwed` rather than reporting a clean run it
cannot vouch for. Like everything else here it is **not live**: the endpoint
returns 404 on production, because production is the July build.

The good news from the same run: 215 Paystack transactions and zero unrecorded,
so the client-callback path has been recording payments reliably even with the
webhook apparently silent.

Note what this does NOT settle: whether the Paystack webhook is reaching
`/api/webhooks/paystack` at all. No `processed_payments` row in 30 days carries
`claimedAt`, which only that route writes. The reconciliation job makes the
webhook's absence survivable; it does not explain it. That still wants checking
in the Paystack dashboard.

### Atomic money operations — COMPLETE as of 2026-08-10
`runTransaction` reads, then replays writes sequentially, with no locking and no
rollback. Two requests arriving together can both pass an "already processed?"
check and both credit the same wallet — reloading a payment confirmation page
twice is enough to attempt it. Roughly 30 money-handling call sites shared this.

Every one is converted. `docs/audit/integrity-sweep-2026-08-10.md` closes the
last of them, including the items both audit documents had recorded and
deliberately left. **Migrations 020 and 021 must be applied to production**
alongside 019.

Two things found in that sweep are worth carrying forward:

- Four of the defects were **a path fixed in one copy and left in another**, and
  in three cases the fixed copy was the one nothing calls. Search for a second
  door before calling a defect fixed.
- Two were found by trying to write a test, not by reading code — including two
  cooperative forms whose validation **no input could satisfy**, so contributions
  and loan applications failed 100% of the time. A grep finds a shape; only
  execution finds a rule that nothing can satisfy.

Fix: one Postgres function per money-moving flow, claiming the reference and
applying the balance change in a single statement.

### Client bundle size
12 MB of JavaScript, with single chunks up to 469 KB, and 188 MB of server
output. Splitting the heavy libraries — PDF rendering, charts, maps, QR scanning
— so they load only on the pages that use them. This is the second half of the
slowness.

### Per-screen pagination
415 of 516 database reads specify no limit. A default cap now stops any single
query reading an entire table, and logs the collection by name when it truncates.
Individual screens still need real "next page" behaviour; the logs will name the
worst offenders in production.

---

## 4. For whoever takes the codebase on

- ~~**Numeric comparisons on unindexed fields compare as text**~~ — FIXED
  2026-08-08. `raw_data->>'field'` yields TEXT, so `where("amount", ">", 900)`
  compared `'1000' > '900'` lexicographically and silently skipped every amount
  beginning with a digit below 9. Ordering comparisons against a number now cast
  the extracted value to `::numeric`. Dates are deliberately not cast — ISO-8601
  strings already sort correctly as text, and a cast would fail outright.
- **Date sorting uses row-insert time**, not the real date. For migrated records
  that is the migration timestamp for every row, so ordering is effectively
  arbitrary. Fixing it needs a data backfill.
- **Type checking is disabled** (`strictNullChecks: false`, `noImplicitAny:
  false`) with over 2,000 untyped values. This is *why* two dozen defects were
  invisible to the compiler and reached production. Typing the two database
  adapter files is the single highest-value long-term change.
- **Eighteen files exceed 1,000 lines**, `admin.ts` at 5,473 with 40 exported
  actions.
- **Cloudinary deletions are not implemented**, so removed files accumulate.
- **Cloudinary signatures use SHA-256**, while the service default is SHA-1.
  Works only if the account is configured for it — worth confirming.
- **`COLLECTIONS` is defined twice** (`lib/types/firestore.ts` and
  `packages/config`), 117 constants duplicated. They currently agree.

### Tests that report coverage they do not have

The single most useful thing a new maintainer could know about this suite.

**Five assertions were found vacuous on 2026-08-10 alone** — each looked like it
was checking something, passed, and would have passed against the defect it named:

| What made it vacuous | Where |
|---|---|
| Read the mock's first argument (`docId`) instead of the patch | WAVE earnings credit |
| `data()` resolved lazily, so a *pre*-claim snapshot returned *post*-claim values | escrow order completion |
| Fixture gave every session `roles: ['admin']`, so the "stranger" was an admin | cooperative loan repayment |
| Detector required an `Action` suffix, hiding a live implementation | escrow lifecycle audit |
| Import counting defeated by barrel files | UI-wiring audit |

**Every one was caught by reverting the fix and re-running, never by reading the
test.** So: on any money path, prove the test fails against the old code before
trusting it. A companion positive assertion — "and it *does* happen in the good
case" — catches most of these for the cost of one extra `it()`.

`action-security-audit.test.ts` has the same weakness at a larger scale. It
checks that an action *file* imports `requireSession`, which is file-level: a
file can import the guard and contain functions that never call it. That is
precisely how the vendor IDOR defects survived it. A per-function check is worth
building.

---

## 5. Already fixed — for reference

Twenty-four defects across 18 commits. The ones that were breaking things daily:

- Cooperative contribution payments threw on every attempt after members were
  charged
- Every server-side file upload threw; images and certificates were never stored
- Saving a new record silently did nothing while reporting success
- The notification bell crashed every page for anyone with a notification
- Financial totals under-reported past 1,000 records
- "Total transactions" showed a sum of money instead of a count
- The unread-message badge counted every conversation on the platform and
  downloaded them to every browser
- Login depended on a Firebase credential that no longer does anything
- The loan interest rate was 10% per year while labelled, and intended, as 10%
  per month; the borrowing limit allowed six times more than intended
- The Railway build ran out of memory
- Browser code could read and write the entire database
