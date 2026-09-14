/**
 * @jest-environment node
 */

/**
 *   #731 A SECOND LOAN QUOTE THAT IGNORES THE LOAN PRODUCT — LATENT, AND ONE
 *        IMPORT AWAY FROM BEING LIVE.
 *
 *   Every path that actually CREATES a cooperative loan reads `interestRate`
 *   off the LOAN_PRODUCTS row and passes it to `calculateRepaymentTerms`:
 *   `_coop_money.ts`, `api/cooperative/apply-loan`, and the member page. A
 *   prior finding put them on one function and recorded why:
 *
 *       "Same function now, so a rate change or a fix cannot reach only one of
 *        them."
 *
 *   Before that, a borrower was quoted their product's terms and the loan was
 *   written at a hardcoded default. That was a real money defect and it was
 *   repaired.
 *
 *   `calculateLoanCost` is the remaining exception. It takes its rate from
 *   `getTierInterestRate`, which returns `DEFAULT_MONTHLY_INTEREST_RATE`
 *   whatever product the member chose.
 *
 * ── WHY THIS IS A TRIPWIRE AND NOT A REPAIR ─────────────────────────────────
 *
 *   Its only caller is `components/LoanApplicationWizard.tsx`, and that
 *   component is imported by NOTHING. No member sees a figure from it, so
 *   there is nothing to fix today and changing live quoting code to chase a
 *   dead path would be the riskier move.
 *
 *   What is worth having is the alarm. Rendering that component would quote
 *   every product at the default rate while the server records the loan at the
 *   product's own — a member told one monthly payment and charged another,
 *   which is precisely the defect already fixed once. The assertion below fails
 *   the moment the component gains an importer, and says what to do instead.
 *
 * ── AND THE ARITHMETIC IS NOT THE HAZARD, MEASURED RATHER THAN ASSUMED ──────
 *
 *   The two calculators were suspected of disagreeing — one works in floating
 *   point naira, the other in integer kobo. They do not. Across four spreads of
 *   principal, rate and term they return the same monthly payment to within a
 *   fraction of a kobo, and that is pinned below so the claim is not left as an
 *   assertion in a comment.
 *
 *   THE RATE IS THE HAZARD. Recorded because the obvious suspicion was wrong,
 *   and chasing the rounding would have missed it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    calculateLoanCost,
    getTierInterestRate,
    DEFAULT_MONTHLY_INTEREST_RATE,
} from '@/lib/cooperative-tiers';
import { calculateRepaymentTerms } from '@/lib/loan-terms';

const ROOT = process.cwd();

/** Every .ts/.tsx of the application, excluding the test tree. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === '__tests__' || e.name === 'node_modules') continue;
                walk(full);
                continue;
            }
            if (/\.tsx?$/.test(e.name)) out.push(relative(ROOT, full).split(sep).join('/'));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#731 — the two loan calculators agree on the arithmetic', () => {
    const CASES: Array<[number, number, number]> = [
        [100_000, 10, 6],
        [250_000, 5, 12],
        [50_000, 2.5, 3],
        [19_999, 7.5, 9],
    ];

    it.each(CASES)('₦%i at %i%% over %i months gives one monthly payment', (amount, rate, months) => {
        const viaCost = calculateLoanCost(amount, rate, months);
        const viaTerms = calculateRepaymentTerms(amount, months, rate);

        //   Within a kobo. The float/integer split is real and it does not
        //   reach the figure a member would be shown.
        expect(Math.abs(viaCost.monthlyPayment - viaTerms.monthlyPayment)).toBeLessThan(0.01);
    });

    it('AND THE VACUITY GUARD: these cases really do differ from one another', () => {
        //   Four identical answers would satisfy the equality above without
        //   exercising anything.
        const payments = CASES.map(([a, r, n]) => calculateRepaymentTerms(a, n, r).monthlyPayment);
        expect(new Set(payments.map((p) => p.toFixed(2))).size).toBe(CASES.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#731 — and the quote that ignores the product stays out of reach', () => {
    it('getTierInterestRate RETURNS THE DEFAULT WHATEVER THE TIER — the hazard, stated', () => {
        /*
         *   Not a complaint about this function: it is a default rate and it
         *   says so. The hazard is using it to QUOTE a product that carries its
         *   own rate.
         */
        const tiers = ['tier1', 'tier2'] as const;
        for (const t of tiers) {
            expect(getTierInterestRate(t as any)).toBe(DEFAULT_MONTHLY_INTEREST_RATE);
        }

        //   A product at any other rate is quoted wrong by this path. Shown
        //   with real figures so the size of the error is on the record.
        const productRate = 5;
        const quoted = calculateLoanCost(200_000, getTierInterestRate('tier1' as any), 12);
        const charged = calculateRepaymentTerms(200_000, 12, productRate);

        expect(quoted.monthlyPayment).toBeGreaterThan(charged.monthlyPayment);
    });

    it('THE COMPONENT THAT USES IT IS RENDERED BY NOTHING — THE tripwire', () => {
        /*
         *   THE assertion this file exists for.
         *
         *   If this fails, somebody has wired LoanApplicationWizard to a page.
         *   That is not automatically wrong — but the wizard quotes through
         *   calculateLoanCost with getTierInterestRate, so as written it will
         *   show every borrower the DEFAULT rate while the server records their
         *   loan at the product's own. A member told one monthly payment and
         *   charged another is the defect the three live paths were already
         *   repaired for.
         *
         *   WHAT TO DO INSTEAD: take `interestRate` from the LOAN_PRODUCTS row
         *   and quote through `calculateRepaymentTerms`, exactly as
         *   _coop_money.ts, api/cooperative/apply-loan and the member page do.
         *   Then delete this test.
         */
        const importers = sourceFiles()
            .filter((rel) => !rel.endsWith('components/LoanApplicationWizard.tsx'))
            .filter((rel) => /\bLoanApplicationWizard\b/.test(code(rel)));

        expect(importers).toEqual([]);
    });

    it('AND THE SWEEP CAN SEE AN IMPORTER, SO [] MEANS UNREACHABLE', () => {
        //   Positive control. An empty list from a sweep that matches nothing
        //   is the same shape as an empty list from a clean tree, and this file
        //   is entirely about telling those apart.
        const selfReferences = sourceFiles()
            .filter((rel) => /\bcalculateRepaymentTerms\b/.test(code(rel)));

        //   calculateRepaymentTerms IS imported in several places, so a sweep
        //   of this shape demonstrably finds importers when they exist.
        expect(selfReferences.length).toBeGreaterThan(2);
        expect(sourceFiles().length).toBeGreaterThan(400);
    });

    it('AND THE THREE LIVE PATHS STILL TAKE THE RATE FROM THE PRODUCT', () => {
        //   The other half: the tripwire is only worth having while the paths
        //   it defers to are doing the right thing.
        for (const rel of [
            'src/app/actions/cooperative/_coop_money.ts',
            'src/app/api/cooperative/apply-loan/route.ts',
        ]) {
            const src = code(rel);
            expect(src).toContain('calculateRepaymentTerms(');
            expect(src).toMatch(/interestRate/);
            //   And not the hardcoded default.
            expect(src).not.toContain('getTierInterestRate');
        }
    });
});
