/**
 * @jest-environment node
 */

/**
 * The Farm Nation purchase-request path, EXECUTED — reserve, list, cancel.
 *
 * _fn_purchases.ts was at 10.5% statements: none of its three actions had ever
 * been run. Two findings came out of running them, and both are about who holds
 * a reservation:
 *
 *   #137 On LAND_LISTINGS, "pending" has exactly ONE writer — the buyer
 *        reservation here. Nothing writes it to mean "waiting for an admin";
 *        review is "pending_verification". But IN_REVIEW_STATUSES listed it, so
 *        APPROVABLE_FROM_STATUSES and REJECTABLE_FROM_STATUSES did too, and an
 *        admin approval could CLAIM A LISTING A BUYER WAS PAYING FOR — writing
 *        "verified" and putting the parcel back on the public market with
 *        someone mid-purchase. The same file already documents this exact
 *        collision for two dashboards that counted reserved properties as
 *        outstanding approvals; those readers were corrected and this list was
 *        not.
 *
 *   #138 cancelPurchaseRequestAction released the listing unconditionally from
 *        the propertyId on the cancelled request. `pendingBuyerId` is written by
 *        both reservation paths and was read by NOTHING, so nothing checked the
 *        listing was still held by the person cancelling — a stale request
 *        cancelled after the reservation had changed hands wiped out the new
 *        holder's reservation.
 *
 *   #139 The claim takes the property off the market and the purchase request is
 *        written afterwards. A failed write left a reservation nobody could
 *        cancel — the buyer has no request, and no other buyer can claim it.
 *
 * RECORDED, NOT FIXED: `pendingSince` is written by both reservation paths and
 * read by nothing, so a reservation never expires. A buyer who abandons
 * checkout without cancelling holds the listing until they cancel. Building
 * that sweep is a product decision.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
    PURCHASABLE_STATUSES,
} from '@/lib/land-listing-status';

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

let store: FakeDbHandle;
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, {
        ...current,
        ...(p.patch ?? {}),
        ...(p.recordPreviousAs ? { [p.recordPreviousAs]: status } : {}),
        status: p.to,
    });
    return { claimed: true, status: p.to };
}) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

const BUYER = 'buyer-1';
const OWNER = 'owner-1';
const PROPERTY = 'land-1';

const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const FN_TXNS = COLLECTIONS.FARM_NATION_TRANSACTIONS;
const USERS = COLLECTIONS.USERS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['general_user'], email: `${id}@e.com` } }, error: null },
    ));
}

/** A cooperative member, which the purchase path requires. */
const seedMember = (id = BUYER, status = 'approved') =>
    store.seed(USERS, id, { serviceRegistrations: { cooperatives: { status } } });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
    seedMember();
});

const purchases = () => import('@/app/actions/farm-nation/_fn_purchases');

const seedListing = (over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, PROPERTY, {
        id: PROPERTY, name: 'Two hectares, Enugu', title: 'Two hectares, Enugu',
        ownerId: OWNER, ownerName: 'Emeka', price: 5_000_000,
        status: 'available', type: 'land',
        ...over,
    });

const buyerInfo = {
    fullName: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
    purpose: 'Cassava farming', zoningComplianceDeclarationAccepted: true,
};

const initiate = async (over: Record<string, unknown> = {}) =>
    (await (await purchases()).initiatePropertyPurchaseAction(
        PROPERTY as never, { ...buyerInfo, ...over } as never,
    )) as any;

const myRequests = async () => (await (await purchases()).getMyPurchaseRequestsAction()) as any;

const cancel = async (id: string) =>
    (await (await purchases()).cancelPurchaseRequestAction(id as never)) as any;

const listing = () => store.get(LISTINGS, PROPERTY) as Record<string, any>;
const firstRequest = () => store.all(FN_TXNS)[0];

// ─────────────────────────────────────────────────────────────────────────────
describe('the status vocabulary', () => {
    // ── #137 ────────────────────────────────────────────────────────────────
    it('DOES NOT LET AN ADMIN DECISION START FROM A BUYER RESERVATION', async () => {
        // "pending" on a land listing means "a buyer is at checkout", not
        // "waiting for an admin". Leaving it in the approvable set let an
        // approval write "verified" over a live reservation and put the parcel
        // back on the market with someone mid-purchase.
        expect(APPROVABLE_FROM_STATUSES).not.toContain('pending');
        expect(REJECTABLE_FROM_STATUSES).not.toContain('pending');
    });

    it('still lets a decision start from every state that means "in review"', async () => {
        for (const status of ['draft', 'pending_verification', 'inspection_scheduled']) {
            expect(APPROVABLE_FROM_STATUSES).toContain(status);
        }
        // And from the for-sale spellings, so all three converge on "verified".
        for (const status of PURCHASABLE_STATUSES) {
            expect(APPROVABLE_FROM_STATUSES).toContain(status);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initiatePropertyPurchaseAction', () => {
    beforeEach(() => { seedListing(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await initiate()).toMatchObject({ success: false });
        expect(store.size(FN_TXNS)).toBe(0);
    });

    it('refuses without the zoning declaration', async () => {
        expect(await initiate({ zoningComplianceDeclarationAccepted: false })).toMatchObject({
            success: false,
        });
        expect(listing().status).toBe('available');
    });

    it('refuses a property that does not exist', async () => {
        store.clear();
        seedMember();
        expect(await initiate()).toMatchObject({ success: false, error: 'Property not found' });
    });

    it('refuses a buyer with no cooperative membership', async () => {
        store.seed(USERS, BUYER, {});
        expect(await initiate()).toMatchObject({ success: false });
        expect(listing().status).toBe('available');
    });

    it.each(['approved', 'active'])('admits a %s cooperative member', async (status) => {
        seedMember(BUYER, status);
        expect(await initiate()).toMatchObject({ success: true });
    });

    it.each([...PURCHASABLE_STATUSES])('reserves a listing that is %s', async (status) => {
        seedListing({ status });

        expect(await initiate()).toMatchObject({ success: true });
        expect(listing()).toMatchObject({
            status: 'pending', pendingBuyerId: BUYER, previousStatus: status,
        });
    });

    it.each(['pending_verification', 'rejected', 'sold', 'pending_escrow'])(
        'refuses a listing that is %s', async (status) => {
            seedListing({ status });

            expect(await initiate()).toMatchObject({
                success: false, error: 'Property is no longer available',
            });
            expect(store.size(FN_TXNS)).toBe(0);
        });

    it('records the property and the seller from the LISTING', async () => {
        await initiate();

        const [, request] = firstRequest();
        expect(request).toMatchObject({
            propertyId: PROPERTY, propertyName: 'Two hectares, Enugu',
            propertyPrice: 5_000_000, escrowAmount: 5_000_000,
            sellerId: OWNER, buyerId: BUYER,
            status: 'pending_payment', escrowStatus: 'pending',
        });
    });

    it('turns a second buyer away — the first one has it', async () => {
        expect((await initiate()).success).toBe(true);

        actAs('buyer-2');
        seedMember('buyer-2');
        expect(await initiate()).toMatchObject({ success: false });
        expect(store.size(FN_TXNS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyPurchaseRequestsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await myRequests()).toMatchObject({ success: false });
    });

    it('returns my requests, newest first', async () => {
        store.seedAll(FN_TXNS, {
            older: { buyerId: BUYER, propertyId: 'p1', status: 'pending_payment', createdAt: '2026-01-01T00:00:00.000Z' },
            newer: { buyerId: BUYER, propertyId: 'p2', status: 'pending_payment', createdAt: '2026-06-01T00:00:00.000Z' },
            theirs: { buyerId: 'buyer-2', propertyId: 'p3', status: 'pending_payment', createdAt: '2026-07-01T00:00:00.000Z' },
        });

        const res = await myRequests();
        expect(res.data.requests.map((r: any) => r.id)).toEqual(['newer', 'older']);
    });

    it('returns an empty list rather than failing', async () => {
        expect(await myRequests()).toMatchObject({ success: true, data: { requests: [] } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cancelPurchaseRequestAction', () => {
    beforeEach(async () => {
        seedListing();
        await initiate();
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await cancel(firstRequest()[0])).toMatchObject({ success: false });
    });

    it('refuses a request that does not exist', async () => {
        expect(await cancel('nope')).toMatchObject({
            success: false, error: 'Purchase request not found',
        });
    });

    it('refuses somebody else\'s request', async () => {
        actAs('buyer-2');
        expect(await cancel(firstRequest()[0])).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(listing().status).toBe('pending');
    });

    it('cancels the request and returns the property to the pool', async () => {
        const [id] = firstRequest();

        expect(await cancel(id)).toMatchObject({ success: true });

        expect(store.get(FN_TXNS, id)).toMatchObject({ status: 'cancelled', escrowStatus: 'refunded' });
        expect(listing()).toMatchObject({ status: 'available', pendingBuyerId: null });
    });

    it('restores the status it was reserved FROM, not a guess', async () => {
        // A listing reserved from "verified" must go back to "verified" or it
        // drops out of the land module's public view.
        store.clear();
        seedMember();
        seedListing({ status: 'verified' });
        await initiate();

        await cancel(firstRequest()[0]);
        expect(listing().status).toBe('verified');
    });

    it('cannot be cancelled twice', async () => {
        const [id] = firstRequest();

        expect((await cancel(id)).success).toBe(true);
        expect((await cancel(id)).success).toBe(false);
    });

    it('refuses to cancel a request that is no longer awaiting payment', async () => {
        const [id, row] = firstRequest();
        store.seed(FN_TXNS, id, { ...row, status: 'payment_confirmed' });

        expect(await cancel(id)).toMatchObject({
            success: false, error: 'Can only cancel pending payment requests',
        });
        expect(listing().status).toBe('pending');
    });

    // ── #138 ────────────────────────────────────────────────────────────────
    it('LEAVES A RESERVATION THAT BELONGS TO SOMEBODY ELSE ALONE', async () => {
        // The release was unconditional, from the propertyId on the cancelled
        // request. `pendingBuyerId` is written by both reservation paths and was
        // read by nothing — so a stale request cancelled after the reservation
        // had changed hands wiped out the new holder's claim, while their money
        // was in escrow.
        const [id] = firstRequest();
        store.seed(LISTINGS, PROPERTY, {
            ...listing(), status: 'pending_escrow', pendingBuyerId: 'buyer-2', previousStatus: 'verified',
        });

        expect(await cancel(id)).toMatchObject({ success: true });

        expect(listing()).toMatchObject({ status: 'pending_escrow', pendingBuyerId: 'buyer-2' });
        expect(store.get(FN_TXNS, id)).toMatchObject({ status: 'cancelled' });
    });

    it('still cancels the request when the listing has vanished', async () => {
        const [id] = firstRequest();
        store.seed(LISTINGS, PROPERTY, {});

        expect(await cancel(id)).toMatchObject({ success: true });
        expect(store.get(FN_TXNS, id)).toMatchObject({ status: 'cancelled' });
    });
});
