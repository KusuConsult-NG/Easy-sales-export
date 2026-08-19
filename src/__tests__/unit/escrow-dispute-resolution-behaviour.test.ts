/**
 * @jest-environment node
 */

/**
 * The SECOND dispute resolver, EXECUTED — _escrow_disputes.resolveDisputeAction
 * and escalateDisputeAction.
 *
 * The admin dispute screen resolves through actions/disputes.ts. This copy is
 * exported, registered, and called by nothing — which is why every fix the live
 * resolver received never reached it. It was at 40.8% executed and held four
 * defects, all of them the shape of a copy left to drift:
 *
 *   #126 The escrow was read INSIDE the transaction that follows the claim, so a
 *        missing escrow threw with the dispute already marked "resolved" — case
 *        closed, resolver recorded, nobody paid, and a second attempt refused
 *        because the claim is gone. Reading first turns that into a refusal
 *        that changes nothing.
 *
 *   #127 `outcome` is typed "release_seller" | "refund_buyer" — a compile-time
 *        claim on a server action. Every use is `outcome === "release_seller" ?
 *        A : B`, so ANY other string fell through to B and silently refunded the
 *        buyer. actions/disputes.ts validates its resolution because a
 *        "no_action" outcome used to refund there too.
 *
 *   #128 A seller winning a dispute was credited the GROSS, so the platform fee
 *        that every undisputed sale withholds was handed over whenever a case
 *        was decided. Two release paths disagreeing about what a seller is owed.
 *
 *   #129 `resolvedBy`, `releasedBy` and the audit row's `userId` all came from
 *        the `adminId` PARAMETER, not from requireAdmin(). One admin could
 *        resolve a dispute and record a colleague as having decided it — in the
 *        log meant to establish who released the money.
 *
 * And the wallet credit itself was the hand-rolled read-then-write inside
 * runTransaction, which takes no lock, with no idempotency reference — the exact
 * shape its sibling in _escrow_lifecycle.ts documents as replaced.
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

const mockNotify = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...a: any[]) => mockNotify(...a),
}));

const mockSms = jest.fn(async () => undefined) as jest.Mock<any>;
const mockPush = jest.fn(async () => undefined) as jest.Mock<any>;
jest.mock('@/lib/africastalking', () => ({
    smsDisputeResolved: (...a: any[]) => mockSms(...a),
    smsEscrowReleased: jest.fn(),
}));
jest.mock('@/lib/fcm', () => ({
    pushDisputeResolved: (...a: any[]) => mockPush(...a),
    pushEscrowReleased: jest.fn(),
}));

/** Credits once per reference, and reports the balance after — as the SQL does. */
let store: FakeDbHandle;
const credited = new Map<string, number>();
const mockCredit = jest.fn(async (p: any) => {
    if (credited.has(p.reference)) return { claimed: false, balance: credited.get(p.reference)! };
    const balance = 100000 + Number(p.amount);
    credited.set(p.reference, balance);
    return { claimed: true, balance };
}) as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (...a: any[]) => mockCredit(...a),
    claimPaymentOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(), markFulfilmentFailed: jest.fn(),
}));

/** Stateful claims: an always-claimed stub cannot tell a guard from no guard. */
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    return { claimed: true, status: p.to };
}) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

const mockAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockAdmin(...a),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ADMIN = 'admin-real';
const OTHER_ADMIN = 'admin-someone-else';
const DISPUTE = 'dis-1';
const ESCROW = 'esc-1';

const DISPUTES = COLLECTIONS.DISPUTES;
const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const WALLET_TXNS = COLLECTIONS.WALLET_TRANSACTIONS;
const LEDGER = COLLECTIONS.TRANSACTIONS;

beforeEach(() => {
    jest.clearAllMocks();
    credited.clear();
    store = installFakeDb();
    mockAdmin.mockResolvedValue({ userId: ADMIN, roles: ['super_admin'] });
    store.seed(COLLECTIONS.USERS, BUYER, { phone: '+2348098765432' });
    store.seed(COLLECTIONS.USERS, SELLER, { phone: '+2348012345678' });
});

const disputes = () => import('@/app/actions/marketplace/_escrow_disputes');

const seedDispute = (over: Record<string, unknown> = {}) =>
    store.seed(DISPUTES, DISPUTE, {
        escrowId: ESCROW, status: 'open',
        initiatedBy: 'buyer', initiatorId: BUYER, respondentId: SELLER,
        buyerId: BUYER, sellerId: SELLER, reason: 'The goods arrived damaged.',
        ...over,
    });

const seedEscrow = (over: Record<string, unknown> = {}) =>
    store.seed(ESCROWS, ESCROW, {
        buyerId: BUYER, sellerId: SELLER, status: 'disputed',
        amount: 10000, netAmount: 9500, platformFee: 500,
        productName: 'Yams', orderId: 'ORD-1',
        ...over,
    });

const resolve = async (
    outcome = 'release_seller',
    claimedAdmin = OTHER_ADMIN,
    resolution = 'Seller provided proof of delivery.',
) => (await (await disputes()).resolveDisputeAction(
    DISPUTE as never, claimedAdmin as never, resolution as never, outcome as never,
)) as any;

const escalate = async (id = DISPUTE) =>
    (await (await disputes()).escalateDisputeAction(id as never)) as any;

const dispute = () => store.get(DISPUTES, DISPUTE) as Record<string, any>;
const escrow = () => store.get(ESCROWS, ESCROW) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveDisputeAction', () => {
    beforeEach(() => { seedDispute(); seedEscrow(); });

    it('refuses a caller who is not an admin', async () => {
        mockAdmin.mockResolvedValue({ error: 'Admin access required' });

        expect(await resolve()).toMatchObject({ success: false, error: 'Admin access required' });
        expect(mockCredit).not.toHaveBeenCalled();
        expect(dispute().status).toBe('open');
    });

    it('refuses a dispute that does not exist', async () => {
        store.clear();
        expect(await resolve()).toMatchObject({ success: false, error: 'Dispute not found' });
    });

    // ── #127 ────────────────────────────────────────────────────────────────
    it.each(['no_action', 'split', '', 'RELEASE_SELLER', 'refund'])(
        'REFUSES THE OUTCOME %p INSTEAD OF REFUNDING THE BUYER', async (outcome) => {
            // Every use is `outcome === "release_seller" ? A : B`, so anything
            // else fell through to B: escrow "refunded", buyer credited, both
            // parties told the case went against the seller.
            const res = await resolve(outcome);

            expect(res.success).toBe(false);
            expect(String(res.error)).toContain('Unknown outcome');
            expect(mockCredit).not.toHaveBeenCalled();
            expect(dispute().status).toBe('open');
            expect(escrow().status).toBe('disputed');
        });

    // ── #126 ────────────────────────────────────────────────────────────────
    it('DOES NOT CLOSE THE DISPUTE WHEN THERE IS NO ESCROW TO SETTLE', async () => {
        // The escrow was read inside the transaction AFTER the claim, so this
        // threw with the dispute already "resolved" — closed, attributed, and
        // unpayable, because a retry now fails the claim.
        store.seed(DISPUTES, DISPUTE, { ...dispute(), escrowId: 'gone' });

        const res = await resolve();

        expect(res.success).toBe(false);
        expect(String(res.error)).toContain('Escrow transaction not found');
        expect(dispute().status).toBe('open');
        expect(dispute().resolvedBy).toBeUndefined();
    });

    it('refuses an escrow with no usable amount, before claiming anything', async () => {
        seedEscrow({ amount: undefined, netAmount: undefined });

        expect(await resolve()).toMatchObject({ success: false });
        expect(dispute().status).toBe('open');
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it.each(['open', 'under_review'])('resolves a %s dispute', async (status) => {
        seedDispute({ status });

        expect(await resolve()).toMatchObject({ success: true });
        expect(dispute()).toMatchObject({ status: 'resolved', resolution: 'Seller provided proof of delivery.' });
    });

    it.each(['resolved', 'closed', 'rejected'])('refuses a %s dispute, naming the state', async (status) => {
        seedDispute({ status });

        const res = await resolve();
        expect(res.success).toBe(false);
        expect(res.error).toContain(status);
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('cannot be resolved twice', async () => {
        expect((await resolve()).success).toBe(true);
        expect((await resolve()).success).toBe(false);
        expect(mockCredit).toHaveBeenCalledTimes(1);
    });

    // ── #128 ────────────────────────────────────────────────────────────────
    it('PAYS THE SELLER THE NET, LIKE EVERY OTHER RELEASE', async () => {
        // This credited the gross, so deciding a dispute for the seller handed
        // over the platform fee that an undisputed sale withholds.
        expect(await resolve('release_seller')).toMatchObject({ success: true });

        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({
            reference: `DISPUTE-RES-${DISPUTE}`,
            userId: SELLER, amount: 9500, status: 'disbursement',
        }));
    });

    it('falls back to the gross when no net was ever stored', async () => {
        seedEscrow({ netAmount: undefined });

        await resolve('release_seller');
        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }));
    });

    it('refunds the buyer the GROSS — they get back what they paid in', async () => {
        expect(await resolve('refund_buyer')).toMatchObject({ success: true });

        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({
            userId: BUYER, amount: 10000, status: 'refund',
        }));
        expect(escrow().status).toBe('refunded');
    });

    // ── #129 ────────────────────────────────────────────────────────────────
    it('ATTRIBUTES THE DECISION TO THE ADMIN WHO MADE IT', async () => {
        // resolvedBy, releasedBy and the audit row all came from the adminId
        // ARGUMENT, so an admin could record a colleague as having decided it.
        await resolve('release_seller', OTHER_ADMIN);

        expect(dispute().resolvedBy).toBe(ADMIN);
        expect(escrow().releasedBy).toBe(ADMIN);
        expect(dispute().resolvedBy).not.toBe(OTHER_ADMIN);

        expect((globalThis as unknown as { mockCreateAdminAuditLog: jest.Mock<any> }).mockCreateAdminAuditLog)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'dispute_resolved', userId: ADMIN, targetId: DISPUTE,
            }));
    });

    it('moves the escrow to released and stamps the time', async () => {
        await resolve('release_seller');

        expect(escrow().status).toBe('released');
        expect(escrow().releasedAt).toBeTruthy();
    });

    it('writes both ledger rows under an id derived from the dispute', async () => {
        // Auto-generated ids meant a retry left the payee two settlement records
        // for one decision.
        await resolve('release_seller');

        expect(store.get(WALLET_TXNS, `DISPUTE-RES-${DISPUTE}`)).toMatchObject({
            userId: SELLER, amount: 9500, balanceBefore: 100000, balanceAfter: 109500, type: 'funding',
        });
        expect(store.get(LEDGER, `DISPUTE-RES-${DISPUTE}`)).toMatchObject({
            userId: SELLER, amount: 9500, type: 'dispute_payout', status: 'completed',
        });
    });

    it('shares its claim key with the live resolver, so one dispute pays once', async () => {
        // actions/disputes.ts credits under the same reference. If both copies
        // ever ran for one dispute the second must credit nothing rather than
        // pay twice and overwrite the first one's ledger row.
        credited.set(`DISPUTE-RES-${DISPUTE}`, 109500);

        expect(await resolve('release_seller')).toMatchObject({ success: true });
        expect(store.get(LEDGER, `DISPUTE-RES-${DISPUTE}`)).toBeUndefined();
    });

    it('tells both parties, by notification and by SMS', async () => {
        await resolve('release_seller');

        const recipients = mockNotify.mock.calls.map(([a]: any[]) => a.userId);
        expect(recipients).toEqual(expect.arrayContaining([BUYER, SELLER]));

        expect(mockSms).toHaveBeenCalledWith('+2348098765432', ESCROW, 'release_seller');
        expect(mockSms).toHaveBeenCalledWith('+2348012345678', ESCROW, 'release_seller');
        expect(mockPush).toHaveBeenCalledWith(BUYER, SELLER, ESCROW);
    });

    it('still resolves when neither party has a phone on file', async () => {
        store.seed(COLLECTIONS.USERS, BUYER, {});
        store.seed(COLLECTIONS.USERS, SELLER, {});

        expect(await resolve()).toMatchObject({ success: true });
        expect(mockSms).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('escalateDisputeAction', () => {
    beforeEach(() => { seedDispute(); seedEscrow(); });

    it('refuses a caller who is not an admin', async () => {
        mockAdmin.mockResolvedValue({ error: 'Admin access required' });
        expect(await escalate()).toMatchObject({ success: false });
    });

    it('refuses a dispute that does not exist', async () => {
        expect(await escalate('nope')).toMatchObject({ success: false, error: 'Dispute not found' });
    });

    it.each(['open', 'under_review'])('escalates a %s dispute', async (status) => {
        seedDispute({ status });

        expect(await escalate()).toMatchObject({ success: true });
        expect(dispute()).toMatchObject({ status: 'under_review', escalated: true, escalatedBy: ADMIN });
    });

    it.each(['resolved', 'closed'])('refuses a %s dispute, naming the state', async (status) => {
        seedDispute({ status });

        const res = await escalate();
        expect(res.success).toBe(false);
        expect(res.error).toContain(status);
    });

    it('cannot escalate the same dispute twice', async () => {
        expect((await escalate()).success).toBe(true);

        const second = await escalate();
        expect(second.success).toBe(false);
        expect(String(second.error)).toMatch(/already escalated/i);
    });

    it('records it and tells both parties', async () => {
        await escalate();

        expect((globalThis as unknown as { mockCreateAdminAuditLog: jest.Mock<any> }).mockCreateAdminAuditLog)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'dispute_escalated', userId: ADMIN, targetId: DISPUTE,
            }));

        const recipients = mockNotify.mock.calls.map(([a]: any[]) => a.userId);
        expect(recipients).toEqual(expect.arrayContaining([BUYER, SELLER]));
    });

    it('moves no money', async () => {
        await escalate();
        expect(mockCredit).not.toHaveBeenCalled();
        expect(escrow().status).toBe('disputed');
    });
});
