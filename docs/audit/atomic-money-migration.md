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

## Fixed: FieldValue.increment was not atomic — 142 call sites

Found 2026-08-08, while converting `infrastructure/payments/service.ts`. This
was larger than everything else on this page. Fixed by migration `010`.

`FieldValue.increment` is the idiom you reach for **specifically to avoid**
read-modify-write. In this codebase it *was* one. `SupabaseDocumentReference.update`
read the document, resolved the sentinel in JavaScript, and wrote the result:

```js
// src/lib/supabase-db.ts — update(), before 010
const snap = await this.get();
const existing = snap.data() ?? {};
...
case 'FieldValue.increment':
    return (typeof existing === 'number' ? existing : 0) + (fvObj._operand || 0);
```

There was no `col = col + n`. Two concurrent increments read the same `existing`,
computed the same result, and the second write overwrote the first. **One
increment was silently lost.**

So code written *correctly* by Firestore conventions was broken here, and it
looked right on inspection. That is worse than the `runTransaction` problem,
which at least looks suspicious once you know.

**Scale: 142 call sites across 37 files.** The money-shaped ones included:

| Site | What was lost |
|---|---|
| `marketplace/_escrow.ts:368`, `:632` | seller wallet credit on escrow release |
| `marketplace/_escrow_actions.ts:415` | seller wallet credit |
| `disputes.ts:525` | wallet credit on dispute resolution |
| `loan-actions.ts:275`, `:412`, `:422` | loan disbursement, repayment, repaid total |
| `platform.ts:237`, `:238` | savings and locked balances |
| `order-management.ts:262` | WAVE earnings balance |
| `export.ts:947` | export window funded amount |

**The fix was one change, not 142.** `splitIncrements` pulls the sentinels out of
the patch and `apply_increments` applies them as a single statement, so every
call site became correct without being touched.

That change sits on the write path used by every table. It still wants the
staging concurrency check (two sessions, second must block or serialise) that
proved 005/006 — see the runbook.

**Note the direction of the interaction.** Making increments land correctly makes
every *unguarded* check-then-increment worse, not better: the lost writes used to
hide overshoot. That is why 010 must ship together with the guards in 007, 013,
014 and 015, and why the deploy script refuses to build a partial set.

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

## Fixed: arrayUnion and arrayRemove were not atomic — 38 call sites

Found 2026-08-08 while converting `academy/_actions.ts`. Same class as the
`FieldValue.increment` bug, and **not** fixed by the change that fixed that one.
Fixed by migration `016`.

`splitIncrements` pulled only `FieldValue.increment` out of a write. `arrayUnion`
and `arrayRemove` still went through `resolveFieldValue`, which read the existing
array, modified it in JavaScript, and wrote the whole array back:

```js
case 'FieldValue.arrayUnion': {
    const arr = Array.isArray(existing) ? [...existing] : [];
    ...
    return arr;                      // computed from a stale read
}
```

Two concurrent calls read the same array and the second write overwrote the
first, so one element was silently lost.

**Why this one is worse than the increment equivalent.** 33 of the ~38 sites are
the same line:

```js
roles: FieldValue.arrayUnion("<some_role>")
```

on the users collection — and `roles` is what every module-access check reads. A
user who joins two modules at once, or a webhook and a server action landing
together, keeps one role and loses the other. They are a paying cooperative
member with no cooperative access, and nothing errored.

It also explains a specific complaint: a fix that "keeps breaking". Re-granting
the role works, right up until the next concurrent write drops it again.

### Three things had to be fixed, not one

**1. The adapter path.** `splitArrayOps` pulls the sentinels out and
`apply_array_ops` applies them in one UPDATE.

**2. `set(..., { merge: true })`, not just `update()`.** The cooperative
membership grant runs through `transaction.set(userRef, ..., { merge: true })`.
Fixing `update()` alone would have left the paid-member role — the most
expensive one to lose — still dropping. Migration 010 left this same gap for
increments; it is closed now too.

**3. The stale-value clobber, which defeated the whole fix.** `processWriteData`
returns `{ ...existingData, ...changes }` — the WHOLE document, not just the
changed fields. That is deliberate: `merge_raw_data` does a shallow
`raw_data || patch`, so a nested change has to carry its whole top-level object
or the siblings are dropped.

But it meant the patch carried a stale copy of the very field the atomic
function was about to change. The sequence was: write the whole stale document
(undoing a concurrent writer), then apply our own element on top. The SQL
function is only atomic if the value reaches the database **once**, so
`stripAtomicPaths` removes those paths from the patch. Dotted paths are removed
at their exact position, so their siblings survive.

This was silently undermining migration 010's increments as well.

### The dual-storage trap, again

`roles` is BOTH a native `TEXT[]` column on `users` and a key inside `raw_data`.
Reads prefer `raw_data`; `.where()` filters use the column. Updating one alone is
exactly how the wallet fix in 005/006 ended up invisible to the application and
needed 011 to correct it.

So `apply_array_ops` derives the column FROM the new `raw_data` value rather than
computing it separately — one expression, two destinations, no way for them to
disagree. The integration tests assert on both.

### One deliberate behaviour change

Element equality is now JSONB equality rather than `JSON.stringify` comparison.
JSONB normalises key order, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are now
correctly treated as the same element where they previously were not. That is a
fix, but it is a behaviour change worth knowing about.

## Fixed: every update() wrote the whole document back

Found while fixing the array bug, and larger than it. Fixed by migration `017`.

`processWriteData(data, existing, true)` started from `{ ...existingData }`, so
**every** `update()` sent the entire document it had just read:

```js
await ref.update({ keep: 2 })
// patch actually sent:
// {"id":"u1","keep":2,"doomed":"x","profile":{...}, ...everything else}
```

Two concurrent updates to completely unrelated fields therefore clobbered one
another. Whoever wrote second reverted the other's change, using a snapshot
taken moments earlier, and nothing errored.

This is not a money bug, an array bug or a counter bug. It is every field in
every collection — and it is the most plausible general mechanism behind the
report that fixes "keep breaking": a value is corrected, and an unrelated
concurrent write reverts it.

It was also silently undermining migrations `010` and `016`, because the stale
copy of a counter or array rode along in that patch.

### Why the whole document was being sent

`merge_raw_data` (002) does `raw_data || p_patch` — a SHALLOW merge. A nested
change like `{"a.b.c": 1}` therefore had to carry the whole `a` object, or `a`'s
other keys would be dropped. Sending everything was the simplest way to be
correct, and it *was* correct. It just was not concurrent.

### The fix: three shapes, because Firestore has three

A single shallow merge cannot express what Firestore distinguishes, so
`buildWritePatch` splits a write into:

| Shape | Example | Semantics |
|---|---|---|
| `patch` | `update({a: {x: 1}})` | top-level, shallow-merged — **replaces** `a` |
| `paths` | `update({"a.b": 1})` | `jsonb_set` — leaves `a`'s siblings alone |
| `deletes` | `update({a: FieldValue.delete()})` | removes the key |

`apply_document_patch` applies them in that order in one statement, deletes last
so an explicit delete wins.

### FieldValue.delete never worked

Worth stating plainly, because it looked like it did. Deleting a field produced a
patch with the key simply **absent** — and `raw_data || patch` only adds and
replaces. It never removes.

So `FieldValue.delete()` has been a silent no-op on this path for as long as it
has existed. Every field anyone believed they had removed is still there. `017`
is the first version that actually deletes.

### Degradation

The adapter prefers `apply_document_patch`, falls back to `merge_raw_data` for a
plain patch, and falls back to a JavaScript read-merge-write for anything
`merge_raw_data` cannot express. A delete is never sent to `merge_raw_data`,
because it would report success and remove nothing — the exact silent failure
being fixed.

### Still not concurrent

One thing this does NOT fix: `arrayUnion` nested **inside** an object, as in
`update({profile: {tags: FieldValue.arrayUnion("x")}})`. `splitArrayOps` only
inspects top-level keys, so that still resolves in JavaScript. Firestore
semantics say the assignment replaces `profile` wholesale anyway, so the array
op is questionable there to begin with — but it is not atomic, and it is worth
knowing.

## Fixed: farm-nation property double sale

`_initiatePropertyPurchaseAction` checked `status === "available"` inside
`runTransaction`, which takes no lock. Two buyers requesting the same property
at once both read "available", both created a purchase request, and both marked
it pending — **the same property sold twice**, with two buyers each expecting to
pay.

The reservation now happens as a claim (`available → pending`) before the
purchase request is written. Exactly one buyer wins; the loser is told the
property is gone rather than being taken to payment for something they cannot
have.

### A pre-existing bug this surfaced

Cancelling a purchase set the listing back to **`"verified"`** — which is not one
of the statuses a `Property` can hold. The union is
`available | pending | sold | leased`. Purchasing requires `"available"`.

So **cancelling a purchase left the listing permanently unbuyable**: no buyer
could claim it again, and nothing reported an error. It simply stopped being
purchasable, quietly, forever.

Cancellation now returns the listing to `"available"` and clears the pending
buyer. ### CORRECTION, 2026-08-09

The paragraph above originally said `"verified"` is not a valid Property status
and that every listing sitting at `"verified"` is stuck. **Both claims were
wrong**, and the production fix they implied — a blanket
`verified → available` UPDATE — would have removed every admin-verified land
listing from the public marketplace.

`"verified"` is the land module's approved state:

```js
// land-actions.ts
status: validated.verified ? 'verified' : 'rejected',
...
_getVerifiedLandListings → _getLandListings({ status: 'verified' })
```

The real defect is that `LAND_LISTINGS` is shared by two modules with
incompatible status vocabularies:

| Module | Lifecycle | Reads |
|---|---|---|
| `land-actions` | `pending_verification` → `verified` / `rejected` → `deleted` | public view queries `status = 'verified'` |
| `farm-nation` | creates as `available`; purchase requires `available` | — |

A listing is therefore **visible in one module or purchasable in the other,
never both**. A land listing an admin verified cannot be bought through
farm-nation at all; a farm-nation property never appears in the verified land
view.

Restoring `"available"` on cancellation is still correct, because only a
farm-nation listing can reach that path — a `"verified"` listing cannot be
purchased in the first place.

**If you want to find listings genuinely stuck by the old cancel bug**, do not
select on status alone. Select the ones that have a cancelled farm-nation
purchase against them:

```sql
SELECT l.id, l.raw_data->>'name' AS name, l.raw_data->>'status' AS status
  FROM document_collections l
  JOIN document_collections t
    ON t.collection_name = 'farm_nation_transactions'
   AND t.raw_data->>'propertyId' = l.id
   AND t.raw_data->>'status' = 'cancelled'
 WHERE l.collection_name = 'land_listings'
   AND l.raw_data->>'status' = 'verified';
```

Those are listings that went `available → pending → cancelled → verified` and
can no longer be bought. Everything else at `"verified"` is a normal,
correctly-approved land listing and must be left alone.

**The vocabulary split itself needs a decision, not a patch:** either the two
modules agree on one lifecycle, or farm-nation stops sharing the collection.
Until then, any status written by one module is invisible to the other.

## Fixed: admin withdrawal payout

`_processWithdrawalAction` in `admin.ts` had the same double-payout defect as
the wallet withdrawal path, on a different set of collections (`withdrawals`,
`cooperative_withdrawals`, `wave_withdrawals`). The guard was labelled

```
// 1. STATE LOCK — Mark as payout_initiated
```

and was not a lock: the status check ran inside `runTransaction`, so two admins
approving the same withdrawal both read "pending", both wrote
"payout_initiated", and both continued to the Paystack transfer — paying the
user twice.

Now claims `pending → payout_initiated` first. The collection is tracked through
the three-way lookup so the claim targets the right one.

## Fixed: loan approval dual-control was bypassed entirely

Two defects. The race was documented earlier; the first one below was found
while fixing it, and it is much worse.

### 1. The maker's own approval disbursed the loan

The first-approval branch returned `makerApproval: true` — and **nothing checked
it** before the Paystack payout. The `return` that should have stopped there was
missing; the orphaned indentation on the audit-log call is where it used to be.

```js
if (!approvalChain.firstApprover) {
    ...
    return { error: null, success: true, makerApproval: true, loanData };   // returns from the TRANSACTION
}
...
});                                                    // <- transaction ends

// nothing inspects makerApproval

// --- DISBURSEMENT (Outside Transaction) ---
const disbResult = await paystackPayout(...)           // <- money leaves
```

So one admin approving a loan of ₦1,000,000 or more paid it out on their own.
The disbursement then set the status to `disbursed`, which made the second
approver's attempt hit the "already processed" early return — so the second
approval could never happen and the audit trail recorded a single approver.

Dual control never took place. The threshold was decorative.

### 2. Both checks ran inside runTransaction, which takes no lock

`if (!approvalChain.firstApprover)` and the self-approval check are
check-then-write:

- Two admins approving at the same moment both read an empty chain, both wrote
  themselves as maker, and one approval was silently replaced.
- Two checkers both passed the "not your own approval" test and **both** reached
  the payout.

### The fix

Every path now claims its transition, so exactly one caller proceeds:

| Step | Claim |
|---|---|
| First approval (≥ threshold) | `pending`/`reviewing` → `partially_approved` |
| Second approval | `partially_approved` → `approved` |
| Approval below threshold | `pending`/`reviewing` → `approved` |

Only the winner of the final claim reaches disbursement, and a first approval
returns before it — that return is the one that was missing.

The self-approval check stays a plain read, which is safe here: `firstApprover`
is only written by the maker claim, and that claim also moves the status to
`partially_approved`, so it cannot change underneath the checker.

The checker's patch writes the **whole** `approvalChain` object, because the CAS
patch shallow-merges — writing only `secondApprover` would drop the maker's
record.

`versionedUpdate` is gone from this path. It re-read the document inside
`runTransaction` to compare `_version`, which takes no lock, so two callers read
the same version and both passed. The `version` parameter is kept for the call
signature and documented as unused.

### The same shape in cooperative/_loans.ts

`approveLoanAction` had defect 2 but not defect 1 — it performs no disbursement,
which is the only reason it was less severe. Converted to the same claims.

### Proving it

The tests were run against the pre-fix code first: 8 of 9 fail, including
"does not disburse on the first approval". A test that passes either way would
have proved nothing. The ninth passes both ways — sequential self-approval was
already blocked; only the concurrent case was not.

## Fixed: cooperative savings could be overdrawn

Two paths debited `cooperative_members.savingsBalance` with a read-check-write:

| Path | What it does |
|---|---|
| `_submitWithdrawalAction` | reserves funds for a withdrawal request |
| `_createFixedSavingsAction` | locks funds into a fixed savings plan |

Both read the balance, compared it to the amount, and then decremented — inside
`runTransaction`, which takes no lock. Two withdrawals submitted at once both
read the same balance, both passed the check, and both deducted. **A member's
savings went negative.**

Migration `010` made this worse rather than better, the same way it did for the
escrow cron: the decrements used to lose one another, which accidentally hid the
overdraft. Once increments apply correctly, both deductions land.

Migration `013` adds `debit_jsonb_balance` — a locked, checked debit for
balances held in `raw_data` rather than a native column. The wallet functions
(005/006/011) could not be reused: they are specific to the `wallets` table and
its native `balance` column, and cooperative savings are neither.

Deliberately generic over table and field, because the same shape appears on
locked balances and WAVE earnings. One primitive rather than one per balance.

An integration test drives three concurrent 400 debits against a balance of
1,000 and asserts exactly two succeed with 200 left. Under the old code all
three passed and the balance ended at −200.

## Fixed: WAVE earnings could be withdrawn twice

`_withdrawEarningsAction` debited `serviceRegistrations.wave.waveEarningsBalance`
with a worse variant of the read-check-write: the sufficiency check happened
**outside the transaction entirely** —

```js
// PHASE 1: Balance Calculation (Snapshot)
if (earnings.data.paidAmount < amount) return "Insufficient available balance";
...
transaction.update(userRef, {
    'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(-amount),
});
```

so the balance was read, released, and only then decremented. Two withdrawals
submitted at once both passed against the same snapshot and both debited.

The `hasPendingWithdrawal` flag was intended to prevent exactly this and could
not: it was itself a check-then-write inside the same lock-free transaction.

Migration `014` extends `debit_jsonb_balance` to nested paths, since WAVE
earnings live three levels into `raw_data` rather than at the top level like
cooperative savings. Single-segment callers are unaffected.

The debit now happens first, under a lock. A second concurrent request is
refused for insufficient funds, which is the honest answer — the first one has
the money.

## NOT fixed: training events can be overbooked

`_registerForTrainingAction` checks capacity and then increments:

```js
if (currentParticipants >= maxParticipants) throw new Error("Event is full");
...
transaction.update(eventRef, { currentParticipants: FieldValue.increment(1) });
```

No lock, so two registrations on the last seat both pass and the event goes over
capacity. Not money, but it oversells a physical training session.

The fix needs a primitive none of the existing ones provide: a **conditional
increment** — raise a counter only while it stays below a bound, in one
statement:

```sql
UPDATE ... SET currentParticipants = currentParticipants + 1
 WHERE currentParticipants < maxParticipants
RETURNING currentParticipants;
```

Same shape as `claim_status_transition`, but on a numeric bound rather than an
equality. Worth adding when the next capacity-style bug appears, rather than
building it for one caller.

## Fixed: escrow release and refund could each pay twice

`marketplace/_escrow_actions.ts` had the same defect as the paths already fixed,
in its two money-moving actions:

| Action | Guard | Where it lived |
|---|---|---|
| `_releaseEscrowFunds` | status is `delivered`/`disputed`/`funded` | **entirely outside** the transaction — a plain read, then a blind write |
| `_refundEscrowToBuyer` | status is `funded`/`in_transit`/`disputed`, plus `refundedAt` | inside `runTransaction`, which takes no lock |

Two admins acting at once both passed and both created a payout or refund
instruction, and the release also credited the seller's wallet.

The `refundedAt` field was a second check on the same unlocked read, so it added
nothing. Moving the record to `refunded` is now the guard.

Both use `claimStatusTransitionFromAny`, added for the several transitions that
are legitimately valid from more than one state — escrow release from three,
refund from three, dispute resolution from two. It attempts each in turn and
stops on the first win. Race-safe, because once any attempt succeeds the row
holds the target status and every other attempt fails against all of them.

## Remaining runTransaction sites: 108, and a way to prioritise them

Converting file by file has diminishing returns — most of the remaining sites
change a status nobody pays against. The ones worth reading first are those
whose file shows both money signals and guard signals:

```
grep -c "increment(\|balance\|amount\|PROCESSED_PAYMENTS\|payout\|escrow" <file>
```

By that measure, the unconverted files with the most money in them are:

| File | Why it is on the list |
|---|---|
| `cooperative/_admin.ts` | admin-side contribution and withdrawal handling |
| `cooperative/_loans.ts` | loan disbursement and repayment |
| `actions/export.ts`, `export-payment.ts` | export investment payments |
| `actions/order-management.ts` | order state and seller earnings |
| `actions/disputes.ts` | dispute payouts |
| `wave/_admin.ts` | WAVE earnings administration |
| `academy/_payment.ts`, `farm-nation-payment.ts` | module payment fulfilment |

Everything else is a status change with no money attached to it, and can be
converted opportunistically when the file is touched for another reason.

## Fixed: the LAND_LISTINGS vocabulary split

Two modules shared one collection without agreeing what a status meant:

| Module | Creates | Approves as | Public view queries |
|---|---|---|---|
| `land-actions` | `pending_verification` | `verified` / `rejected` | `status = 'verified'` |
| `farm-nation` | `available` | — | (no filter at all) |

An admin-verified land listing could not be bought through farm-nation, because
purchase required exactly `"available"`. A farm-nation property never appeared
in the verified land view. **Half the inventory was unreachable from each side.**

Worse, farm-nation's browse applied **no status filter whatsoever**, so buyers
were shown listings awaiting verification, ones an admin had explicitly
rejected, and soft-deleted ones — and could start a purchase that failed at the
end.

`src/lib/land-listing-status.ts` is now the single definition. It treats
`verified` and `available` as synonyms rather than renaming either, which avoids
a data migration over live listings — and a migration here would be the risky
kind, because the two modules would disagree while it ran.

Three changes follow from it:

- **Browse** filters to purchasable listings.
- **Purchase** accepts either spelling.
- **Cancellation** restores the status the listing was reserved *from*, recorded
  at reservation time via `claimStatusTransitionFromAny({ recordPreviousAs })`.
  Hardcoding `"available"` — which an earlier fix did — silently drops an
  admin-approved listing out of the public land view.

If the vocabularies are ever genuinely unified, that file is the only place that
has to change.

## Fixed: marketplace order payment could fulfil twice

`_verifyOrderPaymentAction` read the payment marker outside any transaction and
wrote it inside one, so two callers both passed and both fulfilled: stock
decremented twice, escrow created twice, seller credited twice.

The code already knew the two paths overlap. The comment on that check reads:

> the Paystack webhook already processed this payment (fires before user is
> redirected back)

Only the sequential case was handled — the webhook finishing *first*. Both
arriving at once was not.

The early check stays, because it does something the claim does not: it returns
the human-facing order number and saves a Paystack round trip in the common
case. It is now documented as a fast path rather than a guard, with
`claimPaymentOnce` as the actual gate.

## Fixed: stock oversold across DIFFERENT orders, and training capacity

Both had the same shape — check a bound, then change a counter, with no lock in
between:

```js
// marketplace stock
if (currentQty >= item.quantity) {
    transaction.update(ref, { availableQuantity: FieldValue.increment(-item.quantity) });
} else {
    throw new Error(`Insufficient stock for product: ${item.productTitle}`);
}

// training capacity
if (event.currentParticipants >= event.maxParticipants) throw new Error("Event is full");
transaction.update(eventRef, { currentParticipants: FieldValue.increment(1) });
```

Two buyers took the last unit and both passed; two people took the last seat and
both registered. Migration `010` made both worse rather than better, as it did
for escrow and cooperative savings: the increments used to lose one another,
which hid the overshoot.

Migration `015` adds the two primitives.

### Why not `debit_jsonb_balance` (013/014)

It already does exactly this for a single field, and capacity nearly fits — but
it enforces a floor, not a ceiling against a value held in another field.

Stock is the harder case: an order decrements **several** products and must be
all-or-nothing. Calling a single-item function per product would leave the first
items decremented when the third turns out to be short — worse than the
behaviour it replaced, where a throw meant the queued writes never landed at
all. So `decrement_many_or_fail` takes the whole order, locks every row **in id
order** (two orders listing the same products in opposite sequence would
otherwise deadlock), checks them all, and only then writes.

### The order of operations in `_payment.ts`

Stock is now reserved **after** `claimPaymentOnce` and **before** the fulfilment
transaction. That ordering is deliberate:

- After the claim, because the claim is what makes the whole path idempotent.
  Reserving first would let a retry decrement a second time.
- Before the transaction, because the transaction takes no lock and cannot be
  where the decision is made.

The in-transaction decrement was **removed**, not left alongside — keeping both
would take stock twice. The reads in that transaction run after the reservation,
so `availableQuantity` there is already the post-decrement figure, which is what
the low-stock alert should report.

### The gap this exposed, and closed

If stock is short *after* the payment is claimed, the buyer has paid for
something that cannot ship. The old code threw inside the transaction and
returned a generic error — and because the reference was already claimed, a
retry took the "already processed" path and told the buyer their order was live.
Real money, no order, no trace.

Nothing is decremented in that case (015 is all-or-nothing), so the only thing
outstanding is the refund. The order is now marked
`paymentStatus: "paid_awaiting_refund"` / `status: "cancelled_out_of_stock"`
with the amount and reason recorded, and the buyer is told they have been
charged and a refund is coming.

**This still needs an operational follow-up:** nothing yet *processes* those
refunds. They are findable rather than silent, which is the difference between a
bug and a lost payment, but somebody has to run the refund.

### Uncapped events

`increment_within_ceiling` treats a missing ceiling as unbounded. Events created
without `maxParticipants` must keep accepting registrations; refusing them would
break every uncapped session on the platform.

## Not yet migrated

Ordered by `runTransaction` count. Presence here is not proof of a live defect —
some of these transactions touch no balance — but each needs reading before it
can be ruled out.

| Count | File | Notes |
|---|---|---|
| 7 | `src/app/actions/admin.ts` | Withdrawal payout converted. Loan approval NOT converted — see the security note below. |
| 1 | `src/infrastructure/payments/service.ts` | All fulfilment paths converted; only `processExportInvestment` keeps its wrapper — see below. |
| 4 | `src/app/actions/marketplace/_escrow.ts` | Both money paths converted; 4 non-money status transitions remain — see below. |
| 6 | `src/app/actions/academy/_actions.ts` | Payment claim converted; 6 non-payment transitions remain. |
| 4 | `src/app/actions/farm-nation.ts` | Property reservation and cancellation converted; 4 non-inventory transitions remain. |
| 4 | `src/app/actions/wave/_actions.ts` | Earnings withdrawal and training capacity converted; 4 non-money transitions remain. |
| 5 | `src/app/actions/wallet.ts` | Remaining non-balance transactions (withdrawal request, admin decisions). |
| 3 | `src/app/actions/cooperative/_actions.ts` | Both overdraft paths converted; 3 non-money transitions remain. |
| 4 | `src/app/actions/vendor-settings.ts` | |
| 2 | `src/app/actions/marketplace/_escrow_actions.ts` | Release and refund converted; 2 non-money transitions remain. |
| 4 | `src/app/actions/marketplace/_actions.ts` | |
| 4 | `src/app/actions/loan-actions.ts` | |
| 4 | `src/app/actions/cooperative/_loans.ts` | |
| 4 | `src/app/actions/cooperative/_admin.ts` | |
| 3 | `src/app/actions/wave/_admin.ts` | |
| 3 | `src/app/actions/marketplace/_payment.ts` | Payment claim and stock reservation converted; 3 order-creation transitions remain. |
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
