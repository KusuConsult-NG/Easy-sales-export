/**
 * @jest-environment node
 */

/**
 * The third instance of a notification whose recipient the caller chose.
 *
 * THE DEFECT
 * ----------
 * _submitQuoteRequestAction took `sellerId` and `productName` from the request
 * and passed both straight into a notification:
 *
 *     await db.collection(COLLECTIONS.NOTIFICATIONS).add({
 *         userId: data.sellerId,
 *         title: "New Quote Request",
 *         message: `...for "${data.productName}" from ${session.user.name}`,
 *         link: `/marketplace/seller/quotes/${quoteRef.id}`,
 *     });
 *
 * So any authenticated user could send a platform notification to ANY user id,
 * with an attacker-chosen product name in the body and the marketplace's own
 * branding around it. A phishing primitive.
 *
 * THIS CODEBASE HAS FIXED THIS SHAPE TWICE ALREADY
 * ------------------------------------------------
 * _submitLandInquiryAction took listingOwnerId and listingTitle from the request
 * and now reads them from the listing. Its comment says the same thing in the
 * same words: "an open endpoint for sending a notification to ANY user, with an
 * attacker-chosen title and body — a phishing primitive wearing the platform's
 * own branding."
 *
 * createReviewAction reads the product document to attribute a review to "the
 * ACTUAL seller" rather than trusting the order.
 *
 * Both fixes were in place. This third copy was not, which is the class this
 * audit keeps meeting — and the reason the sweeps in #138, #147 and #148 exist.
 *
 * ALSO
 * ----
 * The product now has to exist. It never did, so a quote could be raised
 * against a productId that was never a product — and the seller notified about
 * it was whoever the caller named.
 *
 * `quantity` is validated. It is typed as a number in QuoteRequestData, which is
 * a TypeScript claim erased before the request arrives.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * `buyerId`, `buyerName` and `buyerEmail` were already taken from the session
 * and written AFTER the spread, so the caller could never forge those. That is
 * the field-order property marketplace/_escrow.ts calls "a thin thing to rest
 * on" — and it held here. _getMyQuotesAction scopes strictly by the session id
 * for both roles.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const REAL_SELLER = 'seller-real';
const VICTIM = 'victim-1';

function setSession(id: string | null, name = 'A Buyer') {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, email: `${id}@e.com`, name, roles: [] } }, error: null }
    ));
}

function setProduct(product: Record<string, any> | null) {
    // One stub answers every read here, document and query alike, so the two
    // flags have to be set independently: `exists` is the PRODUCT lookup, and
    // `empty` is the "does this buyer already have an open request" query added
    // with #125. Tying `empty` to `product === null` made a found product also
    // mean a found duplicate, and every submission was refused.
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: product !== null,
        empty: true,
        size: 0,
        docs: [],
        data: () => product ?? {},
    }));
}

const VALID = {
    productId: 'prod-1',
    productName: 'Cocoa Beans',
    sellerId: REAL_SELLER,
    quantity: 100,
};

async function submit(overrides: Record<string, any> = {}) {
    const { submitQuoteRequestAction } = await import('@/app/actions/marketplace/_quotes');
    return submitQuoteRequestAction({ ...VALID, ...overrides } as any) as any;
}

/** Everything written by .add(), by collection. */
function added(): Array<{ collection: string; doc: any }> {
    return (global as any).mockFirestoreAdd.mock.calls.map((c: any[]) => ({
        collection: c[0],
        doc: c[c.length - 1],
    }));
}

function notification(): any {
    return added().find((a) => a.doc && 'read' in a.doc)?.doc;
}

function quote(): any {
    return added().find((a) => a.doc && 'buyerId' in a.doc)?.doc;
}

describe('the seller is the product\'s seller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct({ sellerId: REAL_SELLER, title: 'Cocoa Beans' });
    });

    it('notifies the product\'s seller, not the id in the request', async () => {
        // THE test. `sellerId` names a different user on purpose.
        const r = await submit({ sellerId: VICTIM });

        expect(r.success).toBe(true);
        expect(notification()?.userId).toBe(REAL_SELLER);
        expect(notification()?.userId).not.toBe(VICTIM);
    });

    it('records the quote against the real seller too', async () => {
        // Not only the notification: a quote attributed to the wrong seller
        // appears in that seller's list.
        await submit({ sellerId: VICTIM });

        expect(quote()?.sellerId).toBe(REAL_SELLER);
    });

    it('uses the product\'s own name in the message body', async () => {
        // The body is where the phishing text would go.
        await submit({ productName: 'URGENT: verify your account at evil.example' });

        expect(notification()?.message).toContain('Cocoa Beans');
        expect(notification()?.message).not.toContain('evil.example');
    });

    it('stores the product\'s name on the quote as well', async () => {
        await submit({ productName: 'Something Else Entirely' });

        expect(quote()?.productName).toBe('Cocoa Beans');
    });

    it('refuses a product that does not exist', async () => {
        // It never had to exist, so a quote could be raised against anything and
        // the named "seller" notified about it.
        setProduct(null);

        const r = await submit();

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('refuses a product with no seller recorded', async () => {
        setProduct({ title: 'Orphan Product' });

        const r = await submit();

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });
});

describe('the quantity is a quantity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct({ sellerId: REAL_SELLER, title: 'Cocoa Beans' });
    });

    it('refuses zero, negative and non-numeric', async () => {
        for (const bad of [0, -5, 'lots']) {
            jest.clearAllMocks();
            const r = await submit({ quantity: bad });
            expect(r.success).toBe(false);
            expect(added()).toEqual([]);
        }
    });

    it('accepts a real quantity', async () => {
        // Vacuity guard. Every refusal above passes against an action that does
        // nothing at all.
        const r = await submit({ quantity: 250 });

        expect(r.success).toBe(true);
        expect(quote()?.quantity).toBe(250);
    });
});

describe('what was already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER, 'A Buyer');
        setProduct({ sellerId: REAL_SELLER, title: 'Cocoa Beans' });
    });

    it('takes the buyer from the session, not the request', async () => {
        // Written after the spread before this change and still is — the field
        // ordering marketplace/_escrow.ts calls "a thin thing to rest on".
        await submit({ buyerId: VICTIM, buyerEmail: 'forged@evil.example' } as any);

        expect(quote()?.buyerId).toBe(BUYER);
        expect(quote()?.buyerEmail).toBe(`${BUYER}@e.com`);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r = await submit();

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('scopes the quote list to the caller in both roles', async () => {
        // _getMyQuotesAction takes a role, not a user id, so there is nothing to
        // substitute — asserted on the signature since adding a parameter later
        // would not fail a behavioural test.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/marketplace/_quotes.ts'), 'utf-8');

        expect(src).toContain('const field = role === "buyer" ? "buyerId" : "sellerId";');
        expect(src).toContain('.where(field, "==", userId)');
    });
});
