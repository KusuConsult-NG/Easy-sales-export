/**
 * @jest-environment node
 */

/**
 * The Farm Nation property money path, EXECUTED — initialise and verify.
 *
 * farm-nation-payment.ts was at 41.5% statements: everything past the first
 * few guards had never run, including the whole verification path. Three
 * findings came out of running it:
 *
 *   #134 THE MODULE'S OWN LISTINGS COULD NOT BE BOUGHT.
 *        LAND_LISTINGS is written by two modules with different vocabularies:
 *        _fn_listings.ts creates a farm-nation property as "available", the land
 *        module's admin approval writes "verified". PURCHASABLE_STATUSES covers
 *        both — it exists BECAUSE requiring one spelling made the other's
 *        listings unbuyable — and BROWSABLE_STATUSES is the same set, so the
 *        browse page shows both. This action required "verified" exactly, so
 *        every property listed through Farm Nation was visible, clickable, and
 *        refused at checkout with "Property is no longer available".
 *        _fn_purchases.ts had been widened to the shared rule; the path the page
 *        actually calls had not.
 *
 *   #135 TWO BUYERS COULD BOTH BE CHARGED FOR ONE PROPERTY.
 *        The reservation was a bare `update({ status: "pending_escrow" })` AFTER
 *        the Paystack session was created, so two buyers at checkout both read
 *        "verified", both got an authorization URL, and both paid. The second
 *        update just overwrote the first. _fn_purchases.ts documents fixing this
 *        with a claim; that fix landed on the path with no UI.
 *
 *   #136 A RESERVATION THAT COULD NOT BE PAID FOR WAS NEVER GIVEN BACK.
 *        If Paystack was unreachable, or the purchase record failed to write,
 *        the listing stayed reserved with no purchase record — so no other buyer
 *        could claim it and its would-be buyer had nothing to cancel. Off the
 *        market permanently.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { PURCHASABLE_STATUSES } from '@/lib/land-listing-status';
import { resetFallbackLimit } from '@/lib/rate-limiter-fallback';

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

jest.mock('@/lib/server-utils', () => ({
    getBaseUrl: async () => 'https://example.test',
}));

const mockInit = jest.fn() as jest.Mock<any>;
const mockVerify = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInit(...a),
    verifyPaystackPayment: (...a: any[]) => mockVerify(...a),
    nairaToKobo: (n: number) => Math.round(n * 100),
}));

/** Claims a reference once, as claim_payment_once does. */
const claimed = new Set<string>();
const mockClaimPayment = jest.fn(async (p: any) => {
    if (claimed.has(p.reference)) return { claimed: false };
    claimed.add(p.reference);
    return { claimed: true };
}) as jest.Mock<any>;
const mockMarkFailed = jest.fn(async () => undefined) as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    markFulfilmentFailed: (...a: any[]) => mockMarkFailed(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

/** Stateful, so "the second buyer loses" cannot pass without a real claim. */
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
const REF = 'FN-REF-1';

const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const FN_TXNS = COLLECTIONS.FARM_NATION_TRANSACTIONS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['general_user'], email: `${id}@e.com`, name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    claimed.clear();
    store = installFakeDb();
    actAs(BUYER);
    resetFallbackLimit(`payment:${BUYER}`);
    mockInit.mockResolvedValue({ authorizationUrl: 'https://paystack.test/pay', reference: REF, accessCode: 'ac' });
    mockVerify.mockResolvedValue({
        status: true,
        data: {
            status: 'success', amount: 500000000, channel: 'card',
            metadata: { userId: BUYER, propertyId: PROPERTY, propertyTitle: 'Two hectares, Enugu' },
            customer: { email: `${BUYER}@e.com` },
        },
    });
});

const payment = () => import('@/app/actions/farm-nation-payment');

const seedListing = (over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, PROPERTY, {
        id: PROPERTY, title: 'Two hectares, Enugu', ownerId: OWNER, ownerName: 'Emeka',
        price: 5_000_000, status: 'verified', category: 'land',
        ...over,
    });

const buyerInfo = {
    fullName: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
    purpose: 'Cassava farming', zoningComplianceDeclarationAccepted: true,
};

const initialise = async (over: Record<string, unknown> = {}) =>
    (await (await payment()).initializePropertyPaymentAction(
        PROPERTY as never, 'Two hectares, Enugu' as never, 5_000_000 as never, OWNER as never,
        { ...buyerInfo, ...over } as never,
    )) as any;

const verify = async (reference = REF) =>
    (await (await payment()).verifyPropertyPaymentAction(reference as never)) as any;

const listing = () => store.get(LISTINGS, PROPERTY) as Record<string, any>;
const purchase = () => store.all(FN_TXNS)[0]?.[1] as Record<string, any> | undefined;

// ─────────────────────────────────────────────────────────────────────────────
describe('initializePropertyPaymentAction', () => {
    beforeEach(() => { seedListing(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await initialise()).toMatchObject({ success: false });
        expect(mockInit).not.toHaveBeenCalled();
    });

    it('refuses without the zoning declaration', async () => {
        expect(await initialise({ zoningComplianceDeclarationAccepted: false })).toMatchObject({
            success: false,
        });
        expect(listing().status).toBe('verified');
    });

    it('refuses a property that does not exist', async () => {
        store.clear();
        expect(await initialise()).toMatchObject({ success: false, error: 'Property not found' });
    });

    it('refuses a listing with no owner or no price', async () => {
        seedListing({ ownerId: '' });
        expect(await initialise()).toMatchObject({ success: false });

        seedListing({ price: 0 });
        expect(await initialise()).toMatchObject({ success: false });

        expect(mockInit).not.toHaveBeenCalled();
    });

    it('refuses the owner buying their own land', async () => {
        seedListing({ ownerId: BUYER });
        expect(await initialise()).toMatchObject({
            success: false, error: 'You cannot purchase your own property',
        });
    });

    // ── #134 ────────────────────────────────────────────────────────────────
    it.each([...PURCHASABLE_STATUSES])('SELLS A LISTING WHOSE STATUS IS %s', async (status) => {
        // The module creates its own listings as "available" and this required
        // "verified" exactly, so Farm Nation's own properties were browsable and
        // unbuyable.
        seedListing({ status });

        const res = await initialise();

        expect(res.success).toBe(true);
        expect(listing().status).toBe('pending_escrow');
    });

    it.each(['pending_verification', 'rejected', 'sold', 'deleted', 'pending_escrow'])(
        'refuses a listing that is %s', async (status) => {
            seedListing({ status });

            expect(await initialise()).toMatchObject({
                success: false, error: 'Property is no longer available',
            });
            expect(mockInit).not.toHaveBeenCalled();
        });

    // ── #135 ────────────────────────────────────────────────────────────────
    it('CHARGES ONLY ONE OF TWO SIMULTANEOUS CHECKOUTS', async () => {
        // The race, not the sequential case: both callers read the listing
        // before either writes. The reservation used to be a bare
        // `update({ status: "pending_escrow" })` AFTER the Paystack session was
        // created, so both got an authorization URL and BOTH WERE CHARGED —
        // the second update simply overwrote the first. The claim is atomic, so
        // exactly one wins and the loser never reaches Paystack.
        //
        // Two submissions of one checkout form is the everyday version of this;
        // two different buyers is the expensive one.
        const [first, second] = await Promise.all([initialise(), initialise()]);

        const outcomes = [first.success, second.success].sort();
        expect(outcomes).toEqual([false, true]);

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(store.size(FN_TXNS)).toBe(1);
        expect(listing().status).toBe('pending_escrow');
    });

    it('and turns a later buyer away once it is reserved', async () => {
        expect((await initialise()).success).toBe(true);

        actAs('buyer-2');
        resetFallbackLimit('payment:buyer-2');

        expect(await initialise()).toMatchObject({
            success: false, error: 'Property is no longer available',
        });
        expect(mockInit).toHaveBeenCalledTimes(1);
    });

    it('reserves BEFORE calling Paystack, and records what it reserved from', async () => {
        await initialise();

        expect(listing()).toMatchObject({
            status: 'pending_escrow', previousStatus: 'verified', pendingBuyerId: BUYER,
        });
    });

    // ── #136 ────────────────────────────────────────────────────────────────
    it('GIVES THE PROPERTY BACK WHEN PAYSTACK CANNOT BE REACHED', async () => {
        // Otherwise the listing is reserved with no purchase record: nobody else
        // can claim it and its buyer has nothing to cancel.
        mockInit.mockRejectedValue(new Error('Paystack unreachable'));

        expect(await initialise()).toMatchObject({ success: false });

        expect(listing().status).toBe('verified');
        expect(listing().pendingBuyerId).toBeNull();
        expect(store.size(FN_TXNS)).toBe(0);
    });

    it('and restores "available" for a listing reserved from "available"', async () => {
        seedListing({ status: 'available' });
        mockInit.mockRejectedValue(new Error('Paystack unreachable'));

        await initialise();

        expect(listing().status).toBe('available');
    });

    it('charges the LISTED price, never the amount the caller passed', async () => {
        await initialise();

        expect(mockInit).toHaveBeenCalledWith(
            `${BUYER}@e.com`,
            500_000_000,                       // ₦5,000,000 in kobo
            expect.objectContaining({ propertyId: PROPERTY, sellerId: OWNER, userId: BUYER }),
            expect.any(String),
        );
        expect(purchase()).toMatchObject({ propertyPrice: 5_000_000, escrowAmount: 5_000_000 });
    });

    it('records the seller from the LISTING, not from the request', async () => {
        // sellerId was a parameter written into the Paystack metadata and from
        // there into the escrow record, so a buyer could name themselves as the
        // seller of somebody else's land.
        const res = await (await payment()).initializePropertyPaymentAction(
            PROPERTY as never, 'Renamed by the buyer' as never, 5_000_000 as never,
            BUYER as never,                                   // forged seller
            buyerInfo as never,
        ) as any;

        expect(res.success).toBe(true);
        expect(purchase()).toMatchObject({ sellerId: OWNER, propertyName: 'Two hectares, Enugu' });
    });

    it('writes the purchase record pending, with the reference to verify against', async () => {
        await initialise();

        expect(purchase()).toMatchObject({
            propertyId: PROPERTY, buyerId: BUYER, status: 'pending_payment',
            escrowStatus: 'pending', paymentReference: REF,
            zoningComplianceDeclarationAccepted: true,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyPropertyPaymentAction', () => {
    beforeEach(async () => {
        seedListing();
        await initialise();
        jest.clearAllMocks();
        mockVerify.mockResolvedValue({
            status: true,
            data: {
                status: 'success', amount: 500000000, channel: 'card',
                metadata: { userId: BUYER, propertyId: PROPERTY, propertyTitle: 'Two hectares, Enugu' },
                customer: { email: `${BUYER}@e.com` },
            },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await verify()).toMatchObject({ success: false });
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it.each(['failed', 'abandoned'])('refuses a %s Paystack payment', async (status) => {
        mockVerify.mockResolvedValue({
            status: true,
            data: { status, gateway_response: 'Declined', amount: 500000000, metadata: {} },
        });

        expect(await verify()).toMatchObject({ success: false });
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses a payment made by somebody else', async () => {
        mockVerify.mockResolvedValue({
            status: true,
            data: {
                status: 'success', amount: 500000000,
                metadata: { userId: 'a-stranger', propertyId: PROPERTY },
            },
        });

        expect(await verify()).toMatchObject({
            success: false, error: 'Payment verification failed: User mismatch',
        });
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('holds the property in escrow and confirms the purchase record', async () => {
        expect(await verify()).toMatchObject({ success: true });

        expect(listing()).toMatchObject({ status: 'pending_escrow' });
        expect(listing().escrowHeldAt).toBeTruthy();
        expect(purchase()).toMatchObject({ status: 'payment_confirmed', escrowStatus: 'held' });
    });

    it('writes the ledger and payment rows under the reference', async () => {
        await verify();

        expect(store.get(COLLECTIONS.TRANSACTIONS, REF)).toMatchObject({
            userId: BUYER, type: 'property_purchase', module: 'farm_nation',
            amount: 5_000_000, status: 'completed',
        });
        expect(store.get(COLLECTIONS.PAYMENTS, `PAY-${REF}`)).toMatchObject({
            userId: BUYER, sellerId: OWNER, purpose: 'escrow_payment', status: 'success',
        });
    });

    it('spends one reference once', async () => {
        expect((await verify()).success).toBe(true);

        const second = await verify();
        expect(second.success).toBe(true);          // idempotent, not an error
        expect(store.size(COLLECTIONS.TRANSACTIONS)).toBe(1);
    });

    it('REFUSES AN UNDERPAYMENT, and flags it for refund', async () => {
        mockVerify.mockResolvedValue({
            status: true,
            data: {
                status: 'success', amount: 100000,      // ₦1,000 against ₦5,000,000
                metadata: { userId: BUYER, propertyId: PROPERTY, propertyTitle: 'x' },
            },
        });

        expect(await verify()).toMatchObject({ success: false });
        expect(mockMarkFailed).toHaveBeenCalledWith(REF, expect.stringContaining('does not cover'));
    });

    it('checks the paid sum against the QUOTED price, not the current one', async () => {
        // An owner repricing between checkout and the buyer's return used to
        // make a correct payment look like an underpayment — after the claim, so
        // the buyer had paid and received nothing.
        seedListing({ status: 'pending_escrow', price: 9_000_000 });

        expect(await verify()).toMatchObject({ success: true });
        expect(mockMarkFailed).not.toHaveBeenCalled();
    });

    it('flags a payment it took but could not apply', async () => {
        store.seed(LISTINGS, PROPERTY, { ...listing(), status: 'sold' });

        expect(await verify()).toMatchObject({ success: false });
        expect(mockMarkFailed).toHaveBeenCalledWith(REF, expect.stringContaining('pending escrow'));
    });
});
