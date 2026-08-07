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

## Not yet migrated

Ordered by `runTransaction` count. Presence here is not proof of a live defect —
some of these transactions touch no balance — but each needs reading before it
can be ruled out.

| Count | File | Notes |
|---|---|---|
| 8 | `src/app/actions/admin.ts` | 5,473 lines, 40 exported actions. Split before touching. |
| 7 | `src/infrastructure/payments/service.ts` | Shared payment layer — likely the highest-value next target. |
| 7 | `src/app/actions/marketplace/_escrow.ts` | Escrow hold/release. |
| 7 | `src/app/actions/academy/_actions.ts` | |
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
| 3 | `src/app/api/cron/release-escrow/route.ts` | Runs unattended — a lost update here is silent. |
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
