/**
 * @jest-environment node
 */

/**
 *   #392 THIS SUITE'S MOCKS HAD NEVER TAKEN EFFECT.
 *
 *        Both jest.mock calls below sat under `import { ..., jest } from
 *        '@jest/globals'`. jest.mock is hoisted above the imports only when
 *        `jest` is the GLOBAL; taking it from @jest/globals defeats the hoist,
 *        so @/app/actions/marketplace/_payment_orders was loaded first and
 *        pulled in the REAL system-settings behind it. Measured with a pair of
 *        one-line probes, not assumed.
 *
 *        So this suite has been asserting the PRODUCTION DEFAULT — 2000 —
 *        while its own mock said 1500 and nobody noticed, because
 *        DEFAULT_DELIVERY_FEES.baseDeliveryFee happens to be 2000. It proved
 *        the formula against one hardcoded configuration, which is precisely
 *        what it was written to avoid; #317 made the base fee editable from an
 *        admin screen, so "whatever the default is" is not the number a buyer
 *        pays.
 *
 *        The mock now applies, it supplies EVERY delivery field rather than
 *        two, and every expectation below is derived from FEES rather than
 *        typed as a literal — so a changed rule fails the suite and a changed
 *        default does not.
 */

import { describe, it, expect } from '@jest/globals';

/** The configured fees this suite tests the formula against. */
const FEES = {
    baseDeliveryFee: 1500,
    outsideCityDeliveryFee: 2400,
    additionalItemFee: 200,
    freeDistanceKm: 10,
    distanceSurchargePerKm: 20,
    freeWeightKg: 5,
    weightSurchargeStepKg: 5,
    weightSurchargeAmount: 500,
    minOrderAmount: 1000,
    maxOrderAmount: 500000,
};

// Mock next/cache to bypass unstable_cache issues in Jest environment
jest.mock('next/cache', () => ({
    unstable_cache: (fn: any) => fn,
}));

// Deliberately NOT `jest.fn(() => ...)` closing over FEES: the hoisted factory
// runs before this module's top-level const, so the object is inlined.
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(() => Promise.resolve({
        baseDeliveryFee: 1500,
        outsideCityDeliveryFee: 2400,
        additionalItemFee: 200,
        freeDistanceKm: 10,
        distanceSurchargePerKm: 20,
        freeWeightKg: 5,
        weightSurchargeStepKg: 5,
        weightSurchargeAmount: 500,
        minOrderAmount: 1000,
        maxOrderAmount: 500000,
    })),
}));

import { calculateDeliveryAction } from '@/app/actions/marketplace/_payment_orders';

describe('calculateDeliveryAction Unit Tests', () => {
    const mockCartItems = [
        {
            id: 'item-1',
            title: 'Yam Tubers',
            sellerId: 'seller-1',
            price: 1000,
            quantity: 3,
            unit: 'kg',
            selectedTier: 'retail' as const,
            addedAt: new Date(),
        }
    ];

    it('charges the configured base inside the city, under both free limits', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 5,
            weight: 3,
            isWithinCityCenter: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(FEES.baseDeliveryFee);
        }
    });

    it('calculates distance surcharge: +20 per KM above 10KM', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 15,
            weight: 3,
            isWithinCityCenter: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            // base + 5km over the free distance
            expect(result.data.fee).toBe(
                FEES.baseDeliveryFee + 5 * FEES.distanceSurchargePerKm,
            );
        }
    });

    it('calculates weight surcharge: +500 per additional 5kg above 5kg', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 8,
            weight: 12, // 7kg over limit -> Math.ceil(7 / 5) = 2 blocks of 500 -> +1000
            isWithinCityCenter: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            // base + ceil(7 / 5) = 2 weight blocks
            expect(result.data.fee).toBe(
                FEES.baseDeliveryFee + 2 * FEES.weightSurchargeAmount,
            );
        }
    });

    it('charges outsideCityDeliveryFee, not baseDeliveryFee, outside the city', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 5,
            weight: 3,
            isWithinCityCenter: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            // The whole point of the separate field: this must NOT be the base.
            expect(result.data.fee).toBe(FEES.outsideCityDeliveryFee);
            expect(result.data.fee).not.toBe(FEES.baseDeliveryFee);
        }
    });

    it('calculates complex case: outside city center, over distance and weight limits', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 15, // 5KM over -> +100
            weight: 12, // 7kg over -> +1000
            isWithinCityCenter: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(
                FEES.outsideCityDeliveryFee
                + 5 * FEES.distanceSurchargePerKm
                + 2 * FEES.weightSurchargeAmount,
            );
        }
    });

    it('falls back to estimated weight from items if not provided', async () => {
        // mockCartItems: 3 * 1kg = 3kg
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 5,
            isWithinCityCenter: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(FEES.baseDeliveryFee);
        }
    });
});
