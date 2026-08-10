# Are the negative assertions real? — issue #60

Closes the follow-up opened from PR #59. **Result: no vacuous assertion found in
any pre-existing suite.** Every candidate that survived the first filter was
killed by mutation, meaning it does discriminate.

That is a boring answer, and it is the one worth having: the alternative was a
quiet hole in the test suite covering money paths.

## The question

`jest.setup.js` had no stub for `collection().add()`, so any action creating a
document that way threw at that line and **never reached the code after it**. A
test asserting "X did not happen" then passes for the wrong reason: not because
the guard worked, but because execution aborted before it could get there.

This bit twice while writing PR #59. Two tests in
`export-volume-overbooking.test.ts` asserted `currentVolume` was never written
directly — and passed against the **pre-fix** code, which very much did write it.
The write sat after a `collection().add()` that threw first. Stubbing `add`
raised that suite's pre-fix failure count from 5 to 8.

The worry was that older suites had the same hole.

## What was already known, and is not the point

Reverting `jest.setup.js` to its pre-#59 state and re-running everything except
that PR's new suites gives **20 suites / 223 tests passing identically with and
without the `add()` stub**. No existing test *changed behaviour*.

So this is not a regression hunt. Every affected assertion passes both ways —
which is exactly why it needs reading rather than running.

## Method

**Step 1 — a cheap filter.** A spy asserted `not.toHaveBeenCalled()` that is
never *positively* asserted anywhere in the same suite is unanchored: the
assertion cannot distinguish "the guard held" from "the code never got there".

That found **22 unanchored assertions across 11 suites**.

**Step 2 — mutation, because step 1 is a heuristic and not proof.** Break the
guard the assertion exists to protect, and re-run. If the test still passes, the
assertion is measuring nothing.

The guard shape in this codebase is consistent enough to automate:
`if (!x.claimed)` and `if (!x.ok)` become `if (false && !x.claimed)`.

| Source mutated | Suite | Tests that noticed |
|---|---|---|
| `cooperative/_admin.ts` | `cooperative-withdrawal-admin` | 2 of 6 |
| `loan-actions.ts` | `loan-actions-money-paths` | 3 of 15 |
| `wave/_admin.ts` | `module-payment-paths` | 2 of 10 |
| `export-payment.ts` | `export-payment-paths` | 4 of 11 |
| `cooperative/_loans.ts` | `cooperative-loan-repayment` | 3 of 8 |
| `platform.ts` | `idempotency-key-claims` | 3 of 7 |
| `marketplace/_buyer.ts` | `unguarded-check-then-writes` | 1 of 9 |
| `disputes.ts` | `order-dispute-payouts` | 1 of 11 |

Plus three targeted mutations on the specific unanchored spies that the guard
sweep did not reach:

| Mutation | Assertion under test | Result |
|---|---|---|
| Neuter `!confirmClaim.claimed` in `order-management.ts` | *"does not pay the seller when the confirmation claim is lost"* | **fails** — bites |
| Make `versionedUpdate` call `transaction.update` | *"never queues the write into the unlocked transaction"* | **fails** — bites |
| Reintroduce the pre-claim in the Paystack webhook route | *"does not pre-claim the reference before dispatching"* | **fails** — bites |

The seller-payout one matters most: `mockPaystackPayout` is asserted not-called
twice and never positively, so on the heuristic it looked like the weakest
assertion in the codebase. It is not.

## Two false positives, and what produced them

The heuristic over-reports, and both causes are worth knowing before anyone runs
it again.

**1. Anchoring through `.mock.calls`, not `expect().toHaveBeenCalled()`.**
`mockCreditWalletOnce` was flagged in `order-dispute-payouts`, but three tests
read `mockCreditWalletOnce.mock.calls[0][0]` to assert on the *arguments* — which
cannot pass unless it was called. The regex only looked for the matcher form.

**2. Mutating a module the suite deliberately mocks.** Neutering all 8 guards in
`infrastructure/payments/service.ts` failed **zero** of
`paystack-webhook-claim`'s tests, which looks damning. It is not: that suite
mocks `@/infrastructure/payments/service` wholesale and tests the *route*. The
handlers' guards are out of its scope by design, and are covered by
`module-payment-paths` and `export-payment-paths`.

A mutation that changes nothing is only evidence when the mutated code is
actually reachable from the suite. Check the mocks first.

## Coverage, stated honestly

- **Not every one of the ~34 negative assertions was mutation-tested
  individually.** The 22 unanchored ones were the target; the guard sweep covered
  them in groups, and the three that groups could not reach were done singly.
- An assertion anchored by a positive counterpart in the same suite was not
  re-checked. That is the filter's premise, not a proven property.
- Mutation testing proves an assertion *can* fail. It does not prove it fails for
  the right reason.

## What to keep

The `add()` stub stays, obviously. Beyond that:

**The vacuity guard is the cheap version of all this.** `export-volume-overbooking`
and `reconcile-fulfilment` now carry positive companions to their negative
assertions:

```js
it('does reach the slot collection when there is room', async () => {
    // Guards the at-capacity assertion from passing vacuously: if the
    // collection name were wrong, touched() would return false either way.
    await book(500);
    expect(touched('export_slots')).toBe(true);
});
```

That pattern earned its place twice in one day — it caught a `marketplace_orders`
vs `marketplaceOrders` typo in `reconcile-fulfilment.test.ts` that the negative
assertion happily passed against. A negative assertion with no positive
counterpart is worth a second look; it is not worth a mutation run every time.
