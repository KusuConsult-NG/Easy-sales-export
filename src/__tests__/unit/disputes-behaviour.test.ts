/**
 * @jest-environment node
 */

/**
 * The dispute lifecycle, EXECUTED — raise, list, read, resolve.
 *
 * At 47.3% statements / 29.8% branches. Two findings were located by running
 * the resolution path against a real store:
 *
 *   #94  DisputeResolution has FOUR values and this treated it as a binary:
 *        anything that was not "release_seller" refunded the buyer the WHOLE
 *        escrow. The admin dispute page offers "Partial Refund" and collects an
 *        amount — which was written onto the dispute and then ignored, so a
 *        ₦5,000 partial refund on a ₦50,000 order paid out ₦50,000 and recorded
 *        ₦5,000 beside it. "no_action" took the same branch and refunded in
 *        full.
 *
 *   #95  getDisputeByIdAction attached bank name, account number, account name
 *        and bank code for BOTH parties to every caller it admits — which
 *        includes the buyer and the seller. Filing a dispute handed each party
 *        the other's bank account number. Its admin arm was also isAdmin(),
 *        true for all ten admin roles, where the sibling list requires admin or
 *        super_admin for the same fields.
 *
 * WHAT IS MOCKED
 * --------------
 * The two Postgres primitives the fake deliberately does not implement —
 * claimStatusTransitionFromAny and creditWalletOnce (see KNOWN_DIVERGENCES;
 * whether they actually serialise is proven in src/__tests__/pg/). The claim
 * mock is stateful, so a second claim on the same row loses exactly as the SQL
 * would. Everything the actions decide runs for real.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: jest.fn(async () => undefined),
    invalidateUserCache: jest.fn(async () => undefined),
}));

jest.mock('@/lib/africastalking', () => ({ smsDisputeResolved: jest.fn(async () => undefined) }));
jest.mock('@/lib/fcm', () => ({ pushDisputeResolved: jest.fn(async () => undefined) }));

/**
 * A stateful stand-in for claim_status_transition_from_any: it reads the row,
 * checks the `fromAny` set, and writes only if it matches. A vacuous
 * always-claimed stub would make every "cannot resolve twice" test pass without
 * the guard existing.
 */
let store: FakeDbHandle;
const claimFromAny = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    if (!p.fromAny.includes(status)) return { claimed: false, status };
    const patch: Record<string, unknown> = { ...(p.patch ?? {}), status: p.to };
    if (p.recordPreviousAs) patch[p.recordPreviousAs] = status;
    store.seed(p.collection, p.id, { ...current, ...patch });
    return { claimed: true, status };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: null })),
    claimStatusTransitionFromAny: (p: unknown) => claimFromAny(p),
}));

const creditWalletOnce = jest.fn(
    async (_p: unknown) => ({ claimed: true, balance: 0 } as { claimed: boolean; balance: number }));
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (p: unknown) => creditWalletOnce(p),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ORDER = 'order-1';
const ESCROW = 'escrow-1';
const DISPUTE = 'dispute-1';

const DISPUTES = COLLECTIONS.DISPUTES;
const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;
const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;

const LONG_ENOUGH = 'x'.repeat(60);

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: 'x@example.com', name: 'X' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    creditWalletOnce.mockImplementation(async () => ({ claimed: true, balance: 50_000 }));
    store = installFakeDb();
    actAs(BUYER);
});

async function actions() {
    return import('@/app/actions/disputes');
}

const seedUsers = () => store.seedAll(COLLECTIONS.USERS, {
    [BUYER]: {
        roles: ['general_user'], firstName: 'Ada', lastName: 'Obi',
        email: 'ada@example.com', phone: '08030000001',
        bankName: 'GTBank', bankAccountNumber: '0000000001',
        bankAccountName: 'Ada Obi', bankCode: '058',
    },
    [SELLER]: {
        roles: ['seller'], firstName: 'Bola', lastName: 'Ade',
        email: 'bola@example.com', phone: '08030000002',
        bankName: 'Zenith', bankAccountNumber: '0000000002',
        bankAccountName: 'Bola Ade', bankCode: '057',
    },
    'admin-1': { roles: ['admin'], email: 'admin@example.com' },
    'super-1': { roles: ['super_admin'], email: 'super@example.com' },
    'support-1': { roles: ['support'], email: 'support@example.com' },
    'moderator-1': { roles: ['moderator'], email: 'mod@example.com' },
    'mkt-admin-1': { roles: ['marketplace_admin'], email: 'mkt@example.com' },
    'stranger-1': { roles: ['general_user'], email: 'nobody@example.com' },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createDisputeAction', () => {
    const raise = async (over: Record<string, unknown> = {}) =>
        (await (await actions()).createDisputeAction({
            orderId: ORDER, reason: 'damaged' as never,
            description: LONG_ENOUGH, evidenceUrls: ['https://cdn.test/a.png'],
            ...over,
        })) as any;

    beforeEach(() => {
        seedUsers();
        store.seed(ORDERS, ORDER, { buyerId: BUYER, sellerId: SELLER, status: 'shipped' });
        store.seed(ESCROWS, ESCROW, { orderId: ORDER, status: 'funded', amount: 50_000 });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await raise()).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses a description under 50 characters', async () => {
        expect(await raise({ description: 'too short' })).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses with no evidence attached', async () => {
        expect(await raise({ evidenceUrls: [] })).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses an order that is not the caller\'s', async () => {
        actAs('stranger-1');
        expect(await raise()).toMatchObject({ success: false, error: 'Not authorized' });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it.each(['completed', 'cancelled'])('refuses a %s order', async (status) => {
        store.seed(ORDERS, ORDER, { buyerId: BUYER, sellerId: SELLER, status });
        expect(await raise()).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses an unpaid order', async () => {
        store.seed(ORDERS, ORDER, { buyerId: BUYER, sellerId: SELLER, status: 'pending_payment' });
        expect(await raise()).toMatchObject({ success: false, error: 'Cannot dispute an unpaid order' });
    });

    it('refuses a second dispute on the same order', async () => {
        store.seed(DISPUTES, 'existing', { orderId: ORDER, status: 'open' });
        expect(await raise()).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(1);
    });

    it('FREEZES THE ESCROW, not just the order', async () => {
        // The auto-release cron selects escrows on status == "funded". This path
        // claimed the ORDER into "disputed" and never touched the escrow, so a
        // buyer who disputed from the dashboard had the order marked disputed
        // while the money stayed releasable — and the cron paid the seller out
        // from under an open dispute.
        expect(await raise()).toMatchObject({ success: true });

        expect(store.get(ESCROWS, ESCROW)).toMatchObject({ status: 'disputed' });
        expect(store.get(ORDERS, ORDER)).toMatchObject({
            status: 'disputed', statusBeforeDispute: 'shipped',
        });

        const [, dispute] = store.all(DISPUTES)[0];
        expect(dispute).toMatchObject({
            orderId: ORDER, buyerId: BUYER, sellerId: SELLER,
            status: 'open', escrowFrozen: true, escrowAlreadySettled: null,
        });
    });

    it.each(['funded', 'in_transit', 'delivered'])(
        'freezes an escrow at %s — every active status, not three of them', async (status) => {
            // This searched for funded|disputed|pending and froze only from
            // "funded". Both release paths release from "delivered", which is
            // what confirming receipt produces — so a dispute raised after the
            // goods arrived froze nothing and the seller was paid anyway.
            store.seed(ESCROWS, ESCROW, { orderId: ORDER, status, amount: 50_000 });

            expect(await raise()).toMatchObject({ success: true });
            expect(store.get(ESCROWS, ESCROW)?.status).toBe('disputed');
            expect(store.all(DISPUTES)[0][1].escrowFrozen).toBe(true);
        });

    it('records that the money has already gone when the escrow is released', async () => {
        // The dispute is still valid — a buyer may dispute after release — but
        // an admin must not discover there is nothing to refund only when the
        // refund fails.
        store.seed(ESCROWS, ESCROW, { orderId: ORDER, status: 'released', amount: 50_000 });

        expect(await raise()).toMatchObject({ success: true });
        expect(store.all(DISPUTES)[0][1]).toMatchObject({
            escrowFrozen: false, escrowAlreadySettled: 'released',
        });
    });

    it('accepts an escrow the other dispute path already froze', async () => {
        store.seed(ESCROWS, ESCROW, { orderId: ORDER, status: 'disputed', amount: 50_000 });

        expect(await raise()).toMatchObject({ success: true });
        expect(store.all(DISPUTES)[0][1].escrowFrozen).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the dispute lists', () => {
    const buyerList = async () => (await (await actions()).getBuyerDisputesAction()) as any;
    const sellerList = async () => (await (await actions()).getSellerDisputesAction()) as any;
    const adminList = async (o: Record<string, unknown> = {}) =>
        (await (await actions()).getAdminDisputesAction(o)) as any;

    beforeEach(() => {
        seedUsers();
        store.seedAll(DISPUTES, {
            mine: {
                orderId: ORDER, buyerId: BUYER, sellerId: SELLER, status: 'open',
                reason: 'damaged', description: 'broken on arrival',
                createdAt: '2026-02-01T00:00:00.000Z',
            },
            theirs: {
                orderId: 'order-2', buyerId: 'stranger-1', sellerId: 'seller-2',
                status: 'resolved', createdAt: '2026-01-01T00:00:00.000Z',
            },
        });
    });

    it('shows a buyer only their own', async () => {
        expect((await buyerList()).data.map((d: any) => d.id)).toEqual(['mine']);
    });

    it('shows a seller only their own', async () => {
        actAs(SELLER, ['seller']);
        expect((await sellerList()).data.map((d: any) => d.id)).toEqual(['mine']);
    });

    it('refuses the admin list to a caller with no session', async () => {
        actAs(null);
        expect(await adminList()).toMatchObject({ success: false });
    });

    it.each([['support-1', 'support'], ['moderator-1', 'moderator'], ['mkt-admin-1', 'marketplace_admin']])(
        'refuses the admin list to %s', async (id, role) => {
            actAs(id, [role]);
            expect(await adminList()).toMatchObject({ success: false, error: 'Not authorized as admin' });
        });

    it.each([['admin-1', 'admin'], ['super-1', 'super_admin']])(
        'ADMITS %s — a super_admin without the plain admin role was locked out', async (id, role) => {
            actAs(id, [role]);
            const res = await adminList();
            expect(res.success).toBe(true);
            expect(res.data.map((d: any) => d.id).sort()).toEqual(['mine', 'theirs']);
        });

    it('filters by status and hydrates both parties', async () => {
        actAs('admin-1', ['admin']);
        const res = await adminList({ status: 'open' });

        expect(res.data.map((d: any) => d.id)).toEqual(['mine']);
        expect(res.data[0].buyerDetails).toMatchObject({ email: 'ada@example.com' });
        expect(res.data[0].sellerDetails).toMatchObject({ email: 'bola@example.com' });
    });

    it('searches across the id, order, reason, description and both emails', async () => {
        actAs('admin-1', ['admin']);

        expect((await adminList({ search: 'bola@example.com' })).data.map((d: any) => d.id)).toEqual(['mine']);
        expect((await adminList({ search: 'broken on arrival' })).data.map((d: any) => d.id)).toEqual(['mine']);
        expect((await adminList({ search: 'no such thing' })).data).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getDisputeByIdAction — who sees a bank account number', () => {
    const read = async (id = DISPUTE) =>
        (await (await actions()).getDisputeByIdAction(id)) as any;

    beforeEach(() => {
        seedUsers();
        store.seed(DISPUTES, DISPUTE, {
            orderId: ORDER, buyerId: BUYER, sellerId: SELLER, status: 'open',
            reason: 'damaged', description: LONG_ENOUGH,
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await read()).toMatchObject({ success: false });
    });

    it('refuses a dispute that does not exist', async () => {
        expect(await read('nope')).toMatchObject({ success: false, error: 'Dispute not found' });
    });

    it('refuses a stranger', async () => {
        actAs('stranger-1');
        expect(await read()).toMatchObject({
            success: false, error: 'Not authorized to view this dispute',
        });
    });

    it('lets the BUYER read their dispute — WITHOUT the seller\'s bank account', async () => {
        // #95. Both profile blocks attached bankDetails unconditionally, to
        // every caller the authorisation check admits. Filing a dispute handed
        // the buyer the seller's account number, and the seller the buyer's.
        const res = await read();

        expect(res.success).toBe(true);
        expect(res.data.dispute.sellerDetails).toMatchObject({ email: 'bola@example.com' });
        expect(res.data.dispute.sellerDetails.bankDetails).toBeUndefined();
        expect(res.data.dispute.buyerDetails.bankDetails).toBeUndefined();
        expect(JSON.stringify(res.data)).not.toContain('0000000002');
    });

    it('and the SELLER likewise', async () => {
        actAs(SELLER, ['seller']);
        const res = await read();

        expect(res.success).toBe(true);
        expect(res.data.dispute.buyerDetails.bankDetails).toBeUndefined();
        expect(JSON.stringify(res.data)).not.toContain('0000000001');
    });

    it.each([['support-1', 'support'], ['moderator-1', 'moderator'], ['mkt-admin-1', 'marketplace_admin']])(
        'lets %s read the dispute but not the bank details', async (id, role) => {
            // The admin arm was isAdmin(), true for all ten admin roles, where
            // the sibling list requires admin or super_admin for the same fields.
            actAs(id, [role]);
            const res = await read();

            expect(res.success).toBe(true);
            expect(res.data.dispute.buyerDetails.bankDetails).toBeUndefined();
            expect(res.data.dispute.sellerDetails.bankDetails).toBeUndefined();
        });

    it.each([['admin-1', 'admin'], ['super-1', 'super_admin']])(
        'gives %s the bank details, because they are the ones who move the money', async (id, role) => {
            actAs(id, [role]);
            const res = await read();

            expect(res.data.dispute.buyerDetails.bankDetails).toMatchObject({
                accountNumber: '0000000001', bankName: 'GTBank',
            });
            expect(res.data.dispute.sellerDetails.bankDetails).toMatchObject({
                accountNumber: '0000000002', bankName: 'Zenith',
            });
        });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateDisputeStatusAction — the money', () => {
    const resolve = async (
        resolution: string, notes = 'reviewed', refundAmount?: number, id = DISPUTE,
    ) => (await (await actions()).updateDisputeStatusAction(
        id, resolution as never, notes, refundAmount)) as any;

    const seedDispute = (extra: Record<string, unknown> = {}) =>
        store.seed(DISPUTES, DISPUTE, {
            orderId: ORDER, buyerId: BUYER, sellerId: SELLER, status: 'open',
            reason: 'damaged', description: LONG_ENOUGH, ...extra,
        });

    const seedEscrow = (extra: Record<string, unknown> = {}) =>
        store.seed(ESCROWS, ESCROW, {
            orderId: ORDER, status: 'disputed', amount: 50_000,
            productName: 'Cocoa', ...extra,
        });

    /** Every credit issued, as { userId, amount } pairs. */
    const credits = () => creditWalletOnce.mock.calls.map(([p]) =>
        ({ userId: (p as any).userId, amount: (p as any).amount }));

    beforeEach(() => {
        seedUsers();
        seedDispute();
        seedEscrow();
        store.seed(ORDERS, ORDER, { buyerId: BUYER, sellerId: SELLER, status: 'disputed' });
        actAs('admin-1', ['admin']);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await resolve('refund_buyer')).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it.each([['support-1', 'support'], ['mkt-admin-1', 'marketplace_admin'], [BUYER, 'general_user']])(
        'refuses %s', async (id, role) => {
            actAs(id, [role]);
            expect(await resolve('refund_buyer')).toMatchObject({
                success: false, error: 'Not authorized as admin',
            });
            expect(creditWalletOnce).not.toHaveBeenCalled();
        });

    it('admits a super_admin who does not also hold the plain admin role', async () => {
        actAs('super-1', ['super_admin']);
        expect(await resolve('refund_buyer')).toMatchObject({ success: true });
    });

    it('refuses a dispute that is already resolved', async () => {
        seedDispute({ status: 'resolved' });
        expect(await resolve('refund_buyer')).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses when there is no escrow for the order', async () => {
        store.clear();
        seedUsers();
        seedDispute();
        expect(await resolve('refund_buyer')).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('REFUNDS THE BUYER the whole escrow, and cancels the order', async () => {
        expect(await resolve('refund_buyer')).toMatchObject({ success: true });

        expect(credits()).toEqual([{ userId: BUYER, amount: 50_000 }]);
        expect(store.get(ESCROWS, ESCROW)?.status).toBe('refunded');
        expect(store.get(ORDERS, ORDER)?.status).toBe('cancelled');
        expect(store.get(DISPUTES, DISPUTE)).toMatchObject({
            status: 'resolved', resolution: 'refund_buyer', adminId: 'admin-1',
        });
    });

    it('RELEASES TO THE SELLER the whole escrow, and completes the order', async () => {
        expect(await resolve('release_seller')).toMatchObject({ success: true });

        expect(credits()).toEqual([{ userId: SELLER, amount: 50_000 }]);
        expect(store.get(ESCROWS, ESCROW)?.status).toBe('released');
        expect(store.get(ORDERS, ORDER)?.status).toBe('completed');
    });

    it('SPLITS a partial refund — the buyer gets the stated amount, the seller the rest', async () => {
        // #94. This treated the resolution as a binary: anything that was not
        // "release_seller" refunded the buyer `escrowAmount`. The admin page
        // offers "Partial Refund" and collects an amount, which was written onto
        // the dispute and then ignored — a ₦5,000 partial refund on a ₦50,000
        // order paid out ₦50,000 and recorded ₦5,000 beside it.
        expect(await resolve('partial_refund', 'split it', 5_000)).toMatchObject({ success: true });

        expect(credits()).toEqual([
            { userId: BUYER, amount: 5_000 },
            { userId: SELLER, amount: 45_000 },
        ]);
        expect(store.get(DISPUTES, DISPUTE)).toMatchObject({
            status: 'resolved', resolution: 'partial_refund', refundAmount: 5_000,
        });
    });

    it('and the two shares always add up to the escrow', async () => {
        for (const share of [1, 12_345.67, 49_999]) {
            jest.clearAllMocks();
            store.clear();
            seedUsers(); seedDispute(); seedEscrow();
            store.seed(ORDERS, ORDER, { buyerId: BUYER, sellerId: SELLER, status: 'disputed' });

            expect((await resolve('partial_refund', 'split', share)).success).toBe(true);
            const total = credits().reduce((sum, c) => sum + Number(c.amount), 0);
            expect(Number(total.toFixed(2))).toBe(50_000);
        }
    });

    it('refuses a partial refund with no amount — the other admin list sends none', async () => {
        // /admin/disputes calls this action with three arguments. Under the old
        // code that meant a full refund; it must not.
        const res = await resolve('partial_refund');
        expect(res.success).toBe(false);
        expect(res.error).toContain('refund amount greater than zero');
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it.each([0, -1, NaN])('refuses a partial refund of %s', async (amount) => {
        expect((await resolve('partial_refund', 'x', amount)).success).toBe(false);
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses a partial refund larger than the escrow', async () => {
        const res = await resolve('partial_refund', 'x', 50_001);
        expect(res.success).toBe(false);
        expect(res.error).toContain('cannot exceed the escrow amount');
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('allows a partial refund of the whole escrow, crediting the seller nothing', async () => {
        expect((await resolve('partial_refund', 'x', 50_000)).success).toBe(true);
        expect(credits()).toEqual([{ userId: BUYER, amount: 50_000 }]);
    });

    it('REFUSES "no_action" instead of quietly refunding in full', async () => {
        const res = await resolve('no_action');
        expect(res.success).toBe(false);
        expect(res.error).toContain('No action');
        expect(creditWalletOnce).not.toHaveBeenCalled();
        expect(store.get(DISPUTES, DISPUTE)?.status).toBe('open');
        expect(store.get(ESCROWS, ESCROW)?.status).toBe('disputed');
    });

    it('will NOT pay out an escrow that was never funded', async () => {
        // "pending" means no money reached the platform, and both branches
        // credit a wallet with the escrow's amount, which is written at creation
        // regardless.
        seedEscrow({ status: 'pending' });

        expect((await resolve('refund_buyer')).success).toBe(false);
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it.each(['in_transit', 'delivered'])(
        'CAN resolve a dispute on a %s escrow', async (status) => {
            // The claim omitted these, so a dispute on a shipped or received
            // order could not be resolved at all — and confirming receipt is
            // what moves an escrow to "delivered".
            seedEscrow({ status });
            expect((await resolve('refund_buyer')).success).toBe(true);
        });

    it('cannot resolve the same escrow twice', async () => {
        expect((await resolve('refund_buyer')).success).toBe(true);
        seedDispute();  // as if the dispute row had not been settled

        const second = await resolve('release_seller');
        expect(second.success).toBe(false);
        expect(second.error).toContain('already refunded');
    });

    it('writes both ledger rows for the amount actually credited', async () => {
        await resolve('partial_refund', 'split', 5_000);

        expect(store.get(COLLECTIONS.WALLET_TRANSACTIONS, `DISPUTE-RES-${DISPUTE}`)).toMatchObject({
            userId: BUYER, type: 'refund', amount: 5_000, status: 'completed',
        });
        expect(store.get(COLLECTIONS.TRANSACTIONS, `DISPUTE-RES-${DISPUTE}`)).toMatchObject({
            userId: BUYER, type: 'dispute_refund', module: 'escrow', amount: 5_000,
        });
    });

    it('leaves the ledger rows alone when the credit was already claimed', async () => {
        creditWalletOnce.mockImplementation(async () => ({ claimed: false, balance: 0 }));

        expect((await resolve('refund_buyer')).success).toBe(true);
        expect(store.get(COLLECTIONS.WALLET_TRANSACTIONS, `DISPUTE-RES-${DISPUTE}`)).toBeUndefined();
    });

    it('credits with a reference keyed on the dispute, so a retry cannot double it', async () => {
        await resolve('partial_refund', 'split', 5_000);

        const refs = creditWalletOnce.mock.calls.map(([p]) => (p as any).reference);
        expect(refs).toEqual([`DISPUTE-RES-${DISPUTE}`, `DISPUTE-RES-SELLER-${DISPUTE}`]);
    });

    it('records the payout as a disbursement and the refund as a refund, never as revenue', async () => {
        // platform_revenue_totals() sums "completed" rows; money leaving escrow
        // to a user is not revenue arriving.
        await resolve('release_seller');
        expect(creditWalletOnce).toHaveBeenCalledWith(expect.objectContaining({ status: 'disbursement' }));

        jest.clearAllMocks();
        store.clear(); seedUsers(); seedDispute(); seedEscrow();
        await resolve('refund_buyer');
        expect(creditWalletOnce).toHaveBeenCalledWith(expect.objectContaining({ status: 'refund' }));
    });
});
