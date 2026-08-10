# Next steps

Written 2026-08-10. One page, in order. Work through it at whatever pace suits.

**Nothing here is on fire.** The platform is up and serving. Most of these have
been true for months; they are listed because somebody finally looked, not
because anything is degrading.

---

## The one thing that unblocks everything else

### ☐ 1. Restore Railway access

Everything below is either blocked on this or pointless without it.

**Why it matters more than it looks.** Production is serving a build from
**2026-07-23**. Confirmed three ways: `/api/health` reports that build time, and
`/api/cron/reconcile-fulfilment` (added 2026-08-09) returns **404** while older
routes return 401.

So **three weeks of money-integrity fixes are merged and not running.**
Production still has the double-payout, overdraft and dual-control defects that
were fixed on 2026-08-09 and 08-10. Getting one real deploy out is worth more
than everything else on this page combined.

Deploys have been reporting success because the GitHub Action only checks that
Railway *accepted* the trigger, never that the build finished.

---

## Then, in one sitting, in this order

### ☐ 2. Confirm the deploy actually landed

```
curl -s https://www.easysalesexport.com/api/health
```

`buildTime` must be **later than 2026-07-23**. If it has not moved, the deploy
was accepted and dropped again — stop and investigate before continuing, because
steps 4 and 5 are only safe once current code is live.

### ☐ 3. Rotate the Paystack secret key — *and update Railway in the same sitting*

A live `sk_live_` key sat in `scripts/force-sync.js` from 2026-04-16 to
2026-07-15. Deleting the file did not remove it from git history, and this
repository is public, so it has been readable throughout.

- Paystack Dashboard → Settings → API Keys & Webhooks → Generate New Secret Key
- Update `PAYSTACK_SECRET_KEY` in Railway **immediately** — the old key dies the
  moment the new one is generated, and payments stop until Railway has the new
  one
- Then review the account for transfers or refunds you did not initiate since
  2026-04-16

Rewriting git history is **not** the fix and is not recommended: the key was
exposed the moment it was pushed, so a rewrite changes nothing and breaks every
clone.

Detail: `docs/audit/secret-exposure-2026-08-10.md`

### ☐ 4. Apply RLS — migration `004`

**Only after step 2 passes.** Right now the browser's public key can read and
write every table, which is the largest remaining exposure in the system.

**Do not apply it before a successful deploy.** The browser-side Supabase
readers were moved to server actions on **2026-08-07**, which is *after* the
live build. Applying RLS against the 23 July build returns empty rows
*silently* — paying members shown as non-members, empty notification badges,
broken onboarding. No error anywhere.

Verified on staging 2026-08-07. Keep the one-line rollback at the bottom of the
migration to hand, and pick a quiet hour.

### ☐ 5. Set `CRON_SECRET` and `PRODUCTION_URL` (GitHub repo secrets)

**Only after step 2 passes.** Until they are set, both reconcilers, escrow
auto-release, the email queue and GDPR purge never run.

**Do not set them before a successful deploy.** `release-escrow` exists in the
live build, but its double-credit fix landed **2026-08-08**. Switching the
schedule on now starts an unattended job, against the buggy version, that **pays
sellers twice**. Its being dormant is currently protecting you.

---

## Worth doing, no deadline

### ☐ Enable GitHub secret scanning and push protection

Settings → Code security and analysis. Would have blocked the April push. CI now
runs `gitleaks` on every PR, but push protection stops it one step earlier.

### ☐ Decide whether this repository should be public

It holds a payments platform for a cooperative with ~41,000 users. That may well
be deliberate — it should be a decision somebody has made, rather than a default
nobody revisited.

### ☐ Find out whether the Paystack webhook is firing

No `processed_payments` row in 30 days carries `claimedAt`, which only the
webhook route writes. The reconcilers make its absence survivable; they do not
explain it. Check the delivery log in the Paystack dashboard.

---

## Four questions only you can answer

No clock on any of these. Nothing breaks while they sit.

| | Question |
|---|---|
| ☐ | **`apply-loan` eligibility** gates on `totalContributions`, a lifetime total nothing decrements. Defensible for a loan in a way it never is for a withdrawal — is it the intended rule? |
| ☐ | **Two fixed-savings collections** exist (`COOPERATIVE_FIXED_SAVINGS`, `FIXED_SAVINGS_PLANS`). Plans created through each are invisible to the other. Which is canonical? |
| ☐ | **Three disbursement paths disagree** — one pays the bank, one credits the wallet, one records a status only. Two should stop existing. |
| ☐ | **Loan applications with no rate** predate the 10%/month fix. Backfill, or handle by hand? Do not assume a borrower was told a number that was never stored. |

---

## Deliberately not doing

- **Migration `022`** (JSONB indexes) — measured against production on
  2026-08-10 and **declined**. The tables are far too small for the planner to
  use them. Annotated `DO NOT APPLY` with a re-measure trigger.
- **Issuing `paid_awaiting_refund` refunds automatically** — they are surfaced by
  the reconciler now. Issuing needs Paystack's refund API, integrated by someone
  who can exercise it against a sandbox.
- **Rewriting git history** — see step 3.

---

## Known-incomplete

Named so that silence is not mistaken for coverage.

- **The security review is partial.** Done: secrets, webhook authentication,
  vendor and escrow authorisation, XSS, SSRF, mass assignment, rate-limit
  coverage. Not done: RLS policy design, session and cookie handling, file
  upload validation, dependency vulnerabilities, and ~18 remaining IDOR
  candidates. See `docs/audit/security-review-2026-08-10.md`.
- **`framer-motion` is static in 11 route files** (~100 KB gzipped). A "do we
  need this library" decision, not a patch.
- **399 collection scans have no `.limit()`.** Bounded by a 5,000-row default
  cap, so each is either a hidden truncation or wasted reads. A project.
- **`strictNullChecks: false`** with 2,000+ untyped values. This is *why* two
  dozen defects were invisible to the compiler. Typing the two database adapter
  files is the highest-value long-term change in the repo.

---

## One pattern worth remembering

Nearly every defect found on 2026-08-10 was the same shape: **a guard applied to
one copy of a path and not its sibling.** Three of four vendor writers. One of
two escrow functions. One of four chart imports. One direction of a migration
check. Even the deploy pipeline verified the step next to the one that mattered.

Where you find one, read the sibling.
