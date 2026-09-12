/**
 * @jest-environment node
 */

/**
 *   #668 THE ONE CASE WHERE A MEMBER MUST NOT PAY AGAIN WAS THE CASE THAT TOLD
 *   THEM TO.
 *
 *   Followed from the captured server log's four "Academy payment verification
 *   error" lines. The question was not whether the error was handled — it is —
 *   but what a member sees when it happens to a real payment.
 *
 *   All three academy verifiers have the same shape: claim the Paystack
 *   reference, then fulfil. The claim is the moment THIS CALL owes the delivery
 *   — `claimPaymentOnce` has banked the reference and the money is ours. A
 *   failure after it means the member has paid and has nothing.
 *
 *   All three handled it. ONE SAID SO:
 *
 *     verifyEnrollmentPaymentAction  "…contact support with reference: <ref>"  ✅
 *     verifyAcademyPaymentAction     "Failed to verify payment"                ❌
 *     verifyCoursePaymentAction      "Failed to verify payment"                ❌
 *
 *   AND THE SCREEN DISCARDED ALL THREE. academy/payment/callback did
 *
 *       setStatus(result.success ? "success" : "failed");
 *
 *   and rendered one fixed panel: a red cross, "Payment Verification Failed",
 *   "We couldn't verify your payment. Please try again or contact support", and
 *   a button labelled **Try Again** linking back to the payment flow.
 *
 *   So a member who has been charged, whose reference is banked, and whose
 *   enrolment failed, was shown the most emphatic possible instruction to pay a
 *   second time — and was not told the reference, so they could not tell support
 *   which payment they meant. The one careful message that existed never
 *   reached them either.
 *
 * ── WHAT IS AND IS NOT CLAIMED ──────────────────────────────────────────────
 *
 *   A second payment is a NEW reference, so `claimPaymentOnce` does not stop it
 *   — the guard is per reference, and it is the right guard. Nothing here
 *   claims a double charge was common; what it claims is that the screen
 *   pointed at one, and that the member had no way to know the first payment
 *   had landed.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import { paidButNotFulfilled, PAID_FULFILMENT_FAILED } from '@/lib/paid-but-not-fulfilled';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const SCREEN = 'src/app/academy/payment/callback/page.tsx';
const ACADEMY = 'src/app/actions/academy/_payment.ts';
const COURSE = 'src/app/actions/academy/_ac_course_payment.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#668 — what the member is told when the money was taken', () => {
    const refusal = paidButNotFulfilled('T1789209406387');

    it('IT SAYS THE PAYMENT ARRIVED', () => {
        //   THE defect. "Failed to verify payment" reads as "your card was
        //   declined" to somebody who has just been charged.
        expect(refusal.error).toContain('received your payment');
    });

    it('AND SAYS NOT TO PAY AGAIN', () => {
        //   Because the button beside it used to say the opposite.
        expect(refusal.error).toMatch(/do NOT pay again/i);
    });

    it('AND CARRIES THE REFERENCE, WHICH SUPPORT CANNOT ACT WITHOUT', () => {
        //   The member has no other copy of it.
        expect(refusal.error).toContain('T1789209406387');
        expect(refusal.meta.reference).toBe('T1789209406387');
    });

    it('AND A CODE, SO THE SCREEN BRANCHES ON A FACT RATHER THAN ON PROSE', () => {
        /*
         *   A screen that matched the sentence would break the day the wording
         *   improved — and the wording is the part most likely to be improved.
         */
        expect(refusal.meta.code).toBe(PAID_FULFILMENT_FAILED);
        expect(refusal.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#668 — and all three verifiers return it', () => {
    it.each([
        ['the academy registration flow', ACADEMY],
        ['the course purchase flow', COURSE],
    ])('%s', (_name, file) => {
        /*
         *   Guarded on `claimedReference`, which is the only honest test of
         *   whether the money is ours: it is set at the moment the reference is
         *   claimed and nowhere else.
         */
        expect(code(file)).toContain('if (claimedReference) return paidButNotFulfilled(claimedReference);');
    });

    it('AND THE ENROLLMENT FLOW, WHICH WAS ALREADY THE ONE THAT GOT IT RIGHT', () => {
        /*
         *   It named the reference before any of this. It is routed through the
         *   same module anyway, because one of three doors being right is how
         *   the other two stayed wrong — and the shared wording adds the part it
         *   was missing, "do not pay again", which is what the screen's button
         *   was contradicting.
         */
        const academy = code(ACADEMY);
        expect((academy.match(/if \(claimedReference\) return paidButNotFulfilled/g) ?? []).length).toBe(2);
    });

    it('AND A FAILURE BEFORE THE CLAIM STILL SAYS "try again"', () => {
        /*
         *   THE positive control, and the reason this is not "never offer a
         *   retry". Before the claim nothing was collected in our name — an
         *   unreachable Paystack, a declined card — and retrying is the correct
         *   advice. A fix that told everybody their money had been taken would
         *   pass every assertion above.
         */
        for (const file of [ACADEMY, COURSE]) {
            expect(`${file}: ${code(file).includes('error: "Failed to verify payment"')}`)
                .toBe(`${file}: true`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#668 — and the screen stops pointing at a second payment', () => {
    const screen = code(SCREEN);

    it('IT KEEPS THE ACTION\'S MESSAGE INSTEAD OF DISCARDING IT', () => {
        //   `setStatus(result.success ? "success" : "failed")` kept one bit and
        //   threw away the sentence — including the one that named the
        //   reference.
        expect(screen).toContain('setFailure(');
        expect(screen).toContain('{failure.message');
    });

    it('AND BRANCHES ON THE CODE', () => {
        expect(screen).toContain('meta?.code === PAID_FULFILMENT_FAILED');
    });

    it('AND OFFERS SUPPORT RATHER THAN "Try Again" WHEN THE MONEY WAS TAKEN', () => {
        /*
         *   THE whole finding, as one assertion. Anchored on the conditional
         *   rather than on the words appearing somewhere — both strings are
         *   still in the file, because the other branch still offers the retry.
         */
        expect(screen).toContain('{failure.paid ? (');
        expect(screen).toContain('Contact support');
    });

    it('AND STILL OFFERS IT TO EVERYBODY ELSE', () => {
        //   The control on the line above: removing the retry entirely would
        //   satisfy it and strand every member whose card was simply declined.
        expect(screen).toContain('href={retryHref}');
        expect(screen).toContain('Try Again');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the screen offers Try Again to a paid member        KILLED
 *     the screen discards the message again                           KILLED
 *     the screen branches on the sentence instead of the code         KILLED
 *     the academy flow stops returning the paid refusal               KILLED
 *     the course flow stops returning it                              KILLED
 *     the refusal stops naming the reference                          KILLED
 *     the refusal stops saying "do not pay again"                     KILLED
 *     every failure is reported as paid                               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The four "Academy payment verification error" lines came from a real run —
 *   362 Playwright tests against a production build with the server's output
 *   captured. The three verifiers and the callback screen were then read one at
 *   a time; the claim boundary (`claimedReference`, set immediately after
 *   `claimPaymentOnce` succeeds) is what separates "the money is ours" from
 *   "nothing was collected", and it is what the refusal is guarded on.
 */
