# Atomic money operations — migration status

`supabaseDb.runTransaction` is not a transaction. It runs the callback, then
replays the queued writes:

```js
async runTransaction(fn) {
    const tx = new SupabaseTransaction();
    const result = await fn(tx);   // reads, unisolated
    await tx._commit();            // writes replayed afterwards
    return result;
}
```

No `BEGIN`, no row lock, no rollback, no retry. Any code that reads a balance,
adjusts it in JavaScript and writes the absolute result back can lose an update
or overdraw. Any code that checks "was this reference already processed?" and
writes the marker afterwards can process a payment twice.

This file tracks which paths have been moved onto the atomic primitives in
`supabase/migrations/005_atomic_wallet_operations.sql` and which have not.

## The primitives

Use `src/lib/wallet-ledger.ts`, never a hand-rolled read-modify-write:

| Function | Use for |
|---|---|
| `creditWalletOnce({ reference, userId, amount, status?, ... })` | Money in. Returns `claimed: false` when the reference was already credited. |
| `debitWalletOnce({ reference, userId, amount, ... })` | Money out **with** a stable key. Returns `reason: 'insufficient_funds' \| 'already_processed' \| 'no_wallet'`. |
| `debitWalletLocked({ userId, amount })` | Money out with **no** stable key (a withdrawal request). Locks the row; claims nothing. |

Four rules:

1. **Never read a balance, adjust it, and write it back.** That is the bug.
2. **The reference is the idempotency key and must be stable across retries** —
   a Paystack reference, or an id derived from the order. A fresh random
   reference per attempt defeats the whole mechanism. When no stable key exists,
   use `debitWalletLocked` rather than inventing one.
3. **`claimed: false` and `already_processed` are successes, not errors.** They
   mean the money already moved. A caller that treats them as failure will
   retry a payment that already succeeded.
4. **Anything that is not money coming in must not record status `completed`.**
   `global-aggregation.ts` sums `processed_payments` rows with
   `status == "completed"` as revenue. Debits record `wallet_debit`
   automatically; refunds must pass `status: "refund"` explicitly. Getting this
   wrong inflates reported revenue rather than breaking anything visibly.

## Done

| Path | Flow |
|---|---|
| `src/app/actions/wallet.ts` → `_confirmWalletFundingAction` | Paystack wallet funding (credit) |
| `src/app/actions/wallet.ts` → `_walletCheckoutAction` | Marketplace checkout (debit) |
| `src/app/actions/wallet.ts` → `_withdrawFromWalletAction` | Withdrawal request reservation (locked debit) |
| `src/app/actions/wallet.ts` → withdrawal rejection | Refund to wallet (credit, status `refund`) |

`wallet.ts` no longer performs balance arithmetic anywhere.

## Verified on staging, 2026-08-07

Migrations `005` and `006` were applied to a staging Supabase project and the
behaviour checked against a real Postgres:

| Property | Check | Result |
|---|---|---|
| Idempotency | `credit_wallet_once` twice with one reference | second returns `claimed = false`, balance unchanged |
| Revenue accounting | status recorded by `debit_wallet_once` | `wallet_debit`, not `completed` — so it is not summed as revenue |
| **Concurrency** | two sessions, second debit while the first is uncommitted | **second session blocked on the row lock** |

The concurrency result is the important one. It is the property the unit tests
explicitly cannot cover, and the whole point of this work: under the old
`runTransaction` both sessions would have read the same balance and proceeded.
Blocking is the fix working.

Note the scope of that evidence. It proves the *primitives* behave correctly.
It does not prove every caller uses them correctly — that is what reading each
conversion is for.

## Fixed: the withdrawal state machine

`_processWalletWithdrawalAction` moved a withdrawal `pending → payout_initiated
→ completed` with check-then-write inside `runTransaction`. No balance was
touched, so the wallet functions did not cover it, but two admins approving at
once could both read `pending`, both write `payout_initiated`, and **both call
Paystack transfer** — paying out twice, out of the business's money, with
nothing raised.

Migration `007` adds `claim_status_transition`, a compare-and-swap: the status
changes only if it still holds the expected value, and the caller is told
whether it was the one that changed it. A single conditional `UPDATE` locks the
row and re-reads under the lock, so exactly one of two concurrent callers
matches the `WHERE`.

**Verified on staging, 2026-08-07.** With a record at `pending`, the first
caller returned `claimed = true` and the second `claimed = false` — and the
row carried the winner's `processedBy`, not the loser's. That second call is
the payout that used to get through.

Use `claimStatusTransition` from `src/lib/status-transition.ts` for any action
that must happen once per state change — payouts, escrow release, order
fulfilment, loan disbursement. Two rules:

1. **`claimed: false` means somebody else is handling it.** Stop; do not retry.
2. **`status: null` means the record does not exist**, which is a different
   failure. Confusing the two either pays a user twice or refuses a legitimate
   payout.

`wallet.ts` now contains no `runTransaction` calls at all.

## Fixed: escrow auto-release (the unattended cron)

All three loops in `api/cron/release-escrow/route.ts` read a status, checked it,
then paid out — inside `runTransaction`, which takes no lock. Two overlapping
runs both saw the same status and both credited.

Each now claims the transition with `claimStatusTransition` before paying:

| Loop | Transition |
|---|---|
| Export windows | `delivered → completed`, credits cooperative savings |
| Escrow transactions | `funded → released`, credits the seller's wallet |
| Delivered escrow | `delivered → released`, credits the seller's wallet |

The compare-and-swap also preserves the guard the status check existed for: a
buyer filing a dispute moves the record off `funded`, and the release then
refuses.

**Worth noting the interaction with migration 010.** Making `FieldValue.increment`
atomic made this worse before it was fixed, not better. Previously one of two
concurrent credits was likely lost, which accidentally masked the duplicate.
Once increments sum correctly, both land and the payee is paid twice. Fixing the
increment without fixing the claim would have turned a hidden bug into a paying
one.

The loops also counted a skipped item as a success, so a run that paid nothing
reported full success. They now report `skipped` separately.

## Fixed: marketplace escrow release and dispute resolution

`marketplace/_escrow.ts` is the manual counterpart to the escrow cron, and had
the same defect. Two paths move money and both now claim the transition first:

| Path | Transition | Credits |
|---|---|---|
| `_releaseEscrowAction` | `funded → released` | seller's wallet |
| `_resolveDisputeAction` | dispute `open`/`under_review` → `resolved` | seller or buyer |

Dispute resolution attempts the claim twice, because a dispute may be resolved
from either state and the compare-and-swap takes one `from` at a time. That is
still race-safe: once the first attempt succeeds the status is `resolved`, so
every later attempt fails both ways.

**The file's header comment was the root of it.** It stated that
`runTransaction` "reads the current state and rejects the write if the
precondition is violated — turning a race condition into a clear error". True of
Firestore, false of this adapter, and precisely the belief that made a status
check look like a guard. The comment now says what actually happens.

Four non-money status transitions in that file are not converted: confirming
payment (`pending → funded`), requesting release, creating a dispute, and
escalating a dispute. A double-apply there duplicates notifications and audit
entries rather than money, so they were left rather than expanding a money PR.

## arrayUnion and arrayRemove are still NOT atomic — 38 call sites

Found 2026-08-08 while converting `academy/_actions.ts`. Same class as the
`FieldValue.increment` bug, and **not** fixed by the change that fixed that one.

`splitIncrements` in `supabase-db.ts` pulls only `FieldValue.increment` out of a
write. `arrayUnion` and `arrayRemove` still go through `resolveFieldValue`,
which reads the existing array, modifies it in JavaScript, and writes the whole
array back:

```js
case 'FieldValue.arrayUnion': {
    const arr = Array.isArray(existing) ? [...existing] : [];
    ...
    return arr;
}
```

Two concurrent `arrayUnion` calls on the same field read the same array and the
second write overwrites the first, so one element is silently lost. 38 call
sites.

A concrete example in the same file: completing a lesson does
`progress.completedLessons.push(lessonId)` and writes the array back. A learner
finishing two lessons quickly can lose one, and the "optimistic locking" guard
above it does not help — it compares `_version` inside `runTransaction`, which
takes no lock, so both callers read the same version and both pass.

**The fix is the same shape as migration 010:** extend `splitIncrements` to
carry array operations, and apply them in SQL with `jsonb` array append and
remove. It depends on that change landing first — PR #13, still open.

Recorded rather than fixed because fixing half of a class and calling it done is
what produced this gap in the first place.

## Not yet migrated

Ordered by `runTransaction` count. Presence here is not proof of a live defect —
some of these transactions touch no balance — but each needs reading before it
can be ruled out.

| Count | File | Notes |
|---|---|---|
| 8 | `src/app/actions/admin.ts` | 5,473 lines, 40 exported actions. Split before touching. |
| 1 | `src/infrastructure/payments/service.ts` | 6 of 7 converted. Only `processExportInvestment` remains — see below. |
| 4 | `src/app/actions/marketplace/_escrow.ts` | Both money paths converted; 4 non-money status transitions remain — see below. |
| 6 | `src/app/actions/academy/_actions.ts` | Payment claim converted; 6 non-payment transitions remain. |
| 6 | `src/app/actions/farm-nation.ts` | |
| 5 | `src/app/actions/wave/_actions.ts` | |
| 5 | `src/app/actions/wallet.ts` | Remaining non-balance transactions (withdrawal request, admin decisions). |
| 5 | `src/app/actions/cooperative/_actions.ts` | |
| 4 | `src/app/actions/vendor-settings.ts` | |
| 4 | `src/app/actions/marketplace/_escrow_actions.ts` | |
| 4 | `src/app/actions/marketplace/_actions.ts` | |
| 4 | `src/app/actions/loan-actions.ts` | |
| 4 | `src/app/actions/cooperative/_loans.ts` | |
| 4 | `src/app/actions/cooperative/_admin.ts` | |
| 3 | `src/app/actions/wave/_admin.ts` | |
| 3 | `src/app/actions/marketplace/_payment.ts` | |
| 3 | `src/app/actions/academy/_admin.ts` | |
| 2 | `src/app/actions/order-management.ts` | |
| 2 | `src/app/actions/marketplace/_buyer.ts` | |
| 2 | `src/app/actions/export.ts` | |
| 2 | `src/app/actions/export-payment.ts` | |
| 2 | `src/app/actions/disputes.ts` | |
| 2 | `src/app/actions/cooperative/_payment.ts` | |
| 2 | `src/app/actions/academy/_payment.ts` | |

Refresh the list with:

```
grep -rln "runTransaction" src/ | grep -v "supabase-db.ts\|__tests__\|shims/"
```

## processExportInvestment — deliberately not converted

The other six sites in `infrastructure/payments/service.ts` now claim the
payment reference before fulfilling. This one does not, because it is not a
mechanical conversion.

It writes the marker with **two different statuses**: `completed` on the normal
path, and `overfunded_review` when the investment would exceed the funding goal.
`global-aggregation` sums rows with status `completed` as revenue, so the second
status deliberately keeps an overfunded payment out of the revenue figure.

Claiming first means choosing a status before the overfunding check has run. The
options are to claim as `completed` (which would start counting overfunded
payments as revenue — a behaviour change), or to claim with a neutral status and
promote it once the branch resolves (correct, but a two-step write that needs
its own thought).

There is also a second race it does not fix: the overfunding guard reads
`fundedAmount` and compares `currentFunded + amount > fundingGoal`. Two
investments arriving together can both pass. The write itself is safe —
`FieldValue.increment` is atomic since migration 010 — so the total is right,
but the goal can be exceeded.

Both want a decision rather than a refactor.

## Suggested order

1. `infrastructure/payments/service.ts` — shared, so fixing it improves several
   callers at once.
2. `marketplace/_escrow.ts` and `api/cron/release-escrow/route.ts` — escrow
   holds real money, and the cron path runs with nobody watching.
3. `cooperative/_loans.ts` and `loan-actions.ts` — disbursement and repayment.
4. The rest, as they are touched for other reasons.

## Before applying migration 005

It only creates two functions — no table, column or row is altered, and it does
nothing until code calls it. But note the assumption it depends on:

Every caller writes the payment reference as the **document id**
(`db.collection(PROCESSED_PAYMENTS).doc(reference)`), so `processed_payments.id`
holds the reference and its PRIMARY KEY is the idempotency gate. The `reference`
column itself is deliberately not UNIQUE — `schema.sql` records that Firestore
allowed duplicates. If a caller is ever added that writes a random id with the
reference only in the body, idempotency will not hold for that caller.

Verify after applying:

```sql
SELECT proname FROM pg_proc
 WHERE proname IN ('credit_wallet_once', 'debit_wallet_once');
```
