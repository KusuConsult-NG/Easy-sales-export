/**
 * @jest-environment node
 */

/**
 * The export module's payment paths.
 *
 * WHAT WAS WRONG
 * --------------
 * Every one of these is the client-side half of a payment the Paystack webhook
 * also fulfils, and each decided whether to run by READING processed_payments
 * and writing the marker afterwards. A webhook arriving while the buyer sat on
 * the callback page had both halves pass the check and both fulfil.
 *
 * verifyInvestmentPayment carried two more defects on top of that:
 *
 *   1. The funding counters were absolute writes computed in JavaScript —
 *      `fundedAmount: currentFunding + amount`, not FieldValue.increment. Two
 *      investors funding one window at the same time each wrote their own
 *      total, so one investment vanished from the window while the investor's
 *      money had been taken. Migration 010 could not help a write that never
 *      used the sentinel.
 *   2. The overfunding guard read the total, compared, and then wrote, with no
 *      lock, so two investments that each fit under the goal but together
 *      exceed it both passed.
 *
 * verifyExportOrderPayment decremented catalog stock with an unbounded
 * increment, so an order could drive availableQuantity negative.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;
const mockIncrementWithinCeiling = jest.fn() as jest.Mock<any>;
const mockDecrementManyOrFail = jest.fn() as jest.Mock<any>;
const mockMarkFulfilmentFailed = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...args: any[]) => mockClaimPaymentOnce(...args),
    incrementWithinCeiling: (...args: any[]) => mockIncrementWithinCeiling(...args),
    decrementManyOrFail: (...args: any[]) => mockDecrementManyOrFail(...args),
    // Called from the action's catch when fulfilment fails after the payment was
    // already claimed — which is exactly what the overfunding case below is. A
    // mock omitting it turns that assertion into
    // "markFulfilmentFailed is not a function" and hides what is being tested.
    markFulfilmentFailed: (...args: any[]) => mockMarkFulfilmentFailed(...args),
}));

const mockVerifyPaystack = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...args: any[]) => mockVerifyPaystack(...args),
    initializePaystackPayment: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function paystackOk(metadata: Record<string, any>, amountKobo: number) {
    mockVerifyPaystack.mockResolvedValue({
        status: true,
        data: { status: 'success', amount: amountKobo, metadata },
    });
}

/** Every .get() in these paths resolves to this. */
function setDocs(data: Record<string, any>, docs: any[] = []) {
    const snap = {
        exists: true,
        data: () => data,
        docs: docs.length ? docs : [{ id: 'doc-1', data: () => data }],
        empty: false,
        id: 'doc-1',
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

describe('verifyInvestmentPaymentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('investor-1');
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
        mockIncrementWithinCeiling.mockResolvedValue({ ok: true, value: 500_000, reason: null });
        paystackOk({ userId: 'investor-1', windowId: 'win-1', investmentAmount: 100_000 }, 10_000_000);
        setDocs({
            paymentReference: 'PSK-1',
            fundingGoal: 1_000_000,
            fundedAmount: 400_000,
            expectedReturn: 120_000,
        });
    });

    it('raises the funding total through the ceiling primitive, not a computed write', async () => {
        // THE test. `fundedAmount: currentFunding + amount` is what lost a
        // concurrent investor's money.
        const { verifyInvestmentPaymentAction } = await import('@/app/actions/export-payment');
        await verifyInvestmentPaymentAction('PSK-1');

        expect(mockIncrementWithinCeiling).toHaveBeenCalledTimes(1);
        const call = mockIncrementWithinCeiling.mock.calls[0][0] as any;
        expect(call.field).toBe('fundedAmount');
        expect(call.amount).toBe(100_000);
        expect(call.ceilingField).toBe('fundingGoal');
    });

    it('picks the ceiling field the record actually uses', async () => {
        // Both vocabularies exist in the data. Naming a field the record does
        // not have leaves the window UNBOUNDED, because a missing ceiling is
        // deliberately treated as uncapped.
        setDocs({ paymentReference: 'PSK-1', goal: 1_000_000, currentFunding: 400_000 });

        const { verifyInvestmentPaymentAction } = await import('@/app/actions/export-payment');
        await verifyInvestmentPaymentAction('PSK-1');

        const call = mockIncrementWithinCeiling.mock.calls[0][0] as any;
        expect(call.ceilingField).toBe('goal');
    });

    it('refuses the investment when it would exceed the goal', async () => {
        mockIncrementWithinCeiling.mockResolvedValue({ ok: false, value: 0, reason: 'ceiling_exceeded' });

        const { verifyInvestmentPaymentAction } = await import('@/app/actions/export-payment');
        const result = await verifyInvestmentPaymentAction('PSK-1');

        expect(result.success).toBe(false);
    });

    it('funds nothing when the webhook already claimed the payment', async () => {
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });

        const { verifyInvestmentPaymentAction } = await import('@/app/actions/export-payment');
        const result = await verifyInvestmentPaymentAction('PSK-1');

        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
        // A duplicate delivery is a success, not an error.
        expect(result.success).toBe(true);
    });

    it('claims the payment before touching the window', async () => {
        const { verifyInvestmentPaymentAction } = await import('@/app/actions/export-payment');
        await verifyInvestmentPaymentAction('PSK-1');

        expect(mockClaimPaymentOnce).toHaveBeenCalledTimes(1);
        expect((mockClaimPaymentOnce.mock.calls[0][0] as any).reference).toBe('PSK-1');
    });
});

describe('verifyExportOrderPaymentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('buyer-1');
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
        mockDecrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
        paystackOk({ userId: 'buyer-1' }, 5_000_000);
        setDocs({
            orderId: 'EXP-ORD-1',
            paymentReference: 'PSK-2',
            items: [
                { productId: 'prod-a', quantityMT: 3 },
                { productId: 'prod-b', quantityMT: 2 },
            ],
        });
    });

    it('decrements stock all-or-nothing rather than item by item', async () => {
        // An unbounded per-item decrement drove availableQuantity negative, and
        // left earlier items decremented when a later one fell short.
        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        await verifyExportOrderPaymentAction('PSK-2');

        expect(mockDecrementManyOrFail).toHaveBeenCalledTimes(1);
        const items = mockDecrementManyOrFail.mock.calls[0][0] as any[];
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ id: 'prod-a', field: 'availableQuantity', amount: 3 });
    });

    it('marks the order for refund when stock is short, rather than fulfilling it', async () => {
        mockDecrementManyOrFail.mockResolvedValue({ ok: false, failedId: 'prod-b', reason: 'insufficient' });

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const result = await verifyExportOrderPaymentAction('PSK-2');

        expect(result.success).toBe(false);
        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.paymentStatus).toBe('paid_awaiting_refund');
        expect(update.status).toBe('cancelled_out_of_stock');
    });

    it('fulfils nothing when the webhook already claimed the payment', async () => {
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const result = await verifyExportOrderPaymentAction('PSK-2');

        expect(mockDecrementManyOrFail).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });
});

describe('verifyExportInvestmentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('investor-1');
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
        paystackOk(
            { type: 'export_investment', userId: 'investor-1', exportId: 'win-1', amount: 100_000 },
            10_000_000,
        );
        setDocs({ fundingGoal: 1_000_000, fundedAmount: 400_000, roiPercentage: '18%' });
    });

    it('claims the reference as completed so the webhook status is not erased', async () => {
        // This path used to write processed_payments with NO status, and set()
        // is an upsert — so it overwrote the webhook's "completed" row and
        // silently removed the payment from platform_revenue_totals().
        const { verifyExportInvestmentAction } = await import('@/app/actions/export');
        await verifyExportInvestmentAction('PSK-3');

        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        expect(claim.status).toBe('completed');
    });

    it('routes an overfunded investment to review instead of counting it', async () => {
        setDocs({ fundingGoal: 450_000, fundedAmount: 400_000 });

        const { verifyExportInvestmentAction } = await import('@/app/actions/export');
        const result = await verifyExportInvestmentAction('PSK-3');

        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        expect(claim.status).toBe('overfunded_review');
        expect(claim.status).not.toBe('completed');
        expect(result.success).toBe(false);
    });

    it('creates no slot when the webhook already claimed the payment', async () => {
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });

        const { verifyExportInvestmentAction } = await import('@/app/actions/export');
        const result = await verifyExportInvestmentAction('PSK-3');

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxSet).not.toHaveBeenCalled();
    });
});
