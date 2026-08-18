/**
 * @jest-environment node
 */

/**
 * One member, two screens, two different interest figures for the same plans.
 *
 * A fixed savings plan stores `interestRate`, and on THIS collection that field
 * is FIXED_SAVINGS_ANNUAL_RATE — a rate PER YEAR. It is the one field in the
 * codebase that is: cooperative-tiers.ts and loan-terms.ts both document
 * `interestRate` as a MONTHLY percentage, and loan products use the same field
 * name for the monthly figure. cooperative-savings.ts opens with a warning
 * about exactly this, and notes that confusing the two has already caused one
 * production defect — "a bare percentage next to this number is what makes the
 * mistake possible".
 *
 * /cooperatives/my-savings made the mistake, twice:
 *
 *     const totalInterest = savings.reduce(
 *         (sum, s) => sum + (s.balance * s.interestRate) / 100, 0);
 *
 *     {formatCurrency((plan.balance * plan.interestRate) / 100)}
 *
 * No term anywhere in it. A three-month plan of ₦100,000 was shown ₦14,000 of
 * "Interest Earned" against a real projected profit of ₦3,500 — four times
 * over. Its sibling /cooperatives/fixed-savings renders the stored
 * projectedProfit and gets it right, so the same member saw two figures for the
 * same money depending on which page they opened.
 *
 * The server computes this once, with projectedFixedSavingsProfit, and stores
 * it on the plan. Reading that is the fix: the figure a member is shown and the
 * figure the cooperative pays must come from one calculation.
 *
 * AND IT CALLED A LUMP SUM A MONTHLY CONTRIBUTION
 * -----------------------------------------------
 * The same page mapped `monthlyContribution: plan.amount / plan.durationMonths`
 * and rendered it under the label "Monthly Contribution". A fixed savings plan
 * is a lump sum locked away — the member paid the whole amount once, at
 * creation, and owes nothing monthly — so a member with a ₦100,000 plan they
 * had already paid in full was told they were contributing ₦33,333 a month.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    FIXED_SAVINGS_ANNUAL_RATE,
    projectedFixedSavingsProfit,
} from '@/lib/cooperative-savings';

const MY_SAVINGS = 'src/app/cooperatives/(member)/my-savings/page.tsx';
const FIXED_SAVINGS = 'src/app/cooperatives/(member)/fixed-savings/page.tsx';
const CREATE_ROUTE = 'src/app/api/cooperative/create-fixed-savings/route.ts';
const LIST_ROUTE = 'src/app/api/cooperative/fixed-savings/route.ts';
const SAVINGS_LIB = 'src/lib/cooperative-savings.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the rate really is annual, which is the whole premise', () => {
    it('the constant says so and the library says why', () => {
        expect(FIXED_SAVINGS_ANNUAL_RATE).toBe(14);
        expect(source(SAVINGS_LIB)).toContain('is a rate PER YEAR');
        // Single-line fragments: the warning wraps across comment lines, so a
        // longer substring never matches the file.
        expect(source(SAVINGS_LIB)).toContain('percentage next to this number is what makes the mistake possible');
        expect(source(SAVINGS_LIB)).toContain('The same field name means two different');
    });

    it('and the correct figure is pro-rated over the term', () => {
        // A three-month plan earns a quarter of the annual rate, not all of it.
        expect(projectedFixedSavingsProfit(100_000, 12)).toBe(14_000);
        expect(projectedFixedSavingsProfit(100_000, 3)).toBe(3_500);
        expect(projectedFixedSavingsProfit(100_000, 1)).toBeCloseTo(1_166.67, 1);
    });

    it('which is four times less than the un-pro-rated figure on a 3-month plan', () => {
        // The size of the error the page was showing.
        const wrong = (100_000 * FIXED_SAVINGS_ANNUAL_RATE) / 100;
        expect(wrong).toBe(14_000);
        expect(wrong / projectedFixedSavingsProfit(100_000, 3)).toBe(4);
    });
});

describe('the server stores the figure it will pay', () => {
    it('computed once, by the shared function', () => {
        expect(code(CREATE_ROUTE)).toContain('projectedFixedSavingsProfit(amount, durationMonths)');
        expect(code(CREATE_ROUTE)).toContain('projectedProfit,');
    });

    it('and the list route hands it back untouched', () => {
        // `...data` spread, so every stored field including projectedProfit.
        expect(code(LIST_ROUTE)).toContain('...data,');
        expect(code(LIST_ROUTE)).toContain('COLLECTIONS.FIXED_SAVINGS_PLANS');
    });
});

describe('the my-savings page', () => {
    const page = code(MY_SAVINGS);

    it('reads the stored profit rather than recomputing one', () => {
        // THE test.
        expect(page).toContain('projectedProfit: Number(plan.projectedProfit) || 0,');
        expect(page).toContain('sum + s.projectedProfit');
    });

    it('in the per-plan figure as well as the total', () => {
        // Both copies. The total was the visible one; the per-plan row had the
        // same arithmetic and would have been missed by a fix to one of them.
        expect(page).toContain('{formatCurrency(plan.projectedProfit)}');
    });

    it('with no un-pro-rated arithmetic left anywhere on it', () => {
        expect(page).not.toContain('s.balance * s.interestRate');
        expect(page).not.toContain('plan.balance * plan.interestRate');
        expect(page).not.toMatch(/balance \* [a-z.]*interestRate\) \/ 100/);
    });

    it('and no longer labels a rate PER YEAR as APR-with-no-period elsewhere', () => {
        // "% APR" and "% p.a." mean the same thing, but the sibling page says
        // "p.a." and this said "APR"; one vocabulary is the point.
        expect(page).toContain('% p.a.');
        expect(page).not.toContain('% APR');
    });

    it('and no longer calls a lump sum a monthly contribution', () => {
        expect(page).not.toContain('monthlyContribution');
        expect(page).not.toContain('Monthly Contribution');
        expect(page).toContain('Amount Locked');
        expect(page).toContain('for {plan.durationMonths} months');
    });
});

describe('the sibling page, which was already right', () => {
    it('renders the stored profit too', () => {
        // Vacuity guard: if BOTH pages had been wrong, "use the stored value"
        // would be an invention rather than the platform's own answer.
        const sibling = code(FIXED_SAVINGS);

        expect(sibling).toContain('plan.projectedProfit');
        expect(sibling).toContain('p.amount + p.projectedProfit');
    });

    it('and its own calculator pro-rates by the term', () => {
        const sibling = code(FIXED_SAVINGS);

        expect(sibling).toContain('(principal * rate * (months / 12)) / 100');
    });
});
