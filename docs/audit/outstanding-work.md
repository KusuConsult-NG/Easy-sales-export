# Outstanding work

Everything still to be done, and who is blocking each item.
Written to be handed to a developer as-is.

Last updated 2026-08-14. Type-check clean, **2,032 tests passing** on `main`,
production build succeeding.

**Everything below is on `main` and none of it is running.** Production serves a
build from 2026-07-23. That single fact outranks every item in this
document: the work is done, merged and unavailable to users. See §1.

Two findings from 2026-08-14 sharpen that sentence, which is why they now sit
above the critical path. Their fixes are on `main` and not running, like
everything else — but the *defects* they fix are in the build production is
serving today. For the rest of this file, not deploying means users do not get
an improvement. For these two, not deploying means the hole stays open.

## 0. Live in production right now

Everything else in this file is a fix waiting to ship. These two are holes
waiting to be used: the first open since 2026-06-20, the second since
2026-05-17. Both fixes are merged — #192 and #191 — and neither is deployed, so
both holes are open right now.

### Payments are verified by a mock — fixed in #192, not deployed

`verifyPaystackPayment` in `src/lib/paystack-server.ts` opened with a test
bypass whose trigger was `reference.startsWith('T')`. Paystack issues references
of the form `T` + fifteen digits; production records carry three of them
(`T457550806738035`, `T232223621495674`, `T750250345181632`), all on cooperative
membership records, alongside card-checkout references in Paystack's other form
(`583fq11y9g`, `9bvszibs1d`). Which form a payment gets is Paystack's to decide.

For any reference in the first form the function returned, without contacting
Paystack at all:

```
status: 'success', amount: 5000000 kobo (₦50,000),
metadata: { userId: <the CALLER'S own session id>, type: 'academy_registration', amount: 50000 }
```

Wrong in both directions:

- **Money in.** The amount returned is 5,000,000 kobo whatever was charged, so a
  member paying the ₦10,000 cooperative registration fee is verified as having
  paid ₦50,000. Which stored rows this actually produced is the open question in
  §3; that it does so is not in question.
- **Money for nothing.** Invent a string beginning with `T`, hand it to any of
  the dozen verify paths — cooperative contribution and registration, academy
  enrolment, marketplace escrow, farm-nation purchase, export investment — and
  the platform records a successful ₦50,000 payment and fulfils against it.

The identity and amount checks written to catch exactly this did not fire. They
are real checks — `verifyContributionPaymentAction` compares
`metadata.userId` to the session, bounds the amount, and compares the charge to
`metadata.amount` — but the mock read the session and echoed the id back, so the
identity check compared the caller to themselves, and it set `data.amount` to
5,000,000 kobo and `metadata.amount` to 50,000, so the amount check agreed with
itself. **A stub that answers every question consistently passes every
consistency check.** That is §5's vacuous-assertion problem, in production code
rather than in a test.

It arrived in `a51213fa` on **2026-06-20** ("complete phases 1-8 recovery and
phase 9 E2E test fixes"), so it is in the July build. Removed rather than
narrowed, because nothing used it: `PLAYWRIGHT_TEST` appeared exactly once in
the repository — in that condition — no e2e spec sends a `TEST_E2E_REF_`, `E2E_`
or `INVALID_REF` reference, and all eight unit tests touching a payment path
already `jest.mock('@/lib/paystack-server')`, which is how it stayed hidden.

**Do first:** deploy (§1 below) — this is the item that makes the deploy
urgent rather than merely overdue — then read the record question in §3.

### The broadcast estimate answered anyone — fixed in #191, not deployed

`/api/admin/broadcast/estimate` opened with:

```js
const isTest = req.nextUrl.searchParams.get("debug") === "antigravity";
if (!isTest) { ...requireSession + isAdmin... }
```

so `POST /api/admin/broadcast/estimate?debug=antigravity` ran with no session.
The middleware does not cover it — `PROTECTED_PATHS` gates `/admin`, and this
path starts with `/api` — so the route's own check was the only one there was.
An anonymous caller got the size of any audience they chose, the module
breakdowns, and a sample of **five real names and email addresses**, plus a full
collection scan under the route's 300-second budget, as often as they liked.

In the repository since **2026-05-17**, so this one is in the July build too.

This is the defect #154 removed from `getCleanBroadcastListAction`, where
`process.env.ADMIN_OVERRIDE === "true"` skipped the same check on the same data.
That commit closed with "every caller ... the two `/api/admin/broadcast` routes
— so nothing legitimate changes", which took the routes' own guards as given.
One of them had a switch of its own, and a query parameter is the worse of the
two: `ADMIN_OVERRIDE` needed deploy access, `?debug=antigravity` needed a URL.

**The lesson is the one §4 already records** — *search for a second door before
calling a defect fixed* — and the specific door to check is a guarded helper
that a route imports and does not call. This route imported
`previewBroadcastAction` and called the unguarded `getCleanBroadcastList`
directly, which is exactly why the earlier fix missed it.

---

## 1. The critical path, in order

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

## 2. You can do these yourself — no technical skill needed

| Task | Where | Why it matters |
|---|---|---|
| Get the 18 commits onto GitHub | See `HOW-TO-GET-THE-COMMITS-ONTO-GITHUB.md` | Nothing else ships until this happens |
| Download `exports/all_users.xlsx` | GitHub → `exports` folder | 41,105 user records. Your safety net if data is missing |
| Check database backups | Supabase → Database → Backups | Retention expires. Tells us what is recoverable |
| Run one query | Supabase → SQL Editor:<br>`select count(*) from public.users;` | Decides whether users were lost, or simply never given logins |
| Take legal advice | — | Separate from the code, and the larger exposure |

---

## 3. Blocked on a decision only you can make

### What the payment mock wrote — UNANSWERED, added 2026-08-14

Follows from §0. Every `processed_payments` row created through
`verifyPaystackPayment` between 2026-06-20 and the deploy of PR #192 carries an
amount the mock supplied — ₦50,000 — rather than one Paystack confirmed. Some of
those rows are real payments recorded at the wrong figure. Some may be
fulfilments nobody paid for at all.

**Why no existing job will tell you.** `reconcile-paystack` compares payment
*references*: Paystack's list of successful transactions against
`processed_payments`. A row written for a reference Paystack really did charge
reconciles cleanly no matter what amount we stored beside it. And a row written
for a reference Paystack never issued is invisible to it for a structural
reason: the job iterates **Paystack's** transaction list
(`for (const tx of allPaystackTransactions)`) and reports what is missing on our
side. A reference Paystack never issued is not in that list, so the loop never
reaches it. `reconcile-fulfilment` asks the opposite question — did the artefact
get created — and a mock-verified payment produces a real artefact, so it passes
too. Neither job compares **amounts**, which is the only thing that would show
this.

The shape of the check that would:

```sql
-- Candidates: everything the mock could have written, at its one amount.
-- processed_payments has no native created_at; the claim writes an ISO-8601
-- 'processedAt' into raw_data, which sorts correctly as text.
SELECT p.id, p.user_id, p.reference, p.amount,
       p.raw_data->>'type', p.raw_data->>'processedAt'
FROM processed_payments p
WHERE p.raw_data->>'processedAt' >= '2026-06-20'
  AND (p.amount = 50000 OR p.reference LIKE 'T%')
ORDER BY p.raw_data->>'processedAt';
```

Then take that reference list to the Paystack dashboard and compare, one by one:
does the transaction exist, and was the amount the same? Three outcomes, and
each is a different decision:

| Paystack says | Means | Decision needed |
|---|---|---|
| No such transaction | Fulfilled without payment | Reverse it, or absorb it |
| Exists, different amount | Under- or over-credited | Correct the record; refund or invoice the difference |
| Exists, same amount | Coincidence — genuinely a ₦50,000 payment | Leave alone |

**This is an operations task against production data, not a code change**, and
the judgement in the third column is yours. Do it after PR #192 is deployed, so
the list stops growing while you work through it.

One thing that makes it smaller than it sounds: the mock's amount was a fixed
₦50,000, which is not a price anything on the platform charges — cooperative
registration is ₦10,000. A stored ₦50,000 against a product that costs something
else is the strongest single signal in the data.

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

## 4. Ready to build — no input needed

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

### ~~Client bundle size~~ — MEASURED 2026-08-11, nothing to do

This previously read: *"12 MB of JavaScript, with single chunks up to 469 KB…
Splitting the heavy libraries — PDF rendering, charts, maps, QR scanning — so
they load only on the pages that use them. This is the second half of the
slowness."*

**The splitting is already done, and the 12 MB is a number no user downloads.**
It is the sum of every chunk across 361 routes. Measure with
`node scripts/measure-bundle.mjs`:

| | gzip |
|---|---|
| Baseline every user pays, on any page | **289 KB** |
| Heaviest route-specific chunk (QR scanner) | 115 KB |
| PDF generation, charts, maps, image capture | own chunks, load only where used |

The 289 KB is React, the Next App Router client and Sentry's browser SDK —
framework floor, not application weight. Removing `replayIntegration` was tried
and changed it by **nothing**, because Sentry already loads Replay separately.

The trap worth remembering is `lucide-react`: **432 KB across 252 chunks, never
more than 9 KB in any single one.** It tree-shakes, so each route pays only for
its own icons. A per-package total is not a download size, and optimising that
figure would have been optimising an illusion.

`jspdf` has one static import — in `src/app/api/id-card/pdf/route.ts`, which is
a server route and never reaches the browser.

If page weight is ever suspected again, measure first: the script prints what a
user actually receives, and Next 16 no longer reports per-route sizes in the
build output.

### Per-screen pagination
415 of 516 database reads specify no limit. A default cap now stops any single
query reading an entire table, and logs the collection by name when it truncates.
Individual screens still need real "next page" behaviour; the logs will name the
worst offenders in production.

---

## 5. For whoever takes the codebase on

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

**The same failure can live in production code.** The payment mock in §0 is this
table's sixth row, promoted: it answered every question about a payment
consistently — echoing the caller's own user id back, and setting the charge and
the metadata amount to agree — so the identity and amount checks written to
catch a forged payment all passed against it. A vacuous *assertion* passes
because the test asks nothing; a vacuous *dependency* passes because it answers
everything. Both look like coverage.

It is also why mocking is not free. All eight unit tests that touch a payment
path do `jest.mock('@/lib/paystack-server')`, so no test in the suite had ever
executed the first ten lines of `verifyPaystackPayment`. The new
`paystack-verify-no-mock.test.ts` deliberately does not mock that module — it
stubs `fetch` instead, one layer lower — which is the only vantage point from
which the bypass is visible. **On any module that is universally mocked, keep
one test that isn't.**

---

## 6. Already fixed — for reference

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
