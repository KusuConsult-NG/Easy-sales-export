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
| `creditWalletOnce({ reference, userId, amount, ... })` | Money in. Returns `claimed: false` when the reference was already credited. |
| `debitWalletOnce({ reference, userId, amount, ... })` | Money out. Returns `reason: 'insufficient_funds' \| 'already_processed' \| 'no_wallet'`. |

Three rules:

1. **Never read a balance, adjust it, and write it back.** That is the bug.
2. **The reference is the idempotency key and must be stable across retries** —
   a Paystack reference, or an id derived from the order. A fresh random
   reference per attempt defeats the whole mechanism.
3. **`claimed: false` and `already_processed` are successes, not errors.** They
   mean the money already moved. A caller that treats them as failure will
   retry a payment that already succeeded.

## Done

| Path | Flow |
|---|---|
| `src/app/actions/wallet.ts` → `_confirmWalletFundingAction` | Paystack wallet funding (credit) |
| `src/app/actions/wallet.ts` → `_walletCheckoutAction` | Marketplace checkout (debit) |

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
