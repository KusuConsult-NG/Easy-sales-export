# How a marketplace seller actually gets paid, 2026-08-10

Written because two functions release the same escrow by different means, one of
them is unreachable, and the difference between them is money the platform is
not collecting.

## DECIDED, 2026-08-10: wallet credit at 100%

Marketplace sellers are paid the **full amount as a wallet credit**, which is
what `releaseEscrowFunds` does. The 2.5% commission and the bank-transfer route
are **not** the model. `confirmDeliveryAction` therefore implements a rejected
design and must not be wired up; the reasoning is repeated at the function
itself, which is where somebody would be standing when it mattered.

The consequence, accepted deliberately: **no commission is taken on marketplace
sales.** That is a pricing decision, not an outstanding defect.

## A correction to this document

An earlier version of this file, and the body of PR #75, both claimed **"orders
never reach `completed`"**. That was wrong.

`releaseEscrowFunds` completes the order itself, in the same transaction as the
payout — step 5 of that function. `disputes.ts` also sets `completed` when a
dispute resolves. The claim came from grepping for the status-transition helper
and missing a plain `tx.update`, which is the same mistake that hid the live
escrow implementation earlier in the week: **searching for the idiom rather than
the effect.**

The chosen path was already whole. What was actually wrong with it is the
stale-snapshot defect below.

## The two paths

| | `releaseEscrowFunds` | `confirmDeliveryAction` |
|---|---|---|
| Reached from | 3 admin escrow pages | **nothing — no caller** |
| Trigger | an admin presses Release | would be the buyer confirming |
| Pays by | credit to the in-platform **wallet** | real **Paystack bank transfer** |
| Amount | the **full** escrow amount | **97.5%** — 2.5% commission withheld |
| WAVE earnings | none | credits 5% of the order total |
| Escrow transition | claimed | was a blind write — now claimed |

## What happens today

1. Buyer presses Confirm Receipt → `confirmOrderReceiptAction` moves the order
   `in_transit|processing|shipped` → `delivered` and the escrow → `delivered`.
   **It moves no money.**
2. An admin opens an escrow page and presses Release. That credits the seller's
   wallet with the full amount **and completes the order**.
3. The seller withdraws from `/dashboard/wallet`; an admin approves; Paystack
   pays out. So the money does reach a bank account — one step later, at 100%.

Every step is wired.

**CORRECTION, 2026-08-11.** This originally said "Sellers can reach their
money", and that overstated it. The *code path* is complete; the *feature* may
be switched off. `wallet_deposits` and `wallet_withdrawals` both default to
`false` in `feature-toggles.ts`, commented "disabled for production rollout",
and `getFeatureToggle` falls back to that default when no override row exists.

`withdrawFromWalletAction` returns "Wallet withdrawals are currently disabled"
before it reaches any money code. So if those toggles have never been enabled in
production, escrow releases credit a wallet that **cannot be topped up or
withdrawn from** — the balance is real and the exit is closed.

Check `/admin/feature-toggles` before relying on the chain above. It was found
by a test that could not reach the debit it was written to exercise.

Two things the code implies and does not do:

- **The 2.5% marketplace commission is never taken.** The only code computing it
  is the unreachable `confirmDeliveryAction`. Now a decision (above) rather than
  a defect.
- **WAVE participants accrue no earnings from marketplace sales.** The only
  other writer of `waveEarningsBalance` is a withdrawal reversal in
  `wave/_admin.ts`, which returns money rather than earning it. If WAVE earnings
  on sales are wanted, they need building on the release path — the code that
  exists for it has never run.

## The stale snapshot: multi-seller orders never completed

Found while acting on the decision, and it is a defect in the **chosen** path.

`releaseEscrowFunds` decided whether to complete the order by asking whether
every *other* escrow on it was released. It asked that of a snapshot taken near
the top of the function — **before** the release was claimed:

```js
const orderEscrowsQuery = await db.collection(ESCROW_TRANSACTIONS)
    .where("orderId", "==", orderId).get();        // read here
...
const claim = await claimStatusTransitionFromAny({...});  // claimed here
...
const otherEscrows = orderEscrowsQuery.docs.filter(...);  // used here
```

That answers *"were the siblings released before I started?"*, which is not the
question. Two escrows on one order released at the same time: both callers held
a snapshot taken before either claim, each saw the other as unreleased, and
**neither completed the order**.

Every seller is paid and the order sits at `delivered` — and `disputes.ts`
refuses a dispute only on `completed` and `cancelled`, so **the order stays
disputable indefinitely after all its sellers have taken their money.** That is
the part that costs money rather than merely looking untidy.

Fixed by reading after the claim. This closes the race rather than narrowing it:
each caller re-reads strictly after its own claim commits, so for any two callers
the later read follows both claims — whoever reads last sees every release and
completes the order. There is no interleaving in which all callers miss it.

## What was fixed

`confirmDeliveryAction` released the escrow with a blind write:

```js
const escrowDoc = await escrowRef.get();
if (escrowDoc.exists) {
    await escrowRef.update({ status: "released", ... });
}
```

`exists` is not `status`. An escrow the admin had already released passed that
check and was released again — and the seller, having already been credited in
their wallet, also received a bank transfer for 97.5% of the order.

The order-level claim immediately above it (`delivered → completed`) does not
help: it guards a **different row**. It stops this function running twice; it
says nothing about the admin path having already run.

It now claims the escrow from the same `["delivered","disputed","funded"]` set
that `releaseEscrowFunds` uses, and a lost claim suppresses both the transfer
and the WAVE credit while still completing the order. Covered by
`order-confirm-delivery-escrow-claim.test.ts`; 4 of its 8 tests fail against the
previous code.

This is the same shape as the vendor writers, the escrow confirm, and the
delivery/receipt split: **a guard applied to one copy of a path and not to its
sibling.**

## Two vacuous assertions, both caught by mutation rather than by reading

Worth recording together, because they failed the same way and neither was
visible in a green run.

**The WAVE credit.** The update mock records `(docId, patch)` and the assertion
read the first argument — the id — whose `Object.keys` are character indices. It
could never have matched.

**The stale snapshot.** The first version of the completion test built its
sibling escrow as `data: () => ({ status: claimed ? 'released' : 'delivered' })`.
`data()` is lazy, so it resolved at step 5 — after the claim — and a *pre-claim
snapshot returned post-claim values*. The mock did not model a snapshot at all,
so the test passed against the very code it was written to condemn. Fixed by
capturing the status at query time, which is what a snapshot is.

Both were found by reverting the fix and re-running, not by inspection. **An
assertion that cannot fail is worse than a missing one, because it reports
coverage.**

### The wallet route is complete

Checked rather than assumed, because "the seller is credited to a wallet" is
only reassuring if the wallet has an exit:

```
escrow released → wallet credited
  → seller requests withdrawal    /dashboard/wallet          (withdrawFromWalletAction)
  → admin approves                /admin/marketplace/withdrawals
  → paystackPayout                                            (processWalletWithdrawalAction)
```

Every step is wired. Sellers can reach their money.

So the gap was **not** that sellers go unpaid — it is that the platform takes no
commission on marketplace sales and WAVE members accrue nothing from them. That
was revenue rather than a broken payment, and it has now been decided: **100% to
the seller, no commission.**

## If commission is ever wanted

It belongs on `releaseEscrowFunds`, not on the retired function — that is where
the payout happens and where the order completes. Two things would need
answering first, neither of which the old code answered:

- **Where the withheld 2.5% goes.** `confirmDeliveryAction` simply paid the
  seller less; nothing credited the platform. The commission was deducted and
  then existed nowhere.
- **Whether it is recorded as revenue.** `platform_revenue_totals()` sums
  `processed_payments` rows with status `completed`. A commission that is not
  written there is invisible to reporting; one written carelessly inflates it.
  Rule 4 of `atomic-money-migration.md`.
