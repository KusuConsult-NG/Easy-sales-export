/**
 * @jest-environment jsdom
 */

/**
 *   #580 THE MINIMUM ORDER WAS PRINTED ON EVERY CARD AND ENFORCED ON ONE DOOR.
 *
 *   `minOrderMT` is a REQUIRED input on both submission forms — the seller's
 *   /export/products/create and the admin's catalogue editor, each
 *   `required min={1}` — stored on every catalogue row, published by the public
 *   catalogue route, and drawn on every product card as "Min: 20 MT".
 *
 *   One place read it: the quantity stepper on the catalogue card, which clamps
 *   with Math.max(product.minOrderMT, ...) at every control, so a buyer cannot
 *   ADD less than the minimum.
 *
 *   TWO OTHER DOORS IGNORED IT.
 *
 *     THE CART'S OWN STEPPER. The sidebar on /export/buyer and the
 *     /export/buyer/cart page both step by `item.quantityMT - 5` with no floor.
 *     So a buyer who added 20 MT of cashews — the minimum, because the card
 *     would not let them add less — pressed minus twice and checked out with 10.
 *
 *     AND THE CHARGE. initializeExportOrderPaymentAction validated that the
 *     tonnage was a positive finite number and nothing else, so whatever
 *     survived the cart was priced and charged.
 *
 *   A rule shown to the buyer on every card, applied on one door in three:
 *   #38 / #179 / #183 / #324's shape, on an export order where the minimum is
 *   what makes a container load economic.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   AN ABSENT MINIMUM STILL MEANS NONE, deliberately, and for the same reason a
 *   missing ceiling means uncapped in migration 015: rows exist that predate
 *   the field, and inventing a floor for them would refuse orders nobody ever
 *   said were too small. Only a positive finite number is a minimum. That is
 *   asserted below, because a fix that quietly imposed a floor of 1 MT on every
 *   legacy row would look identical in review.
 *
 *   Removing a line is still the X button. Clamping the stepper means minus no
 *   longer walks a line down to zero and off the list, which is exactly how the
 *   catalogue card has always behaved.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     an absent minimum treated as 1                 KILLED (2 tests)
 *     the cart stepper clamp removed                 KILLED (1)
 *     the checkout minimum removed                   KILLED (1)
 *     a zero minimum treated as a minimum            KILLED (1)
 *     reword the finding comment                     SURVIVED, as intended
 *
 *   No mutant survived. One INSTRUMENT fault was found and is recorded at the
 *   import: @testing-library/react registers an afterEach on load, so
 *   importing it inside the helper made the first case that reached it fail
 *   while every later one passed — the module having been loaded by then.
 */

/**
 *   IMPORTED AT THE TOP, NOT INSIDE THE HELPER. @testing-library/react
 *   registers its own afterEach on load, and jest refuses a hook defined
 *   inside a running test — so the first case to reach a dynamic import failed
 *   while the ones after it passed, purely because the module was already
 *   loaded by then.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';

import { minimumOrderMT, clampToMinimumOrder } from '@/lib/export-minimum-order';

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
    markFulfilmentFailed: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getExchangeRates: jest.fn(async () => ({ usdToNgn: 1_650 })),
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 0 })),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));

// ─────────────────────────────────────────────────────────────────────────────
describe('#580 — what counts as a minimum', () => {
    it('A POSITIVE NUMBER IS ONE', () => {
        expect(minimumOrderMT({ minOrderMT: 20 })).toBe(20);
        //   A stored string is what an unvalidated `any` write leaves behind.
        expect(minimumOrderMT({ minOrderMT: '25' as any })).toBe(25);
        //   Fractional tonnage is a real order (see export-cart-price).
        expect(minimumOrderMT({ minOrderMT: 2.5 })).toBe(2.5);
    });

    it('AND NOTHING ELSE IS', () => {
        //   THE claim that keeps this from refusing legitimate orders on rows
        //   that predate the field.
        for (const value of [undefined, null, 0, -5, NaN, Infinity, 'twenty', {}, []]) {
            expect({ value, minimum: minimumOrderMT({ minOrderMT: value as any }) })
                .toEqual({ value, minimum: null });
        }
        expect(minimumOrderMT(null)).toBeNull();
        expect(minimumOrderMT(undefined)).toBeNull();
    });

    it('AND THE CLAMP ONLY EVER RAISES', () => {
        expect(clampToMinimumOrder({ minOrderMT: 20 }, 10)).toBe(20);
        expect(clampToMinimumOrder({ minOrderMT: 20 }, 25)).toBe(25);
        //   No minimum: the number is the buyer's.
        expect(clampToMinimumOrder({}, 1)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#580 — the cart cannot step below it', () => {
    /**
     * Through the real provider, because the finding is that the rule lives in
     * the one function both steppers call rather than in each of them.
     */
    async function cartWith(minOrderMT: number | undefined, quantityMT: number) {
        const { ExportCartProvider, useExportCart } = await import('@/contexts/ExportCartContext');

        const product = {
            id: 'cashew', name: 'Cashew Nuts', icon: '🥜', origin: 'Oyo', season: 'Feb',
            category: 'nuts', grades: ['W320'], certifications: [], pricePerMT: 2_850,
            minOrderMT: minOrderMT as any,
        };

        const { result } = renderHook(() => useExportCart(), {
            wrapper: ({ children }: any) =>
                React.createElement(ExportCartProvider, null, children),
        });

        await act(async () => { result.current.addToCart(product as any, quantityMT, 'W320'); });
        return { result };
    }

    beforeEach(() => { localStorage.clear(); });

    it('STEPPING DOWN STOPS AT THE MINIMUM', async () => {
        //   THE defect. Added at 20 because the card would not allow less, then
        //   walked down to 10 in the cart and charged for it.
        const { result } = await cartWith(20, 20);

        await act(async () => { result.current.updateQuantity('cashew', 15); });
        expect(result.current.cart[0].quantityMT).toBe(20);

        await act(async () => { result.current.updateQuantity('cashew', 10); });
        expect(result.current.cart[0].quantityMT).toBe(20);
    });

    it('AND GOING UP IS UNTOUCHED', async () => {
        //   Vacuity guard: a clamp that pinned the quantity would make the cart
        //   useless.
        const { result } = await cartWith(20, 20);

        await act(async () => { result.current.updateQuantity('cashew', 40); });
        expect(result.current.cart[0].quantityMT).toBe(40);
    });

    it('AND A PRODUCT WITH NO MINIMUM IS NOT GIVEN ONE', async () => {
        const { result } = await cartWith(undefined, 8);

        await act(async () => { result.current.updateQuantity('cashew', 1); });
        expect(result.current.cart[0].quantityMT).toBe(1);
    });

    it('AND THE X BUTTON STILL EMPTIES A LINE', async () => {
        //   Removal is removeFromCart, and a direct zero still removes — the
        //   clamp must not turn "delete this" into "hold it at 20".
        const { result } = await cartWith(20, 20);

        await act(async () => { result.current.updateQuantity('cashew', 0); });
        expect(result.current.cart).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#580 — and neither can the charge', () => {
    const BUYER_DETAILS = {
        companyName: 'A Co', contactPerson: 'A Person', email: 'b@e.com', phone: '0800',
        country: 'DE', portOfDestination: 'Hamburg', shippingTerm: 'CIF', additionalNotes: '',
    };

    /** An approved catalogue row at $2,850/MT with the given minimum. */
    function setCatalogue(minOrderMT: unknown) {
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({ name: 'Cashew Nuts', pricePerMT: 2_850, isActive: true, userId: 'x', minOrderMT }),
        }));
    }

    async function checkout(quantityMT: number) {
        const { initializeExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        return initializeExportOrderPaymentAction(
            [{ productId: 'cashew', quantityMT, grade: 'W320' }] as any,
            BUYER_DETAILS as any,
            //   #577's quote: the total the buyer was shown, so the minimum is
            //   what is being tested rather than the price guard.
            quantityMT * 2_850 * 1_650,
        ) as any;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'buyer-1', email: 'b@e.com', name: 'B', roles: [] } },
            error: null,
        }));
        mockInitPaystack.mockResolvedValue({ authorizationUrl: 'https://pay', reference: 'ref-1' });
    });

    it('AN ORDER UNDER THE MINIMUM IS REFUSED, AND CHARGES NOTHING', async () => {
        //   THE test. Whatever route the buyer took to 10 MT of a 20 MT
        //   product — the cart stepper, or a direct call to this endpoint —
        //   this is the door that takes the money.
        setCatalogue(20);

        const r = await checkout(10);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/minimum order of 20 MT/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND THE MINIMUM ITSELF IS ACCEPTED', async () => {
        //   Vacuity guard, and an off-by-one guard: `>` rather than `>=` would
        //   refuse the exact quantity the card tells buyers to order.
        setCatalogue(20);

        const r = await checkout(20);

        expect(r.success).toBe(true);
        expect(mockInitPaystack).toHaveBeenCalled();
    });

    it('AND A ROW WITH NO MINIMUM STILL SELLS ANY QUANTITY', async () => {
        //   Rows predate the field. Inventing a floor for them would refuse
        //   orders nobody ever said were too small.
        setCatalogue(undefined);

        const r = await checkout(1);

        expect(r.success).toBe(true);
    });

    it('AND A ZERO MINIMUM IS NOT A MINIMUM', async () => {
        setCatalogue(0);

        const r = await checkout(0.5);

        expect(r.success).toBe(true);
    });
});
