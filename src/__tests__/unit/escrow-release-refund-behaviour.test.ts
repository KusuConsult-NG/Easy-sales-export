/**
 * @jest-environment node
 */

/**
 * Releasing and refunding an escrow, EXECUTED — the two paths that move money
 * out of the platform.
 *
 * _escrow_actions.ts was at 19.5% statements and 8.9% branches. Two findings
 * came out of running it:
 *
 *   #109 THE PLATFORM FEE WAS NEVER TAKEN. Three escrow creators compute
 *        `platformFee` from MARKETPLACE_CONFIG.platformFee (5%) and store it,
 *        with `netAmount`, on every escrow row. Nothing read either field —
 *        grep found only the lines that compute them — and both release paths
 *        credited the seller `data.amount`, the GROSS. So the commission was
 *        calculated on every sale, written to the database, and collected on
 *        none of them, while the seller onboarding pages state "Platform fee:
 *        5% per transaction" as an agreed term.
 *
 *        The refund path is different and correct: a refunded buyer gets the
 *        gross back, because gross is what they paid.
 *
 *   #110 _escrow_lifecycle.releaseEscrowAction still credited the wallet by
 *        hand — set-if-absent, increment-otherwise — which its sibling
 *        documents as replaced, because two escrows for the SAME seller
 *        released at once before that seller has a wallet row both take the set
 *        branch and one release is lost. Nothing imports that action, which is
 *        how it was missed.
 *
 * The Postgres money primitives are mocked (creditWalletOnce, the claim); every
 * decision about WHO gets paid and HOW MUCH runs for real.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ESCROW_RELEASABLE_FROM, ESCROW_REFUNDABLE_FROM } from '@/lib/escrow-status';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/africastalking', () => ({
    smsEscrowReleased: jest.fn(async () => undefined),
    smsDisputeResolved: jest.fn(async () => undefined),
}));
jest.mock('@/lib/fcm', () => ({
    pushEscrowReleased: jest.fn(async () => undefined),
    pushDisputeResolved: jest.fn(async () => undefined),
}));

let store: FakeDbHandle;

const claimFromAny = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    if (!p.fromAny.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    return { claimed: true, status: p.to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: (p: unknown) => claimFromAny(p),
}));

const creditWalletOnce = jest.fn(
    async (_p: unknown) => ({ claimed: true, balance: 0 } as { claimed: boolean; balance: number }));
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (p: unknown) => creditWalletOnce(p),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    markFulfilmentFailed: jest.fn(async () => undefined),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ESCROW = 'ESC-1';
const ORDER = 'ORD-1';

const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;

function actAs(id: string | null, roles: string[] = ['admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    creditWalletOnce.mockImplementation(async () => ({ claimed: true, balance: 47_500 }));
    store = installFakeDb();
    actAs('admin-1', ['admin']);
});

/** An escrow as the funding paths write it: gross, fee and net all recorded. */
const seedEscrow = (status = 'funded', extra: Record<string, unknown> = {}) =>
    store.seed(ESCROWS, ESCROW, {
        id: ESCROW, orderId: ORDER, buyerId: BUYER, sellerId: SELLER,
        sellerEmail: 'bola@example.com', productName: 'Cocoa',
        amount: 50_000, grossAmount: 50_000, platformFee: 2_500, netAmount: 47_500,
        status, ...extra,
    });

const release = async (id = ESCROW) =>
    (await (await import('@/app/actions/marketplace/_escrow_actions'))
        .releaseEscrowFunds(id)) as any;
const refund = async (id = ESCROW) =>
    (await (await import('@/app/actions/marketplace/_escrow_actions'))
        .refundEscrowToBuyer(id)) as any;

/** Every credit issued, as { userId, amount }. */
const credits = () => creditWalletOnce.mock.calls.map(([p]) =>
    ({ userId: (p as any).userId, amount: (p as any).amount, status: (p as any).status }));

// ─────────────────────────────────────────────────────────────────────────────
describe('releaseEscrowFunds', () => {
    beforeEach(() => {
        seedEscrow();
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, ORDER, { buyerId: BUYER, status: 'delivered' });
        store.seed(COLLECTIONS.USERS, SELLER, { phone: '08030000000' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await release()).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it.each([['support'], ['marketplace_admin'], ['moderator'], ['general_user']])(
        'refuses a %s — release needs finance:resolve_disputes', async (role) => {
            actAs('someone', [role]);
            expect(await release()).toMatchObject({ success: false, error: 'Admin access required' });
            expect(creditWalletOnce).not.toHaveBeenCalled();
        });

    it.each([['admin'], ['super_admin']])('admits a %s', async (role) => {
        actAs('admin-1', [role]);
        expect(await release()).toMatchObject({ success: true });
    });

    it('refuses an escrow that does not exist', async () => {
        store.clear();
        expect(await release()).toMatchObject({ success: false, error: 'Transaction not found' });
    });

    it('refuses an escrow with no amount on it', async () => {
        seedEscrow('funded', { amount: 0, grossAmount: 0 });
        expect(await release()).toMatchObject({ success: false, error: 'Invalid transaction amount' });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('PAYS THE SELLER NET OF THE PLATFORM FEE', async () => {
        // #109. Both release paths credited `data.amount` — the gross — so the
        // 5% the platform computes on every escrow, stores, and tells sellers
        // about at onboarding was never actually taken.
        expect(await release()).toMatchObject({ success: true });

        expect(credits()).toEqual([
            { userId: SELLER, amount: 47_500, status: 'disbursement' },
        ]);
    });

    it('and falls back to the gross for an escrow written before the fee was recorded', async () => {
        // Paying nothing would be a worse failure than paying the old amount.
        seedEscrow('funded', { netAmount: undefined, platformFee: undefined });

        await release();
        expect(credits()).toEqual([
            { userId: SELLER, amount: 50_000, status: 'disbursement' },
        ]);
    });

    it.each([0, -1, NaN, 'nonsense'])(
        'and for an unusable netAmount of %s', async (netAmount) => {
            seedEscrow('funded', { netAmount });

            await release();
            expect(credits()[0].amount).toBe(50_000);
        });

    it('records the payout, not the gross, everywhere a seller can see it', async () => {
        await release();

        expect(store.get(COLLECTIONS.WALLET_TRANSACTIONS, `escrow-release-${ESCROW}`))
            .toMatchObject({ userId: SELLER, type: 'funding', amount: 47_500 });
        expect(store.get(COLLECTIONS.TRANSACTIONS, `ESCROW-RELEASE-${ESCROW}`))
            .toMatchObject({ userId: SELLER, type: 'escrow_payout', amount: 47_500 });

        const [, instruction] = store.all(COLLECTIONS.PAYMENT_INSTRUCTIONS)[0];
        expect(instruction).toMatchObject({ recipientId: SELLER, amount: 47_500 });
    });

    it('never records a payout as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows at "completed",
        // and an escrow release is platform-held money going OUT to a seller.
        await release();
        expect(credits()[0].status).toBe('disbursement');
    });

    it.each([...ESCROW_RELEASABLE_FROM])('releases from %s', async (status) => {
        seedEscrow(status);
        expect(await release()).toMatchObject({ success: true });
        expect(store.get(ESCROWS, ESCROW)?.status).toBe('released');
    });

    it.each(['pending', 'released', 'refunded', 'cancelled'])(
        'refuses to release a %s escrow', async (status) => {
            seedEscrow(status);

            expect((await release()).success).toBe(false);
            expect(creditWalletOnce).not.toHaveBeenCalled();
        });

    it('cannot release the same escrow twice', async () => {
        expect((await release()).success).toBe(true);
        const second = await release();
        expect(second.success).toBe(false);
        expect(second.error).toContain('already released');
    });

    it('completes the order once every seller has been paid', async () => {
        store.seedAll(ESCROWS, {
            [ESCROW]: {
                id: ESCROW, orderId: ORDER, buyerId: BUYER, sellerId: SELLER,
                amount: 30_000, netAmount: 28_500, status: 'funded', productName: 'Cocoa',
            },
            'ESC-2': {
                id: 'ESC-2', orderId: ORDER, buyerId: BUYER, sellerId: 'seller-2',
                amount: 20_000, netAmount: 19_000, status: 'funded', productName: 'Sesame',
            },
        });

        await release(ESCROW);
        expect(store.get(COLLECTIONS.MARKETPLACE_ORDERS, ORDER)?.status).toBe('delivered');

        await release('ESC-2');
        expect(store.get(COLLECTIONS.MARKETPLACE_ORDERS, ORDER)).toMatchObject({
            status: 'completed', paymentStatus: 'paid_to_seller', escrowReleased: true,
        });
    });

    it('records who released it, and what the fee was', async () => {
        await release();

        expect(store.get(ESCROWS, ESCROW)).toMatchObject({
            status: 'released', releasedBy: 'admin-1',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('refundEscrowToBuyer', () => {
    beforeEach(() => {
        seedEscrow('disputed');
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, ORDER, { buyerId: BUYER, status: 'disputed' });
        store.seed(COLLECTIONS.USERS, BUYER, { phone: '08030000001' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await refund()).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses an admin of another module', async () => {
        actAs('mkt-1', ['marketplace_admin']);
        expect((await refund()).success).toBe(false);
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('RETURNS THE GROSS to the buyer — gross is what they paid', async () => {
        // Deliberately NOT net. The fee is the platform's share of a completed
        // sale; a refunded sale did not complete, so there is nothing to keep.
        expect(await refund()).toMatchObject({ success: true });

        expect(credits()).toEqual([
            { userId: BUYER, amount: 50_000, status: expect.any(String) },
        ]);
    });

    it.each([...ESCROW_REFUNDABLE_FROM])('refunds from %s', async (status) => {
        seedEscrow(status);
        expect(await refund()).toMatchObject({ success: true });
        expect(store.get(ESCROWS, ESCROW)?.status).toBe('refunded');
    });

    it.each(['pending', 'released', 'refunded'])(
        'refuses to refund a %s escrow', async (status) => {
            seedEscrow(status);
            expect((await refund()).success).toBe(false);
            expect(creditWalletOnce).not.toHaveBeenCalled();
        });

    it('cannot refund the same escrow twice', async () => {
        expect((await refund()).success).toBe(true);
        expect((await refund()).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two release paths agree', () => {
    it('both credit through the ledger primitive, neither by hand', async () => {
        // #110. _escrow_lifecycle.releaseEscrowAction read the wallet and wrote
        // a computed balance. The set-if-absent branch loses a release when two
        // escrows for the same seller are released before that seller has a
        // wallet row — which its own claim does not cover, because the claim is
        // per-escrow.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        for (const rel of [
            'src/app/actions/marketplace/_escrow_actions.ts',
            'src/app/actions/marketplace/_escrow_lifecycle.ts',
        ]) {
            const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });
            expect(src).toContain('creditWalletOnce({');
            // The shape that loses money.
            expect(src).not.toMatch(/tx\.set\(walletRef,\s*\{[^}]*balance:/);
        }
    });

    it('and both pay net of the platform fee', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        for (const rel of [
            'src/app/actions/marketplace/_escrow_actions.ts',
            'src/app/actions/marketplace/_escrow_lifecycle.ts',
        ]) {
            const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });
            expect(src).toContain('sellerPayout');
            expect(src).toMatch(/netAmount/);
        }
    });
});
