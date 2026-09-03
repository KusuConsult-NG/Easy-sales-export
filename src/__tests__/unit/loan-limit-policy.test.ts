/**
 * @jest-environment node
 */

/**
 * The loan limit the member UI submits through must be the limit the policy
 * module states.
 *
 * WHAT WAS WRONG
 * --------------
 * lib/cooperative-tiers.ts holds the confirmed rule: a member may borrow up to
 * HALF their savings (maxLoanMultiplier: 0.5), i.e. savings must be at least
 * twice the loan. That constant was corrected from 3 to 0.5, and
 * cooperative-tiers.test.ts asserts it.
 *
 * _applyForLoanAction — the action the member loan page actually submits
 * through — never read the constant. It had:
 *
 *     const maxLoanAmount = savingsBalance * 3;
 *
 * So the correction did not reach the one place that decides whether to lend.
 * A member with ₦100,000 saved was shown a ₦50,000 limit and enforced at
 * ₦300,000: six times the intended exposure, on loans whose only security is
 * the savings being lent against.
 *
 * WHY THIS TEST IS SHAPED THIS WAY
 * --------------------------------
 * Asserting `maxLoanMultiplier === 0.5` is what cooperative-tiers.test.ts
 * already does, and it passed throughout — the constant was right the whole
 * time. A test on the constant cannot see a caller that ignores it.
 *
 * So these drive the ACTION and assert on whether the loan was WRITTEN. The
 * case that matters is `refuses ₦150,000 against ₦100,000 savings`: 150,000 is
 * under the old 3× ceiling of 300,000 and over the correct 0.5× ceiling of
 * 50,000, so it is the single input that distinguishes the two rules. Restore
 * `savingsBalance * 3` and only that assertion fails.
 *
 * The refusal assertions check that claimSingleOpenLoanApplication was NOT
 * called, not merely that an error came back. The claim is the insert; a
 * refusal that still wrote the row would be the defect, not the fix.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

declare const global: any;

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimSingleOpenLoanApplication: (...a: any[]) => mockClaim(...a),
    debitJsonbBalance: jest.fn(),
    claimPaymentOnce: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateCooperativeCache: jest.fn(),
    invalidateAdminGlobalStats: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const USER_ID = 'admin-id'; // matches jest.setup.js's default session

/** A doc-id read that finds nothing — see withSavings. */
const MEMBER_DOC_ABSENT = { exists: false, id: USER_ID, data: () => undefined };

/** A product with usable terms, so nothing downstream refuses for another reason. */
const PRODUCT = {
    exists: true,
    data: () => ({ name: 'Test Loan', interestRate: 10, durationMonths: 12, minAmount: 1000, maxAmount: 5_000_000 }),
};

function membershipSnapshot(savingsBalance: number) {
    return {
        empty: false,
        docs: [{ id: USER_ID, data: () => ({ userId: USER_ID, savingsBalance, membershipStatus: 'active' }) }],
    };
}

/**
 * Routes the two reads this action makes. The mock's collection().get() is
 * called with the collection name and doc().get() with the document id, so the
 * membership query and the product lookup are told apart by argument.
 */
function withSavings(savingsBalance: number) {
    global.mockFirestoreGet.mockImplementation((key: string) => {
        // #345 the member lookup tries the DOCUMENT ID first, then the `userId`
        // FIELD. This fixture is a field-keyed row — the shape
        // joinCooperativeAction writes — so the doc-id read must MISS here and
        // the query must serve it. Without this branch the doc-id read fell
        // through to PRODUCT and the action read a loan product as a
        // membership: zero savings, every loan refused.
        if (key === USER_ID) return Promise.resolve(MEMBER_DOC_ABSENT);
        if (key === 'cooperative_members') return Promise.resolve(membershipSnapshot(savingsBalance));
        return Promise.resolve(PRODUCT);
    });
}

/** The doc-id-keyed shape, which most writers produce. */
function withSavingsKeyedById(savingsBalance: number) {
    global.mockFirestoreGet.mockImplementation((key: string) => {
        if (key === USER_ID) {
            return Promise.resolve({
                exists: true, id: USER_ID,
                data: () => ({ savingsBalance, membershipStatus: 'active' }),
            });
        }
        if (key === 'cooperative_members') return Promise.resolve({ empty: true, docs: [] });
        return Promise.resolve(PRODUCT);
    });
}

async function apply(amount: number) {
    const { applyForLoanAction } = await import('@/app/actions/cooperative/_coop_money');
    const fd = new FormData();
    fd.set('productId', 'prod-1');
    fd.set('amount', String(amount));
    fd.set('purpose', 'Working capital for the next planting season');
    return applyForLoanAction({ success: false, error: null } as any, fd);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockClaim.mockResolvedValue({ claimed: true });
});

describe('cooperative loan limit — savings must cover twice the loan', () => {
    it('allows a loan of exactly half the savings', async () => {
        withSavings(100_000);
        const res = await apply(50_000);
        expect(res.success).toBe(true);
        expect(mockClaim).toHaveBeenCalledTimes(1);
    });

    it('and does so whichever way the membership row is keyed — #345', async () => {
        // The lookup walks the document id and then the `userId` field, because
        // COOPERATIVE_MEMBERS holds both shapes. This door used to query the
        // field ONLY, so a member whose row carries the id and not the field —
        // the shape getCooperativeApplicationAction heals on the fly — was told
        // to join a cooperative they already belonged to.
        withSavingsKeyedById(100_000);
        const res = await apply(50_000);
        expect(res.success).toBe(true);
        expect(mockClaim).toHaveBeenCalledTimes(1);
    });

    it('refuses ₦150,000 against ₦100,000 savings — allowed by the old 3x rule', async () => {
        // 150,000 sits between the correct ceiling (50,000) and the old one
        // (300,000). This is the assertion that fails if `savingsBalance * 3`
        // comes back.
        withSavings(100_000);
        const res = await apply(150_000);
        expect(res.success).toBe(false);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('refuses a loan one naira over half the savings', async () => {
        withSavings(100_000);
        const res = await apply(50_001);
        expect(res.success).toBe(false);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('refuses a member below the minimum contribution, however small the loan', async () => {
        // The floor is COOPERATIVE_TIERS.Member.minContribution (₦5,000). The
        // action never applied it before — it only compared against a multiple
        // of the balance, and half of ₦4,000 is ₦2,000, so a ₦1,000 loan to a
        // member with almost nothing saved was written.
        withSavings(4_000);
        const res = await apply(1_000);
        expect(res.success).toBe(false);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('refuses when savingsBalance is absent rather than treating it as unlimited', async () => {
        global.mockFirestoreGet.mockImplementation((key: string) => {
            if (key === 'cooperative_members') {
                return Promise.resolve({
                    empty: false,
                    docs: [{ id: USER_ID, data: () => ({ userId: USER_ID, membershipStatus: 'active' }) }],
                });
            }
            return Promise.resolve(PRODUCT);
        });
        const res = await apply(10_000);
        expect(res.success).toBe(false);
        expect(mockClaim).not.toHaveBeenCalled();
    });
});
