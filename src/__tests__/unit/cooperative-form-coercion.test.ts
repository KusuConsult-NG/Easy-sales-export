/**
 * @jest-environment node
 */

/**
 * Cooperative contributions and loan applications failed on EVERY submission.
 *
 * WHAT WAS WRONG
 * --------------
 * Both actions validate with `parseFormData`, which calls `formDataToObject`,
 * which does no conversion at all — every FormData value arrives as a string.
 * Both schemas declared:
 *
 *     amount: z.number().positive(...)
 *
 * Zod does not coerce by default, so the parse failed every time with
 * "amount: Invalid input: expected number, received string". There is no input
 * that could satisfy it: the check was unsatisfiable, not strict.
 *
 * So making a contribution and applying for a cooperative loan were broken 100%
 * of the time, and the member saw a validation error on a form they had filled
 * in correctly. This is not a race and has no concurrency precondition — it is
 * the same class as the defects in the "breaking things daily" list in
 * docs/audit/outstanding-work.md.
 *
 * Found while writing fixtures for the loan-application claim: the actions
 * refused a valid payload, which is what exposed it. Worth recording — a test
 * that cannot construct a passing input is telling you something about the code,
 * not about the fixture.
 *
 * THE FIX IS TWO PARTS
 * --------------------
 * z.coerce.number() makes a numeric string parse. It is not sufficient alone:
 * Number("₦10,000") is NaN, and the amount field is currency-formatted in the
 * UI. The loan path already stripped formatting with parseCurrencyStringToFloat
 * before parsing; the contribution path did not, and would have kept failing for
 * any formatted amount — looking like the fix had only half worked.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/wallet-ledger', () => ({
    claimSingleOpenLoanApplication: jest.fn(async () => ({ claimed: true, existingId: null })),
    debitJsonbBalance: jest.fn(async () => ({ ok: true, balance: 0, reason: null })),
    debitJsonbBalanceWithFloor: jest.fn(async () => ({ ok: true, balance: 0, reason: null })),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(),
    claimIdempotencyKey: jest.fn(),
    claimVersionedUpdate: jest.fn(),
    incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function setMember(data: Record<string, any>) {
    const snap = {
        exists: true,
        empty: false,
        docs: [{ id: 'member-1', data: () => data }],
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** The single assertion that matters: the parse must not be what refused. */
function expectNotAValidationFailure(result: any) {
    expect(String(result?.error ?? '')).not.toMatch(/expected number, received string/);
    expect(String(result?.error ?? '')).not.toMatch(/Validation failed/);
}

describe('makeContributionAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember({ userId: 'member-1', membershipStatus: 'active', savingsBalance: 10_000 });
    });

    function form(amount: string) {
        const fd = new FormData();
        fd.set('cooperativeId', 'coop-1');
        fd.set('amount', amount);
        fd.set('type', 'savings');
        return fd;
    }

    it('accepts a plain numeric string', async () => {
        // Against the pre-fix code this returns
        // "amount: Invalid input: expected number, received string" — for every
        // possible input, which is why contributions never worked.
        const { makeContributionAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await makeContributionAction({} as any, form('5000'));

        expectNotAValidationFailure(result);
    });

    it('accepts a currency-formatted amount', async () => {
        // z.coerce alone does not save this: Number("₦5,000") is NaN.
        const { makeContributionAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await makeContributionAction({} as any, form('₦5,000'));

        expectNotAValidationFailure(result);
    });

    it('still refuses a genuinely invalid amount', async () => {
        // Coercion must not turn the validation into a rubber stamp.
        const { makeContributionAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await makeContributionAction({} as any, form('0'));

        expect(result.success).toBe(false);
    });
});

describe('applyForLoanAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember({ userId: 'member-1', membershipStatus: 'active', savingsBalance: 500_000 });
    });

    function form(amount: string) {
        const fd = new FormData();
        fd.set('productId', 'prod-1');
        fd.set('amount', amount);
        fd.set('purpose', 'Stock purchase for the new season');
        return fd;
    }

    it('accepts a plain numeric string', async () => {
        const { applyForLoanAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await applyForLoanAction({} as any, form('10000'));

        expectNotAValidationFailure(result);
    });

    it('accepts a currency-formatted amount', async () => {
        const { applyForLoanAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await applyForLoanAction({} as any, form('₦10,000'));

        expectNotAValidationFailure(result);
    });

    it('still refuses a zero amount', async () => {
        const { applyForLoanAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await applyForLoanAction({} as any, form('0'));

        expect(result.success).toBe(false);
    });
});
