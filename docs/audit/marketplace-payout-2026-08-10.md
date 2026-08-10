# How a marketplace seller actually gets paid, 2026-08-10

Written because two functions release the same escrow by different means, one of
them is unreachable, and the difference between them is money the platform is
not collecting.

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
2. Nothing else runs automatically. The order stops at `delivered`.
3. A seller is paid only when an admin opens an escrow page and presses Release,
   which credits their wallet with the full amount.

Three consequences, none of them visible from any one function:

- **Orders never reach `completed`.** The only transition into it lives in the
  unreachable function.
- **The 2.5% marketplace commission is never taken.** The only code that
  computes it is that same function, so every sale settles at 100% to the seller.
- **WAVE participants accrue no earnings from marketplace sales.** The only
  other writer of `waveEarningsBalance` is a withdrawal reversal in
  `wave/_admin.ts`, which returns money rather than earning it.

Whether that is a bug or the current commercial arrangement is a business
question and this document does not answer it. It is recorded because the code
reads as though a commission is charged, and it is not.

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

## A note on the test

The WAVE assertion passed against the unfixed code on the first attempt. The
update mock records `(docId, patch)` and the assertion read the first argument —
the id — whose `Object.keys` are character indices. It could never have matched.

A companion positive assertion now proves the credit is observable. An assertion
that cannot fail is worse than a missing one, because it reports coverage.

## Decision needed

Wiring `confirmDeliveryAction` to the buyer's Confirm button would complete
orders, take the 2.5%, and pay sellers by bank transfer instead of into a wallet
balance. That is a change to how sellers receive money and when the platform
earns, so it is not made here.

One thing to settle: **which payout is intended** — wallet credit at 100%, or
bank transfer at 97.5%? They disagree, and both are live code.

### The wallet route is complete, so this is not urgent

Checked rather than assumed, because "the seller is credited to a wallet" is
only reassuring if the wallet has an exit:

```
escrow released → wallet credited
  → seller requests withdrawal    /dashboard/wallet          (withdrawFromWalletAction)
  → admin approves                /admin/marketplace/withdrawals
  → paystackPayout                                            (processWalletWithdrawalAction)
```

Every step is wired. Sellers can reach their money.

So the gap is **not** that sellers go unpaid — it is that the platform takes no
commission on marketplace sales and WAVE members accrue nothing from them.
That is revenue, not a broken payment, and it is a pricing decision rather than
a defect to fix unilaterally.
