/**
 * @jest-environment node
 */

/**
 * lib/cooperative-utils.ts, EXECUTED. It was at 0%.
 *
 *   #183 getCooperativeQuickStats QUERIED THE WRONG KEY.
 *        It filtered COOPERATIVE_LOANS on `userId`; every other query against
 *        that collection in the cooperative module uses `memberId`, which is
 *        what the loan rows are written with. So it matched nothing and left
 *        nextPaymentDate and nextPaymentAmount permanently undefined — a
 *        dashboard widget whose entire purpose is "when is my next payment"
 *        that could never answer. Same shape as #49 and #88.
 *
 *   #184 A FOURTH COPY OF THE LOAN MULTIPLIER, TWICE.
 *        Both credit calculations read `savingsBalance * 0.5 - loanBalance`.
 *        That 0.5 is COOPERATIVE_TIERS.Member.maxLoanMultiplier, which was
 *        itself corrected from 3 — cooperative-tiers.ts still carries the note
 *        "Previously 3 — a member could borrow three times their savings, six
 *        times more than intended."
 *
 *        lib/testing/policy-constant-scan.ts exists to stop exactly this and did
 *        not catch it: its rule was "a numeric literal ASSIGNED to a
 *        policy-named variable", and these literals sat inside arithmetic. The
 *        scan is widened in the same change, and widening it immediately found a
 *        fifth copy that DISAGREED with the canonical value — see
 *        cooperative-loan-rate-fallback below.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { getMaxLoanAmount, DEFAULT_MONTHLY_INTEREST_RATE } from '@/lib/cooperative-tiers';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

const mockAuth = jest.fn(async () => ({ user: { id: 'member-1' } })) as jest.Mock<any>;
jest.mock('@/lib/auth', () => ({
    auth: (...a: any[]) => mockAuth(...a),
    signIn: async () => undefined, signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;
const MEMBER = 'member-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const LOANS = COLLECTIONS.COOPERATIVE_LOANS;

const utils = async () => await import('@/lib/cooperative-utils');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockAuth.mockResolvedValue({ user: { id: MEMBER } });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeBalance', () => {
    it('returns the savings balance', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 120_000 });
        expect(await (await utils()).getCooperativeBalance())
            .toMatchObject({ success: true, balance: 120_000 });
    });

    it('reports zero rather than undefined for a member with no balance yet', async () => {
        store.seed(MEMBERS, MEMBER, {});
        expect(await (await utils()).getCooperativeBalance())
            .toMatchObject({ success: true, balance: 0 });
    });

    it('refuses a caller with no session', async () => {
        mockAuth.mockResolvedValue(null);
        expect(await (await utils()).getCooperativeBalance()).toMatchObject({ success: false });
    });

    it('says so when the caller is not a member', async () => {
        expect(await (await utils()).getCooperativeBalance())
            .toMatchObject({ success: false, error: 'Not a cooperative member' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#184 — credit is the tier rule, not a copy of its number', () => {
    it('AGREES WITH getMaxLoanAmount rather than a hardcoded multiplier', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 200_000, loanBalance: 0 });

        const res = await (await utils()).checkCooperativeCreditEligibility(1);

        // Derived from the constant on both sides: if the tier multiplier ever
        // changes, this test moves with it instead of pinning the old number.
        expect(res.availableCredit).toBe(getMaxLoanAmount(200_000));
    });

    it('subtracts what the member already owes', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 200_000, loanBalance: 40_000 });

        const res = await (await utils()).checkCooperativeCreditEligibility(1);
        expect(res.availableCredit).toBe(getMaxLoanAmount(200_000) - 40_000);
    });

    it('never reports negative credit for a member who owes more than the limit', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 10_000, loanBalance: 500_000 });

        const res = await (await utils()).checkCooperativeCreditEligibility(1);
        expect(res.availableCredit).toBe(0);
        expect(res.eligible).toBe(false);
    });

    it('answers the eligibility question against the amount asked for', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 200_000, loanBalance: 0 });
        const limit = getMaxLoanAmount(200_000);

        const { checkCooperativeCreditEligibility } = await utils();
        expect((await checkCooperativeCreditEligibility(limit)).eligible).toBe(true);
        expect((await checkCooperativeCreditEligibility(limit + 1)).eligible).toBe(false);
    });

    it('treats a non-member as having no credit, without failing', async () => {
        const res = await (await utils()).checkCooperativeCreditEligibility(1_000);
        expect(res).toMatchObject({ success: true, eligible: false, availableCredit: 0 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#183 — the next payment the widget exists to show', () => {
    beforeEach(() => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 200_000, loanBalance: 50_000 });
    });

    it('FINDS THE LOAN, WHICH IS KEYED ON memberId', async () => {
        store.seed(LOANS, 'loan-1', {
            memberId: MEMBER, status: 'disbursed',
            nextPaymentDate: '2026-09-01T00:00:00.000Z',
            nextPaymentAmount: 12_500,
        });

        const res = await (await utils()).getCooperativeQuickStats();

        expect(res.success).toBe(true);
        expect(res.data?.nextPaymentAmount).toBe(12_500);
        expect(res.data?.nextPaymentDate?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    it('falls back to the monthly payment when no explicit next amount is recorded', async () => {
        store.seed(LOANS, 'loan-1', {
            memberId: MEMBER, status: 'approved',
            nextPaymentDate: '2026-09-01T00:00:00.000Z',
            monthlyPayment: 9_000,
        });

        const res = await (await utils()).getCooperativeQuickStats();
        expect(res.data?.nextPaymentAmount).toBe(9_000);
    });

    it('does not look for a loan when nothing is owed', async () => {
        store.seed(MEMBERS, MEMBER, { savingsBalance: 200_000, loanBalance: 0 });
        store.seed(LOANS, 'loan-1', {
            memberId: MEMBER, status: 'disbursed', nextPaymentAmount: 12_500,
        });

        const res = await (await utils()).getCooperativeQuickStats();
        expect(res.data?.nextPaymentAmount).toBeUndefined();
    });

    it('ignores another member\'s loan', async () => {
        store.seed(LOANS, 'theirs', {
            memberId: 'somebody-else', status: 'disbursed', nextPaymentAmount: 99_999,
        });

        const res = await (await utils()).getCooperativeQuickStats();
        expect(res.data?.nextPaymentAmount).toBeUndefined();
    });

    it('reports the credit alongside, on the same rule', async () => {
        const res = await (await utils()).getCooperativeQuickStats();
        expect(res.data?.availableCredit).toBe(getMaxLoanAmount(200_000) - 50_000);
    });

    it('refuses a caller with no session, and a non-member', async () => {
        mockAuth.mockResolvedValue(null);
        expect(await (await utils()).getCooperativeQuickStats()).toMatchObject({ success: false });

        mockAuth.mockResolvedValue({ user: { id: 'nobody' } });
        expect(await (await utils()).getCooperativeQuickStats()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeMembershipStatus', () => {
    it('reports membership and status', async () => {
        store.seed(MEMBERS, MEMBER, { membershipStatus: 'active' });
        expect(await (await utils()).getCooperativeMembershipStatus())
            .toMatchObject({ success: true, isMember: true, status: 'active' });
    });

    it('reports a non-member without failing', async () => {
        expect(await (await utils()).getCooperativeMembershipStatus())
            .toMatchObject({ success: true, isMember: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The fifth copy, found by widening the scan — and it disagreed.
 */
describe('cooperative-loan-rate-fallback', () => {
    it('THE ADMIN LIST FALLBACK IS THE CANONICAL RATE, NOT 5', () => {
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/actions/cooperative/_loans_applications.ts'),
            'utf8',
        );
        // Was `app.interestRate || 5` while DEFAULT_MONTHLY_INTEREST_RATE is 10,
        // so a reviewing admin saw half the rate that is actually applied.
        expect(src).toContain('app.interestRate || DEFAULT_MONTHLY_INTEREST_RATE');
        expect(DEFAULT_MONTHLY_INTEREST_RATE).toBe(10);
    });
});
