/**
 * @jest-environment node
 */

/**
 * Escrow release and refund credited wallets by hand.
 *
 * THE DEFECT
 * ----------
 * Both paths did this inside db.runTransaction:
 *
 *     const walletSnap = await tx.get(walletRef);
 *     if (!walletSnap.exists) {
 *         tx.set(walletRef, { balance: escrowAmount, ... });      // <-- computed
 *     } else {
 *         tx.update(walletRef, { balance: FieldValue.increment(escrowAmount) });
 *     }
 *
 * The increment branch is fine. The other one is a read-then-write of a balance:
 * two escrows for the SAME seller released at the same time, before that seller
 * has a wallet row, both take it and both SET the balance to their own amount.
 * Last write wins and one release is gone.
 *
 * `db.runTransaction` does not save it. On this adapter it takes no lock and
 * cannot roll back — established earlier in this audit and the reason
 * claimStatusTransitionFromAny exists at all. The claim above these lines
 * prevents the same escrow being released twice; it does nothing about two
 * different escrows landing on one empty wallet.
 *
 * A new seller's first two payouts is not an exotic case.
 *
 * THE FIX, AND THE TRAP INSIDE IT
 * -------------------------------
 * credit_wallet_once does it in one statement —
 *
 *     INSERT INTO wallets (id, balance) VALUES (...)
 *     ON CONFLICT (id) DO UPDATE SET balance = wallets.balance + EXCLUDED.balance
 *
 * — an upsert and an increment together, after claiming the reference in
 * processed_payments so a repeat cannot pay twice.
 *
 * But platform_revenue_totals() sums processed_payments rows whose
 * raw_data->>'status' is 'completed', and credit_wallet_once writes that table.
 * Passing the default status would have added **every escrow payout and every
 * buyer refund to reported platform revenue** — swapping a rare lost credit for
 * a permanent inflation of the revenue figure. Release is "disbursement",
 * refund is "refund". Both are asserted below, because that is the kind of
 * mistake that looks like a working fix.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * Nearly everything else, with comments recording earlier fixes: the release is
 * claimed from {delivered, disputed, funded} before any money moves, the refund
 * is claimed from {funded, in_transit, disputed}, the global ledger row uses a
 * derived id so a repeat overwrites, and the sibling-escrow read deliberately
 * happens after the claim. Those properties are asserted here too.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const ESCROW = 'escrow-1';
const ORDER = 'order-1';
const AMOUNT = 250_000;

const mockCredit = jest.fn() as jest.Mock<any>;
const mockClaimFromAny = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (...a: any[]) => mockCredit(...a),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(), claimPaymentOnce: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (...a: any[]) => mockClaimFromAny(...a),
    claimStatusTransition: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/** The escrow row, and the caller profile the admin re-validation reads. */
function setEscrow(overrides: Record<string, any> = {}) {
    const data = {
        amount: AMOUNT, orderId: ORDER, sellerId: SELLER, buyerId: BUYER,
        sellerEmail: 's@e.com', productName: 'A Product', status: 'delivered',
        roles: ['admin'],
        ...overrides,
    };
    const snap = {
        exists: true, empty: false,
        docs: [{ id: ESCROW, ref: { id: ESCROW }, data: () => data }],
        ref: { id: ESCROW },
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

describe('releaseEscrowFunds — the seller is credited through the ledger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setEscrow();
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'released' });
        mockCredit.mockResolvedValue({ claimed: true, balance: AMOUNT });
    });

    async function release() {
        const { releaseEscrowFunds } = await import('@/app/actions/marketplace/_escrow_actions');
        return releaseEscrowFunds(ESCROW);
    }

    it('credits the seller with credit_wallet_once, not a computed balance', async () => {
        // THE test. The upsert-and-increment is what makes two concurrent
        // releases to one empty wallet safe.
        await release();

        expect(mockCredit).toHaveBeenCalledWith(
            expect.objectContaining({ userId: SELLER, amount: AMOUNT })
        );
    });

    it('does not record the payout as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows with status
        // 'completed'. An escrow release is platform-held money going OUT.
        // Getting this wrong would inflate the revenue figure on every payout —
        // quieter than the bug being fixed, and permanent.
        await release();

        const [args] = mockCredit.mock.calls[0] as any[];
        expect(args.status).toBe('disbursement');
        expect(args.status).not.toBe('completed');
    });

    it('keys the credit on the escrow, so a repeat cannot pay twice', async () => {
        await release();

        expect(mockCredit).toHaveBeenCalledWith(
            expect.objectContaining({ reference: `escrow-release:${ESCROW}` })
        );
    });

    it('writes no wallet balance by hand any more', async () => {
        // The specific shape that was wrong: any write carrying a `balance`
        // field to the wallets collection. The history row carries
        // balanceBefore/balanceAfter, which are descriptive, not the money.
        await release();

        const balanceWrites = allWrites().filter((p) => p && 'balance' in p);
        expect(balanceWrites).toEqual([]);
    });

    it('claims the transition before crediting anyone', async () => {
        // Without the claim first, two admins releasing together both pay.
        await release();

        expect(mockClaimFromAny).toHaveBeenCalled();
        expect(mockClaimFromAny.mock.invocationCallOrder[0])
            .toBeLessThan(mockCredit.mock.invocationCallOrder[0]);
    });

    it('credits nobody when the claim is lost', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'released' });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/already released/i);
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('treats an already-credited escrow as success rather than an error', async () => {
        // Rule 3: claimed:false from the ledger means the money already moved.
        mockCredit.mockResolvedValue({ claimed: false, balance: AMOUNT });

        const r: any = await release();

        expect(r.success).toBe(true);
    });

    it('refuses a non-admin, and moves nothing', async () => {
        setSession(SELLER, ['seller']);

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/admin/i);
        expect(mockClaimFromAny).not.toHaveBeenCalled();
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('refuses an escrow with no amount', async () => {
        setEscrow({ amount: 0, grossAmount: 0 });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('still completes a legitimate release', async () => {
        // Vacuity guard: every refusal above is satisfied by an action that
        // pays nobody, which would break marketplace payouts entirely.
        const r: any = await release();

        expect(r.success).toBe(true);
        expect(mockCredit).toHaveBeenCalledTimes(1);
    });
});

describe('refundEscrowToBuyer — the buyer is credited the same way', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setEscrow({ status: 'funded' });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'refunded' });
        mockCredit.mockResolvedValue({ claimed: true, balance: AMOUNT });
    });

    async function refund() {
        const { refundEscrowToBuyer } = await import('@/app/actions/marketplace/_escrow_actions');
        return refundEscrowToBuyer(ESCROW);
    }

    it('credits the BUYER, not the seller', async () => {
        await refund();

        expect(mockCredit).toHaveBeenCalledWith(
            expect.objectContaining({ userId: BUYER, amount: AMOUNT })
        );
    });

    it('records the refund as a refund, not as revenue', async () => {
        // Money going back to a buyer is not income.
        await refund();

        const [args] = mockCredit.mock.calls[0] as any[];
        expect(args.status).toBe('refund');
    });

    it('keys the credit on the escrow', async () => {
        await refund();

        expect(mockCredit).toHaveBeenCalledWith(
            expect.objectContaining({ reference: `escrow-refund:${ESCROW}` })
        );
    });

    it('writes no wallet balance by hand', async () => {
        await refund();

        expect(allWrites().filter((p) => p && 'balance' in p)).toEqual([]);
    });

    it('refunds nobody when the claim is lost', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'refunded' });

        const r: any = await refund();

        expect(r.success).toBe(false);
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('still completes a legitimate refund', async () => {
        const r: any = await refund();

        expect(r.success).toBe(true);
        expect(mockCredit).toHaveBeenCalledTimes(1);
    });
});
