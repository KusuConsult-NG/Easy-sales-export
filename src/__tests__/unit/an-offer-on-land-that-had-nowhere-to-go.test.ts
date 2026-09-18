/**
 * @jest-environment node
 */

/**
 *   #874 THE SAME GAP AS #873, IN THE MODULE WHERE THE SUMS ARE LARGER.
 *
 *   THE OWNER: "there is a senerio where a buyer wants to ask for discount on
 *   certain product/property" — product AND property.
 *
 *   MEASURED, and the two modules were not in the same state. The marketplace
 *   at least had a RECORD for the ask (`marketplace_quotes`) and no reply.
 *   Farm Nation had nothing at either end: the only buyer-to-owner channel on a
 *   listing is a land inquiry, and an inquiry is a PUBLIC intake carrying a
 *   name, an email and a phone number and deliberately no buyerId —
 *   getLandInquiryByIdAction's own guard says so, and it is why #872's reply had
 *   to leave the platform as an email.
 *
 *   An offer moves money into escrow. It needs an account on both sides, so it
 *   could not be an inquiry.
 *
 * ── ONE SET OF RULES, CHECKED HERE TOO ──────────────────────────────────────
 *
 *   The law is lib/quote-negotiation.ts, shared with #873 rather than copied.
 *   These tests do not re-derive it; they check this module is WIRED to it — a
 *   shared rule that one of two callers does not actually consult is the exact
 *   defect class this audit keeps finding, and it would be invisible from the
 *   marketplace suite passing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const OWNER = 'owner-1';
const LISTING = 'listing-1';
const OFFERS = COLLECTIONS.LAND_OFFERS;
const LISTED = 5_000_000;

const actAs = (id: string, name = 'Emeka Nwosu') =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles: ['investor'], email: `${id}@e.com`, name } },
        error: null,
    });

const seedListing = (over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.LAND_LISTINGS, LISTING, {
        id: LISTING,
        title: '2 hectares at Ugwuoba',
        ownerId: OWNER,
        status: 'verified',
        price: LISTED,
        availableForSale: true,
        ...over,
    });

const seedOffer = (over: Record<string, unknown> = {}) =>
    store.seed(OFFERS, 'o-1', {
        id: 'o-1',
        listingId: LISTING,
        listingTitle: '2 hectares at Ugwuoba',
        sellerId: OWNER,
        buyerId: BUYER,
        buyerName: 'Emeka Nwosu',
        quantity: 1,
        offerMode: 'buy',
        listedPrice: LISTED,
        offeredPrice: 4_200_000,
        status: 'pending',
        ...over,
    });

const offer = () => store.get(OFFERS, 'o-1') as Record<string, any>;
const rowsIn = (c: string) => store.all(c).map(([, d]) => d as Record<string, any>);

const make = async (data: Record<string, unknown> = {}) => {
    const { makeLandOfferAction } = await import('@/app/actions/land-offers');
    return await makeLandOfferAction({
        listingId: LISTING, offeredPrice: 4_200_000, ...data,
    } as any) as any;
};

const respond = async (decision: string, price?: number) => {
    const { respondToLandOfferAction } = await import('@/app/actions/land-offers');
    return await respondToLandOfferAction('o-1', { decision, price } as any) as any;
};

const settle = async (decision: string) => {
    const { settleLandOfferCounterAction } = await import('@/app/actions/land-offers');
    return await settleLandOfferCounterAction('o-1', decision as any) as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedListing();
    actAs(BUYER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — a buyer can offer a price for land', () => {
    it('THE REPORTED GAP: an offer is recorded', async () => {
        const res = await make();

        expect(res.success).toBe(true);
        const rows = rowsIn(OFFERS);
        expect(rows).toHaveLength(1);
        expect(rows[0].offeredPrice).toBe(4_200_000);
        expect(rows[0].status).toBe('pending');
    });

    it('AND THE OWNER AND TITLE COME FROM THE LISTING, not from the request', async () => {
        /*
         *   The fourth time this file's neighbours have had to enforce it.
         *   _submitLandInquiryAction, createReviewAction and
         *   _submitQuoteRequestAction all took a recipient id from the request
         *   and all had to stop: a notification addressed to a caller-named user
         *   is an open endpoint for sending a branded platform message to
         *   anybody.
         */
        await make({ sellerId: 'somebody-else', listingTitle: 'Free Money' } as any);

        const row = rowsIn(OFFERS)[0];
        expect(row.sellerId).toBe(OWNER);
        expect(row.listingTitle).toBe('2 hectares at Ugwuoba');
    });

    it('AND THE LISTED PRICE IS READ FROM THE LISTING — the ceiling is not the caller’s', async () => {
        await make({ listedPrice: 999_999_999 } as any);

        expect(rowsIn(OFFERS)[0].listedPrice).toBe(LISTED);
    });

    it('AND THE OWNER IS TOLD', async () => {
        await make();

        const bells = rowsIn(COLLECTIONS.NOTIFICATIONS);
        expect(bells).toHaveLength(1);
        expect(bells[0].userId).toBe(OWNER);
    });

    it('AND AN OFFER ABOVE THE LISTED PRICE IS REFUSED', async () => {
        expect((await make({ offeredPrice: LISTED + 1 })).success).toBe(false);
        expect(rowsIn(OFFERS)).toHaveLength(0);
    });

    it('AND AN OFFER OF ZERO, A NEGATIVE OR NOTHING AT ALL IS REFUSED', async () => {
        /*
         *   Unlike a marketplace RFQ, a land offer with no figure is not a
         *   thing: the owner has nothing to accept. "Tell me about it" is what
         *   the inquiry form is for.
         */
        expect((await make({ offeredPrice: 0 })).success).toBe(false);
        expect((await make({ offeredPrice: -1 })).success).toBe(false);
        expect((await make({ offeredPrice: undefined })).success).toBe(false);
        expect(rowsIn(OFFERS)).toHaveLength(0);
    });

    it('AND NOBODY CAN OFFER ON THEIR OWN LAND', async () => {
        actAs(OWNER);

        expect((await make()).success).toBe(false);
        expect(rowsIn(OFFERS)).toHaveLength(0);
    });

    it('AND A SECOND OFFER WHILE THE FIRST IS UNANSWERED IS REFUSED', async () => {
        //   Every call writes a row AND a notification, and nothing else bounds
        //   the repetition — _quotes.ts's own duplicate check, same reasoning.
        await make();

        expect((await make()).success).toBe(false);
        expect(rowsIn(OFFERS)).toHaveLength(1);
    });

    it('AND A LISTING THAT DOES NOT EXIST IS NOT FOUND, not a crash', async () => {
        expect((await make({ listingId: 'no-such-listing' })).success).toBe(false);
    });

    it('AND A RENTAL OFFER IS MEASURED AGAINST THE RENTAL PRICE', async () => {
        /*
         *   #869's rule, and it has to be the same rule. `price` is the sale
         *   figure; measuring a rental offer against it would make every rental
         *   offer look like an enormous discount off a price nobody was
         *   discussing, and would let a ₦300,000 offer pass as "below ₦5m".
         */
        seedListing({
            availableForSale: false, availableForRent: true, rentPrice: 200_000,
        });

        const tooHigh = await make({ offeredPrice: 250_000, mode: 'rent' });
        expect(tooHigh.success).toBe(false);

        const ok = await make({ offeredPrice: 180_000, mode: 'rent' });
        expect(ok.success).toBe(true);
        expect(rowsIn(OFFERS)[0].listedPrice).toBe(200_000);
        expect(rowsIn(OFFERS)[0].offerMode).toBe('rent');
    });

    it('AND `mode=rent` ON A SALE-ONLY PARCEL IS IGNORED, not honoured', async () => {
        //   Otherwise a buyer picks the cheaper of two figures by naming an
        //   offer the owner never made — the trick #869 closed at the checkout.
        await make({ mode: 'rent' });

        expect(rowsIn(OFFERS)[0].offerMode).toBe('buy');
        expect(rowsIn(OFFERS)[0].listedPrice).toBe(LISTED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — and the owner answers', () => {
    beforeEach(() => { seedOffer(); actAs(OWNER, 'Ngozi Eze'); });

    it('ACCEPTING WRITES AN AGREED PRICE', async () => {
        const res = await respond('accept');

        expect(res.success).toBe(true);
        expect(offer().status).toBe('accepted');
        expect(offer().agreedPrice).toBe(4_200_000);
        expect(offer().acceptedAt).toEqual(expect.any(String));
    });

    it('AND ACCEPTING TAKES THE BUYER’S FIGURE, not one the owner passes', async () => {
        await respond('accept', 4_900_000);

        expect(offer().agreedPrice).toBe(4_200_000);
    });

    it('AND A COUNTER AGREES NOTHING UNTIL THE BUYER ANSWERS', async () => {
        await respond('counter', 4_600_000);

        expect(offer().status).toBe('countered');
        expect(offer().counterPrice).toBe(4_600_000);
        expect(offer().agreedPrice).toBeUndefined();
    });

    it('AND A COUNTER ABOVE THE LISTED PRICE IS REFUSED', async () => {
        expect((await respond('counter', LISTED + 1)).success).toBe(false);
        expect(offer().status).toBe('pending');
    });

    it('AND A COUNTER OF ZERO OR NONE IS REFUSED', async () => {
        expect((await respond('counter')).success).toBe(false);
        expect((await respond('counter', 0)).success).toBe(false);
        expect(offer().status).toBe('pending');
    });

    it('AND DECLINING CLOSES IT', async () => {
        expect((await respond('decline')).success).toBe(true);
        expect(offer().status).toBe('declined');
    });

    it('AND THE BUYER IS TOLD', async () => {
        await respond('accept');

        const bells = rowsIn(COLLECTIONS.NOTIFICATIONS);
        expect(bells).toHaveLength(1);
        expect(bells[0].userId).toBe(BUYER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — and only the two of them may move it', () => {
    beforeEach(() => seedOffer());

    it('A STRANGER CANNOT ANSWER', async () => {
        actAs('stranger-1');

        expect((await respond('accept')).success).toBe(false);
        expect(offer().status).toBe('pending');
    });

    it('AND AN ADMIN CANNOT EITHER, which is deliberate', async () => {
        /*
         *   Every other privileged door in this codebase admits an admin. This
         *   one must not: agreeing a price on an owner's behalf is not
         *   moderation, it is selling their land for them.
         */
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com', name: 'A' } },
            error: null,
        });

        expect((await respond('accept')).success).toBe(false);
        expect(offer().status).toBe('pending');
    });

    it('AND THE BUYER CANNOT ACCEPT HER OWN OFFER', async () => {
        actAs(BUYER);

        expect((await respond('accept')).success).toBe(false);
        expect(offer().status).toBe('pending');
    });

    it('AND AN ANSWERED OFFER CANNOT BE ANSWERED AGAIN', async () => {
        //   How an agreed price gets quietly replaced with a worse one after the
        //   buyer has seen it and gone to pay.
        actAs(OWNER);
        await respond('accept');

        expect((await respond('counter', 4_900_000)).success).toBe(false);
        expect(offer().agreedPrice).toBe(4_200_000);
    });

    it('AND A CALLER WITH NO SESSION CANNOT', async () => {
        mockRequireSession.mockResolvedValue({
            session: null, error: { error: 'Authentication required' },
        });

        expect((await respond('accept')).success).toBe(false);
        expect((await make()).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — and the buyer answers a counter', () => {
    beforeEach(() => seedOffer({ status: 'countered', counterPrice: 4_600_000 }));

    it('ACCEPTING TAKES THE OWNER’S FIGURE', async () => {
        actAs(BUYER);

        expect((await settle('accept')).success).toBe(true);
        expect(offer().status).toBe('accepted');
        expect(offer().agreedPrice).toBe(4_600_000);
    });

    it('AND THE OWNER CANNOT ACCEPT ON HER BEHALF', async () => {
        actAs(OWNER);

        expect((await settle('accept')).success).toBe(false);
        expect(offer().status).toBe('countered');
    });

    it('AND DECLINING CLOSES IT', async () => {
        actAs(BUYER);

        expect((await settle('decline')).success).toBe(true);
        expect(offer().status).toBe('declined');
    });

    it('AND THERE IS NOTHING TO SETTLE ON AN UNANSWERED OFFER', async () => {
        seedOffer({ status: 'pending' });
        actAs(BUYER);

        expect((await settle('accept')).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — and both sides see their own offers and nobody else’s', () => {
    it('THE LIST FILTERS ON THE SESSION, and takes no id to name somebody with', async () => {
        /*
         *   getLandInquiriesAction once matched `listingOwnerId == userId` where
         *   userId was the CALLER'S OWN ARGUMENT — "any authenticated user could
         *   name any landowner and read their inbox". This action takes no
         *   parameter at all, so there is nothing to name.
         */
        const { getMyLandOffersAction } = await import('@/app/actions/land-offers');
        seedOffer();
        store.seed(OFFERS, 'o-2', {
            id: 'o-2', listingId: 'other', sellerId: 'other-owner',
            buyerId: 'other-buyer', quantity: 1, offeredPrice: 1, status: 'pending',
        });

        actAs(BUYER);
        const asBuyer = await getMyLandOffersAction() as any;
        expect(asBuyer.data.asBuyer.map((o: any) => o.id)).toEqual(['o-1']);
        expect(asBuyer.data.asSeller).toEqual([]);

        actAs(OWNER);
        const asOwner = await getMyLandOffersAction() as any;
        expect(asOwner.data.asSeller.map((o: any) => o.id)).toEqual(['o-1']);
        expect(asOwner.data.asBuyer).toEqual([]);

        actAs('stranger-1');
        const stranger = await getMyLandOffersAction() as any;
        expect(stranger.data).toEqual({ asBuyer: [], asSeller: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   THE MONEY. The shared rules are proved in #873's suite; these prove THIS
//   module is wired to them, which passing over there cannot show.
// ─────────────────────────────────────────────────────────────────────────────
describe('#874 — and the land checkout honours the agreed price, not the URL', () => {
    const { quoteRefusal, chargeablePrice } = require('@/lib/quote-negotiation');

    const asCheckoutSees = (row: Record<string, any>) => ({
        ...row, productId: String(row.listingId ?? ''),
    });
    const line = (buyerId = BUYER) => ({
        buyerId, productId: LISTING, quantity: 1, productName: '2 hectares at Ugwuoba',
    });
    const accepted = (over: Record<string, unknown> = {}) => ({
        listingId: LISTING, buyerId: BUYER, sellerId: OWNER, quantity: 1,
        status: 'accepted', agreedPrice: 4_200_000,
        acceptedAt: new Date().toISOString(), ...over,
    });

    it('AN ACCEPTED OFFER PRICES THE PURCHASE', () => {
        expect(quoteRefusal(asCheckoutSees(accepted()), line())).toBeNull();
        expect(chargeablePrice(4_200_000, LISTED)).toBe(4_200_000);
    });

    it('AND SOMEBODY ELSE’S CANNOT BE SPENT', () => {
        expect(quoteRefusal(asCheckoutSees(accepted({ buyerId: 'someone-else' })), line()))
            .toMatch(/does not belong/i);
    });

    it('AND IT CANNOT BE HONOURED AGAINST A NEW OWNER', () => {
        /*
         *   This module is where that actually happens: fulfilling a purchase
         *   rewrites `ownerId`. An agreed price is one owner's promise, and the
         *   escrow is credited to whoever the listing names TODAY.
         */
        expect(quoteRefusal(
            asCheckoutSees(accepted()),
            { ...line(), sellerId: 'new-owner' },
        )).toMatch(/different seller/i);

        //   And the ordinary case still passes, so the check is not just "no".
        expect(quoteRefusal(
            asCheckoutSees(accepted({ sellerId: OWNER })),
            { ...line(), sellerId: OWNER },
        )).toBeNull();
    });

    it('AND IT CANNOT BE MOVED TO A DIFFERENT PARCEL', () => {
        expect(quoteRefusal(asCheckoutSees(accepted({ listingId: 'other-listing' })), line()))
            .toMatch(/different listing/i);
    });

    it('AND AN UNANSWERED, DECLINED OR COUNTERED ONE CANNOT', () => {
        expect(quoteRefusal(asCheckoutSees(accepted({ status: 'pending' })), line()))
            .toMatch(/not responded/i);
        expect(quoteRefusal(asCheckoutSees(accepted({ status: 'declined' })), line()))
            .toMatch(/declined/i);
        expect(quoteRefusal(asCheckoutSees(accepted({ status: 'countered' })), line()))
            .toMatch(/Accept or decline/i);
    });

    it('AND AN EXPIRED ONE CANNOT', () => {
        const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        expect(quoteRefusal(asCheckoutSees(accepted({ acceptedAt: longAgo })), line()))
            .toMatch(/expired/i);
    });

    it('AND ONE ALREADY SPENT CANNOT BE SPENT TWICE', () => {
        expect(quoteRefusal(asCheckoutSees(accepted({ consumedByOrderId: 'PUR-1' })), line()))
            .toMatch(/already been used/i);
    });

    it('AND A PARCEL THAT HAS FALLEN BELOW THE AGREED FIGURE IS SOLD AT THE LOWER ONE', () => {
        //   Nobody is punished for having negotiated.
        expect(chargeablePrice(4_200_000, 3_000_000)).toBe(3_000_000);
    });

    it('AND THE CHECKOUT REALLY IS WIRED TO ALL OF IT — not just able to be', () => {
        /*
         *   The suites above use the shared rules directly. This one reads the
         *   PATH, because a rule nothing calls is the defect, not the rule: the
         *   payment action has to pass the buyer's session id, the listing id
         *   and a quantity of 1, and then charge `chargedPrice`.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments');

        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/farm-nation-payment.ts'), 'utf8'),
            { label: 'farm-nation-payment.ts' },
        );

        const at = src.indexOf('const refusal = quoteRefusal(');
        expect(at).toBeGreaterThan(-1);

        const block = src.slice(at, at + 400);
        expect(block).toContain('buyerId: session.user.id');
        expect(block).toContain('productId: propertyId');
        expect(block).toContain('quantity: 1');

        //   And the figure it decides is the figure that is charged.
        expect(src).toContain('nairaToKobo(chargedPrice)');
        expect(src).toContain('escrowAmount: chargedPrice');
        expect(src).toContain('propertyPrice: chargedPrice');
    });
});
