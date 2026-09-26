/**
 * @jest-environment node
 */

/**
 * Cooperative loan repayment and disbursement.
 *
 * WHAT WAS WRONG
 * --------------
 * `submitRepaymentAction` had two money defects, neither of them about status.
 *
 * 1. LOST UPDATE. `newPaidAmount = (paidAmount || 0) + amount` was computed in
 *    JavaScript and written back as an absolute value, inside runTransaction,
 *    which takes no lock. Two repayments landing together both read the same
 *    paidAmount and the second write overwrote the first — the member paid
 *    twice and was credited once.
 *
 * 2. NO IDEMPOTENCY. Nothing claimed `paymentReference`, so the same Paystack
 *    reference submitted twice credited the instalment twice.
 *
 * `disburseLoanAction` read the status, compared it to "approved" and wrote
 * "disbursed" with no lock, so two admins clicking Disburse together both
 * wrote, producing two audit entries and two notifications for one loan.
 *
 * The first test in each block asserts on the write itself, not on the returned
 * message.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;
const mockCreateNotification = jest.fn() as jest.Mock<any>;

//   #952 — the loan actions this suite drives now ask the LIVE gate, not the
//   token. The mock still lets roles decide; see lib/testing/require-admin-mock.
jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...args: any[]) => mockClaimPaymentOnce(...args),
}));

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...args: any[]) => mockCreateNotification(...args),
}));

function setSession(id: string, roles: string[] = ['admin']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles },
        },
        error: null,
    }));
}

/** An instalment due today, nothing paid against it yet. */
function installment(overrides: Record<string, any> = {}) {
    return {
        loanId: 'loan-1',
        installmentNumber: 1,
        totalAmount: 10_000,
        paidAmount: 0,
        status: 'pending',
        dueDate: { toDate: () => new Date() },
        ...overrides,
    };
}

describe('submitRepaymentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
        mockCreateNotification.mockResolvedValue({ success: true });
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => installment(),
            docs: [],
        }));
    });

    it('credits the instalment by increment, never by writing a computed total', async () => {
        // THE test. The absolute write is what lost a concurrent repayment.
        setSession('member-1');

        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'PSK-abc',
        });

        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.paidAmount).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: 4_000,
        });
        expect(typeof update.paidAmount).not.toBe('number');
    });

    it('claims the payment reference before touching the instalment', async () => {
        setSession('member-1');

        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'PSK-abc',
        });

        expect(mockClaimPaymentOnce).toHaveBeenCalledTimes(1);
        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        expect(claim.reference).toBe('PSK-abc');
        expect(claim.amount).toBe(4_000);
    });

    it('credits nothing when the reference was already applied', async () => {
        // A retried webhook or a reloaded confirmation page used to pay twice.
        setSession('member-1');
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'loan_repayment' });

        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        const result = await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'PSK-abc',
        });

        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        // A duplicate delivery is a success, not an error.
        expect(result.success).toBe(true);
    });

    it('does not record a repayment as platform revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows whose status is
        // "completed". These rows did not exist at all before this change, so
        // writing them as completed would move reported revenue as a side
        // effect of an idempotency fix.
        setSession('member-1');

        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'PSK-abc',
        });

        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        expect(claim.status).not.toBe('completed');
    });

    it('refuses a repayment submitted for somebody else', async () => {
        // roles: [] matters. submitRepaymentAction now allows self OR admin,
        // because repayments arrive as bank transfers an admin reconciles by
        // hand and the action was previously unreachable by the only person who
        // needed it. This fixture defaults every session to ['admin'], so
        // without the empty roles here the "stranger" would BE an admin and the
        // test would assert nothing.
        setSession('not-the-member', []);

        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        const result = await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'PSK-abc',
        });

        expect(result.success).toBe(false);
        expect(mockClaimPaymentOnce).not.toHaveBeenCalled();
    });
});

describe('disburseLoanAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'disbursed' });
        mockCreateNotification.mockResolvedValue({ success: true });
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => ({ userId: 'member-1', amount: 250_000, status: 'disbursed' }),
            docs: [],
        }));
    });

    it('claims approved → disbursed rather than checking then writing', async () => {
        setSession('admin-A');

        const { disburseLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        await disburseLoanAction('loan-1');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['approved']);
        expect(call.to).toBe('disbursed');
    });

    it('does not notify the member twice when the claim is lost', async () => {
        // Two admins clicking Disburse together both wrote, and the member got
        // two "Funds Disbursed" notifications for one loan.
        setSession('admin-B');
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'disbursed' });

        const { disburseLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        const result = await disburseLoanAction('loan-1');

        expect(result.success).toBe(false);
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('reports a loan that was never approved distinctly from one already disbursed', async () => {
        setSession('admin-A');
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'pending' });

        const { disburseLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        const result = await disburseLoanAction('loan-1');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be approved/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#723 — a lost claim is only "already applied" if the winner was a repayment', () => {
    /*
     *   THE BRANCH RETURNED SUCCESS ON THE STRENGTH OF THE LOST CLAIM ALONE,
     *   and its reasoning — "already applied, a success not an error" — holds
     *   only while nothing ELSE can hold the reference.
     *
     *   Something else can. `processed_payments.id` is ONE namespace shared by
     *   every claimant: eleven Paystack processors, escrow funding, and this.
     *   And this reference is not generated — it is a bank reference an ADMIN
     *   TYPES IN, which RecordRepaymentModal's own note calls the idempotency
     *   key and warns must be the real one.
     *
     *   So an admin entering a reference that collides — another transfer
     *   recorded as "TRF001", or a Paystack reference — lost the claim and was
     *   told the repayment was recorded. It was not: the borrower still owed
     *   the money and the screen said they did not.
     */

    beforeEach(() => {
        jest.clearAllMocks();
        mockCreateNotification.mockResolvedValue({ success: true });
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => installment(),
            docs: [],
        }));
    });

    const submit = async () => {
        setSession('member-1');
        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        return await submitRepaymentAction({
            loanId: 'loan-1',
            installmentId: 'inst-1',
            userId: 'member-1',
            amount: 4_000,
            paymentReference: 'TRF001',
        }) as any;
    };

    it('A REFERENCE ALREADY HELD BY A PAYSTACK PAYMENT IS REFUSED, NOT CALLED SUCCESS', async () => {
        //   THE defect. `completed` is what a fulfilled Paystack payment leaves,
        //   so lostClaimWasFulfilled would call this fulfilled — it just was not
        //   fulfilled as THIS loan's repayment.
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });

        const res = await submit();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/different payment/i);
        //   And nothing was credited on the strength of it.
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('AND ONE HELD BY AN ESCROW FUNDING IS REFUSED TOO', async () => {
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'escrow_funding' });

        const res = await submit();

        expect(res.success).toBe(false);
    });

    it('BUT A GENUINE RE-RECORDING OF THE SAME TRANSFER IS STILL A SUCCESS', async () => {
        /*
         *   #259's rule, which this must not cost. An admin re-entering the same
         *   bank reference — a double-click, a reloaded page — has already had
         *   it applied by this same action, which claims with this status.
         *   Telling them it failed is the outcome #259 exists to remove.
         */
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'loan_repayment' });

        const res = await submit();

        expect(res.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });
});
