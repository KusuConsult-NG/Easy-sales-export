/**
 * @jest-environment node
 */

/**
 * Two money-handling routes validated their numbers with truthiness, which is
 * not a range check and is not a type check.
 *
 * THE NaN COMPARISON HOLE (/api/cooperative/apply-loan)
 * ----------------------------------------------------
 * `amount` came off a JSON body and was used raw. Every guard below it is a
 * COMPARISON, and a comparison against a non-number is false rather than an
 * error:
 *
 *     "abc" < product.minAmount   →  false   (not too small)
 *     "abc" > product.maxAmount   →  false   (not too large)
 *     "abc" * 2                   →  NaN
 *     totalSavings < NaN          →  false   (savings sufficient)
 *
 * So a non-numeric amount passed the range check AND the savings requirement.
 * What eventually stopped it was calculateRepaymentTerms throwing, which the
 * outer catch turned into a 500 "Internal server error" — by which point the
 * guards had already been bypassed. They were never the thing refusing.
 *
 * That distinction is why these tests assert on the STATUS AND ON THE ABSENCE
 * OF A WRITE, not just that the request did not succeed. Before the fix the
 * request also did not succeed; it failed for the wrong reason, at the wrong
 * place, and one tolerant refactor downstream from becoming a real hole.
 *
 * A missing product bound had the same shape: `x < undefined` is false, so a
 * loan product saved without minAmount/maxAmount accepted every amount.
 *
 * TRUTHINESS AS A RANGE CHECK (/api/marketplace/create-product)
 * ------------------------------------------------------------
 * `if (!retailPrice || !stockQuantity)` rejects exactly two values: 0 and NaN.
 * It accepts -100 and it accepts Infinity. A negative retail price went
 * straight into pricingTiers and from there into order totals; a negative
 * stockQuantity became availableQuantity, which checkout decrements against.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

declare const global: any;

const USER_ID = 'admin-id'; // matches jest.setup.js's default session

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Let every request through the limiter; this file is about validation.
jest.mock('@/lib/rate-limit', () => ({
    withRateLimit: (handler: any) => handler,
    rateLimit: async () => ({ success: true }),
    rateLimitConfig: { maxRequests: 100 },
}));

const mockUpload = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (...a: any[]) => mockUpload(...a),
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue('https://cdn.test/img.jpg');
});

// ─── /api/cooperative/apply-loan ──────────────────────────────────────────────

describe('POST /api/cooperative/apply-loan — amount validation', () => {
    const ACTIVE_MEMBER = {
        exists: true,
        data: () => ({
            userId: USER_ID,
            membershipStatus: 'active',
            paymentStatus: 'completed',
            savingsBalance: 1_000_000,
        }),
    };
    const PRODUCT = {
        exists: true,
        data: () => ({ name: 'Coop Loan', interestRate: 10, durationMonths: 12, minAmount: 5_000, maxAmount: 500_000 }),
    };

    /** doc().get() is keyed by id, collection().get() by collection name. */
    function routeReads(product: any = PRODUCT) {
        global.mockFirestoreGet.mockImplementation((key: string) => {
            if (key === USER_ID) return Promise.resolve(ACTIVE_MEMBER);
            if (key === 'prod-1') return Promise.resolve(product);
            if (key === 'loan_applications') return Promise.resolve({ empty: true, docs: [] });
            return Promise.resolve({ exists: false, data: () => undefined });
        });
    }

    async function apply(body: any) {
        const { POST } = await import('@/app/api/cooperative/apply-loan/route');
        return POST({ json: async () => body } as any);
    }

    const valid = {
        productId: 'prod-1',
        amount: 50_000,
        purpose: 'Working capital',
        guarantorName: 'Ada Obi',
        guarantorPhone: '+2348000000000',
    };

    it('accepts a well-formed application', async () => {
        // The positive control. Without it, every refusal below could be a
        // refusal for an unrelated reason and the file would prove nothing.
        routeReads();
        const res = await apply(valid);
        expect(res.status).toBe(200);
        expect(global.mockFirestoreSet).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-numeric amount with 400 and writes nothing', async () => {
        routeReads();
        const res = await apply({ ...valid, amount: 'abc' });
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects an amount sent as a digit string rather than storing it as text', async () => {
        // "50000" coerced through every comparison and would have been written
        // onto the application as a STRING, for approval and disbursement to do
        // arithmetic on later.
        routeReads();
        const res = await apply({ ...valid, amount: '50000' });
        expect(res.status).toBe(200);
        const written = global.mockFirestoreSet.mock.calls[0][1];
        expect(typeof written.amount).toBe('number');
        expect(written.amount).toBe(50_000);
    });

    it('rejects a negative amount', async () => {
        routeReads();
        const res = await apply({ ...valid, amount: -50_000 });
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects Infinity', async () => {
        routeReads();
        const res = await apply({ ...valid, amount: 1e400 });
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('refuses a product with no amount bounds instead of accepting any amount', async () => {
        // `x < undefined` and `x > undefined` are both false, so a product saved
        // without minAmount/maxAmount had no range at all — and the error
        // message it would have produced called .toLocaleString() on undefined.
        routeReads({ exists: true, data: () => ({ name: 'Broken', interestRate: 10, durationMonths: 12 }) });
        const res = await apply({ ...valid, amount: 999_999_999 });
        expect(res.status).toBe(409);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects a non-string guarantor name rather than throwing on .trim()', async () => {
        routeReads();
        const res = await apply({ ...valid, guarantorName: 12345 });
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });
});

// ─── /api/marketplace/create-product ──────────────────────────────────────────

describe('POST /api/marketplace/create-product — price and quantity validation', () => {
    const APPROVED_SELLER = {
        exists: true,
        data: () => ({ id: USER_ID, sellerVerificationStatus: 'approved', state: 'Lagos', lga: 'Ikeja' }),
    };

    function sellerReads() {
        global.mockFirestoreGet.mockResolvedValue(APPROVED_SELLER);
    }

    function form(overrides: Record<string, string> = {}) {
        const fd = new FormData();
        const base: Record<string, string> = {
            name: 'Sorghum, 50kg',
            category: 'grains',
            description: 'Clean, dried sorghum',
            unit: 'bag',
            minOrder: '10',
            stockQuantity: '200',
            retailPrice: '25000',
            ...overrides,
        };
        for (const [k, v] of Object.entries(base)) fd.set(k, v);
        return fd;
    }

    async function create(fd: FormData) {
        const { POST } = await import('@/app/api/marketplace/create-product/route');
        return POST({ formData: async () => fd } as any);
    }

    it('accepts a well-formed listing', async () => {
        sellerReads();
        const res = await create(form());
        expect(res.status).toBe(200);
        expect(global.mockFirestoreSet).toHaveBeenCalledTimes(1);
    });

    it('rejects a negative retail price and lists nothing', async () => {
        // -25000 is truthy, so `!retailPrice` accepted it and it went into
        // pricingTiers, which order totals are computed from.
        sellerReads();
        const res = await create(form({ retailPrice: '-25000' }));
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects a negative stock quantity', async () => {
        // stockQuantity is copied to availableQuantity, which checkout
        // decrements against.
        sellerReads();
        const res = await create(form({ stockQuantity: '-200' }));
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects a negative minimum order', async () => {
        // minOrder is multiplied by 5 and by 10 to derive the bulk and export
        // tier thresholds, so one bad value reaches three tiers.
        sellerReads();
        const res = await create(form({ minOrder: '-10' }));
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects an overflowing price', async () => {
        // parseCurrencyStringToFloat is parseFloat underneath, so "1e400" is
        // Infinity — truthy, and JSON.stringify writes it as null.
        sellerReads();
        const res = await create(form({ retailPrice: '1e400' }));
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('rejects a negative bulk price even though bulk is optional', async () => {
        // bulk and export default to 0 when absent, so they skip the truthiness
        // check entirely — 0 means "not offered". A negative value is not the
        // same thing and must still be refused.
        sellerReads();
        const res = await create(form({ bulkPrice: '-5000' }));
        expect(res.status).toBe(400);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });

    it('still refuses a seller who is not approved', async () => {
        // The guard that was already there. Kept so the added validation cannot
        // be mistaken for the only thing standing between a caller and a write.
        global.mockFirestoreGet.mockResolvedValue({
            exists: true,
            data: () => ({ id: USER_ID, sellerVerificationStatus: 'pending' }),
        });
        const res = await create(form());
        expect(res.status).toBe(403);
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
    });
});
