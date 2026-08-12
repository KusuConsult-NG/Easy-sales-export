/**
 * @jest-environment node
 */

/**
 * The negative-cart defect from #113, in the module that was not fixed with it.
 *
 * `initializeExportOrderPaymentAction` builds each line as
 *
 *     const pricePerMT = productData.pricePerMT || 0;
 *     const itemTotalUSD = pricePerMT * item.quantityMT;
 *
 * and checked neither factor — the same shape as `validateCartItems` before
 * #113, which I fixed in marketplace/_payment.ts and did not carry across.
 *
 * WORSE HERE THAN IN THE MARKETPLACE
 * ----------------------------------
 * The marketplace has a `minOrderAmount` floor, so a wholly negative order was
 * already refused there and the exploit needed a mixed cart. **This path has no
 * minimum at all.** Nothing bounded how far a negative line could pull the total
 * down.
 *
 * QUANTITY comes straight from the client. A negative one subtracts from the
 * order. It does not end in theft — decrementManyOrFail refuses a non-positive
 * amount, so verification throws at the stock step AFTER claimPaymentOnce has
 * claimed the reference — but that leaves the buyer charged, with no order, no
 * escrow and a spent reference that makes a retry a no-op.
 *
 * PRICE comes from the catalogue document, which submitExportProductAction
 * writes from an unvalidated `any` — no schema, no checks, the whole object
 * stored. A negative price needs an admin to approve the listing, and an admin
 * reviewing a product page has no particular reason to notice a minus sign.
 * After that, nothing downstream refuses it.
 *
 * FIXED IN BOTH PLACES
 * --------------------
 * At the boundary, because every export purchase passes through it; and at the
 * source, because a stored negative price should never exist. Same reasoning as
 * #113.
 *
 * Fractional tonnage is legitimate — 2.5 MT is a real order — so the quantity
 * check requires a positive finite number rather than an integer, unlike the
 * marketplace equivalent which counts whole units. Asserted below, because
 * copying the integer check across would have broken real orders.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const PRODUCT = 'exp-product-1';

const mockInitPaystack = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: jest.fn(),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getExchangeRates: jest.fn(async () => ({ usdToNgn: 1650 })),
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 0 })),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));
jest.mock('@/lib/audit-log', () => ({ createAdminAuditLog: jest.fn(async () => ({})) }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/** An approved, active catalogue product at the given price. */
function setProduct(overrides: Record<string, any> = {}) {
    const data = {
        name: 'Grade A Cocoa', pricePerMT: 2_500, isActive: true,
        userId: 'exporter-1', availableQuantityMT: 100, ...overrides,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
}

const buyerDetails = {
    companyName: 'A Co', contactPerson: 'A Person', email: 'b@e.com', phone: '0800',
    country: 'NG', portOfDestination: 'Lagos', shippingTerm: 'FOB', additionalNotes: '',
};

async function checkout(items: any[]) {
    const { initializeExportOrderPaymentAction } = await import('@/app/actions/export-payment');
    return initializeExportOrderPaymentAction(items as any, buyerDetails as any);
}

describe('export checkout — neither factor of the line total is trusted', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct();
        mockInitPaystack.mockResolvedValue({ authorizationUrl: 'https://pay', reference: 'ref-1' });
    });

    it('refuses a negative tonnage, and charges nothing', async () => {
        // THE test. With no minimum-order floor on this path, nothing else
        // stood between a negative line and the charge.
        const r: any = await checkout([{ productId: PRODUCT, quantityMT: -10, grade: 'A' }]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/invalid quantity/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a negative tonnage even when the order total stays positive', async () => {
        // The mixed cart, which is how this would actually be used.
        const r: any = await checkout([
            { productId: PRODUCT, quantityMT: 20, grade: 'A' },
            { productId: PRODUCT, quantityMT: -19, grade: 'A' },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a zero tonnage', async () => {
        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 0, grade: 'A' }]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('accepts fractional tonnage, which is a real order', async () => {
        // Deliberately NOT an integer check. Copying the marketplace's
        // Number.isInteger across would have refused 2.5 MT — a fix that broke
        // legitimate orders while looking identical in review.
        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 2.5, grade: 'A' }]);

        expect(r.success).toBe(true);
        // 2.5 MT × $2,500 × ₦1,650 = ₦10,312,500, in kobo.
        expect(mockInitPaystack).toHaveBeenCalled();
        const kobo = (mockInitPaystack.mock.calls[0] as any[])[1];
        expect(kobo).toBe(Math.round(2.5 * 2_500 * 1650 * 100));
    });

    it('refuses a product stored at a negative price', async () => {
        // Needs an admin to approve the listing — and then nothing downstream
        // refused it, because the quantity stays positive and the order
        // completes.
        setProduct({ pricePerMT: -2_500 });

        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 10, grade: 'A' }]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not priced/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a product with no price at all', async () => {
        // `productData.pricePerMT || 0` made an unpriced product free.
        setProduct({ pricePerMT: undefined });

        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 10, grade: 'A' }]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('still refuses a product that is not active', async () => {
        // Pre-existing guard; must survive the change.
        setProduct({ isActive: false });

        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 10, grade: 'A' }]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not available/i);
    });

    it('still charges a normal order the catalogue price', async () => {
        // Vacuity guard: every refusal above is satisfied by a checkout that
        // charges nobody, which would take the export module offline.
        const r: any = await checkout([{ productId: PRODUCT, quantityMT: 10, grade: 'A' }]);

        expect(r.success).toBe(true);
        const kobo = (mockInitPaystack.mock.calls[0] as any[])[1];
        expect(kobo).toBe(10 * 2_500 * 1650 * 100);
    });
});

describe('submitExportProductAction — an impossible price is refused at the source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct();
    });

    async function submit(overrides: Record<string, any> = {}) {
        const { submitExportProductAction } = await import('@/app/actions/export-products');
        return submitExportProductAction({ name: 'Cocoa', pricePerMT: 2_500, ...overrides });
    }

    function added(): Record<string, any>[] {
        return (global as any).mockFirestoreAdd.mock.calls.map((c: any[]) => c[c.length - 1]).filter(Boolean);
    }

    it('refuses a negative price', async () => {
        const r: any = await submit({ pricePerMT: -2_500 });

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('refuses a zero price', async () => {
        const r: any = await submit({ pricePerMT: 0 });

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('refuses a negative available quantity', async () => {
        const r: any = await submit({ availableQuantityMT: -50 });

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('accepts a normal submission', async () => {
        const r: any = await submit();

        expect(r.success).toBe(true);
        expect(added()[0]?.pricePerMT).toBe(2_500);
    });

    it('still forces the submitter, status and visibility', async () => {
        // Pre-existing and correct: the spread happens BEFORE these, so a
        // caller cannot self-approve a listing. Asserted so a later reordering
        // cannot silently undo it.
        await submit({ userId: 'somebody-else', status: 'live', isActive: true });

        const written = added()[0];
        expect(written?.userId).toBe(BUYER);
        expect(written?.status).toBe('pending');
        expect(written?.isActive).toBe(false);
    });
});
