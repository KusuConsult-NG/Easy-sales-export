/**
 * @jest-environment node
 */

/**
 *   #744 THE ONLY AMOUNT CAP IN THE LOAN APPROVAL PATH READ A FIELD ONE OF THE
 *        TWO COOPERATIVE APPLICATION PATHS NEVER WRITES, AND A MISSING NUMBER
 *        ADMITS EVERY AMOUNT.
 *
 *   `_loans_decisions.ts` capped an approval with
 *
 *       const maxLoan = getMaxLoanAmount(appData.contributionAmount);
 *       if (appData.amount > maxLoan) { refuse }
 *
 *   `contributionAmount` is declared OPTIONAL on the stored shape
 *   (types/firestore.ts), and `/api/cooperative/apply-loan` builds its
 *   application document without it — the field is simply not in the literal.
 *   `undefined * multiplier` is NaN, and
 *
 *       anything > NaN   === false
 *
 *   so the refusal never fired. It was the only amount cap in the function.
 *
 * ── IT IS THE GUARANTOR FAULT FROM THE TOP OF THE SAME FUNCTION, INVERTED ───
 *
 *   That one is recorded in place, eight lines above:
 *
 *       "Demanded unconditionally, which refused every application filed
 *        through the member loan page — that path collects no guarantor, so the
 *        field is absent and always will be."
 *
 *   Identical cause — a field absent on one creation path, met by a check
 *   written as though it were always present. Opposite outcome: that one failed
 *   CLOSED and was noticed because nothing could be approved. This one failed
 *   OPEN, and nothing about it is visible from the outside.
 *
 * ── AND FIXING IT WITHOUT SCOPING WOULD HAVE BEEN THE SAME FAULT AGAIN ──────
 *
 *   LOAN_APPLICATIONS holds BOTH products: `actions/loan-actions.ts` writes
 *   BUSINESS loans into it, with no contributionAmount and no cooperative
 *   membership. A savings-multiple cap is a cooperative rule a business
 *   application has nothing to satisfy — and applying it to both was only
 *   survivable BECAUSE of the NaN.
 *
 *   So the first repair here refused every business approval, and the existing
 *   suite caught it. The cap is scoped by the product classifier now, the way
 *   the guarantor rule beside it is scoped by the shape of the application.
 *
 * ── AND THE CAP IS READ LIVE, NOT FROM THE APPLICATION ──────────────────────
 *
 *   Both cooperative application paths already read the balance live, through
 *   findCooperativeMemberRow + readCooperativeBalance (#345 put it on each).
 *   Only the DECISION trusted a denormalised copy. A cap is a statement about
 *   the member's savings now, and an approval can sit behind an application for
 *   weeks, so the copy was the wrong source even where it was present.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full against this suite
 *   AND #688's, and every row below is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { getMaxLoanAmount, isEligibleForLoan, COOPERATIVE_TIERS } from '@/lib/cooperative-tiers';
import { loanProductOf } from '@/lib/loan-product';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#744 — the mechanism: a comparison against NaN refuses nobody', () => {
    it('BOTH DIRECTIONS ARE FALSE, WHICH IS WHY READING THE GUARD SHOWS NOTHING', () => {
        const cap = (undefined as unknown as number) * 5;

        expect(Number.isNaN(cap)).toBe(true);
        expect(5_000_000 > cap).toBe(false);   // the cap as written — never refuses
        expect(5_000_000 <= cap).toBe(false);  // and inverting it would not help
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#744 — getMaxLoanAmount fails closed on a number it cannot read', () => {
    it('AN ABSENT CONTRIBUTION IS A CAP OF ZERO, NOT A CAP OF NaN', () => {
        /*
         *   Zero refuses. NaN admits. That is the whole difference, and it is
         *   the direction a limit must fail in.
         */
        expect(getMaxLoanAmount(undefined as unknown as number)).toBe(0);
        expect(getMaxLoanAmount(null as unknown as number)).toBe(0);
        expect(getMaxLoanAmount(NaN)).toBe(0);
        expect(getMaxLoanAmount('' as unknown as number)).toBe(0);
    });

    it('AND A REAL CONTRIBUTION STILL GIVES ITS REAL MULTIPLE', () => {
        //   Vacuity guard: a function that returned 0 for everything would
        //   satisfy the test above and refuse every member on the platform.
        const multiplier = COOPERATIVE_TIERS.Member.maxLoanMultiplier;

        expect(getMaxLoanAmount(100_000)).toBe(100_000 * multiplier);
        expect(getMaxLoanAmount(100_000)).toBeGreaterThan(0);
    });

    it('AND THE CAP OF ZERO ACTUALLY REFUSES AN AMOUNT', () => {
        //   Stated as the behaviour rather than the number, because "returns 0"
        //   only matters if 0 turns into a refusal at the comparison.
        expect(50_000 > getMaxLoanAmount(undefined as unknown as number)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#744 — and isEligibleForLoan had the same trap on both of its checks', () => {
    const FLOOR = COOPERATIVE_TIERS.Member.minContribution;

    it('AN UNREADABLE CONTRIBUTION NO LONGER CLEARS THE MINIMUM', () => {
        //   `NaN < floor` is false, so the floor admitted it.
        const r = isEligibleForLoan(undefined as unknown as number, 1_000_000, 0);

        expect(r.eligible).toBe(false);
        expect(r.reason).toContain('Minimum contribution');
    });

    it('AND AN UNREADABLE REQUEST IS REFUSED RATHER THAN TREATED AS ZERO', () => {
        /*
         *   THE SIDES NEED OPPOSITE TREATMENTS, and getting that backwards is
         *   its own way to fail open. What the member HAS falls back to zero,
         *   which refuses. What the member ASKS FOR must not: numberOrZero on
         *   the requested amount makes it 0, and `0 > maxLoan` is false — the
         *   guard reinstated facing the wrong way.
         */
        const r = isEligibleForLoan(500_000, NaN, 0);

        expect(r.eligible).toBe(false);
        expect(r.reason).toContain('could not be read');
    });

    it('AND AN UNREADABLE OUTSTANDING BALANCE IS REFUSED TOO', () => {
        //   It is the other half of `requested + outstanding > maxLoan`, and a
        //   zero there understates the total, which admits more.
        expect(isEligibleForLoan(500_000, 1_000, NaN).eligible).toBe(false);
    });

    it('AND A MEMBER WHO QUALIFIES IS STILL ELIGIBLE', () => {
        //   The guard that all of the above needs: a rule that refused
        //   everybody would pass every assertion in this block.
        const contribution = FLOOR * 10;
        const r = isEligibleForLoan(contribution, 1, 0);

        expect(r).toEqual({ eligible: true });
    });

    it('AND THE REAL CEILING STILL REFUSES AN OVER-LIMIT REQUEST', () => {
        const contribution = FLOOR * 10;
        const over = getMaxLoanAmount(contribution) + 1;

        expect(isEligibleForLoan(contribution, over, 0).eligible).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#744 — the decision reads the balance live, and only where the rule applies', () => {
    const DECISION = 'src/app/actions/cooperative/_loans_decisions.ts';

    it('IT NO LONGER CAPS ON THE DENORMALISED FIELD', () => {
        //   The defect, stated as its absence.
        expect(code(DECISION)).not.toContain('getMaxLoanAmount(appData.contributionAmount)');
    });

    it('AND READS THE MEMBER ROW THE WAY BOTH APPLICATION PATHS DO', () => {
        const src = code(DECISION);

        expect(src).toContain('findCooperativeMemberRow(');
        expect(src).toContain('readCooperativeBalance(memberRow.data)');
        expect(src).toContain('getMaxLoanAmount(savingsBalance)');
    });

    it('AND THE COOPERATIVE RULE IS SCOPED TO COOPERATIVE APPLICATIONS', () => {
        /*
         *   Without this, fixing the NaN refuses every BUSINESS approval —
         *   LOAN_APPLICATIONS holds both products and a business row has no
         *   savings to satisfy a savings-multiple cap. The scope is asserted to
         *   come BEFORE the lookup, because a membership check applied to a
         *   business loan is a refusal, not a no-op.
         */
        const src = code(DECISION);
        const scopeAt = src.indexOf('isCooperativeLoan(');
        const lookupAt = src.indexOf('findCooperativeMemberRow(');

        expect(scopeAt).toBeGreaterThan(-1);
        expect(lookupAt).toBeGreaterThan(scopeAt);
    });

    it('AND THE CLASSIFIER PUTS THE TWO KINDS WHERE THIS EXPECTS', () => {
        /*
         *   The scope above is only correct if the classifier agrees. Exercised
         *   rather than assumed: a row from /api/cooperative/apply-loan carries
         *   a productId and a guarantor; a business row carries collateral; and
         *   a row with neither falls to business, which is the case the
         *   existing suite's fixture is.
         */
        expect(loanProductOf({ productId: 'p1', guarantorName: 'A' })).toBe('cooperative');
        expect(loanProductOf({ collateral: 'a shop' })).toBe('business');
        expect(loanProductOf({ amount: 50_000 })).toBe('business');
    });

    it('AND A MEMBER WHOSE ROW IS GONE IS REFUSED, NOT CAPPED AT ZERO SILENTLY', () => {
        //   Both cooperative application paths require membership to apply, so
        //   an absent row at decision time means they have left — which is a
        //   reason to say so rather than to produce a confusing "exceeds ₦0".
        expect(code(DECISION)).toContain('no longer a cooperative member');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#744 — and the field really is absent from that application path', () => {
    it('THE ROUTE WRITES ITS APPLICATION WITHOUT A CONTRIBUTION AMOUNT', () => {
        /*
         *   The fact the whole finding rests on, read from the source rather
         *   than asserted. If this route ever starts writing the field, the
         *   finding's premise changes and this is where a reader finds out.
         */
        const route = code('src/app/api/cooperative/apply-loan/route.ts');
        const at = route.indexOf('const applicationData = {');
        const literal = route.slice(at, route.indexOf('};', at));

        expect(at).toBeGreaterThan(-1);
        expect(literal).toContain('amount,');              // it writes the amount
        expect(literal).not.toContain('contributionAmount'); // and not this
    });

    it('AND THE STORED SHAPE DECLARES IT OPTIONAL', () => {
        expect(code('src/lib/types/firestore.ts')).toContain('contributionAmount?: number');
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
 *     getMaxLoanAmount stops guarding its input                      KILLED
 *     getMaxLoanAmount returns 0 for everything                      KILLED
 *     the eligibility floor stops guarding the contribution          KILLED
 *     an unreadable requested amount is zeroed instead of refused    KILLED
 *     an unreadable outstanding balance is zeroed instead of refused KILLED
 *     the decision goes back to the denormalised field               KILLED
 *     the decision caps without scoping to the product               KILLED
 *     the decision stops refusing a vanished member                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
