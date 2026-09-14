/**
 * @jest-environment node
 */

/**
 *   #745 EVERY RULE ON A COOPERATIVE LOAN'S AMOUNT AND DURATION WAS WRITTEN AS
 *        "NOT MORE THAN", SO ZERO AND NEGATIVE PASSED ALL OF THEM.
 *
 *   #744 found the tier CEILING failing open on an unreadable number. Looking
 *   at the same two values from the other end: there was no FLOOR on either.
 *
 *       formData.amount > maxLoanAmount            the only amount rule
 *       formData.durationMonths > maxDuration      the only duration rule
 *
 *   Both bound the top. Nothing bound the bottom, and the duration is the one
 *   that costs money, because the amortisation loop underneath is
 *
 *       for (let i = 1; i <= n; i++) { …accrue interest… }
 *
 *   Any n below 1 runs ZERO iterations, so no interest accrues at all and the
 *   application is filed with `totalRepayment` equal to the principal:
 *
 *       durationMonths   clears cap   interest   monthlyPayment
 *       null             yes          0          Infinity
 *       0                yes          0          Infinity
 *       -5               yes          0          -10,000
 *       "abc"            yes          0          NaN
 *
 *   An interest-free loan, in the queue an admin approves from, with nothing on
 *   the row to say it was not a legitimate quote.
 *
 * ── HOW REACHABLE THIS IS, STATED PLAINLY ───────────────────────────────────
 *
 *   submitLoanApplicationAction HAS NO UI CALLER. #370 measured that and #377
 *   corrected what it meant; both notes are at the top of that file, and this
 *   finding does not disturb them.
 *
 *   It is still a `"use server"` export, which is addressable over the network
 *   whether or not a screen calls it — and that is exactly the reasoning #345
 *   used to fix the NEIGHBOURING FIELD OF THE SAME REQUEST:
 *
 *       "This is a 'use server' export, so a request carrying
 *        `contributionAmount: 50_000_000` cleared the ₦5,000 minimum and the
 *        cap and filed a pending application for ₦25m against a member with
 *        nothing saved."
 *
 *   #345 hardened `contributionAmount` and left `durationMonths` and `amount`
 *   beside it. This is the rest of that request.
 *
 * ── AND THE AMOUNT FLOOR IS DEFENCE IN DEPTH, NOT A LIVE HOLE ───────────────
 *
 *   Said plainly because the difference matters. The member door members
 *   actually use — _applyForLoanAction — parses through `loanApplicationSchema`,
 *   which already has `z.coerce.number().positive(...)`, so a zero or negative
 *   amount cannot reach it. The floor added to isEligibleForLoan protects the
 *   unvalidated action and any future caller; it does not close an open door on
 *   the live path.
 *
 *   It is placed in isEligibleForLoan rather than at the call sites because the
 *   apply-loan route already names that function as the single home of the
 *   rule: "so a future change to it reaches every path at once".
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full and every row below
 *   is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    loanDurationProblem, isEligibleForLoan, getTierMaxDuration, COOPERATIVE_TIERS,
} from '@/lib/cooperative-tiers';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
const MAX = getTierMaxDuration('Member');

// ─────────────────────────────────────────────────────────────────────────────
describe('#745 — the mechanism: a loop that never runs charges no interest', () => {
    /** The amortisation exactly as the action computes it. */
    function interestKobo(amountKobo: number, monthlyRate: number, n: any): number {
        let total = 0;
        let remaining = amountKobo;
        const monthly = Math.round(
            (amountKobo * (monthlyRate * Math.pow(1 + monthlyRate, n))) / (Math.pow(1 + monthlyRate, n) - 1),
        );
        for (let i = 1; i <= n; i++) {
            const ia = Math.round(remaining * monthlyRate);
            total += ia;
            remaining -= (monthly - ia);
        }
        return total;
    }

    it('A DURATION UNDER ONE ACCRUES NOTHING, WHICH IS THE WHOLE HARM', () => {
        for (const n of [0, -5, null, 'abc']) {
            expect(interestKobo(5_000_000, 0.005, n)).toBe(0);
        }
    });

    it('AND A REAL DURATION DOES ACCRUE — so zero means something', () => {
        //   Vacuity guard: if the helper above charged nothing for a good
        //   duration either, the assertion would be about nothing.
        expect(interestKobo(5_000_000, 0.005, 6)).toBeGreaterThan(0);
    });

    it('AND NONE OF THOSE WAS STOPPED BY A CEILING-ONLY CHECK', () => {
        //   The old rule, run against each. Every one passes.
        for (const n of [0, -5, null]) {
            expect((n as any) > MAX).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#745 — the duration rule now has both ends', () => {
    it('ZERO, NEGATIVE AND FRACTIONAL ARE REFUSED', () => {
        expect(loanDurationProblem(0, MAX)).toContain('at least one month');
        expect(loanDurationProblem(-5, MAX)).toContain('at least one month');
        expect(loanDurationProblem(1.5, MAX)).toContain('whole number');
    });

    it('AND SO IS ANYTHING THAT IS NOT A NUMBER AT ALL', () => {
        /*
         *   Takes `unknown` deliberately. The action declares
         *   `durationMonths: number` on its parameter interface and validates
         *   nothing at runtime — and a TypeScript annotation is not a check on
         *   a value that arrived as JSON. That assumption IS the defect.
         */
        for (const bad of [null, undefined, 'abc', '6', NaN, Infinity, {}, []]) {
            expect({ bad, problem: loanDurationProblem(bad, MAX) !== null })
                .toEqual({ bad, problem: true });
        }
    });

    it('AND THE CEILING IT ALREADY HAD STILL HOLDS', () => {
        expect(loanDurationProblem(MAX + 1, MAX)).toContain(`Maximum: ${MAX}`);
    });

    it('AND A LEGITIMATE DURATION IS ACCEPTED', () => {
        //   The guard every refusal above needs: a rule that refused everything
        //   would satisfy all of them and let nobody borrow.
        expect(loanDurationProblem(1, MAX)).toBeNull();
        expect(loanDurationProblem(6, MAX)).toBeNull();
        expect(loanDurationProblem(MAX, MAX)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#745 — and the amount rule has a floor', () => {
    const CONTRIBUTION = COOPERATIVE_TIERS.Member.minContribution * 10;

    it('ZERO AND NEGATIVE ARE REFUSED', () => {
        expect(isEligibleForLoan(CONTRIBUTION, 0, 0).eligible).toBe(false);
        expect(isEligibleForLoan(CONTRIBUTION, -50_000, 0).eligible).toBe(false);
        expect(isEligibleForLoan(CONTRIBUTION, -50_000, 0).reason).toContain('greater than zero');
    });

    it('AND A NEGATIVE OUTSTANDING BALANCE IS REFUSED', () => {
        //   It is the other operand of `requested + outstanding > maxLoan`, and
        //   a negative there makes room the member does not have.
        expect(isEligibleForLoan(CONTRIBUTION, 1_000, -1_000_000).eligible).toBe(false);
    });

    it('AND A LEGITIMATE REQUEST IS STILL ELIGIBLE', () => {
        expect(isEligibleForLoan(CONTRIBUTION, 1_000, 0)).toEqual({ eligible: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#745 — the action reads the rule rather than restating half of it', () => {
    const ACTION = 'src/app/actions/cooperative/_loans_applications.ts';

    it('THE CEILING-ONLY CHECK IS GONE', () => {
        expect(code(ACTION)).not.toContain('formData.durationMonths > maxDuration');
    });

    it('AND THE SHARED RULE IS CALLED WITH THE TIER MAXIMUM', () => {
        const src = code(ACTION);

        expect(src).toContain('loanDurationProblem(formData.durationMonths, maxDuration)');
        expect(src).toContain('const maxDuration = getTierMaxDuration(actualTier)');
    });

    it('AND IT REFUSES BEFORE THE SCHEDULE IS BUILT, NOT AFTER', () => {
        /*
         *   A check that runs after the amortisation would still file nothing,
         *   but it would have divided by the bad duration on the way — and
         *   `monthlyPayment` is the value that goes on the record.
         */
        const src = code(ACTION);
        const checkAt = src.indexOf('loanDurationProblem(');
        const scheduleAt = src.indexOf('const monthlyPaymentKobo =');

        expect(checkAt).toBeGreaterThan(-1);
        expect(scheduleAt).toBeGreaterThan(checkAt);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#745 — and the live door was already guarded, which is why this is depth', () => {
    it('THE MEMBER ENTRANCE PARSES ITS AMOUNT AS POSITIVE', () => {
        /*
         *   Asserted so the severity claim in the header is checkable rather
         *   than a claim. If this ever stops being true, the amount floor above
         *   becomes a live control and this test is where that shows up.
         */
        const schema = code('src/lib/types/cooperative.ts');
        const at = schema.indexOf('export const loanApplicationSchema');

        expect(at).toBeGreaterThan(-1);
        expect(schema.slice(at, at + 400)).toContain('z.coerce.number().positive(');
    });

    it('AND THE SIBLING ROUTE ALREADY HAD THE DURATION RULE', () => {
        //   Where the shape came from: one path guarded, one did not.
        expect(code('src/app/api/cooperative/apply-loan/route.ts'))
            .toContain('Number.isInteger(product.durationMonths)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by full path, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the duration rule loses its floor                              KILLED
 *     the duration rule loses its integer check                      KILLED
 *     the duration rule loses its ceiling                            KILLED
 *     the duration rule refuses everything                           KILLED
 *     the amount floor is removed                                    KILLED
 *     the negative-outstanding check is removed                      KILLED
 *     the action goes back to the ceiling-only check                 KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
