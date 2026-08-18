/**
 * @jest-environment node
 */

/**
 * farm-nation-admin.ts — 1,049 lines, 8 admin endpoints, no tests.
 *
 * WHAT WAS ALREADY CORRECT
 * ------------------------
 * More than in most files audited this week, and the comments say why: the
 * escrow release is guarded by claimStatusTransition from "payment_confirmed",
 * after an earlier fix for two admins both releasing the same escrow, and the
 * payout row is keyed on the transaction id so it cannot duplicate. All eight
 * endpoints check isAdmin. The payout amount comes from the transaction record
 * rather than a parameter.
 *
 * THE GAP
 * -------
 * Everything the release needs was validated AFTER the claim.
 *
 * Claiming first is the right order — it is what stops a double release — but
 * it makes the claim unrepeatable. If the property document is missing, or the
 * transaction has no escrowAmount, the code threw at that point and returned a
 * generic failure, having ALREADY moved the transaction to
 * "completed" / "released". A retry then fails the claim, because the row is no
 * longer "payment_confirmed".
 *
 * The result: the buyer's money is released on paper, the property is never
 * transferred, no payout row exists for the seller, and the record says the
 * release succeeded. Nobody is told the seller was not paid.
 *
 * Those two conditions are knowable before the claim, so they are checked
 * there now, while backing out is free. What can still fail afterwards is a
 * write, which is a reconciliation problem rather than a silent one — the same
 * trade every other module in this codebase makes.
 *
 * WHAT THIS FILE DOES NOT ASSERT
 * ------------------------------
 * That the payout ever reaches the seller. It writes a row with
 * `status: "pending_transfer"` and nothing in the repository consumes it — the
 * transfer is manual. That is a product arrangement, not a defect to fix
 * unilaterally, but it does mean the "release" here moves a record and not
 * money.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const TXN = 'fn-txn-1';
const PROPERTY = 'prop-1';
const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const AMOUNT = 4_500_000;

const mockClaimStatus = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => mockClaimStatus(...a),
    claimStatusTransitionFromAny: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
    // The money paths record who approved or rejected. Mocking the module
    // without this export made the call a TypeError, which the action's own
    // catch turned into a failed response — the operation looked broken.
    recordAdminAction: jest.fn(async () => undefined),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/**
 * The release reads two different documents — the transaction, then the
 * property — so the mock answers by id rather than returning one shape for
 * everything. A single shared snapshot would let the property check pass on the
 * transaction's own fields and make the "property not found" test vacuous.
 */
function setDocs(opts: { txn?: Record<string, any> | null; property?: Record<string, any> | null } = {}) {
    const txn = opts.txn === undefined
        ? { propertyId: PROPERTY, sellerId: SELLER, buyerId: BUYER, buyerEmail: 'b@e.com', escrowAmount: AMOUNT, status: 'payment_confirmed' }
        : opts.txn;
    const property = opts.property === undefined
        ? { type: 'sale', ownerId: SELLER, title: 'Two hectares' }
        : opts.property;

    const snapFor = (data: Record<string, any> | null, id: string) => data === null
        ? { exists: false, empty: true, docs: [], data: () => undefined }
        : { exists: true, empty: false, docs: [{ id, ref: { id }, data: () => data }], ref: { id }, data: () => data };

    (global as any).mockFirestoreGet.mockImplementation((id: string) =>
        Promise.resolve(id === PROPERTY ? snapFor(property, PROPERTY) : snapFor(txn, TXN)));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snapFor(txn, TXN)));
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

async function release() {
    const { releaseFarmNationEscrowAction } = await import('@/app/actions/farm-nation-admin');
    return releaseFarmNationEscrowAction(TXN);
}

describe('releaseFarmNationEscrowAction — nothing is claimed until it can be finished', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setDocs();
        mockClaimStatus.mockResolvedValue({ claimed: true, status: 'completed' });
    });

    it('does not claim the release when the property is missing', async () => {
        // THE test. Claiming here marks the transaction completed and released,
        // then throws — and the claim cannot be retried, because the row is no
        // longer "payment_confirmed". The seller is never paid and the record
        // says otherwise.
        setDocs({ property: null });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/property not found/i);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('does not claim the release when there is no escrow amount', async () => {
        // A payout row reading `amount: undefined` is worse than no payout row:
        // the transaction says released and the seller is owed an unknown sum.
        setDocs({ txn: { propertyId: PROPERTY, sellerId: SELLER, buyerId: BUYER, status: 'payment_confirmed' } });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/escrow amount/i);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('does not claim the release when the transaction has no property', async () => {
        setDocs({ txn: { sellerId: SELLER, buyerId: BUYER, escrowAmount: AMOUNT, status: 'payment_confirmed' } });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('does not claim the release when the transaction is missing', async () => {
        setDocs({ txn: null });

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('refuses a non-admin before reading anything', async () => {
        setSession(MEMBER, ['farmer']);

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed|permission/i);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('refuses when the claim is lost, and transfers nothing', async () => {
        // Two admins releasing together: the second must not transfer ownership
        // a second time.
        mockClaimStatus.mockResolvedValue({ claimed: false, status: 'completed' });

        const r: any = await release();

        expect(r.success).toBe(false);
        const ownershipWrites = allWrites().filter((p) => p && 'ownerId' in p);
        expect(ownershipWrites).toEqual([]);
    });

    it('transfers the property to the buyer and queues the payout', async () => {
        // Vacuity guard. Every refusal above is satisfied by an action that
        // releases nothing, which would strand every completed sale.
        const r: any = await release();

        expect(r.success).toBe(true);

        const ownership = allWrites().find((p) => p && 'ownerId' in p);
        expect(ownership?.ownerId).toBe(BUYER);
        expect(ownership?.previousOwnerId).toBe(SELLER);
        expect(ownership?.status).toBe('sold');

        const payout = allWrites().find((p) => p && 'status' in p && p.status === 'pending_transfer');
        expect(payout?.sellerId).toBe(SELLER);
        expect(payout?.amount).toBe(AMOUNT);
    });

    it('marks a lease as leased rather than sold', async () => {
        setDocs({ property: { type: 'lease', ownerId: SELLER } });

        await release();

        const ownership = allWrites().find((p) => p && 'ownerId' in p);
        expect(ownership?.status).toBe('leased');
    });

    it('claims from payment_confirmed only', async () => {
        // The state machine is the guard. Releasing from any other state would
        // let an unpaid transaction transfer a property.
        await release();

        expect(mockClaimStatus).toHaveBeenCalledWith(
            expect.objectContaining({ from: 'payment_confirmed', to: 'completed' })
        );
    });
});

describe('the other seven endpoints refuse a non-admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER, ['farmer']);
        setDocs();
    });

    const cases: Array<[string, any[]]> = [
        ['getFarmNationStatsAction', []],
        ['getFarmNationRegistrantsAction', [{}]],
        ['getStandardFarmNationRegistrantsAction', [{}]],
        ['getFarmNationVerificationStatsAction', []],
        ['getAdminLandVerificationsAction', [{}]],
        ['getFarmNationTransactionsAction', [{}]],
        ['updateAdminLandListingAction', [PROPERTY, { title: 'Renamed' }]],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses`, async () => {
            // These return registrant PII and land records, and the last one
            // rewrites a listing.
            const mod: any = await import('@/app/actions/farm-nation-admin');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed|permission|admin/i);
        });
    }

    it('lets an admin through, so the refusals above are not vacuous', async () => {
        setSession(ADMIN, ['admin']);
        const { getFarmNationVerificationStatsAction } = await import('@/app/actions/farm-nation-admin');

        const r: any = await getFarmNationVerificationStatsAction();

        expect(r.success).toBe(true);
    });
});
