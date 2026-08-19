/**
 * @jest-environment node
 */

/**
 * The Farm Nation escrow release, EXECUTED — the end of the property money path.
 *
 * farm-nation-admin/_fna_finance.ts was at 30.5% statements. Running it turned
 * up the largest defect in this module:
 *
 *   #141 THE SELLER WAS NEVER PAID.
 *        Releasing escrow transferred the property to the buyer, marked the
 *        transaction "completed" and "released", and wrote "escrow_released" to
 *        the audit log — then recorded the seller's money as a
 *        `farm_nation_payouts` row with status "pending_transfer". That
 *        collection is written HERE AND NOWHERE ELSE and read by nothing: no
 *        admin screen (/admin/farm-nation has applications, escrow,
 *        land-verification and listings, and no payouts), no cron, no script, no
 *        query anywhere in the repository. The buyer's payment had already
 *        reached the platform's Paystack account. The seller had no wallet
 *        credit, no transfer, and no screen telling them anything was owed.
 *
 *        The marketplace's escrow release credits the seller's wallet through
 *        creditWalletOnce, and the wallet already has a withdrawal flow behind
 *        it. Farm Nation now does the same.
 *
 *   #142 The transaction list hydrates every seller's account number, account
 *        name, bank code, email and phone, gated on isAdmin() — true for all ten
 *        admin roles. Third copy of a defect already closed on the admin
 *        withdrawal list and the marketplace escrow list.
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

/** Credits once per reference and reports the balance after, as the SQL does. */
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

const ADMIN = 'admin-1';
const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const TX = 'fntx-1';
const PROPERTY = 'land-1';

const FN_TXNS = COLLECTIONS.FARM_NATION_TRANSACTIONS;
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const USERS = COLLECTIONS.USERS;
const PAYOUTS = 'farm_nation_payouts';

function actAs(id: string | null, roles: string[] = ['general_user']): void {
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
    credited.clear();
    store = installFakeDb();
    actAs(ADMIN, ['admin']);
    store.seed(USERS, SELLER, {
        name: 'Emeka Nwosu', email: 'emeka@example.com', phone: '08040000000',
        bankDetails: { bankName: 'Zenith', accountNumber: '9876543210', accountName: 'Emeka Nwosu', bankCode: '057' },
    });
});

const finance = () => import('@/app/actions/farm-nation-admin/_fna_finance');

const seedTx = (over: Record<string, unknown> = {}) =>
    store.seed(FN_TXNS, TX, {
        id: TX, propertyId: PROPERTY, buyerId: BUYER, buyerEmail: `${BUYER}@e.com`,
        sellerId: SELLER, escrowAmount: 5_000_000, escrowStatus: 'held',
        status: 'payment_confirmed', createdAt: '2026-05-01T00:00:00.000Z',
        ...over,
    });

const seedProperty = (over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, PROPERTY, {
        id: PROPERTY, title: 'Two hectares, Enugu', ownerId: SELLER,
        status: 'pending_escrow', type: 'sale', price: 5_000_000,
        ...over,
    });

const release = async (id = TX) =>
    (await (await finance()).releaseFarmNationEscrowAction(id as never)) as any;

const list = async (options: Record<string, unknown> = {}) =>
    (await (await finance()).getFarmNationTransactionsAction(options as never)) as any;

const tx = () => store.get(FN_TXNS, TX) as Record<string, any>;
const property = () => store.get(LISTINGS, PROPERTY) as Record<string, any>;
const payout = () => store.get(PAYOUTS, TX) as Record<string, any> | undefined;

// ─────────────────────────────────────────────────────────────────────────────
describe('releaseFarmNationEscrowAction', () => {
    beforeEach(() => { seedTx(); seedProperty(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await release()).toMatchObject({ success: false });
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it.each(['farm_nation_admin', 'marketplace_admin', 'academy_admin', 'support', 'moderator'])(
        'refuses %s — releasing escrow needs finance:resolve_disputes', async (role) => {
            actAs('other-admin', [role]);

            expect(await release()).toMatchObject({ success: false });
            expect(mockCredit).not.toHaveBeenCalled();
            expect(tx().status).toBe('payment_confirmed');
        });

    it('refuses a transaction that does not exist', async () => {
        expect(await release('nope')).toMatchObject({ success: false, error: 'Transaction not found' });
    });

    it('refuses a transaction with no escrow amount, before claiming', async () => {
        seedTx({ escrowAmount: 0 });

        expect(await release()).toMatchObject({ success: false });
        expect(tx().status).toBe('payment_confirmed');
    });

    it('refuses when the property is missing, before claiming', async () => {
        store.seed(LISTINGS, PROPERTY, {});
        seedTx({ propertyId: 'gone' });

        expect(await release()).toMatchObject({ success: false, error: 'Property not found' });
        expect(tx().status).toBe('payment_confirmed');
    });

    it.each(['pending_payment', 'completed', 'cancelled'])(
        'refuses a %s transaction', async (status) => {
            seedTx({ status });

            expect(await release()).toMatchObject({ success: false });
            expect(mockCredit).not.toHaveBeenCalled();
        });

    // ── #141 ────────────────────────────────────────────────────────────────
    it('PAYS THE SELLER, rather than queueing a transfer nothing performs', async () => {
        // The payout row went to a collection written here and read nowhere:
        // no screen, no cron, no script. The property changed hands and the
        // seller's money stopped.
        expect(await release()).toMatchObject({ success: true });

        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({
            reference: `FN-ESCROW-RELEASE-${TX}`,
            userId: SELLER,
            amount: 5_000_000,
            status: 'disbursement',
        }));
    });

    it('refuses to release a transaction with no seller recorded', async () => {
        seedTx({ sellerId: '' });

        expect(await release()).toMatchObject({ success: false });
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('records the settlement, saying where the money went', async () => {
        await release();

        expect(payout()).toMatchObject({
            transactionId: TX, sellerId: SELLER, amount: 5_000_000,
            status: 'paid_to_wallet', walletCredited: true,
        });
    });

    it('transfers the property to the buyer', async () => {
        await release();

        expect(property()).toMatchObject({
            status: 'sold', ownerId: BUYER, previousOwnerId: SELLER,
        });
        expect(property().soldAt).toBeTruthy();
    });

    it('marks a lease as leased rather than sold', async () => {
        seedProperty({ type: 'lease' });

        await release();

        expect(property()).toMatchObject({ status: 'leased', ownerId: BUYER });
        expect(property().leasedAt).toBeTruthy();
    });

    it('closes the transaction and its escrow', async () => {
        await release();

        expect(tx()).toMatchObject({
            status: 'completed', escrowStatus: 'released', escrowReleasedBy: ADMIN,
        });
    });

    it('cannot pay the same escrow twice', async () => {
        expect((await release()).success).toBe(true);
        expect((await release()).success).toBe(false);

        expect(mockCredit).toHaveBeenCalledTimes(1);
    });

    it('records who released it', async () => {
        await release();

        expect((globalThis as unknown as { mockRecordAdminAction: jest.Mock<any> }).mockRecordAdminAction)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'escrow_released', userId: ADMIN, targetId: TX,
            }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getFarmNationTransactionsAction', () => {
    beforeEach(() => { seedTx(); seedProperty(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await list()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('nobody-1');
        expect(await list()).toMatchObject({ success: false });
    });

    // ── #142 ────────────────────────────────────────────────────────────────
    it.each(['farm_nation_admin', 'marketplace_admin', 'academy_admin', 'support', 'moderator', 'wave_admin'])(
        'GIVES %s THE LIST BUT NOT THE BANK DETAILS', async (role) => {
            actAs('other-admin', [role]);

            const res = await list();
            expect(res.success).toBe(true);
            expect(res.data[0].participant).toMatchObject({ email: 'emeka@example.com' });
            expect(res.data[0].participant.bankDetails).toBeUndefined();
        });

    it.each(['admin', 'super_admin'])(
        'gives %s the bank details — the roles that can release the escrow', async (role) => {
            actAs('finance-admin', [role]);

            const res = await list();
            expect(res.data[0].participant.bankDetails).toMatchObject({ accountNumber: '9876543210' });
        });

    it('filters by status', async () => {
        store.seed(FN_TXNS, 'other', {
            id: 'other', propertyId: PROPERTY, sellerId: SELLER, escrowAmount: 1,
            status: 'cancelled', createdAt: '2026-04-01T00:00:00.000Z',
        });

        const res = await list({ status: 'payment_confirmed' });
        expect(res.data.map((t: any) => t.id)).toEqual([TX]);
    });

    it('returns an empty list rather than failing', async () => {
        store.clear();
        expect(await list()).toMatchObject({ success: true, data: [] });
    });
});
