# Integrity sweep, 2026-08-10 — findings

Extends the work in `atomic-money-migration.md`.

**Round 1** (below) — six findings from fresh sweeps, all fixed.
**Round 2** (at the bottom) — the recorded-but-open list from both audit
documents, cleared, plus one live breakage found while writing fixtures.

Two questions remain that need a decision rather than a patch. See the status
table.

That document ends with the priority table emptied and warns why an empty table
is not the same as a clean codebase: the sweeps that built it grepped for money
*vocabulary* and for `runTransaction`, so they cannot see a money path that uses
neither. Every finding below sits in exactly that blind spot.

## How these were found

Three sweeps that had not been run before, aimed at the new primitives being
**misused or bypassed** rather than absent:

| Sweep | Question | Result |
|---|---|---|
| A | Is a claim's return value ever discarded? | clean — see below |
| B | Is any idempotency reference unstable across retries (rule 2)? | clean |
| C | Bound check followed by `FieldValue.increment` of the checked field | **F4**, plus one minor |
| D | Claim result bound but never inspected | **clean — all 126 call sites inspect it** |
| E | `creditWalletOnce` status correct per rule 4 (revenue) | **clean — all 4 sites correct** |
| F | Balance moved outside `wallet-ledger` | clean — all 7 sites are behind a claim and dual-synced by 010 |
| G | API routes touching money with no claim primitive | **F1, F2, F3** |

Sweep G is the one that paid. `atomic-money-migration.md` already records why —
the fourth loan-approval door was an API route, and `mark-withdrawal-completed`
had no wrapper at all ("a wrapper is not the disease; its absence is not
health"). Both sweeps in that document still keyed off server actions.

The clean results are worth as much as the findings: rules 2, 3 and 4 hold
everywhere they apply, and no claim in the codebase is decorative. What is
missing is claims that were never added to a *second* copy of a path.

---

## F1 — The fixed-savings fix went into the door nobody uses

`src/app/api/cooperative/create-fixed-savings/route.ts:80`

`atomic-money-migration.md` records `_createFixedSavingsAction` as fixed: it
takes the debit through `debitJsonbBalance` under a row lock
(`cooperative/_actions.ts:1336`, `field: "savingsBalance"`).

**The UI does not call it.** `cooperatives/(member)/fixed-savings/page.tsx`
posts to this API route, and `createFixedSavingsAction` has no caller outside
its own re-export in `cooperative/index.ts`. The fixed path is dead code; the
live path is this one, unchanged:

```js
const currentBalance = userData.savingsBalance || 0;
if (currentBalance < amount) { throw new Error("Insufficient savings balance..."); }
transaction.update(memberRef, {
    savingsBalance: currentBalance - amount,      // absolute write
    ...
});
```

Two defects, and the second is the worse one:

1. **Overdraft.** Read, check, write inside `runTransaction`, which takes no
   lock. Two plans created together both pass against the same balance. This is
   the exact defect migration `013` exists for.
2. **An absolute write, not `FieldValue.increment`.** So `010` cannot save it —
   `010` only fixes the sentinel, and no sentinel is used. Per the same finding
   in `marketplace/_buyer.ts`, an absolute write does not merely double: it
   **erases any concurrent write to `savingsBalance`**, including a
   contribution's credit landing at the same moment. The member's contribution
   disappears and nothing errors.

### What was changed

**FIXED.** The route takes the debit through `debitJsonbBalance` and the
`runTransaction` wrapper is gone — it queued two writes that the adapter
flushes one at a time regardless, so it was buying nothing. The refusal message
now quotes the balance the debit actually saw rather than the pre-read, which
under concurrency is not the number that caused the refusal.

`src/__tests__/unit/fixed-savings-overdraft.test.ts` — 5 tests, **4 fail against
the pre-fix code**. The fifth asserts the plan is still created on the happy
path, which the old code also did; regression cover, not evidence.

### The consolidation was NOT done, deliberately

The obvious tidy-up is to delete the route and point the page at the server
action. It was left alone because the two are not the same operation:

| | `_createFixedSavingsAction` | this route |
|---|---|---|
| plan collection | `COOPERATIVE_FIXED_SAVINGS` | `FIXED_SAVINGS_PLANS` |
| membership lookup | `where("userId","==",…).limit(1)` | `.doc(userId)` |
| ledger row | none | writes `TRANSACTIONS` |
| stores | rate only | rate, `projectedProfit`, `maturityDate` |

They write to **different collections**, so plans created through the two doors
are invisible to each other, and whichever screen reads one will not see the
other's. That is a data question — which collection holds the real plans, and
whether anything must be migrated — not something to settle inside a
concurrency fix. Recorded here as its own item.

---

## F2 — The withdrawal reservation contract, broken three different ways

**FIXED in `fix-withdrawal-reservation-contract`.** Escalated after writing the
first draft of this section: what looked like one eligibility bug turned out to
be four doors disagreeing about a contract, one of which creates money.

### The contract

`cooperative/_admin.ts` is the only consumer, and it assumes exactly this:

| Moment | savingsBalance | lockedBalance |
|---|---|---|
| request | `− amount` | `+ amount` |
| reject (`:1232`) | `+ amount` | `− amount` |
| approve (`:1081`) | — | `− amount` |

### What each door actually did

| Door | savings | locked | Consequence on reject |
|---|---|---|---|
| `platform.ts` `submitWithdrawalAction` | debited ✓ | `+` ✓ | correct — writes to `WITHDRAWALS`, a different collection |
| `cooperative/_withdrawal.ts` | read-check-write ✗ | `+` ✓ | overdraft at request time (**F6**) |
| `cooperative/_actions.ts` `_submitWithdrawalAction` | debited ✓ | **absent** ✗ | savings restored correctly, `lockedBalance` driven **negative** |
| `api/cooperative/withdraw/route.ts` | **absent** ✗ | **absent** ✗ | **savings credited by an amount never debited** |

The last row is the money defect. A withdrawal requested through that route
reserved nothing at all; when an admin rejected it, `_admin.ts:1232` credited
`savingsBalance += amount` to return funds that had never left. The member's
savings grew by the full withdrawal amount, out of nothing, and `lockedBalance`
went negative in the same write. Nothing errored, and the request looks
completely ordinary in the admin queue.

### F6 — `cooperative/_withdrawal.ts` was a third door onto savingsBalance

Found while mapping the above. It read `savingsBalance`, compared it to the
amount, and decremented — inside `runTransaction`, which takes no lock. The
overdraft defect already fixed on `_submitWithdrawalAction` and `platform.ts`,
still open on a third copy. The file appears nowhere in
`atomic-money-migration.md`.

### The eligibility bug (the original F2)

`src/app/api/cooperative/withdraw/route.ts:76`
`src/app/api/cooperative/apply-loan/route.ts:82`

Both read:

```js
const totalSavings = membershipData.totalContributions || 0;
```

`totalContributions` is a **cumulative lifetime total**. It is incremented on
every contribution (`cooperative/_payment.ts:136`) and feeds
`calculateUserTier`. Nothing decrements it anywhere in `src/` — verified: no
`increment(-`, no `- amount`, no `-=` against that field exists.

The spendable balance is `savingsBalance`, which is what every fixed path
debits.

So a member who contributed ₦100,000 and has already withdrawn ₦90,000 still
reports `totalContributions = 100,000`, and this route authorises another
withdrawal of up to ₦95,000 against money that is gone.

**This is not a race.** It has no concurrency precondition and fires on every
single call. It is the only finding here that is wrong sequentially, which is
why it belongs at the top of the list despite the routes having no UI caller
today — an exported HTTP endpoint is reachable whether or not a page calls it.

Two smaller things in the same file, both secondary to the above:

- The withdrawal request **reserves nothing.** `_submitWithdrawalAction` debits
  `savingsBalance` at request time; this route creates a `pending` row and
  leaves the funds spendable.
- "You already have a pending withdrawal request" is a check-then-write on an
  unlocked read — two requests submitted together both read empty and both
  create. That check is currently the only thing standing in for the missing
  reservation.

### What was changed

- `api/cooperative/withdraw/route.ts` — gates on `savingsBalance`, reserves
  through `debitJsonbBalance`, then increments `lockedBalance`. Debit before
  lock, deliberately: the debit is the step that can legitimately fail, and
  locking first would reserve funds that were never taken. `currentBalance` /
  `balanceAfterWithdrawal` on the request row are now derived from the debit's
  own post-write figure rather than a pre-read, so they agree with what
  happened.
- `cooperative/_actions.ts` — added the missing `lockedBalance` increment.
- `cooperative/_withdrawal.ts` — converted to `debitJsonbBalance`; the
  in-transaction decrement was **removed**, not left alongside, since keeping
  both would take the money twice.

`src/__tests__/unit/withdrawal-reservation-contract.test.ts` — 9 tests, **8 fail
against the pre-fix code** (verified by stashing the source changes and
re-running). The one that passes either way asserts a negative — "locks nothing
when the debit is refused" — which the old code satisfies by never locking
anything at all. It guards against regression rather than proving the fix.

### Still open in this finding

`apply-loan/route.ts:82` gates loan eligibility on the same lifetime figure.
**Left unchanged deliberately** — for a loan, assessing against lifetime
contributions is a defensible business rule in a way it can never be for a
withdrawal, and this is a policy question rather than a defect. If it is the
intended rule it should say so; if it is not, it is the same fix as above.
Needs the business owner's answer, not a patch.

---

## F3 — Cooperative registration verification still does not claim

`src/app/api/cooperative/verify-payment/route.ts:152`

The client-side half of the payment whose webhook half **does** claim:
`processCooperativeRegistration` calls `claimPaymentOnce` and honours
`claim.claimed` (`infrastructure/payments/service.ts:491`).

This route instead reads `processed_payments`, re-reads it inside
`runTransaction`, and writes the marker afterwards:

```js
await db.runTransaction(async (transaction) => {
    const tProcessedDoc = await transaction.get(processedRef);
    if (tProcessedDoc.exists) { return; }        // takes no lock
    ...
    transaction.set(processedRef, { ... status: "completed", ... });   // blind set
});
```

This is precisely the shape `atomic-money-migration.md` describes fixing in
export, academy and farm-nation — "decided whether to fulfil by reading
`processed_payments` and writing the marker afterwards" — left in place on the
cooperative registration path.

**Severity is lower than the equivalents, and it is worth being exact about
why.** Every write in the transaction is keyed on the reference or the user id
(`processedRef`, `TRANSACTIONS/{reference}`, `COOPERATIVE_TRANSACTIONS/{reference}`,
the membership doc at `{userId}`), and `roles` moves by `arrayUnion`, atomic
since `016`. So a concurrent double-run is largely idempotent by construction.
No money is duplicated.

What is actually wrong:

- `transaction.set(processedRef, ...)` **overwrites the row the webhook
  claimed**, including the `claimedAt` marker. That marker is the only evidence
  the webhook ran — and `outstanding-work.md` records that the absence of
  `claimedAt` across 30 days of rows is the open question about whether the
  webhook is firing at all. This route is capable of erasing that evidence.
- It is the last unclaimed fulfilment path of the set, so the invariant "every
  payment path claims before fulfilling" is not yet true, and the next person to
  add a balance change here inherits an unguarded path that looks guarded.

**This is the path of the original incident** — the eight paid cooperative
registrations that were never fulfilled, and it is live
(`cooperatives/payment/callback/page.tsx`). That does not make it the cause;
the reconciler work (#54, #56) already covers detection. It does mean it is the
one to bring in line first.

### What was changed

**FIXED.** `claimPaymentOnce` first, mirroring the academy conversion:

- The claim runs **after** Paystack confirms and the amount is checked, so an
  abandoned or underpaid transaction never consumes the reference.
- `status` is left at its default `"completed"` — this is money in, and rule 4
  runs both ways. Four paths in `atomic-money-migration.md` must *not* record
  `completed`; this is not one of them, and overriding it would quietly drop the
  registration fee out of `platform_revenue_totals()`.
- `source: "client_verify"`, matching the academy path, so the two halves are
  distinguishable in `processed_payments`.
- **The `processed_payments` write is gone.** `claimPaymentOnce` owns that row.
  The blind `set()` was the actual defect.
- The `processedDoc.exists` pre-check is deleted — it was the read half of the
  check-then-write, and leaving it above the claim is how it came to be read as
  protection. The membership fast path **stays**, now documented as a fast path
  rather than a guard: it saves a Paystack round trip for a user re-landing on
  the callback page.
- Its sync work moved onto the `!claim.claimed` branch, which knows for certain
  the payment was applied rather than inferring it from a racy read. Deleting it
  wholesale would have reintroduced a user-visible bug (a user whose webhook
  landed first being told "verification failed" after paying) while fixing a
  concurrency one.
- The `runTransaction` wrapper is gone; it queued writes the adapter flushes one
  at a time regardless. Ledger rows are written last, matching the webhook
  handler's ordering.

`src/__tests__/unit/cooperative-registration-claim.test.ts` — 8 tests, **5 fail
against the pre-fix code**. The three that pass do so for a different reason
rather than by agreement: with no claim primitive in the old code the
lost-claim scenarios cannot be set up at all, so it reaches the same assertions
through its `processedDoc.exists` early return. They are regression cover for
the new branch, not evidence about the old one.

---

## F4 — Export window volume: two doors, neither bounded

`src/app/actions/export-booking.ts:39` and `:61`

```js
const availableVolume = windowData.targetVolume - windowData.currentVolume;
if (data.quantity > availableVolume) { return { error: `Only ${availableVolume}kg available` }; }
...
await windowRef.update({ currentVolume: FieldValue.increment(data.quantity) });
```

Check a ceiling, then raise a counter — with **no transaction at all**, which
is why every sweep in `atomic-money-migration.md` missed the file. It appears
nowhere in that document's tables, because those are ordered by
`runTransaction` count and this file has none.

Two bookings for the remaining volume both pass and the window goes over
`targetVolume`. Migration `010` made this worse rather than better, the same way
it did for escrow, cooperative savings and stock: the increments used to lose
one another, which hid the overshoot.

**Live** — called from `BookingWizard.tsx:126` and `BookingModal.tsx:37`.

### A second door, and it was the worse one

`src/app/actions/export-aggregation.ts:125` — `bookExportSlotAction`, found while
checking whether `targetVolume` was a reliable ceiling:

```js
if (windowData.currentVolume + data.volume > windowData.targetVolume) { return ...; }
...
await windowRef.update({ currentVolume: windowData.currentVolume + data.volume });
```

Same check-then-write on the same counter, but the write is **absolute**, not
`FieldValue.increment`. Migration `010` therefore cannot help it, and the damage
is not confined to overbooking: an absolute write from a stale read **erases any
other write to `currentVolume` in between — including the other door's
increment**. The window then believes less volume is taken than really is, and
the next booking oversells further. Same shape as F1 and the `_buyer.ts`
restock.

No `.tsx` caller today, but it is an exported server action.

### What was changed

**FIXED, both doors.** Each reserves through `incrementWithinCeiling`
(migration `015`) before writing its booking or slot. Reserve-first is
deliberate: the loser is told the volume is gone rather than left holding a
booking against capacity that does not exist — the same ordering as the
farm-nation property reservation.

On the ceiling-name question raised above: `targetVolume` is a **single
vocabulary** here, unlike the `fundingGoal`/`goal` split in `export-payment.ts`.
`export-aggregation.ts:58` creates every window with `targetVolume` and
`currentVolume: 0`. Windows with no `targetVolume` do exist — `admin.ts:936`
treats a missing one as "not crowdfunded" — and `increment_within_ceiling`
leaves those unbounded. **That matches the old behaviour rather than changing
it:** `quantity > (undefined - currentVolume)` is `quantity > NaN`, which is
false, so those windows already accepted every booking.

`src/__tests__/unit/export-volume-overbooking.test.ts` — 11 tests, **8 fail
against the pre-fix code**. Of the three that pass, two are deliberate vacuity
guards (asserting the booking/slot collection *is* reached on the happy path, so
the at-capacity assertions cannot pass by a name typo) and one asserts a closed
window is still refused.

### A harness gap this exposed

`jest.setup.js` had **no stub for `collection().add()`**, so every action that
creates a document that way threw before reaching its later writes. Two of the
tests above passed against the pre-fix code purely because of it — the
`currentVolume` write was never reached, so "never raises currentVolume itself"
held for the wrong reason.

`add` is now stubbed in both mock blocks, recording through a new
`mockFirestoreAdd` global. The pre-fix failure count went from 5 to 8 as a
result: three assertions that looked fine were measuring nothing. All 24 unit
suites (256 tests) pass with the change.

Worth knowing generally: any older suite asserting on an action that uses
`collection().add()` was exercising its error path, not its success path.

---

## F5 — Two of three marketplace order paths still oversell stock

`src/app/actions/marketplace/_payment.ts:825` (bank transfer)
`src/app/actions/marketplace/_payment.ts:978` (payment on delivery)

The Paystack path in the same file was fixed and carries a long comment
explaining why (`:470–487`, `decrementManyOrFail`, all-or-nothing, migration
`015`). Its two siblings kept the pre-fix shape verbatim:

```js
if (currentQty < item.quantity) { throw new Error(`Insufficient stock...`); }
...
transaction.update(productRef, { availableQuantity: FieldValue.increment(-item.quantity) });
```

`atomic-money-migration.md` lists this file as "payment claim and stock
reservation converted; 3 order-creation transitions remain" — classifying the
remainder as status-only. Two of the three decrement real inventory against an
unlocked bound check, which is the oversell defect, not a status transition.

Also inherited: the per-item loop is not all-or-nothing, so a three-item order
short on the third item leaves the first two decremented — the specific reason
`decrement_many_or_fail` takes the whole order.

**Lower priority than F1–F4:** neither action has a `.tsx` caller today, and no
money is taken at order time, so an oversell here produces an order that cannot
ship rather than a payment with nothing behind it. It still corrupts
`availableQuantity`, which is shared with the Paystack path, so the damage is
not confined to these two doors.

### What was changed

**FIXED, both paths.** Each reserves the whole order through
`decrementManyOrFail` before the order row is written, exactly as `:487` does.
The in-transaction decrement was **removed**, not left alongside — keeping both
would take stock twice. The reads that remain in the transaction run after the
reservation, so `availableQuantity` there is the post-decrement figure, which is
what the low-stock alert should report; the `orders` and `_version` increments
stay where they were.

The out-of-stock branch is simpler than the Paystack one: nothing has been
charged on either path, so the order is refused outright rather than recorded as
`paid_awaiting_refund`. `not_found` and `insufficient` are reported differently —
a withdrawn product and a sold-out one are not the same thing to a buyer.

`src/__tests__/unit/marketplace-order-stock-reservation.test.ts` — 9 tests,
**8 fail against the pre-fix code**. The one that passes asserts the
payment-on-delivery seller check still runs before anything is reserved, which
the old code also enforced.

---

## Minor

`src/app/api/cron/process-email-queue/route.ts:89`/`:110` — `if (attempts >= maxAttempts)`
then `attempts: FieldValue.increment(1)`, unlocked. Two overlapping cron runs can
push a message past its retry cap. Not money; bounded by the cap being exceeded
by one or two. Recorded so the next reader does not have to re-derive that it is
harmless.

---

## Status

| | Finding | State |
|---|---|---|
| F1 | fixed-savings fix on the unused door | **fixed** |
| F2 | withdrawal reservation contract | **fixed** — `fix-withdrawal-reservation-contract` |
| F3 | cooperative registration never claims | **fixed** |
| F4 | export bookings overbook (two doors) | **fixed** |
| F5 | 2 of 3 order paths oversell stock | **fixed** |
| F6 | `_withdrawal.ts` third door overdraft | **fixed** — same branch |
| — | `apply-loan` lifetime-total gating | needs a business decision |
| — | fixed-savings plans split across two collections | needs a data decision |

## What is left

Nothing in this document is open as code. Two items need an answer, not a patch:

- **`apply-loan/route.ts:82`** gates loan eligibility on `totalContributions`,
  the lifetime figure. For a loan that is a defensible business rule in a way it
  never is for a withdrawal, so it was left alone. If it is the intended rule it
  should say so deliberately; if it is not, it is the same one-line fix as the
  withdrawal route.
- **Fixed-savings plans are split across two collections** —
  `COOPERATIVE_FIXED_SAVINGS` and `FIXED_SAVINGS_PLANS` — so plans created
  through the two doors are invisible to each other. Which one is canonical, and
  whether anything needs migrating, is a data question.

One thing found along the way that is worth its own look: closing the
`collection().add()` gap in `jest.setup.js` (see F4) means **any older suite
asserting on an action that creates documents that way was exercising its error
path, not its success path.** Nothing broke when the stub was added — 25 suites,
265 tests pass — but those assertions were weaker than they read, and no audit
of which ones has been done.

F1, F2 and F5 are all one shape: **a path that was fixed in one copy and left in
another.** Worth a standing check when closing any of these — search for a
second door before calling a defect fixed. F3 is the same shape seen from the
other side: two copies that both existed, where only one had been converted.

---

# Round 2 — clearing the recorded-but-open list

Everything above was found by sweeping. This round works the *other* list: the
items `atomic-money-migration.md` and `outstanding-work.md` had already
identified and deliberately left, each with a reason. Those reasons were sound,
and each needed something that did not exist yet.

Requires **migrations 020 and 021**, both of which must be applied to production
before this deploys. Neither alters a table, column, row or index; both are inert
until code calls them.

## R1 — processExportInvestment, the conversion that was not mechanical

The migration doc left this one on purpose. It writes the marker with two
statuses — `completed` normally, `overfunded_review` when the investment exceeds
the goal — and `platform_revenue_totals()` sums exactly the `completed` rows.
Claiming first means choosing a status before the branch has run, and claiming as
`completed` would have started counting overfunded payments as revenue: a
behaviour change smuggled inside an idempotency fix.

**Resolved as a two-step write.** Claim as `pending_fulfilment`, which is not
revenue, then promote once the branch resolves.

The second race it recorded is closed at the same time: the overfunding guard
read `fundedAmount`, compared, and wrote, with no lock, so two investments that
each fit under the goal but together exceed it both passed.
`incrementWithinCeiling` applies both in one statement, with the ceiling field
chosen from the record (`fundingGoal` **or** `goal`).

`fundedAmount` is dropped from the stats update — the ceiling call already raised
it, and incrementing again would double-count.

**The new failure mode, and what catches it.** A crash between claim and
promotion strands the row at `pending_fulfilment`. That is the safe direction —
under-counted, not over-counted — but every artefact check in
`reconcile-fulfilment` filters to `status === "completed"`, so a stranded row
would have been invisible to all of them. The reconciler now reports
`strandedClaims` **and counts them toward `totalUnfulfilled`**: a payment claimed
and never fulfilled needs no artefact lookup to be a problem, and reporting it
without counting it would let such a run report "ok".

## R2 — the refunds nothing was processing, or surfacing

Both stock-reservation paths mark an order `paid_awaiting_refund` when the
reservation fails after the payment is claimed, and the comment beside each says
nothing yet *processes* those refunds. True — and issuing one belongs behind a
human, the same reasoning that keeps the reconciler alerting rather than
auto-healing.

Nothing **surfaced** them either, which is the half that made them forgettable.
`reconcile-fulfilment` now reports `refundsOwed` across marketplace and export
orders — count, total, and the affected orders — counted toward the alarm.

Issuing the refund needs Paystack's refund API, which this codebase does not call
anywhere today. That should be its own change, by someone able to exercise it
against Paystack's sandbox.

## R3 — the minimum-balance floor was advisory (migration 020)

`platform.ts` and `api/cooperative/withdraw` enforced a ₦5,000 floor with a plain
read above the debit, and both comments said what that meant: two withdrawals
that each leave ₦5,000 behind can together dip under it. `debitJsonbBalance`
could not close it — it checks `balance >= amount` and nothing more.

`debit_jsonb_balance_with_floor` applies the floor under the same lock as the
deduction. A **separate function**, not a floor parameter added to the existing
one: adding a DEFAULTed parameter creates a new signature and leaves the old one
resolvable, which is the trap this document already records under "`proname`
alone proves nothing about version".

`below_floor` is deliberately distinct from `insufficient_funds`, and both call
sites report it distinctly. The member HAS the money and is not allowed to take
all of it; "insufficient funds" would be false.

## R4 — optimistic locking did not lock (migration 020)

`versionedUpdate` read `_version` inside `runTransaction`, compared it, and
wrote. That wrapper takes no lock, so two callers read the same version, both
passed, and both wrote — the second silently reverting the first from a snapshot
taken moments earlier. Precisely the failure the mechanism exists to prevent,
which is why `loan-actions.ts` dropped the helper rather than trust it. Five
other sites kept it, and kept the false guarantee.

`claim_versioned_update` is the compare-and-swap. **The fix is one change, not
six**: rewriting the helper moves `vendor-settings.ts` (4 sites), `admin.ts` and
`_updateMembershipAction` onto it without touching them — the same shape as
`splitIncrements` fixing 142 call sites at once.

The `transaction` parameter is kept and documented as unused. Passing the write
to it would be *actively wrong*: it would put the write back on the unlocked
replay path the rewrite exists to leave. There is a test asserting the
transaction is never touched.

`version === null` means the record does not exist, a different failure from a
lost claim. Confusing them tells a user to refresh and retry something that is
not there.

## R5 — one open loan application per borrower (migration 021)

Recorded twice in the migration doc and left both times, correctly: "Closing it
needs a uniqueness constraint on a borrower's open applications, not a wrapper."

**Why a row lock cannot fix it.** The thing being guarded is the ABSENCE of rows,
so `FOR UPDATE` has nothing to hold. This is a phantom, not a lost update.

**Why a partial unique index does not fit.** The rule spans two tables —
`cooperative_loans` and `document_collections` filtered to `loan_applications` —
and no index spans both. Worse, `CREATE UNIQUE INDEX` fails outright if existing
data already violates it, and the defect being fixed is exactly what would have
produced duplicates. A migration that cannot be applied until production is
cleaned is one that does not get applied.

`claim_single_open_loan_application` takes a **per-borrower advisory lock** and
does the check and the insert inside one function, so the lock covers both. A
second caller for the same borrower blocks, then sees the row the first wrote.
Per-borrower, so different borrowers never contend; xact-scoped, so it releases
on error and cannot leak. It imposes no precondition on existing data — a
borrower with duplicates simply cannot add a third.

Note the two borrower fields: `COOPERATIVE_LOANS` keys on `memberId`,
`LOAN_APPLICATIONS` on `userId`. Getting that wrong makes the guard match
nothing, which is indistinguishable from working.

## R6 — two cooperative forms failed on every submission

**Not on any list.** Found while writing fixtures for R5: both actions refused a
valid payload. A test that cannot construct a passing input is telling you
something about the code, not the fixture.

`makeContributionAction` and `applyForLoanAction` validate through
`parseFormData` → `formDataToObject`, which does no conversion — every FormData
value arrives as a **string**. Both schemas declared `amount: z.number()`, and
Zod does not coerce by default, so the parse failed every time with
`expected number, received string`.

There is no input that could satisfy it. The check was **unsatisfiable, not
strict**: making a cooperative contribution and applying for a cooperative loan
were broken 100% of the time, and the member saw a validation error on a
correctly filled form. No race, no concurrency precondition — the same class as
the "breaking things daily" list in `outstanding-work.md`.

The fix is two parts. `z.coerce.number()` makes a numeric string parse, and is
backward compatible: callers holding a real number (react-hook-form via
`zodResolver`) pass through untouched. Coercion alone is not enough —
`Number("₦10,000")` is `NaN` and the field is currency-formatted in the UI. The
loan path already stripped formatting; the contribution path did not, and would
have kept failing for formatted amounts, looking like the fix had half worked.

**Worth generalising from.** Two of this round's six items were found by trying
to write a test rather than by reading code, and both were invisible to every
sweep in these documents. A grep finds a shape; only execution finds a rule that
nothing can satisfy.

## Verification

| Suite | Pre-fix |
|---|---|
| `export-investment-two-step-claim` | 6 of 7 fail |
| `floored-debit-and-versioned-cas` | 6 of 6 fail |
| `cooperative-form-coercion` | 4 of 6 fail |
| `reconcile-fulfilment` (+4 tests) | new coverage |
| `single-open-loan-application` | 6 tests |

**29 unit suites / 295 tests pass. `tsc --noEmit` clean.**

## What is left after this round

No item from either audit document remains open as code. What remains is
operational or needs a decision — see the Status table above, plus:

- **Apply migrations 020 and 021** before deploying this.
- **Issuing** refunds (as opposed to surfacing them) needs the Paystack refund
  API integrated by someone who can test it against their sandbox.
