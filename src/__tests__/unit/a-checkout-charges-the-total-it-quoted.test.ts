/**
 * @jest-environment node
 */

/**
 *   #577 THE ACTION HALF — A CHECKOUT CHARGES THE TOTAL IT QUOTED, OR NOTHING.
 *
 *   The finding, the reasoning and what is NOT claimed are in the screen half:
 *   src/__tests__/unit/the-price-shown-is-the-price-charged.test.tsx. In short,
 *   /export/buyer/cart converted the order to naira at a constant in the
 *   browser while this action charges at `getExchangeRates().usdToNgn`, an
 *   owner-editable setting — so the buyer approved one number and Paystack
 *   debited another the moment the two diverged.
 *
 *   Split from that suite for a mechanical reason, not a conceptual one: the
 *   screen half mocks '@/app/actions/export-payment' to watch what the browser
 *   sends, and a file-level mock of the module under test would leave this half
 *   asserting against a jest.fn().
 *
 *   MUTATION-TESTED, WITH A CONTROL — the table is in the screen half.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockInitPaystack = jest.fn() as jest.Mock<any>;
const mockRates = jest.fn(async () => ({ usdToNgn: 1_650 })) as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: jest.fn(),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
    markFulfilmentFailed: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getExchangeRates: () => mockRates(),
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 0 })),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));

const BUYER_DETAILS = {
    companyName: 'A Co', contactPerson: 'A Person', email: 'b@e.com', phone: '0800',
    country: 'DE', portOfDestination: 'Hamburg', shippingTerm: 'CIF', additionalNotes: '',
};

/** $2,500/MT × 10 MT — the same basket the screen above holds. */
function setCatalogue(pricePerMT = 2_500) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({ name: 'Cocoa Beans', pricePerMT, isActive: true, userId: 'exporter-1' }),
    }));
}

async function checkout(quotedTotalNGN: number) {
    const { initializeExportOrderPaymentAction } = await import('@/app/actions/export-payment');
    return initializeExportOrderPaymentAction(
        [{ productId: 'cocoa', quantityMT: 10, grade: 'A' }] as any,
        BUYER_DETAILS as any,
        quotedTotalNGN,
    ) as any;
}

describe('#577 — the action charges the quoted total or nothing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'buyer-1', email: 'b@e.com', name: 'B', roles: [] } },
            error: null,
        }));
        setCatalogue();
        mockRates.mockResolvedValue({ usdToNgn: 1_650 });
        mockInitPaystack.mockResolvedValue({ authorizationUrl: 'https://pay', reference: 'ref-1' });
    });

    it('A QUOTE THAT MATCHES IS CHARGED', async () => {
        //   The vacuity guard, first: every refusal below is satisfied by an
        //   action that refuses everything.
        const r = await checkout(25_000 * 1_650);

        expect(r.success).toBe(true);
        expect(mockInitPaystack).toHaveBeenCalled();
        expect((mockInitPaystack.mock.calls[0] as any[])[1]).toBe(25_000 * 1_650 * 100);
    });

    it('A QUOTE AT THE OLD RATE IS REFUSED, AND NOTHING IS CHARGED', async () => {
        //   THE defect. The screen said ₦41,250,000 at its hard-coded 1,650;
        //   the owner had moved the rate to 1,900 and Paystack would have taken
        //   ₦47,500,000.
        mockRates.mockResolvedValue({ usdToNgn: 1_900 });

        const r = await checkout(25_000 * 1_650);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
        expect(String(r.error)).toMatch(/₦47,500,000/);
    });

    it('AND THE REFUSAL CARRIES THE PRICE THE SERVER ACTUALLY HOLDS', async () => {
        mockRates.mockResolvedValue({ usdToNgn: 1_900 });

        const r = await checkout(25_000 * 1_650);

        expect(r.meta.quote).toEqual({
            totalUSD: 25_000, totalNGN: 25_000 * 1_900, usdToNgn: 1_900,
        });
    });

    it('AND A CATALOGUE PRICE THAT MOVED IS REFUSED THE SAME WAY', async () => {
        //   The other half of the drift: the cart holds a price snapshotted
        //   when the item was added, and the rate never changed.
        setCatalogue(2_600);

        const r = await checkout(25_000 * 1_650);

        expect(r.success).toBe(false);
        expect(r.meta.quote.totalUSD).toBe(26_000);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND A ONE-NAIRA DIFFERENCE IS A DIFFERENCE', async () => {
        //   The tolerance is one KOBO, for floating-point noise on the
        //   multiplication. Anything a person could notice is a refusal.
        const r = await checkout(25_000 * 1_650 + 1);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND FLOATING-POINT NOISE IS NOT', async () => {
        //   The other side of that: refusing a hundredth of a kobo would make
        //   fractional tonnage unpayable, which is a real order (see
        //   export-cart-price).
        const r = await checkout(25_000 * 1_650 + 0.004);

        expect(r.success).toBe(true);
        expect(mockInitPaystack).toHaveBeenCalled();
    });

    it('AND AN ORDER WITH NO QUOTE AT ALL IS REFUSED', async () => {
        //   This action is an independently addressable endpoint. A caller that
        //   states no total cannot have shown one.
        const r = await checkout(undefined as any);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });
});
