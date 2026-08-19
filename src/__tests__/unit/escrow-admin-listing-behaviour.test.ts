/**
 * @jest-environment node
 */

/**
 * The escrow listing and participant status actions, EXECUTED.
 *
 * escrow-release-refund-behaviour.test.ts drives the two money paths in
 * _escrow_actions.ts. The three that read and move state had never been run:
 * getUserEscrowTransactions, getAllEscrowTransactionsAdmin and
 * updateEscrowStatus, which is most of what kept the file at 53.6% statements.
 *
 * One finding came out of running them:
 *
 *   #133 getAllEscrowTransactionsAdmin hydrates BOTH parties of every escrow
 *        with their account number, account name, bank code, email and phone —
 *        and its gate was isAdmin(), true for all TEN admin roles. So an
 *        academy_admin or a wave_admin could open the escrow screen and read
 *        the banking instrument of every buyer and seller on the platform, in
 *        bulk. The admin withdrawal list had exactly this defect and was closed
 *        by requiring the permission that lets you process the payout; the same
 *        line applies here, because the page renders bank details only inside
 *        the release/refund confirmation modal and both of those actions require
 *        "finance:resolve_disputes".
 *
 * The rest executes rules earlier findings asserted structurally: the claimed
 * participant transition, the from-set that no longer lets either party strand
 * a funded escrow, and the refusal to move money through a status update.
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

jest.mock('@/lib/africastalking', () => ({
    smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn(),
}));
jest.mock('@/lib/fcm', () => ({
    pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn(),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: jest.fn(async () => ({ claimed: true, balance: 0 })),
    claimPaymentOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(), markFulfilmentFailed: jest.fn(),
}));

let store: FakeDbHandle;
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

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ESCROW = 'esc-1';

const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const USERS = COLLECTIONS.USERS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

/** The session AND the record agree, since the admin gate re-reads the doc. */
function actAsAdmin(id: string, roles: string[]): void {
    actAs(id, roles);
    store.seed(USERS, id, { roles, name: 'An Admin' });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
    store.seed(USERS, BUYER, {
        firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08030000000',
        bankDetails: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', bankCode: '058' },
    });
    store.seed(USERS, SELLER, {
        firstName: 'Emeka', lastName: 'Nwosu', email: 'emeka@example.com', phone: '08040000000',
        bankDetails: { bankName: 'Zenith', accountNumber: '9876543210', accountName: 'Emeka Nwosu', bankCode: '057' },
    });
});

const escrowActions = () => import('@/app/actions/marketplace/_escrow_actions');

const seedEscrow = (id = ESCROW, over: Record<string, unknown> = {}) =>
    store.seed(ESCROWS, id, {
        id, orderId: 'ORD-1', buyerId: BUYER, sellerId: SELLER,
        participants: [BUYER, SELLER],
        buyerEmail: 'ada@example.com', sellerEmail: 'emeka@example.com',
        amount: 10000, netAmount: 9500, platformFee: 500,
        status: 'funded', productName: 'Yams',
        createdAt: '2026-05-01T00:00:00.000Z',
        ...over,
    });

const mine = async () => (await (await escrowActions()).getUserEscrowTransactions()) as any;

const allAdmin = async (options: Record<string, unknown> = {}) =>
    (await (await escrowActions()).getAllEscrowTransactionsAdmin(options as never)) as any;

const setStatus = async (status: string, id = ESCROW) =>
    (await (await escrowActions()).updateEscrowStatus(id as never, status as never)) as any;

const escrow = (id = ESCROW) => store.get(ESCROWS, id) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserEscrowTransactions', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await mine()).toMatchObject({ success: false });
    });

    it('returns the escrows I am a party to, on either side', async () => {
        seedEscrow('as-buyer', { buyerId: BUYER, sellerId: 'seller-2', participants: [BUYER, 'seller-2'] });
        seedEscrow('as-seller', { buyerId: 'buyer-2', sellerId: BUYER, participants: ['buyer-2', BUYER] });
        seedEscrow('not-mine', { buyerId: 'buyer-2', sellerId: 'seller-2', participants: ['buyer-2', 'seller-2'] });

        const res = await mine();
        expect(res.success).toBe(true);
        expect(res.data.transactions.map((t: any) => t.id).sort()).toEqual(['as-buyer', 'as-seller']);
    });

    it('is keyed on the participants array every escrow creator writes', async () => {
        // The four creators — the order initialiser, the payment verifier, the
        // payments service and _createEscrowAction — all write `participants`.
        // A creator that forgot it would make its escrows invisible here while
        // buyerId and sellerId still looked right.
        seedEscrow('no-participants', { participants: undefined });

        expect((await mine()).data.transactions.map((t: any) => t.id)).toEqual([]);
    });

    it('returns an empty list rather than failing', async () => {
        expect(await mine()).toMatchObject({ success: true, data: { transactions: [] } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAllEscrowTransactionsAdmin', () => {
    beforeEach(() => { seedEscrow(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await allAdmin()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs(BUYER);
        expect(await allAdmin()).toMatchObject({ success: false, error: 'Admin access required' });
    });

    it('re-reads the roles from the record, not from the session', async () => {
        actAs('demoted-1', ['super_admin']);            // the token still says admin
        store.seed(USERS, 'demoted-1', { roles: ['general_user'] });

        expect(await allAdmin()).toMatchObject({ success: false, error: 'Admin access required' });
    });

    // ── #133 ────────────────────────────────────────────────────────────────
    it.each(['academy_admin', 'wave_admin', 'export_admin', 'cooperative_admin', 'moderator', 'support', 'marketplace_admin'])(
        'GIVES %s THE LIST BUT NOT THE BANK DETAILS', async (role) => {
            // The gate was isAdmin(), true for all ten admin roles, over a list
            // that hydrates both parties' account number, account name and bank
            // code for every escrow on the platform.
            actAsAdmin('other-admin', [role]);

            const res = await allAdmin();
            expect(res.success).toBe(true);
            expect(res.data.transactions).toHaveLength(1);

            const tx = res.data.transactions[0];
            expect(tx.buyerDetails).toMatchObject({ email: 'ada@example.com' });
            expect(tx.buyerDetails.bankDetails).toBeUndefined();
            expect(tx.sellerDetails.bankDetails).toBeUndefined();
        });

    it.each(['admin', 'super_admin'])(
        'gives %s the bank details — the roles that can release and refund', async (role) => {
            actAsAdmin('finance-admin', [role]);

            const res = await allAdmin();
            const tx = res.data.transactions[0];
            expect(tx.sellerDetails.bankDetails).toMatchObject({ accountNumber: '9876543210' });
            expect(tx.buyerDetails.bankDetails).toMatchObject({ accountNumber: '0123456789' });
        });

    it('filters by status, and "all" means no filter', async () => {
        actAsAdmin('a1', ['admin']);
        seedEscrow('released-1', { status: 'released' });

        expect((await allAdmin({ status: 'released' })).data.transactions.map((t: any) => t.id))
            .toEqual(['released-1']);
        expect((await allAdmin({ status: 'all' })).data.transactions).toHaveLength(2);
    });

    it('sorts newest first, and oldest first when asked', async () => {
        actAsAdmin('a1', ['admin']);
        seedEscrow('older', { createdAt: '2026-01-01T00:00:00.000Z' });

        expect((await allAdmin()).data.transactions.map((t: any) => t.id)).toEqual([ESCROW, 'older']);
        expect((await allAdmin({ sortOrder: 'asc' })).data.transactions.map((t: any) => t.id))
            .toEqual(['older', ESCROW]);
    });

    it('searches across both parties\' contact fields', async () => {
        actAsAdmin('a1', ['admin']);
        seedEscrow('other', {
            buyerId: 'buyer-2', sellerId: 'seller-2',
            buyerEmail: 'zoe@example.com', sellerEmail: 'kola@example.com',
        });

        const res = await allAdmin({ search: 'emeka@example.com' });
        expect(res.data.transactions.map((t: any) => t.id)).toEqual([ESCROW]);
    });

    it('reports an empty result honestly', async () => {
        actAsAdmin('a1', ['admin']);
        store.clear();
        store.seed(USERS, 'a1', { roles: ['admin'] });

        expect(await allAdmin()).toMatchObject({ success: true, data: { transactions: [] } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateEscrowStatus', () => {
    beforeEach(() => { seedEscrow(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await setStatus('delivered')).toMatchObject({ success: false });
    });

    it('refuses a transaction that does not exist', async () => {
        expect(await setStatus('delivered', 'nope')).toMatchObject({
            success: false, error: 'Transaction not found',
        });
    });

    it('refuses somebody who is neither the buyer nor the seller', async () => {
        actAs('stranger-1');
        expect(await setStatus('delivered')).toMatchObject({
            success: false, error: 'Not authorized to update this transaction',
        });
        expect(escrow().status).toBe('funded');
    });

    it.each(['released', 'refunded'])(
        'refuses to move money through a status update (%s)', async (status) => {
            // Both belong to the release and refund actions, which write the
            // ledger. Saying so beats failing with "Invalid status value".
            const res = await setStatus(status);

            expect(res.success).toBe(false);
            expect(String(res.error)).toMatch(/moves money and writes the ledger/i);
            expect(escrow().status).toBe('funded');
        });

    it('refuses a status that is not an escrow status at all', async () => {
        expect(await setStatus('completed')).toMatchObject({ success: false });
        expect(await setStatus('nonsense')).toMatchObject({ success: false });
        expect(escrow().status).toBe('funded');
    });

    it('lets a party move a funded escrow to in_transit and then delivered', async () => {
        expect(await setStatus('in_transit')).toMatchObject({ success: true });
        expect(escrow().status).toBe('in_transit');

        expect(await setStatus('delivered')).toMatchObject({ success: true });
        expect(escrow().status).toBe('delivered');
        expect(escrow().deliveredAt).toBeTruthy();
    });

    it('CANNOT CANCEL A FUNDED ESCROW', async () => {
        // "cancelled" is settled, so this stranded real money: the seller could
        // not be paid, the buyer could not be refunded, and a dispute could not
        // find the record to freeze.
        const res = await setStatus('cancelled');

        expect(res.success).toBe(false);
        expect(escrow().status).toBe('funded');
    });

    it('refuses a transition the from-set does not allow', async () => {
        seedEscrow(ESCROW, { status: 'delivered' });

        const res = await setStatus('in_transit');
        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/invalid status transition/i);
    });

    it('needs the dispute permission to move a disputed escrow', async () => {
        seedEscrow(ESCROW, { status: 'disputed' });

        expect(await setStatus('delivered')).toMatchObject({
            success: false, error: 'Admin access required to perform this transition',
        });
        expect(escrow().status).toBe('disputed');
    });

    it('tells the OTHER party, and records the change', async () => {
        await setStatus('in_transit');

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: SELLER }));
        expect((globalThis as unknown as { mockRecordAdminAction: jest.Mock<any> }).mockRecordAdminAction)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'escrow_status_update', userId: BUYER, targetId: ESCROW,
            }));
    });

    it('notifies the buyer when the seller is the one acting', async () => {
        actAs(SELLER);
        await setStatus('in_transit');

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: BUYER }));
    });
});
