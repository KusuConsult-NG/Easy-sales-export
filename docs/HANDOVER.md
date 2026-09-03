# Audit handover

Written for whoever picks this up cold. Everything here is measured; where it
is an estimate it says so.

## 1. Where the work lives

Two audits ran against this repository in parallel, on branches that never saw
each other.

| branch | commits | findings | state |
| --- | --- | --- | --- |
| `claude/easy-sales-export-audit-voajzc` | 100 | #151–#344 | pushed, no PR |
| `claude/academy-email-bugs-6iktdu` | 19 | #227–#368 (31 numbers) | pushed, no PR |

Neither is merged to `main`. **They do not merge cleanly** — 15 conflicting
files, listed in §3. That is the single blocker on shipping any of this.

`docs/audit-finding-reconciliation.md` is the companion to this file: it maps
the ten colliding finding numbers and gives per-file merge guidance. Read it
before touching §3.

## 2. What is verified, and how

| suite | tests | how to run | notes |
| --- | --- | --- | --- |
| unit | 7,612 / 376 suites | `npm test` | runs against a hand-written fake |
| real Postgres | 59 | `./scripts/local-postgres.sh start` then `npm run test:pg` | needs no credentials |
| db-integration | 148 (140 pass, 8 skip) | `./scripts/local-supabase-rest.sh start` then `npm run test:db` | no Docker needed |

The last two had **never executed** before this session. Both harnesses turned
out to have something wrong the moment they first ran (#367, #368). Treat "the
suite is green" as meaning nothing until you have checked the suite runs.

The 8 skips are `auth-shim-pagination`, which needs GoTrue. Use
`scripts/ci-integration-db.sh` (full Supabase stack, needs Docker) for those.

## 3. The merge, file by file

15 conflicts. Eight have a documented resolution; the rest are ordinary.

| file | resolution |
| --- | --- |
| `app/actions/land-actions.ts` | **take academy-email-bugs.** Their #340 gates on a *named* status; calling `getLandListings()` with no argument still returns every status to an anonymous caller. Ours closes that. |
| `app/actions/auth.ts` | **both.** Theirs fixes `getPostLoginRedirect` + `registerAction` open-redirect; ours fixes the takeover, enumeration and timing. Different regions, but overlapping — merge by hand and re-run `register-enumeration.test.ts`. |
| `app/actions/course-actions.ts` | **ours**, which publishes the payload under both `courses` and `enrollments` so their assertions pass unchanged. |
| `app/actions/cooperative/_coop_registration.ts` | **both**, then rename one of the two independently written `cooperative-registration-behaviour.test.ts`. |
| `app/actions/cooperative/_coop_money.ts` | **both.** Ours only adds `cooperativeId` to the withdrawal write. |
| `__tests__/unit/land-listing-visibility.test.ts` | **converged** — both now assert the same guard. Take either. |
| `__tests__/unit/auth-actions-behaviour.test.ts` | **ours.** Theirs still pins `listUsers()` being called, which is the account-takeover mechanism. |
| `__tests__/pg/fake-db-matches-postgres.test.ts` | **ours** (#367). Theirs omits the adapter's own `order by id`. |
| the other 7 | ordinary content conflicts, no policy attached |

**Also take theirs, unconditionally:**

- their #343 — `lib/auth.ts`. Two casts hiding dead branches; session revocation never fired. Ours does not have this fix.
- their #252/#256 — 15 `revalidateTag(tag, "page")` call sites that **throw**
  after their write commits. `"page"` is not one of Next's seven profiles.
  Verified independently: `revalidation-utils.js:111` throws `E873`. Ours still
  has these.
- their #262, #265, #302, #336 — see the reconciliation doc.

## 4. Known, deliberately not fixed

Each of these is a decision, not an oversight. All are recorded in code.

| item | why it was left |
| --- | --- |
| `registerAction` still says "already registered" for a **known** owner | only reachable by someone who proved the password |
| timing side-channels beyond the response floor | TLS, CDN and auth-provider variance are outside the handler |
| `firebase-admin` in `devDependencies` while production code imports it | packaging decision; a `file:` path in-repo either way |
| lesson-progress row id is `userId_lessonId`, not `userId_courseId_lessonId` | changing it orphans every existing row — a migration, not an edit |
| `CourseProgressCard.tsx` renders nowhere; its "View" button navigates nowhere | in the unreferenced-component bucket the other audit was told to leave |
| withdrawal IDOR guard is unreachable today | ratcheted: a test fires if `finance:process_withdrawals` reaches a scopeable role |

One behaviour change worth flagging to whoever ships: **registration no longer
auto-logs-in.** Everyone lands on the login page. That was required to close
the enumeration oracle — a generic message alone did not, because the client's
`signIn()` outcome still revealed the answer.

## 5. What is left

709 files need work: 586 never executed, 123 partially covered.

| layer | never run | partial | uncovered stmts |
| --- | --- | --- | --- |
| Server actions | 7 | 61 | 4,321 |
| API routes | 99 | 7 | 4,472 |
| lib | 24 | 45 | 2,140 |
| services/infra | 1 | 7 | 781 |
| Components | 104 | 2 | 3,801 |
| Pages/layouts | 268 | 0 | 15,726 |

Highest value first — biggest uncovered backend files:

| file | coverage | uncovered |
| --- | --- | --- |
| `lib/supabase-db.ts` | 58.53% | 357 |
| `services/analytics.service.ts` | 27.02% | 289 |
| `infrastructure/payments/service.ts` | 38.18% | 204 |
| `app/actions/admin/_exports.ts` | 54.7% | 178 |
| `app/actions/cooperative/_loans_applications.ts` | 55.88% | 150 |
| `app/api/cron/release-escrow/route.ts` | 18.64% | 144 |
| `app/actions/export/_ex_onboarding.ts` | 52.49% | 143 |
| `app/actions/admin/_marketplace.ts` | 68.49% | 132 |
| `app/actions/in-app-broadcast.ts` | 64.34% | 128 |
| `lib/auth.ts` | 39.04% | 128 |
| `app/actions/bulk-user-operations.ts` | 49.38% | 124 |
| `app/api/admin/finance/paystack-sync/route.ts` | 0% | 119 |
| `app/actions/marketplace/_mp_catalog.ts` | 59.09% | 117 |
| `app/actions/wave/_wv_admin_applications.ts` | 69.02% | 114 |
| `app/api/cron/reconcile-paystack/route.ts` | 0% | 113 |

**Estimate.** Both audits ran at ~2 files per commit (100 commits/210 files;
19/45). Backend only (251 files) is ~165 commits; everything is ~245. The file
counts and the rate are measured; the mapping to wall-clock is not.

## 6. Two things to know before continuing

**The finding rate has not dropped.** Every file opened in the last session
produced at least one defect, three security-relevant. A flat rate means the
remaining defect count is unknown — the numbers above estimate *coverage*, not
*defects*.

**Coverage is not correctness.** `_coop_admin_money.ts` sat at 47% and still
had a live cross-tenant authorization hole. The db-integration suite was 16
well-written files that had never run. Getting a file to 80% does not retire it.

## 7. The method, if you want the findings to keep being real

Four rules, each of which caught something in this codebase:

1. **Prove it by execution, not by reading.** Several confident findings
   dissolved on checking — the withdrawal IDOR is latent, not live; the stale
   Firebase password cannot log anyone in.
2. **Mutation-test every fix.** Break the fix; a test must fail. Five mutants
   survived in the last session, each revealing a test that asserted nothing.
3. **When a fix is applied in one place, find its twin.** This is the dominant
   defect shape here: a rule correct in eleven call sites and wrong in the
   twelfth; a helper used on one branch and not the one ten lines above.
4. **A partial module mock is a trap.** Four times a mock covering two thirds
   of a module's surface failed inside a generic catch and read as a defect in
   the code under test. Use `jest.requireActual` and override one function.
