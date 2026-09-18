/**
 * @jest-environment node
 */

/**
 *   #873 A BUYER COULD ASK FOR A DISCOUNT AND THE SELLER COULD NOT SAY YES.
 *
 *   THE OWNER: "there is a senerio where a buyer wants to ask for discount on
 *   certain product/property, how can that be wired in the app?" — and then,
 *   asked to build it: "build the pending flow".
 *
 *   MEASURED BEFORE DESIGNING. The ask already had a home: `marketplace_quotes`
 *   is exactly "a buyer is asking this seller about a price". What was missing
 *   was the other half, and both quote screens said so in their own headers —
 *   "There is no seller-response flow in this codebase", "Reply by email —
 *   there is no in-app quoting yet".
 *
 *   So a quote was written, the buyer was told it succeeded, and every quote
 *   sat at "pending" for ever. The whole feature was an outbox.
 *
 * ── EXECUTED, NOT SCANNED ───────────────────────────────────────────────────
 *
 *   Every test below runs the real action against a fake database. A source
 *   scan cannot tell a live call from a declaration — #870's mutation survived
 *   exactly that mistake in this repo — and none of it could tell whether a
 *   refused door actually refuses.
 *
 * ── WHAT IS ACTUALLY AT STAKE ───────────────────────────────────────────────
 *
 *   An accepted quote is a licence to pay LESS than the listing says, which
 *   makes it the second thing in this codebase that can move a price (the first
 *   being the pricing tiers, where #571 found that naming `bulk` with
 *   `quantity: 1` bought one unit at the bulk rate). The suites at the bottom
 *   are that case: they are the ones that would cost somebody money.
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
const SELLER = 'seller-1';
const PRODUCT = 'prod-1';
const QUOTES = COLLECTIONS.MARKETPLACE_QUOTES;
const LISTED = 1000;

const actAs = (id: string, name = 'Ngozi Eze') =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles: ['user'], email: `${id}@e.com`, name } },
        error: null,
    });

function seedProduct(over: Record<string, unknown> = {}) {
    store.seed(COLLECTIONS.PRODUCTS, PRODUCT, {
        id: PRODUCT,
        title: 'Ofada Rice',
        sellerId: SELLER,
        status: 'active',
        unit: 'bag',
        availableQuantity: 1000,
        pricingTiers: [{ type: 'retail', price: LISTED, minQuantity: 1 }],
        ...over,
    });
}

function seedQuote(over: Record<string, unknown> = {}) {
    store.seed(QUOTES, 'q-1', {
        id: 'q-1',
        buyerId: BUYER,
        sellerId: SELLER,
        productId: PRODUCT,
        productName: 'Ofada Rice',
        subjectType: 'product',
        quantity: 10,
        unit: 'bag',
        listedPrice: LISTED,
        offeredPrice: 800,
        status: 'pending',
        ...over,
    });
}

const quote = () => store.get(QUOTES, 'q-1') as Record<string, any>;

/**
 *   store.all returns [id, doc] PAIRS, not documents — the rows written by
 *   `.add()`, whose ids are generated. Unwrapped here once so a test that reads
 *   a field off the pair cannot pass by finding `undefined` on both sides.
 */
const rowsIn = (collection: string) =>
    store.all(collection).map(([, doc]) => doc as Record<string, any>);

const ask = async (data: Record<string, unknown> = {}) => {
    const { submitQuoteRequestAction } = await import('@/app/actions/marketplace/_quotes');
    return await submitQuoteRequestAction({
        productId: PRODUCT, productName: 'whatever the caller says',
        sellerId: 'whoever the caller says', quantity: 10, unit: 'bag',
        ...data,
    } as any) as any;
};

const respond = async (decision: string, price?: number, message?: string) => {
    const { respondToQuoteAction } = await import('@/app/actions/marketplace/_quote_offers');
    return await respondToQuoteAction('q-1', { decision, price, message } as any) as any;
};

const settle = async (decision: string) => {
    const { settleQuoteCounterAction } = await import('@/app/actions/marketplace/_quote_offers');
    return await settleQuoteCounterAction('q-1', decision as any) as any;
};

const priceCart = async (line: Record<string, unknown> = {}, buyerId: string | undefined = BUYER) => {
    const { validateCartItems } = await import('@/lib/marketplace-cart');
    return await validateCartItems([{
        id: PRODUCT, title: 'Ofada Rice', sellerId: SELLER,
        quantity: 10, unit: 'bag', selectedTier: 'retail', price: LISTED,
        addedAt: new Date(), ...line,
    }] as any, buyerId);
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProduct();
    actAs(BUYER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — the buyer can name a figure', () => {
    it('THE REPORTED GAP: an offer is recorded', async () => {
        const res = await ask({ offeredPrice: 800 });

        expect(res.success).toBe(true);
        const rows = rowsIn(QUOTES);
        expect(rows).toHaveLength(1);
        expect(rows[0].offeredPrice).toBe(800);
    });

    it('AND THE LISTED PRICE IS TAKEN FROM THE PRODUCT, not from the request', async () => {
        /*
         *   The whole negotiation is bounded by this number — an offer above it
         *   is refused, a counter above it is refused, and the checkout charges
         *   the lower of the agreed figure and the listing. A caller-supplied
         *   ceiling is no ceiling.
         */
        await ask({ offeredPrice: 800, listedPrice: 999999 } as any);

        expect(rowsIn(QUOTES)[0].listedPrice).toBe(LISTED);
    });

    it('AND ASKING WITH NO FIGURE IS STILL A VALID REQUEST', async () => {
        //   "What would you charge?" is a different question from "would you
        //   take ₦800?", and the form asks both.
        const res = await ask();

        expect(res.success).toBe(true);
        expect(rowsIn(QUOTES)[0].offeredPrice).toBeUndefined();
    });

    it('AND AN OFFER ABOVE THE LISTED PRICE IS REFUSED', async () => {
        /*
         *   Not pedantry. A seller who "accepts" ₦2,000 on a ₦1,000 listing has
         *   agreed to overcharge somebody, and the accept button makes that one
         *   click away from happening.
         */
        const res = await ask({ offeredPrice: LISTED + 1 });

        expect(res.success).toBe(false);
        expect(store.all(QUOTES)).toHaveLength(0);
    });

    it('AND AN EXPORT WINDOW TAKES NO FIGURE — nothing could ever spend it', async () => {
        /*
         *   The other half of the cart's export refusal, and the reason it is
         *   here rather than only there: a quote a seller can ACCEPT and nobody
         *   can USE is a record written that nothing reads, which is the defect
         *   class this audit keeps closing. The plain RFQ still works — that is
         *   the legitimate case on an export window.
         */
        store.seed(COLLECTIONS.EXPORT_WINDOWS, 'win-1', {
            id: 'win-1', title: 'March container to Rotterdam', createdBy: 'admin-x',
        });

        const withFigure = await ask({ productId: 'win-1', offeredPrice: 500 });
        expect(withFigure.success).toBe(false);
        expect(store.all(QUOTES)).toHaveLength(0);

        const plainRequest = await ask({ productId: 'win-1' });
        expect(plainRequest.success).toBe(true);
        expect(rowsIn(QUOTES)[0].subjectType).toBe('export_window');
    });

    it('AND SO IS AN OFFER OF ZERO OR LESS', async () => {
        /*
         *   THIS ONE FAILED AGAINST MY OWN FIRST DRAFT, and the draft was
         *   wrong. `positiveNumber` answers null for "nothing was sent" AND for
         *   "0 was sent", and the code read that single null as "no figure
         *   offered" — so a buyer who typed 0 had their number silently dropped
         *   and their quote filed as a plain "what would you charge?".
         *
         *   A field that looks like it does something and does not is the exact
         *   class this audit keeps removing, and it had just been reintroduced.
         *   The two cases are told apart now; see offerWasGiven.
         */
        expect((await ask({ offeredPrice: 0 })).success).toBe(false);
        expect((await ask({ offeredPrice: -50 })).success).toBe(false);
        expect((await ask({ offeredPrice: "not a number" as any })).success).toBe(false);
        expect(store.all(QUOTES)).toHaveLength(0);
    });

    it('AND A BLANK FIELD IS STILL NOT AN OFFER OF ZERO — the other half', async () => {
        /*
         *   The control on the test above. An untouched number input submits
         *   "", and refusing that would break the plain RFQ the form still
         *   offers.
         */
        expect((await ask({ offeredPrice: "" as any })).success).toBe(true);
        expect(rowsIn(QUOTES)[0].offeredPrice).toBeUndefined();
    });

    it('AND A COUNTER OF ZERO IS REFUSED FOR THE SAME REASON', async () => {
        //   The same conflation on the seller's side of the same rule.
        seedQuote();
        actAs(SELLER);

        const res = await respond('counter', 0);

        expect(res.success).toBe(false);
        expect(quote().status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — and the seller can answer, which nothing could do before', () => {
    beforeEach(() => { seedQuote(); actAs(SELLER); });

    it('THE REPORTED GAP: accepting writes an agreed price', async () => {
        const res = await respond('accept');

        expect(res.success).toBe(true);
        expect(quote().status).toBe('accepted');
        expect(quote().agreedPrice).toBe(800);
        expect(quote().acceptedAt).toEqual(expect.any(String));
    });

    it('AND THE AGREED PRICE IS THE BUYER’S FIGURE, not one the seller passes', async () => {
        /*
         *   "Accept" means accept. A price in the accept call would let a seller
         *   click Accept on ₦800 and record ₦950 — the buyer would see the
         *   button they expected and be charged something else.
         */
        await respond('accept', 950);

        expect(quote().agreedPrice).toBe(800);
    });

    it('AND ACCEPTING A REQUEST WITH NO FIGURE IS REFUSED, with the reason', async () => {
        //   Otherwise the quote reaches `accepted` carrying no number, and the
        //   buyer meets the failure at the checkout instead.
        seedQuote({ offeredPrice: undefined });

        const res = await respond('accept');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/price/i);
        expect(quote().status).toBe('pending');
    });

    it('AND A COUNTER RECORDS THE SELLER’S PRICE WITHOUT AGREEING ANYTHING', async () => {
        const res = await respond('counter', 900);

        expect(res.success).toBe(true);
        expect(quote().status).toBe('countered');
        expect(quote().counterPrice).toBe(900);
        //   Nothing is agreed until the buyer says so.
        expect(quote().agreedPrice).toBeUndefined();
    });

    it('AND A COUNTER WITH NO PRICE IS REFUSED', async () => {
        //   A counter with no figure is a decline wearing a different word, and
        //   it would leave the buyer a button that agrees to nothing.
        const res = await respond('counter');

        expect(res.success).toBe(false);
        expect(quote().status).toBe('pending');
    });

    it('AND A COUNTER ABOVE THE LISTED PRICE IS REFUSED', async () => {
        const res = await respond('counter', LISTED + 1);

        expect(res.success).toBe(false);
        expect(quote().status).toBe('pending');
    });

    it('AND DECLINING CLOSES IT', async () => {
        expect((await respond('decline')).success).toBe(true);
        expect(quote().status).toBe('declined');
        expect(quote().agreedPrice).toBeUndefined();
    });

    it('AND THE BUYER IS TOLD, whichever way it went', async () => {
        await respond('accept');

        const bells = rowsIn(COLLECTIONS.NOTIFICATIONS);
        expect(bells).toHaveLength(1);
        expect(bells[0].userId).toBe(BUYER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — and only the two of them may move it', () => {
    beforeEach(() => seedQuote());

    it('A STRANGER CANNOT ANSWER A QUOTE', async () => {
        actAs('stranger-1');

        expect((await respond('accept')).success).toBe(false);
        expect(quote().status).toBe('pending');
    });

    it('AND NEITHER CAN THE BUYER — answering her own offer is agreeing with herself', async () => {
        actAs(BUYER);

        expect((await respond('accept')).success).toBe(false);
        expect(quote().status).toBe('pending');
    });

    it('AND AN ADMIN CANNOT EITHER, which is deliberate', async () => {
        /*
         *   Every other privileged door in this codebase admits an admin, and
         *   this one must not. Agreeing a price on a seller's behalf is not
         *   moderation; it is trading as them, and the money moves to their
         *   escrow.
         */
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com', name: 'A' } },
            error: null,
        });

        expect((await respond('accept')).success).toBe(false);
        expect(quote().status).toBe('pending');
    });

    it('AND AN ALREADY-ANSWERED QUOTE CANNOT BE ANSWERED AGAIN', async () => {
        /*
         *   This is how an agreed price gets quietly replaced with a worse one
         *   after the buyer has seen it and gone to pay.
         */
        actAs(SELLER);
        await respond('accept');

        const again = await respond('counter', 950);

        expect(again.success).toBe(false);
        expect(quote().agreedPrice).toBe(800);
        expect(quote().status).toBe('accepted');
    });

    it('AND A CALLER WITH NO SESSION CANNOT', async () => {
        mockRequireSession.mockResolvedValue({
            session: null, error: { error: 'Authentication required' },
        });

        expect((await respond('accept')).success).toBe(false);
        expect(quote().status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — and the buyer answers the counter', () => {
    beforeEach(() => seedQuote({ status: 'countered', counterPrice: 900 }));

    it('ACCEPTING TAKES THE SELLER’S FIGURE', async () => {
        actAs(BUYER);

        const res = await settle('accept');

        expect(res.success).toBe(true);
        expect(quote().status).toBe('accepted');
        expect(quote().agreedPrice).toBe(900);
    });

    it('AND THE ACTION TAKES NO PRICE AT ALL — there is nothing to tamper with', async () => {
        /*
         *   Deliberate shape, not an omission. The buyer is agreeing to the
         *   number the SELLER wrote; the only way to guarantee that is to never
         *   accept one from the caller. Same reasoning as the ignored `amount`
         *   in the payment path.
         */
        const { settleQuoteCounterAction } = await import('@/app/actions/marketplace/_quote_offers');
        actAs(BUYER);

        //   A third argument has nowhere to land.
        await (settleQuoteCounterAction as any)('q-1', 'accept', { price: 1 });

        expect(quote().agreedPrice).toBe(900);
    });

    it('AND THE SELLER CANNOT ACCEPT ON HER BEHALF', async () => {
        actAs(SELLER);

        expect((await settle('accept')).success).toBe(false);
        expect(quote().status).toBe('countered');
    });

    it('AND THERE IS NOTHING TO SETTLE ON A QUOTE NOBODY COUNTERED', async () => {
        seedQuote({ status: 'pending' });
        actAs(BUYER);

        expect((await settle('accept')).success).toBe(false);
        expect(quote().status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   THE MONEY. Everything above decides what a row says; these decide what a
//   buyer is charged.
// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — the checkout charges the agreed price, and derives it itself', () => {
    const accepted = (over: Record<string, unknown> = {}) => seedQuote({
        status: 'accepted', agreedPrice: 800, acceptedAt: new Date().toISOString(), ...over,
    });

    it('THE REPORTED GAP: an agreed line is charged at the agreed price', async () => {
        accepted();

        const { subtotal, validatedItems } = await priceCart({ quoteId: 'q-1' });

        expect(validatedItems[0].pricePerUnit).toBe(800);
        expect(subtotal).toBe(8000);
    });

    it('AND AN ORDINARY LINE IS STILL CHARGED THE LISTED PRICE — the control', async () => {
        accepted();

        const { validatedItems } = await priceCart();

        expect(validatedItems[0].pricePerUnit).toBe(LISTED);
    });

    it('AND THE PRICE COMES OFF THE QUOTE, NOT OUT OF THE CART', async () => {
        /*
         *   THE ONE THAT MATTERS. The cart lives in localStorage, which anybody
         *   can edit. A line claiming to have agreed ₦1 is charged ₦800 — the
         *   seller's own figure — because the only thing read from the request
         *   is the quote's ID.
         */
        accepted();

        const { validatedItems } = await priceCart({
            quoteId: 'q-1', price: 1, agreedPrice: 1, pricePerUnit: 1,
        } as any);

        expect(validatedItems[0].pricePerUnit).toBe(800);
    });

    it('AND SOMEBODY ELSE’S AGREED PRICE CANNOT BE SPENT', async () => {
        /*
         *   Quote ids travel: the notification the seller receives carries one.
         *   Without the ownership check anybody could spend anybody's discount.
         */
        accepted({ buyerId: 'someone-else' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/does not belong/i);
    });

    it('AND IT CANNOT BE HONOURED AGAINST A DIFFERENT SELLER', async () => {
        /*
         *   An agreement is with a PERSON, not with a row. A listing can change
         *   hands — fulfilling a land purchase rewrites `ownerId`, which is the
         *   whole point of it — and paying a NEW owner a discount the previous
         *   one gave takes money off somebody who agreed to nothing.
         *
         *   The seller checked is the one read from the PRODUCT, so a cart line
         *   claiming the old seller does not help.
         */
        accepted();
        seedProduct({ sellerId: 'new-owner' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/different seller/i);
        await expect(priceCart({ quoteId: 'q-1', sellerId: SELLER }))
            .rejects.toThrow(/different seller/i);
    });

    it('AND IT CANNOT BE MOVED TO A DIFFERENT PRODUCT', async () => {
        accepted({ productId: 'other-product' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/different listing/i);
    });

    it('AND IT CANNOT BE STRETCHED TO A DIFFERENT QUANTITY', async () => {
        /*
         *   A volume price is cheap BECAUSE of the volume. This is #571's
         *   finding in a second place: there, naming `bulk` with `quantity: 1`
         *   bought one unit at the bulk rate.
         */
        accepted();

        await expect(priceCart({ quoteId: 'q-1', quantity: 1 })).rejects.toThrow(/was for 10/i);
        await expect(priceCart({ quoteId: 'q-1', quantity: 500 })).rejects.toThrow(/was for 10/i);
    });

    it('AND A QUOTE NOBODY ACCEPTED CANNOT BE SPENT', async () => {
        seedQuote({ status: 'pending' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/not responded/i);
    });

    it('AND A DECLINED ONE CANNOT', async () => {
        seedQuote({ status: 'declined' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/declined/i);
    });

    it('AND AN UNANSWERED COUNTER CANNOT — it says what to do about it', async () => {
        seedQuote({ status: 'countered', counterPrice: 900 });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/Accept or decline/i);
    });

    it('AND AN EXPIRED ONE CANNOT', async () => {
        //   A price agreed in March cannot be spent in December: the listing
        //   moves and the agreement does not.
        const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        accepted({ acceptedAt: longAgo });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/expired/i);
    });

    it('AND ONE ALREADY SPENT CANNOT BE SPENT TWICE', async () => {
        accepted({ consumedByOrderId: 'ORD-1' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/already been used/i);
    });

    it('AND A QUOTE THAT DOES NOT EXIST IS REFUSED, not ignored', async () => {
        /*
         *   REFUSING RATHER THAN QUIETLY REPRICING. Falling back to the list
         *   price would charge a total the buyer was never shown — the defect
         *   this whole function exists to prevent.
         */
        await expect(priceCart({ quoteId: 'no-such-quote' })).rejects.toThrow();
    });

    it('AND AN EXPORT-WINDOW QUOTE IS NOT A CART LINE', async () => {
        accepted({ subjectType: 'export_window' });

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/Export window/i);
    });

    it('AND A FLASH-SALE LINE CANNOT CARRY ONE — two discounts nobody agreed together', async () => {
        accepted();
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, PRODUCT, {
            id: PRODUCT, title: 'Ofada Rice', sellerId: SELLER, status: 'active',
            flashPrice: 700, availableQuantity: 100,
        });

        await expect(priceCart({ quoteId: 'q-1', isFlashSale: true }))
            .rejects.toThrow(/flash-sale/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — and it never raises a price', () => {
    it('A LISTING THAT FELL BELOW THE AGREED FIGURE WINS', async () => {
        /*
         *   Nobody should be punished for having negotiated. A buyer who agreed
         *   ₦800 and comes back to find the shelf at ₦600 pays ₦600.
         */
        seedProduct({ pricingTiers: [{ type: 'retail', price: 600, minQuantity: 1 }] });
        seedQuote({ status: 'accepted', agreedPrice: 800, acceptedAt: new Date().toISOString() });

        const { validatedItems } = await priceCart({ quoteId: 'q-1' });

        expect(validatedItems[0].pricePerUnit).toBe(600);
    });

    it('AND THE ORDER RECORDS WHY IT WAS CHARGED LESS', async () => {
        //   Without it the line says only what was paid, and nobody can tell
        //   afterwards whether ₦8,000 was a discount or a mistake.
        seedQuote({ status: 'accepted', agreedPrice: 800, acceptedAt: new Date().toISOString() });

        const { validatedItems } = await priceCart({ quoteId: 'q-1' });

        expect(validatedItems[0].quoteId).toBe('q-1');
        expect(validatedItems[0].listedPricePerUnit).toBe(LISTED);
    });

    it('AND AN ORDINARY LINE CARRIES NEITHER FIELD', async () => {
        const { validatedItems } = await priceCart();

        expect(validatedItems[0].quoteId).toBeUndefined();
        expect(validatedItems[0].listedPricePerUnit).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#873 — and a negotiated price is one purchase, not a standing discount', () => {
    it('SPENDING IT MARKS IT', async () => {
        seedQuote({ status: 'accepted', agreedPrice: 800, acceptedAt: new Date().toISOString() });
        const { markQuotesSpent } = await import('@/lib/marketplace-cart');

        await markQuotesSpent([{ quoteId: 'q-1' } as any], 'ORD-9');

        expect(quote().consumedByOrderId).toBe('ORD-9');
    });

    it('AND THEN THE CHECKOUT REFUSES IT', async () => {
        //   The two halves together, which is the claim: marked, then unusable.
        seedQuote({ status: 'accepted', agreedPrice: 800, acceptedAt: new Date().toISOString() });
        const { markQuotesSpent } = await import('@/lib/marketplace-cart');
        await markQuotesSpent([{ quoteId: 'q-1' } as any], 'ORD-9');

        await expect(priceCart({ quoteId: 'q-1' })).rejects.toThrow(/already been used/i);
    });

    it('AND MARKING NEVER THROWS — the order is already paid for by then', async () => {
        /*
         *   It runs AFTER the money has moved. A failure here must not surface
         *   as a failed checkout on an order that exists and is paid.
         */
        await expect(markSpentOnMissingQuote()).resolves.toBeUndefined();

        async function markSpentOnMissingQuote() {
            const { markQuotesSpent } = await import('@/lib/marketplace-cart');
            return markQuotesSpent([{ quoteId: 'gone' } as any], 'ORD-9');
        }
    });

    it('AND A LINE WITH NO QUOTE IS NOT TOUCHED', async () => {
        const { markQuotesSpent } = await import('@/lib/marketplace-cart');
        seedQuote();

        await markQuotesSpent([{ productId: PRODUCT } as any], 'ORD-9');

        expect(quote().consumedByOrderId).toBeUndefined();
    });
});
