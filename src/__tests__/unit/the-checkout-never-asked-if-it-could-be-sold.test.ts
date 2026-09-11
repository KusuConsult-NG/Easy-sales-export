/**
 * @jest-environment node
 */

/**
 *   #647 THE CHECKOUT NEVER ASKED WHETHER THE GOODS COULD BE SOLD.
 *
 *   `validateCartItems` is the function every marketplace purchase passes
 *   through. It reads the product document out of the database — which is how a
 *   buyer is stopped from naming their own price — and then asked it three
 *   questions: is the quantity a positive whole number, does the chosen tier
 *   earn its price, is the stored price a real one.
 *
 *   It never asked the two questions a shop asks before it takes money:
 *
 *       MAY THIS BE SOLD?          the product's status was not read at all
 *       IS THERE ANY OF IT?        `availableQuantity` was not read at all
 *
 * ── WHAT THAT MEANT, IN ORDINARY TRAFFIC ────────────────────────────────────
 *
 *   The status question has four live answers, written by real doors today:
 *
 *     suspended / rejected   admin/marketplace/products, via reviewProductAction
 *     archived               the seller's own delete, through BOTH of its doors
 *     removed                a seller pulling a flash-sale item
 *
 *   #624 made PRODUCT_VISIBLE_STATUSES decide what a buyer may SEE, and fifteen
 *   catalogue queries ask it. Not one purchase door did. So an admin suspending
 *   a counterfeit listing took it out of the browse results and left it for
 *   sale: the cart lives in localStorage and is never re-read against the
 *   database, and `/marketplace/products/<id>` serves any product by id whatever
 *   its status, with Add to Cart enabled. A shared link kept selling a listing
 *   the platform had pulled.
 *
 *   The stock question is the same defect the EXPORT module already fixed. #582:
 *
 *       The only stock check on this path ran at FULFILMENT, after the payment
 *       reference was claimed — so a listing that really was short left the
 *       buyer charged, the order cancelled and a manual refund to arrange.
 *       Checked here too, where refusing costs nobody anything.
 *
 *   The marketplace's Paystack door never got it. The checkout's quantity
 *   stepper enforces a MINIMUM and no maximum, so a buyer could set 500 against
 *   three in stock, pay, and be told afterwards that it "sold out before your
 *   payment completed" — `paid_awaiting_refund`, a manual refund, and nothing
 *   raced at all. (The bank-transfer and pay-on-delivery doors reserve stock
 *   before they create anything, so they were already safe. The one that takes
 *   money first was the one with no check.)
 *
 * ── AND THE VOCABULARY WAS WRITTEN DOWN IN THREE PLACES ─────────────────────
 *
 *   `archived` is written by two delete doors and appears in NEITHER
 *   PRODUCT_STATUSES nor ProductSchema — so a status the code writes was not a
 *   status the code declared. The seller's own products page reads it through
 *   `configs[status] || configs.active` and labelled a deleted listing "Active".
 *
 *   ProductSchema now derives its enum from PRODUCT_STATUSES instead of
 *   restating it. Two hand-maintained copies of one contract is this audit's
 *   most repeated shape, and the copies had already drifted.
 *
 * ── BOTH HALVES OF `out_of_stock`, LANDED TOGETHER ──────────────────────────
 *
 *   #624 left this open with its reason: adding out_of_stock to the visible list
 *   alone would make an unfulfillable listing PURCHASABLE, which is worse than
 *   hiding it, and it moves money. So it waited for a checkout that refuses.
 *
 *   That is what this change is, so the pair lands: the status is visible now
 *   and it is not sellable. The presentation was already written — all three
 *   product cards and the detail page test `status === "out_of_stock"` — and
 *   could never fire, because the status was filtered out of every query that
 *   could have produced it. A rule nothing consults, and its mirror image: a
 *   treatment nothing can reach.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    PRODUCT_STATUSES,
    PRODUCT_VISIBLE_STATUSES,
    PRODUCT_SELLABLE_STATUSES,
    isSellableProductStatus,
    isSellableFlashSaleStatus,
} from '@/lib/product-status';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const PRODUCT = 'prod-1';

const mockInitPaystack = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: jest.fn(),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    restoreReservedStock: jest.fn(async () => ({})),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
    markFulfilmentFailed: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 1000, escrowFeePercent: 0, deliveryBaseFee: 2000 })),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));
jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderPlaced: jest.fn(async () => ({})),
    notifyPaymentReceived: jest.fn(async () => ({})),
    notifyVillageMarketCreated: jest.fn(async () => ({})),
}));
jest.mock('@/infrastructure/notifications/service', () => ({ createNotification: jest.fn(async () => ({})) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/** One product in the database, in whatever state the case needs. */
function setProduct(data: Record<string, any>) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: PRODUCT, ref: { id: PRODUCT }, data: () => data }],
        ref: { id: PRODUCT },
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** A listing that is genuinely for sale: the shape every refusal below departs from. */
const SELLABLE = {
    title: 'Cocoa', sellerId: SELLER, price: 50_000,
    availableQuantity: 100, status: 'active',
};

const location = { state: 'Lagos', city: 'Ikeja', street: '1 Road', isWithinCityCenter: true };
const GENEROUS_QUOTE = 1_000_000;

async function checkout(items: any[]) {
    const { initializeOrderPaymentAction } = await import('@/app/actions/marketplace/_payment_orders');
    return initializeOrderPaymentAction(
        items as any, 'buyer@e.com', '08030000000', GENEROUS_QUOTE, location as any,
    );
}

const oneOf = (extra: Record<string, any> = {}) => [
    { id: PRODUCT, title: 'Cocoa', quantity: 1, unit: 'kg', selectedTier: 'retail', sellerId: SELLER, ...extra },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — a listing that may not be sold is not sold', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct(SELLABLE);
        mockInitPaystack.mockResolvedValue({
            status: true, data: { authorization_url: 'https://pay', reference: 'ref-1' },
        });
    });

    it('ACCEPTS AN ORDINARY LISTING — the control, and it comes first', async () => {
        /*
         *   Every other case in this block is a refusal, and a function that
         *   refused EVERYTHING would satisfy all of them while closing the shop.
         *   This is the assertion that says the change did not do that.
         */
        const r: any = await checkout(oneOf());
        expect(r.success).toBe(true);
        expect(mockInitPaystack).toHaveBeenCalled();
    });

    it.each([
        ['suspended', /no longer available/i],
        ['rejected', /no longer available/i],
        ['archived', /no longer available/i],
        ['draft', /no longer available/i],
        ['pending', /no longer available/i],
        ['deleted', /no longer available/i],
        ['out_of_stock', /no longer available/i],
    ])('REFUSES A %s LISTING, AND CHARGES NOTHING', async (status, message) => {
        setProduct({ ...SELLABLE, status });

        const r: any = await checkout(oneOf());

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(message);
        //   The half that matters: the refusal has to happen BEFORE the buyer is
        //   sent to Paystack. A check that ran after the charge is the defect
        //   this finding is about, one step later.
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('REFUSES A FLASH-SALE ITEM THE SELLER HAS REMOVED', async () => {
        //   A second vocabulary — flash_sale_products is active/removed, not the
        //   product statuses — reached through the same one function.
        setProduct({ title: 'Cocoa', sellerId: SELLER, flashPrice: 40_000, price: 50_000, status: 'removed' });

        const r: any = await checkout(oneOf({ isFlashSale: true }));

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND STILL SELLS AN ACTIVE FLASH-SALE ITEM', async () => {
        //   The control for the flash vocabulary, for the same reason as above.
        setProduct({ title: 'Cocoa', sellerId: SELLER, flashPrice: 40_000, price: 50_000, availableQuantity: 10, status: 'active' });

        const r: any = await checkout(oneOf({ isFlashSale: true }));

        expect(r.success).toBe(true);
    });

    it('REFUSES A PRODUCT WITH NO STATUS RECORDED', async () => {
        /*
         *   An allow-list, not a list of bad states — which is how `archived`
         *   and `removed` came to be sellable in the first place: both were
         *   invented after the checks were written, and a deny-list would have
         *   missed the next one too.
         *
         *   Nothing legitimate is refused by this. Every catalogue query selects
         *   `status IN (...)`, so a row with no status has never been browsable,
         *   and a product that cannot be browsed cannot be in a cart.
         */
        const { status: _dropped, ...noStatus } = SELLABLE;
        setProduct(noStatus);

        const r: any = await checkout(oneOf());

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — and it is refused BEFORE the charge when there is not enough', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        mockInitPaystack.mockResolvedValue({
            status: true, data: { authorization_url: 'https://pay', reference: 'ref-1' },
        });
    });

    it('REFUSES AN ORDER LARGER THAN THE STOCK, NAMING WHAT IS LEFT', async () => {
        //   THE DEFECT. Not a race: three in stock, five hundred ordered, and
        //   the only thing that would have noticed ran after the money moved.
        setProduct({ ...SELLABLE, availableQuantity: 3 });

        const r: any = await checkout(oneOf({ quantity: 500 }));

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/only 3/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND SAYS "out of stock" WHEN THERE IS NONE AT ALL', async () => {
        //   "has only 0 left" is not a sentence to show a member.
        setProduct({ ...SELLABLE, availableQuantity: 0 });

        const r: any = await checkout(oneOf());

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/out of stock/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND ALLOWS AN ORDER FOR EXACTLY WHAT IS LEFT', async () => {
        //   The boundary, in the direction that matters: an off-by-one here
        //   refuses the last unit of every product in the shop.
        setProduct({ ...SELLABLE, availableQuantity: 3 });

        const r: any = await checkout(oneOf({ quantity: 3 }));

        expect(r.success).toBe(true);
    });

    it('AND DOES NOT REFUSE A LISTING THAT RECORDS NO STOCK AT ALL', async () => {
        /*
         *   #582's rule, and the reason it is written that way there: a missing
         *   field reads as zero, so "nobody is counting this listing" and "there
         *   is none left" are the same value. Refusing on a missing field would
         *   take every untracked listing off sale — the atomic decrement still
         *   guards the race, and this check only catches the ordinary case.
         *
         *   Flash-sale rows are explicitly nullable here: village-market stores
         *   `availableQuantity: null` when the seller leaves the field empty.
         */
        setProduct({ title: 'Cocoa', sellerId: SELLER, price: 50_000, status: 'active' });

        const r: any = await checkout(oneOf({ quantity: 999 }));

        expect(r.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — visible and sellable are two different questions', () => {
    it('out_of_stock IS VISIBLE NOW, AND IS NOT SELLABLE', () => {
        /*
         *   #624 pinned the opposite with its reason — "adding the status here
         *   alone would make an unfulfillable listing purchasable" — and that
         *   reason is spent: the checkout refuses it above. The two halves land
         *   together, which is exactly what that note asked for.
         */
        expect([...PRODUCT_VISIBLE_STATUSES]).toContain('out_of_stock');
        expect([...PRODUCT_SELLABLE_STATUSES]).not.toContain('out_of_stock');
        expect(isSellableProductStatus('out_of_stock')).toBe(false);
    });

    it('AND active IS BOTH', () => {
        expect([...PRODUCT_VISIBLE_STATUSES]).toContain('active');
        expect([...PRODUCT_SELLABLE_STATUSES]).toEqual(['active']);
        expect(isSellableProductStatus('active')).toBe(true);
    });

    it('AND NOTHING THAT IS SELLABLE IS INVISIBLE', () => {
        //   A listing a buyer may buy but may not see is a state with no
        //   meaning; if the two lists ever part in that direction it is a
        //   mistake rather than a decision.
        for (const s of PRODUCT_SELLABLE_STATUSES) {
            expect({ status: s, visible: PRODUCT_VISIBLE_STATUSES.includes(s) })
                .toEqual({ status: s, visible: true });
        }
    });

    it('AND THE FLASH VOCABULARY IS ITS OWN, stated rather than assumed', () => {
        expect(isSellableFlashSaleStatus('active')).toBe(true);
        expect(isSellableFlashSaleStatus('removed')).toBe(false);
        expect(isSellableFlashSaleStatus(undefined)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — the vocabulary is written down once', () => {
    it('archived IS DECLARED, because two doors write it', () => {
        //   It was written by both product-delete doors and declared by neither
        //   the constant nor the schema.
        expect([...PRODUCT_STATUSES]).toContain('archived');
        expect(isSellableProductStatus('archived')).toBe(false);
    });

    it('AND BOTH DELETE DOORS REALLY DO WRITE IT — a positive control', () => {
        /*
         *   Without this the assertion above is a statement about a list nobody
         *   uses. #301 fixed these two together and named the pair; they are
         *   still a pair.
         */
        expect(code('src/app/api/marketplace/delete-product/route.ts')).toContain('status: "archived"');
        expect(code('src/app/actions/marketplace/_mp_products.ts')).toContain('status: "archived"');
    });

    it('AND ProductSchema DERIVES ITS ENUM rather than restating it', () => {
        //   The two copies had already drifted — that is how `archived` became
        //   a status the code writes and the schema rejects.
        const src = code('src/lib/validations/marketplace.ts');
        expect(src).toContain('z.enum(PRODUCT_STATUSES)');

        /*
         *   Scoped to ProductSchema's own block. The first version of this
         *   assertion forbade `status: z.enum([` anywhere in the file and
         *   failed on OrderSchema — whose statuses are pending_payment,
         *   shipped, disputed and so on. That is a DIFFERENT vocabulary that
         *   happens to live under the same field name, and sweeping it up would
         *   have demanded a change with no meaning.
         */
        const from = src.indexOf('export const ProductSchema');
        const block = src.slice(from, src.indexOf('export const', from + 10));
        expect({ found: from > -1, restated: /status:\s*z\.enum\(\[/.test(block) })
            .toEqual({ found: true, restated: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — every purchase door asks', () => {
    it('THE THREE MARKETPLACE DOORS ALL GO THROUGH validateCartItems', () => {
        /*
         *   Paystack, bank transfer and pay-on-delivery. The check lives in the
         *   one function they share, so the thing to pin is that they still
         *   share it — three call sites, in one file.
         */
        const src = code('src/app/actions/marketplace/_payment_orders.ts');
        expect((src.match(/await validateCartItems\(/g) ?? []).length).toBe(3);
    });

    it('AND validateCartItems ASKS BOTH QUESTIONS', () => {
        //   Anchored on the calls, not on the import: a definition is not a use,
        //   and neither is an import (#629, #641, #645).
        const src = code('src/lib/marketplace-cart.ts');
        expect(src).toContain('isSellableFlashSaleStatus(productData?.status)');
        expect(src).toContain('isSellableProductStatus(productData?.status)');
        expect(src).toContain('stockOf(productData)');
    });

    it('AND THE FOURTH DOOR, WHICH DOES NOT USE IT, ASKS TOO', () => {
        /*
         *   actions/orders.ts::createOrderAction builds its own order without
         *   validateCartItems. It is called by no screen — and every export of a
         *   "use server" module is a reachable endpoint whether the app calls it
         *   or not, which this codebase already records elsewhere.
         *
         *   THIS ASSERTION IS NOT THE ONE THAT GUARDS IT. A mutant that kept the
         *   line and appended `&& false` survived this and nothing else caught
         *   it, because a source check asks whether a line EXISTS and the defect
         *   is about what it DOES. The real guard is behavioural and lives in
         *   order-stock-reservation.test.ts, where the action is executed
         *   against a suspended listing. This stays as the pointer to it.
         */
        const src = code('src/app/actions/orders.ts');
        expect(src).toContain('isSellableProductStatus(');
        expect(code('src/__tests__/unit/order-stock-reservation.test.ts'))
            .toContain("setProduct(5, 'suspended')");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#647 — and a pulled listing stops presenting as a live one', () => {
    it('THE DETAIL PAGE OFFERS NO PURCHASE FOR A STATUS THAT CANNOT BE SOLD', () => {
        /*
         *   The client tested `status === "out_of_stock"` alone, so a suspended
         *   or archived product — which the by-id read serves, because the
         *   seller's own edit screen needs it to — rendered an ordinary Add to
         *   Cart button.
         */
        const src = code('src/app/marketplace/products/[id]/ProductDetailClient.tsx');
        expect(src).toContain('const notForSale = !isSellableProductStatus(product.status);');
        //   And the button really consults it. "The file mentions the helper"
        //   is satisfied by an import; the disabled attribute is the thing that
        //   decides whether a member can act.
        expect(src).toContain('disabled={isAddingToCart || cannotBuy}');
        expect(src).toContain('const cannotBuy = notForSale || soldOut;');
    });

    it('AND THE BY-ID READ STOPS CALLING A REMOVED FLASH ITEM ACTIVE', () => {
        /*
         *   The flash branch built its mapped product with a hard-coded
         *   `status: "active"`, so a removed flash-sale row was served to the
         *   public page as a live listing no matter what it said. It is not
         *   served at all now — every other flash read already filters it out.
         */
        const src = code('src/app/actions/marketplace/_mp_catalog.ts');
        const guard = src.indexOf('isSellableFlashSaleStatus(doc.data()?.status)');
        //   The literal is still there and is now TRUE — which is only true
        //   because the guard runs first, so what has to be pinned is the
        //   order, not the literal's absence.
        const literal = src.indexOf('status: "active",');
        expect({ guarded: guard > -1, mapped: literal > -1 }).toEqual({ guarded: true, mapped: true });
        expect({ guardFirst: guard < literal }).toEqual({ guardFirst: true });
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the status check is removed                         KILLED
 *     THE DEFECT: the stock check is removed                          KILLED
 *     the status check becomes a deny-list that misses archived       KILLED
 *     the flash vocabulary is assumed to be the product one           KILLED
 *     the stock comparison is off by one, refusing the last unit      KILLED
 *     an unrecorded stock reads as ZERO, taking untracked off sale    KILLED
 *     the out-of-stock wording is lost ("has only 0 left")            KILLED
 *     out_of_stock quietly becomes sellable                           KILLED
 *     out_of_stock is dropped from the visible list again             KILLED
 *     a removed flash status is treated as sellable                   KILLED
 *     archived is undeclared again                                    KILLED
 *     the by-id read serves a removed flash row again                 KILLED
 *     the fourth door stops asking                                    KILLED
 *     the fourth door refuses but does not put the stock back         KILLED
 *     the detail page offers Add to Cart again                        KILLED
 *     ProductSchema restates the vocabulary again                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "The status check becomes a deny-list that misses archived" is the one this
 *   finding exists for. Both of the statuses that were sellable — `archived` and
 *   `removed` — were invented AFTER the checks around them were written, so a
 *   list of bad states would have been wrong again by the next release. That is
 *   why the check is an allow-list and why a row with no status is refused.
 *
 *   "An unrecorded stock reads as ZERO" fails in the opposite direction and is
 *   the one that would close the shop: a missing field reads as zero everywhere
 *   downstream, so treating absent as none-left takes every untracked listing
 *   off sale.
 *
 * ── TWO MUTANTS SURVIVED THE FIRST RUN ──────────────────────────────────────
 *
 *   ONE WAS MINE, AND IT WAS A NO-OP. It deleted `raw === undefined` from the
 *   stock reader — and `Number(undefined)` is NaN, which the very next line
 *   rejects, so the function returned null exactly as before. A mutant that
 *   changes no behaviour always survives and proves nothing. Rewritten to
 *   actually coerce a missing field to zero, it dies.
 *
 *   THE OTHER WAS A REAL GAP. The fourth purchase door was asserted only by
 *   `expect(src).toContain('isSellableProductStatus(')`, and the mutant kept
 *   that text while appending `&& false`. A source check asks whether a line
 *   EXISTS; the defect is about what the line DOES. The guard is behavioural
 *   now — order-stock-reservation.test.ts executes the action against a
 *   suspended listing — and the source check stays only as a pointer to it.
 *
 *   That gap also revealed a second one: nothing observed #613's reversal. A
 *   refusal that happens after the reservation must give the units back, or the
 *   listing bleeds stock on every attempt. `restoreReservedStock` was a bare
 *   mock in that file; it is a recorded call now.
 */
