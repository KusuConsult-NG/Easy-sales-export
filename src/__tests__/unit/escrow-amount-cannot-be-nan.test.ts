/**
 * @jest-environment node
 */

/**
 *   #409 THE LIVE ESCROW WRITE HAD NO AMOUNT CHECK — THE RETIRED ONE DID.
 *
 *   Found by sweeping .tsx and .ts for divisions by a `.length` with no
 *   zero-guard, after #408 turned up a NaN progress bar in a loans component.
 *   Seven sites; five were guarded or provably safe. Two were the marketplace
 *   delivery-fee split, on both halves of a real checkout:
 *
 *       const deliveryFeePerSeller = orderData.deliveryFee / uniqueSellers.length;
 *
 *   `orderData.deliveryFee` is read back off a stored order. An order written
 *   before the field existed, or by any path that omitted it, gives
 *   `undefined / n` — NaN. Every sellerTotal becomes NaN, platformFeeFor and
 *   sellerNetFor propagate it, and the escrow rows are written with amount,
 *   grossAmount, platformFee and netAmount all NaN. Nothing downstream tests
 *   for it: the release path reads the stored amount and pays it.
 *
 *   THE GUARD EXISTED — ON THE DOOR #398 RETIRED
 *   ---------------------------------------------
 *   _escrow_lifecycle.ts was shut down because nothing ever called it, and its
 *   create opens with `if (!Number.isFinite(data.amount) || data.amount <= 0)`.
 *   The dispute resolver checks too. The LIVE creation — the one every Paystack
 *   checkout goes through — did not. That is #112 exactly ("the escrow amount
 *   check fails open when the amount is unreadable") standing on the path that
 *   actually runs, while the unreachable copy was careful.
 *
 *   WHERE EACH HALF REFUSES, AND WHY THEY DIFFER
 *   ---------------------------------------------
 *   The two halves deliberately do NOT behave the same, and the reason is who
 *   has paid:
 *
 *     _payment_orders (before Paystack)  returns a refusal. Nobody has paid, so
 *                                        the order simply does not proceed.
 *     _payment_verify (after Paystack)   throws inside the transaction. The
 *                                        buyer HAS paid; a throw is retryable
 *                                        and visible to the reconciliation jobs
 *                                        (#298/#299), whereas a NaN written
 *                                        here is money the release path pays.
 *
 *   A missing delivery fee is treated as zero rather than as a reason to abort,
 *   for the same reason: refusing after payment would leave a verified payment
 *   with no escrow at all, which is worse than an understated fee. What must
 *   never happen is a NaN reaching the ledger.
 *
 *   ALSO FIXED: components/loans/RepaymentSchedule.tsx, which nothing imports.
 *   It computed `paidCount / schedule.length` — 0/0 = NaN — and rendered it as
 *   "NaN%" and `style={{ width: "NaN%" }}`, and it treated a failed read as an
 *   empty schedule. Both faults fire together, on a borrower's loan, the moment
 *   somebody adds the import. #403's rule at its cheapest.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the verify-side amount check is dropped        KILLED
 *     the order-side refusal is dropped              KILLED
 *     the fee sanitisation reverts to a raw divide   KILLED
 *     the NaN progress guard is removed              KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const VERIFY = 'src/app/actions/marketplace/_payment_verify.ts';
const ORDERS = 'src/app/actions/marketplace/_payment_orders.ts';
const RETIRED = 'src/app/actions/marketplace/_escrow_lifecycle.ts';
const SCHEDULE = 'src/components/loans/RepaymentSchedule.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#409 — no escrow row can be written with a non-finite amount', () => {
    it('THE LIVE VERIFY PATH CHECKS THE AMOUNT BEFORE transaction.set', () => {
        const src = code(VERIFY);
        const guard = src.indexOf('!Number.isFinite(grossAmount)');
        const write = src.indexOf('transaction.set(escrowRef');
        expect({ guarded: guard > -1 }).toEqual({ guarded: true });
        expect({ write: write > -1 }).toEqual({ write: true });
        expect({ guardFirst: guard < write }).toEqual({ guardFirst: true });
        // …and refuses zero and negatives too, not merely NaN.
        expect(src).toMatch(/grossAmount <= 0/);
    });

    it('and the order-creation path refuses BEFORE the buyer reaches Paystack', () => {
        const src = code(ORDERS);
        const guard = src.indexOf('!Number.isFinite(grossAmount)');
        const write = src.indexOf('await escrowRef.set(');
        expect({ guarded: guard > -1 }).toEqual({ guarded: true });
        expect({ guardFirst: guard > -1 && guard < write }).toEqual({ guardFirst: true });
        // A refusal, not a throw: nothing has been charged at this point.
        const after = src.slice(guard, guard + 400);
        expect(after).toMatch(/success: false/);
    });

    it('and the two halves differ deliberately — refuse before payment, throw after', () => {
        /**
         * Asserted because the asymmetry looks like an inconsistency and is not.
         * After Paystack has taken the money, returning a refusal would leave a
         * verified payment with no escrow; a throw rolls the transaction back
         * and leaves a retryable failure the reconciliation jobs can see.
         */
        const verify = code(VERIFY);
        const guardAt = verify.indexOf('!Number.isFinite(grossAmount)');
        expect(verify.slice(guardAt, guardAt + 400)).toMatch(/throw new Error/);
    });

    it('and the delivery-fee split can no longer produce NaN on either side', () => {
        for (const file of [VERIFY, ORDERS]) {
            const src = code(file);
            // The raw divide is gone…
            expect(src).not.toMatch(/deliveryFee\s*\/\s*uniqueSellers\.length/);
            expect(src).not.toMatch(/calculatedDeliveryFee\s*\/\s*uniqueSellers\.length/);
            // …replaced by a finite check and a non-empty seller list.
            expect(src).toMatch(/Number\.isFinite\(\w+\)\s*&&\s*uniqueSellers\.length > 0/);
        }
    });

    it('and the RETIRED lifecycle still carries the check it always had', () => {
        // The comparison that makes the finding legible. If this ever loses its
        // guard the story in the header stops being true.
        expect(code(RETIRED)).toMatch(/!Number\.isFinite\(data\.amount\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#409 — the loans component cannot render NaN%', () => {
    it('THE PROGRESS PERCENTAGE IS GUARDED AGAINST AN EMPTY SCHEDULE', () => {
        const src = code(SCHEDULE);
        expect(src).toMatch(/schedule\.length > 0 \? \(paidCount \/ schedule\.length\) \* 100 : 0/);
        expect(src).not.toMatch(/const progressPercent = \(paidCount \/ schedule\.length\) \* 100;/);
    });

    it('and a failed read is shown as a failure, not as an empty schedule', () => {
        const src = code(SCHEDULE);
        expect(src).toMatch(/setError\(/);
        expect(src).toMatch(/\bcatch\b/);
        expect(src).toMatch(/\bfinally\s*\{/);
        // The error must be RENDERED — a state nothing reads changes nothing.
        expect(src).toContain('Repayment schedule unavailable');
        expect(src).toMatch(/if \(error\) \{/);
    });

    it('and it does not tell a borrower they owe nothing', () => {
        expect(code(SCHEDULE)).toMatch(/not a statement that you owe nothing/i);
    });
});
