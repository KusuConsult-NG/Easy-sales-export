/**
 * @jest-environment node
 */

/**
 * wallet.ts — 920 lines, 65 money-handling references, one test.
 *
 * WHY IT HAD NO COVERAGE
 * ----------------------
 * It uses `.select()` and query `.all()`, and neither existed in jest.setup.js
 * until the harness audit. Any test reaching those paths threw
 * `x is not a function`, the action's try/catch swallowed it, and the test saw
 * a generic failure. The harness gap and the coverage gap were hiding each
 * other: nothing tripped over the missing stubs because nothing tested the file.
 *
 * WHAT THIS COVERS
 * ----------------
 * The money paths, which are already claim-based from the earlier atomic-money
 * migration and were entirely unprotected by tests:
 *
 *   withdrawFromWalletAction     debitWalletLocked — reserve before requesting
 *   walletCheckoutAction         debitWalletOnce, keyed on the order
 *   processWalletWithdrawalAction  claimStatusTransition before paystackPayout,
 *                                creditWalletOnce on reject
 *
 * THE ONE DEFECT FOUND
 * --------------------
 * `walletCheckoutAction` took `amountNGN` from the caller and never compared it
 * to the order. It cannot mark an unpaid order paid — it does not touch the
 * order at all — but it wrote two ledger rows marked `status: "completed"` for
 * whatever amount it was handed, and reconciliation reads those rows to decide
 * whether a payment produced what it should have.
 *
 * It now loads the order, requires the caller to own it, and charges
 * `totalAmount`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const STRANGER = 'stranger-1';
const ORDER = 'order-1';
const ORDER_TOTAL = 50_000;

const mockDebitOnce = jest.fn() as jest.Mock<any>;
const mockDebitLocked = jest.fn() as jest.Mock<any>;
const mockCreditOnce = jest.fn() as jest.Mock<any>;
const mockClaimStatus = jest.fn() as jest.Mock<any>;
const mockPayout = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    debitWalletOnce: (...a: any[]) => mockDebitOnce(...a),
    debitWalletLocked: (...a: any[]) => mockDebitLocked(...a),
    creditWalletOnce: (...a: any[]) => mockCreditOnce(...a),
    claimPaymentOnce: jest.fn(), debitJsonbBalance: jest.fn(),
    debitJsonbBalanceWithFloor: jest.fn(), claimVersionedUpdate: jest.fn(),
    claimIdempotencyKey: jest.fn(), incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => mockClaimStatus(...a),
    claimStatusTransitionFromAny: jest.fn(),
}));
jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (...a: any[]) => mockPayout(...a),
    // The REAL payoutReference. A mock that stubs only paystackPayout leaves
    // this undefined, the caller throws on the call, and the action's own catch
    // turns it into a generic failure — the fourth time an incomplete mock has
    // made a working path look broken in this codebase. Taken from the real
    // module so the reference asserted here is the reference sent (#249).
    payoutReference: (jest.requireActual('@/lib/paystack-transfer') as typeof import('@/lib/paystack-transfer')).payoutReference,
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
    // The money paths record who approved or rejected. Mocking the module
    // without this export made the call a TypeError, which the action's own
    // catch turned into a failed response — the operation looked broken.
    recordAdminAction: jest.fn(async () => undefined),
}));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));

/**
 * Withdrawals and deposits sit behind feature toggles that DEFAULT TO FALSE —
 * `wallet_deposits: false, wallet_withdrawals: false`, commented in
 * feature-toggles.ts as "disabled for production rollout".
 *
 * Without this mock every withdrawal test passes for the wrong reason: the
 * action returns "Wallet withdrawals are currently disabled" and never reaches
 * the money code, so an assertion of `success === false` holds no matter what
 * the debit does. One of these tests was written that way and passed.
 *
 * Enabled here so the tests exercise the path they claim to.
 */
jest.mock('@/app/actions/feature-toggles', () => ({
    getFeatureToggle: jest.fn(async () => true),
    getAllFeatureToggles: jest.fn(async () => ({})),
    updateFeatureToggle: jest.fn(),
    hasFeatureAccess: jest.fn(async () => true),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles } },
        error: null,
    }));
}

/** An order of ORDER_TOTAL owned by BUYER. */
function setOrder(overrides: Record<string, any> = {}) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({ buyerId: BUYER, totalAmount: ORDER_TOTAL, status: 'pending', ...overrides }),
    }));
}

describe('walletCheckoutAction — the amount must come from the order', () => {
    beforeEach(() => {
    /**
     * #400 retired walletCheckoutAction behind this flag: it debits the
     * wallet and never completes the order — no status write, no escrow, no
     * fee, no notification.
     *
     * ARMED here rather than these tests being deleted. They carry #91's
     * repair — the caller's amount replaced by the order's own total, in the
     * debit AND in both ledger rows — and that has to hold if the fulfilment
     * half is ever written. A refusal in front of them would make the suite
     * pass vacuously.
     */
    process.env.MARKETPLACE_WALLET_CHECKOUT = 'enabled';
        jest.clearAllMocks();
        setSession(BUYER);
        setOrder();
        mockDebitOnce.mockResolvedValue({ ok: true, balance: 10_000, reason: null });
    });

    async function checkout(claimedAmount: number, caller = BUYER) {
        setSession(caller);
        const { walletCheckoutAction } = await import('@/app/actions/wallet');
        return walletCheckoutAction(ORDER, claimedAmount);
    }

    it('charges the order total, not the amount the caller asked for', async () => {
        // THE test. Asking to pay ₦1 for a ₦50,000 order must charge ₦50,000.
        await checkout(1);

        expect(mockDebitOnce).toHaveBeenCalledWith(
            expect.objectContaining({ amount: ORDER_TOTAL })
        );
    });

    it('refuses a caller who does not own the order', async () => {
        const r: any = await checkout(ORDER_TOTAL, STRANGER);

        expect(r.success).toBe(false);
        expect(mockDebitOnce).not.toHaveBeenCalled();
    });

    it('refuses an order that does not exist', async () => {
        (global as any).mockFirestoreGet.mockImplementation(() =>
            Promise.resolve({ exists: false, empty: true, docs: [], data: () => undefined }));

        const r: any = await checkout(ORDER_TOTAL);

        expect(r.success).toBe(false);
        expect(mockDebitOnce).not.toHaveBeenCalled();
    });

    it('refuses an order with no amount', async () => {
        setOrder({ totalAmount: 0 });

        const r: any = await checkout(ORDER_TOTAL);

        expect(r.success).toBe(false);
        expect(mockDebitOnce).not.toHaveBeenCalled();
    });

    it('keys the debit on the order, so a repeat cannot charge twice', async () => {
        // Rule 2: the reference must be stable across attempts.
        await checkout(ORDER_TOTAL);

        expect(mockDebitOnce).toHaveBeenCalledWith(
            expect.objectContaining({ reference: `order:${ORDER}` })
        );
    });

    it('treats an already-processed order as success, not an error', async () => {
        // Rule 3: a lost claim means the money already moved.
        mockDebitOnce.mockResolvedValue({ ok: false, reason: 'already_processed', balance: 10_000 });

        const r: any = await checkout(ORDER_TOTAL);

        expect(r.success).toBe(true);
    });

    it('reports insufficient balance without charging', async () => {
        mockDebitOnce.mockResolvedValue({ ok: false, reason: 'insufficient_funds', balance: 5 });

        const r: any = await checkout(ORDER_TOTAL);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/insufficient/i);
    });

    it('still completes a legitimate checkout', async () => {
        // Vacuity guard: every refusal above is satisfied by an action that
        // charges nobody, which would break marketplace payment entirely.
        const r: any = await checkout(ORDER_TOTAL);

        expect(r.success).toBe(true);
        expect(mockDebitOnce).toHaveBeenCalledTimes(1);
    });
});

describe('withdrawFromWalletAction — reserve before requesting', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setOrder();
        mockDebitLocked.mockResolvedValue({ ok: true, balance: 1_000, reason: null });
    });

    async function withdraw(amount: number) {
        const { withdrawFromWalletAction } = await import('@/app/actions/wallet');
        return withdrawFromWalletAction(amount, {
            accountNumber: '0123456789', bankCode: '058', accountName: 'A Person', bankName: 'A Bank',
        } as any);
    }

    it('debits under a row lock rather than reading then writing', async () => {
        // Two withdrawals arriving together both read the same balance and both
        // debited, before this used debitWalletLocked.
        await withdraw(5_000);

        expect(mockDebitLocked).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 5_000 })
        );
    });

    it('refuses when the balance will not cover it', async () => {
        // Asserts the REASON, not just failure: "withdrawals are disabled"
        // produces the same success:false and would make this vacuous.
        mockDebitLocked.mockResolvedValue({ ok: false, reason: 'insufficient_funds', balance: 100 });

        const r: any = await withdraw(5_000);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/insufficient/i);
    });
});

describe('processWalletWithdrawalAction — approval pays out once', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-1', ['admin']);
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({
                userId: BUYER, amount: -5_000, status: 'pending',
                bankDetails: { accountNumber: '0123456789', bankCode: '058', accountName: 'A' },
                createdAt: { toDate: () => new Date(Date.now() - 48 * 3600 * 1000) },
            }),
        }));
        mockClaimStatus.mockResolvedValue({ claimed: true, status: 'processing' });
        mockCreditOnce.mockResolvedValue({ claimed: true });
        mockPayout.mockResolvedValue({ success: true, transferCode: 'TRF-1' });
    });

    async function process(action: 'approve' | 'reject') {
        const { processWalletWithdrawalAction } = await import('@/app/actions/wallet');
        return processWalletWithdrawalAction('txn-1', action, 'note');
    }

    it('refuses a non-admin', async () => {
        setSession(BUYER);

        const r: any = await process('approve');

        expect(r.success).toBe(false);
        expect(mockPayout).not.toHaveBeenCalled();
    });

    it('claims the transition before paying out', async () => {
        // Without the claim, two admins approving together both pay.
        await process('approve');

        expect(mockClaimStatus).toHaveBeenCalled();
        const claimOrder = mockClaimStatus.mock.invocationCallOrder[0];
        const payoutOrder = mockPayout.mock.invocationCallOrder[0];
        if (payoutOrder !== undefined) expect(claimOrder).toBeLessThan(payoutOrder);
    });

    it('does not pay out when the claim is lost', async () => {
        mockClaimStatus.mockResolvedValue({ claimed: false, status: 'processing' });

        await process('approve');

        expect(mockPayout).not.toHaveBeenCalled();
    });

    it('refunds a rejection exactly once', async () => {
        await process('reject');

        expect(mockCreditOnce).toHaveBeenCalledTimes(1);
    });

    it('ignores a duplicate rejection rather than refunding twice', async () => {
        mockCreditOnce.mockResolvedValue({ claimed: false });

        const r: any = await process('reject');

        expect(r.success).toBe(true);
    });
});
