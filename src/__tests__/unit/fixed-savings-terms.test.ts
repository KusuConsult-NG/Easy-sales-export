/**
 * @jest-environment node
 */

/**
 * Fixed savings: one rate, one set of bounds, one projection — and a plan that
 * lands where the member can see it.
 *
 * TWO DEFECTS, BOTH OF THE SAME FAMILY AS THE LOAN LIMIT
 * -----------------------------------------------------
 * 1. THE RATE HAD FOUR COPIES. Two decided what a member is PAID (the route and
 *    the server action) and two decided what a member is TOLD (the calculator's
 *    useState and the marketing sentence beside it). Nothing kept them equal.
 *    That is exactly how the loan limit came to show half-your-savings while
 *    enforcing three-times-your-savings.
 *
 * 2. THE SERVER ACTION FILED THE PLAN WHERE NOTHING READS IT.
 *    _createFixedSavingsAction debited the member's savingsBalance and wrote
 *    the plan to COLLECTIONS.COOPERATIVE_FIXED_SAVINGS. The member's plan list
 *    comes from /api/cooperative/fixed-savings, which reads
 *    COLLECTIONS.FIXED_SAVINGS_PLANS. The money left the balance; the plan
 *    appeared nowhere. It also omitted projectedProfit, which the savings page
 *    renders as `plan.amount + plan.projectedProfit` — undefined there shows
 *    the member "₦NaN".
 *
 * The rate assertions below are deliberately NOT "the rate is 14". A test that
 * restates the constant passes while a caller ignores it — cooperative-tiers'
 * own maxLoanMultiplier test did exactly that for the entire time the live loan
 * path was enforcing the old value. These assert that the WRITE uses the
 * constant, whatever it is set to.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
    FIXED_SAVINGS_ANNUAL_RATE,
    FIXED_SAVINGS_MIN_AMOUNT,
    FIXED_SAVINGS_MAX_MONTHS,
    projectedFixedSavingsProfit,
    validateFixedSavingsPlan,
    formatFixedSavingsRate,
} from '@/lib/cooperative-savings';
import { COLLECTIONS } from '@/lib/types/firestore';

declare const global: any;

const USER_ID = 'admin-id'; // matches jest.setup.js's default session

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockDebit = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    debitJsonbBalance: (...a: any[]) => mockDebit(...a),
    debitJsonbBalanceWithFloor: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
    claimPaymentOnce: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    claimIdempotencyKey: jest.fn(),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateCooperativeCache: jest.fn(),
    invalidateAdminGlobalStats: jest.fn(),
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockDebit.mockResolvedValue({ ok: true, balance: 100_000 });
});

// ─── The projection ───────────────────────────────────────────────────────────

describe('projectedFixedSavingsProfit', () => {
    it('pro-rates simple interest over the term', () => {
        // ₦100,000 for a full year at the configured rate.
        expect(projectedFixedSavingsProfit(100_000, 12)).toBe(
            Math.round(100_000 * FIXED_SAVINGS_ANNUAL_RATE) / 100 * 1,
        );
        // Half a year earns half of it.
        expect(projectedFixedSavingsProfit(100_000, 6)).toBe(
            projectedFixedSavingsProfit(100_000, 12) / 2,
        );
    });

    it('does not compound', () => {
        // Twice the principal earns exactly twice the interest. If this ever
        // becomes a compounding product, this is the assertion that says so.
        expect(projectedFixedSavingsProfit(200_000, 12)).toBe(
            projectedFixedSavingsProfit(100_000, 12) * 2,
        );
    });

    it('rounds to the kobo', () => {
        // The unrounded formula produced figures like 5833.333333333334, which
        // were stored on the plan and then summed into member-facing totals.
        const profit = projectedFixedSavingsProfit(50_000, 1);
        expect(Number.isFinite(profit)).toBe(true);
        expect(profit).toBe(Math.round(profit * 100) / 100);
    });

    it.each([
        ['a zero amount', 0, 12],
        ['a negative amount', -50_000, 12],
        ['a non-finite amount', NaN, 12],
        ['a zero term', 50_000, 0],
        ['a negative term', 50_000, -6],
    ])('returns 0 rather than NaN for %s', (_label, amount, months) => {
        // The savings page renders `amount + projectedProfit`. NaN there shows
        // a member "₦NaN" against their locked money, which is worse than a
        // zero that is obviously wrong.
        expect(projectedFixedSavingsProfit(amount, months)).toBe(0);
    });
});

// ─── The bounds ───────────────────────────────────────────────────────────────

describe('validateFixedSavingsPlan', () => {
    it('accepts a plan at the minimum for the maximum term', () => {
        expect(validateFixedSavingsPlan(FIXED_SAVINGS_MIN_AMOUNT, FIXED_SAVINGS_MAX_MONTHS))
            .toEqual({ valid: true });
    });

    it('refuses one naira below the minimum', () => {
        const result = validateFixedSavingsPlan(FIXED_SAVINGS_MIN_AMOUNT - 1, 12);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain(FIXED_SAVINGS_MIN_AMOUNT.toLocaleString());
    });

    it('refuses a term past the ceiling', () => {
        expect(validateFixedSavingsPlan(100_000, FIXED_SAVINGS_MAX_MONTHS + 1).valid).toBe(false);
    });

    it('refuses a fractional term', () => {
        // 1.5 months is not a term the maturity arithmetic or the schedule can
        // express, and it passed a `>= 1 && <= 12` check.
        expect(validateFixedSavingsPlan(100_000, 1.5).valid).toBe(false);
    });

    it('refuses a non-numeric amount', () => {
        expect(validateFixedSavingsPlan(NaN, 12).valid).toBe(false);
    });
});

describe('formatFixedSavingsRate', () => {
    it('always says the period', () => {
        // A bare "14%" beside a codebase where every other rate is MONTHLY is
        // how the 10%-per-year-vs-per-month defect happened. The period is not
        // optional here.
        expect(formatFixedSavingsRate()).toContain('per year');
        expect(formatFixedSavingsRate()).toContain(String(FIXED_SAVINGS_ANNUAL_RATE));
    });
});

// ─── The write ────────────────────────────────────────────────────────────────

describe('createFixedSavingsAction — where the plan is filed', () => {
    async function create(amount: number, durationMonths: number) {
        const { createFixedSavingsAction } = await import('@/app/actions/cooperative/_coop_money');
        global.mockFirestoreGet.mockResolvedValue({
            empty: false,
            docs: [{ id: USER_ID, data: () => ({ userId: USER_ID, savingsBalance: 500_000 }) }],
        });
        const fd = new FormData();
        fd.set('amount', String(amount));
        fd.set('durationMonths', String(durationMonths));
        return createFixedSavingsAction({ success: false, error: null } as any, fd);
    }

    /** The document the action wrote, whichever collection it chose. */
    function written(): any {
        expect(global.mockFirestoreSet).toHaveBeenCalled();
        return global.mockFirestoreSet.mock.calls[0][1];
    }

    it('writes the plan to the collection the member page reads', async () => {
        // It wrote COOPERATIVE_FIXED_SAVINGS; /api/cooperative/fixed-savings
        // reads FIXED_SAVINGS_PLANS. The savings were debited and the plan was
        // invisible.
        const res = await create(100_000, 12);
        expect(res.success).toBe(true);
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.FIXED_SAVINGS_PLANS);
        expect(global.mockFirestoreCollection).not.toHaveBeenCalledWith(COLLECTIONS.COOPERATIVE_FIXED_SAVINGS);
    });

    it('stores the configured rate', async () => {
        // Asserted against the constant rather than against 14, so it still
        // means something after the rate changes.
        //
        // BUT BE CLEAR ABOUT WHAT THIS DOES NOT CATCH: restoring the literal
        // `interestRate: 14` passes this test, because 14 IS the constant
        // today. A value assertion cannot tell a constant from a copy of its
        // current value — which is the whole reason the four copies survived
        // this long. policy-constants-single-source.test.ts is what fails on
        // the literal; verified by reintroducing it. The two together cover
        // this line, and neither does alone.
        await create(100_000, 12);
        expect(written().interestRate).toBe(FIXED_SAVINGS_ANNUAL_RATE);
    });

    it('stores projectedProfit so the member page does not render NaN', async () => {
        // The page shows `plan.amount + plan.projectedProfit`. This field was
        // simply absent.
        await create(100_000, 12);
        expect(written().projectedProfit).toBe(projectedFixedSavingsProfit(100_000, 12));
        expect(Number.isFinite(written().amount + written().projectedProfit)).toBe(true);
    });

    it('stores a maturity date', async () => {
        await create(100_000, 6);
        expect(written().maturityDate).toBeInstanceOf(Date);
    });

    it('debits the savings balance before writing the plan', async () => {
        // The guard that was already there. Kept so the fixes above cannot be
        // mistaken for the only thing between a caller and a free plan.
        await create(100_000, 12);
        expect(mockDebit).toHaveBeenCalledWith(
            expect.objectContaining({ field: 'savingsBalance', amount: 100_000 }),
        );
    });

    it('writes no plan when the debit is refused', async () => {
        mockDebit.mockResolvedValue({ ok: false, reason: 'insufficient_funds', balance: 10 });
        const res = await create(100_000, 12);
        expect(res.success).toBe(false);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });
});
