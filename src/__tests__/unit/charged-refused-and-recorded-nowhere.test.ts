/**
 * @jest-environment node
 */

/**
 *   #760 A PAYSTACK PAYMENT THE PLATFORM HAD ALREADY TAKEN WAS REFUSED, AND THE
 *        ONLY RECORD WAS A LOG LINE.
 *
 *   Reported by the owner, following on from the nine unrecorded academy
 *   learners: "there were discounts you can also check for those who paid during
 *   that time."
 *
 *   THERE IS NO DISCOUNT MECHANISM IN THIS CODEBASE. An academy course carries
 *   a single `price`; there is no coupon, no promo code, no sale price, in the
 *   academy types or anywhere else. So a learner charged a discounted amount is
 *   — to `checkOrderPaymentAmount` — an UNDERPAYMENT, and underpayment is
 *   refused.
 *
 *   What that refusal did:
 *
 *       logger.warn(`Price mismatch for course ...`);
 *       return { success: false, error: `Payment amount (X) does not match ...` };
 *
 *   And by that line Paystack has ALREADY confirmed the payment — the
 *   `paymentData.data.status !== "success"` guard is sixty lines above it. So
 *   the learner has been charged. There is no processed_payments row, because
 *   this path never reaches claimPaymentOnce; order-payment-amount.ts states
 *   that plainly. There is no enrolment. There is no queue entry. The money is
 *   with Paystack, the platform owes the learner either the course or a refund,
 *   and it knows about neither.
 *
 * ── THE COLLECTION FOR THIS ALREADY EXISTED ─────────────────────────────────
 *
 *   The Paystack webhook routes a marketplace OVERpayment to FAILED_PAYMENTS
 *   under `overfunded_review`, and the reasoning beside it is this finding's
 *   reasoning: "the surplus was simply unrecorded". Same shape, same
 *   collection — and the academy path, which strands the whole amount rather
 *   than a surplus, wrote nothing.
 *
 * ── THE REFUSAL IS KEPT, DELIBERATELY ───────────────────────────────────────
 *
 *   Fulfilling a course for less than it costs is a decision about discounts
 *   and belongs to the owner, not to a check quietly lowered to make a symptom
 *   go away. #711's own note on the marketplace equivalent settles the
 *   direction: "UNDERPAYMENT IS REFUSED... fulfilling an order for less than it
 *   costs is the one case where refusing is clearly right."
 *
 *   What changes is that the money stops being invisible — and the learner is
 *   told it has been recorded rather than left with a bare error.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { checkOrderPaymentAmount } from '@/lib/order-payment-amount';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const PAYMENT = 'src/app/actions/academy/_payment.ts';
const FORENSICS = 'src/app/actions/forensics.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#760 — the premise: a discount reads as an underpayment', () => {
    it('THERE IS NO DISCOUNT MECHANISM FOR AN ACADEMY COURSE', () => {
        /*
         *   The fact the owner's report turns on, asserted rather than assumed.
         *   If a coupon or sale price existed, a discounted payment would be
         *   expected and this finding would be about something else.
         */
        for (const f of ['src/lib/types/academy.ts', 'src/lib/types/academy-actions.ts']) {
            const src = code(f).toLowerCase();
            expect({ f, discount: /discount|coupon|promo|saleprice/.test(src) })
                .toEqual({ f, discount: false });
        }
    });

    it('AND A PAYMENT BELOW THE PRICE IS REFUSED', () => {
        //   ₦25,000 against a ₦50,000 course — the owner's own figures.
        const verdict = checkOrderPaymentAmount(25_000, 50_000);

        expect(verdict.ok).toBe(false);
        expect(verdict).toMatchObject({ reason: 'underpaid', shortfall: 25_000 });
    });

    it('and BOTH refusals are KEPT — this finding does not lower either check', () => {
        /*
         *   Stated as a decision. Making the symptom go away by fulfilling
         *   underpaid courses would be a discount policy invented by a test.
         *
         *   COUNTED, not matched. A first draft asserted
         *   `toContain('if (!amountVerdict.ok)')` and the mutant that removed
         *   the COURSE path's refusal SURVIVED — because that expression occurs
         *   TWICE in this file and the other occurrence satisfied it. Reading
         *   the second one is what revealed that the PLAN-fee path had the
         *   identical unrecorded-money hole, which this finding then also fixed.
         */
        const refusals = [...code(PAYMENT).matchAll(/if \(!amountVerdict\.ok\) \{/g)];

        expect(refusals).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#760 — the money is recorded where somebody looks', () => {
    it('BOTH REFUSED-BUT-PAID PATHS WRITE A FAILED_PAYMENTS ROW', () => {
        /*
         *   Two payment routes, two refusals, two records. The course purchase
         *   and the plan registration fee both reach a point where Paystack has
         *   confirmed the money and the platform declines to fulfil, and only
         *   the first was covered by my first version of this fix.
         */
        const src = code(PAYMENT);
        const rows = [...src.matchAll(/COLLECTIONS\.FAILED_PAYMENTS/g)];

        expect(rows).toHaveLength(2);
        expect(src).toContain('"academy_course_amount_mismatch"');
        expect(src).toContain('"academy_plan_amount_mismatch"');
        expect([...src.matchAll(/status: "awaiting_review"/g)]).toHaveLength(2);
    });

    it('AND IT CARRIES WHAT AN ADMIN NEEDS TO ACT', () => {
        /*
         *   A row saying only "something failed" is the log line again in a
         *   table. Deciding between fulfilling and refunding needs the learner,
         *   the course, what was charged and what was expected.
         */
        const src = code(PAYMENT);
        const block = src.slice(src.indexOf('COLLECTIONS.FAILED_PAYMENTS'));

        for (const field of ['reference', 'userId', 'courseId', 'amountPaid', 'expectedAmount']) {
            expect({ field, present: block.slice(0, 900).includes(`${field},`) || block.slice(0, 900).includes(`${field}:`) })
                .toEqual({ field, present: true });
        }
    });

    it('AND IT SAYS THE LEARNER WAS CHARGED AND IS NOT ENROLLED', () => {
        //   The one sentence that tells whoever opens this row why it is
        //   urgent. "Amount mismatch" alone reads as a validation nicety.
        const src = code(PAYMENT);

        expect(src).toContain('has been charged and is NOT enrolled');
        //   And the plan path's equivalent, which is "not registered".
        expect(src).toContain('has been charged and is NOT registered');
    });

    it('AND RECORDING IT NEVER FAILS THE REFUSAL', () => {
        /*
         *   The write is best-effort on purpose: the learner is already being
         *   refused, and a throw here would replace a clear error with a crash
         *   while still leaving the money unrecorded. Same treatment the
         *   webhook's overpayment row gets.
         */
        const src = code(PAYMENT);
        const block = src.slice(src.indexOf('COLLECTIONS.FAILED_PAYMENTS'));

        expect(block.slice(0, 1200)).toContain('.catch(');
        //   Both of them.
        expect([...src.matchAll(/Could not record the stranded/g)]).toHaveLength(2);
    });

    it('and the learner is told it was recorded, not just refused', () => {
        //   "Contact support" is actionable; a bare amount mismatch is not.
        expect([...code(PAYMENT).matchAll(/recorded for review/g)]).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#760 — and the forensic scan surfaces it', () => {
    it('THE MONEY CHECK READS THE AWAITING-REVIEW ROWS', () => {
        /*
         *   Added to "Money Waiting For A Human" rather than given its own
         *   check: the question that screen asks is "whose money is sitting
         *   somewhere it should not be", and the answer was three-quarters
         *   complete — loans, overpayments and escrow, but not this.
         */
        const src = code(FORENSICS);

        expect(src).toContain('COLLECTIONS.FAILED_PAYMENTS');
        expect(src).toContain('"status", "==", "awaiting_review"');
    });

    it('AND THE COUNT IS REPORTED, NOT JUST THE IDS', () => {
        //   The details line is what an admin reads before deciding to expand
        //   the list. Leaving this out of it hides the whole category.
        expect(code(FORENSICS)).toContain('payment(s) taken and then refused on the amount');
    });

    it('AND EACH ENTRY NAMES BOTH AMOUNTS', () => {
        /*
         *   Fulfil or refund is decided by the gap. An entry that says only
         *   "payment refused" sends the admin back to Paystack to find out
         *   what this check already knew.
         */
        const src = code(FORENSICS);
        const block = src.slice(src.indexOf('const stranded ='));

        expect(block.slice(0, 900)).toContain('data.amountPaid');
        expect(block.slice(0, 900)).toContain('data.expectedAmount');
    });

    it('and it stays a warning rather than a failure', () => {
        //   Nothing here is corrupt. It is money that stopped halfway, which is
        //   what the check's own comment says it collects.
        expect(code(FORENSICS)).toContain('status: owed.length > 0 ? "warning" : "pass"');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the COURSE FAILED_PAYMENTS row is not written                  KILLED
 *     the row loses the expected amount                              KILLED
 *     the course row is written already resolved                     KILLED
 *     the PLAN path stops recording its stranded money               KILLED
 *     the scan stops reading awaiting_review                         KILLED
 *     the scan reports the ids without the amounts                   KILLED
 *     the refusal is lowered to fulfil an underpayment               KILLED †
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   † THIS SWEEP FOUND THAT THE FIX WAS HALF DONE, WHICH IS THE WHOLE REASON
 *     TO RUN ONE. The mutant removing the COURSE path's refusal SURVIVED,
 *     because `if (!amountVerdict.ok)` occurs TWICE in that file and the
 *     assertion matched the other occurrence. Reading the second one showed the
 *     PLAN-FEE path had the identical unrecorded-money hole — and ₦25,000,
 *     ₦50,000 and ₦100,000, the owner's own figures, are PLAN prices, so it is
 *     the likelier of the two to be holding their money. Both paths record now,
 *     and every assertion here COUNTS rather than matches.
 *
 *     Two of these mutants were badly designed first time and are recorded
 *     rather than quietly re-run: one inserted a duplicate object key that JS
 *     then overwrote, so the mutation never took effect; the other used an
 *     anchor occurring twice and patched whichever came first.
 */
