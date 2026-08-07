# Outstanding work

Everything still to be done, and who is blocking each item.
Written to be handed to a developer as-is.

Last updated after 18 commits of fixes. Type-check clean, 331 tests passing,
production build succeeding.

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

### Savings interest labelling
`cooperatives/(member)/my-savings` displays `{rate}% APR` for fixed savings
plans. Left untouched because it is unknown whether that figure is monthly or
annual. If monthly, the label is wrong in the same way the loan label was.

### Push notifications
Have never worked. The messaging layer was a stub that returned a fake success
id for every send, so nothing was ever delivered while the logs reported
success. Restoring them requires choosing and paying for a notification service.

### A database trigger
`enforce_member_active_on_paid` in `supabase/schema.sql` raises an exception
whenever a cooperative member is written with status `pending` while any payment
exists for them. That blocks refunds, reversals and administrative corrections,
and surfaces as a server error. Confirm whether this is intended.

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

### Atomic money operations
`runTransaction` reads, then replays writes sequentially, with no locking and no
rollback. Two requests arriving together can both pass an "already processed?"
check and both credit the same wallet — reloading a payment confirmation page
twice is enough to attempt it. Roughly 30 money-handling call sites share this.

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

- **Numeric comparisons on unindexed fields compare as text**, so
  `where("amount", ">", 900)` treats `"1000"` as smaller than `"900"`. Affects
  any range filter on a field not promoted to a real column.
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
