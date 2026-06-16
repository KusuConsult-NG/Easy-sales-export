/**
 * @jest-environment node
 */

import { describe, it, expect, jest } from '@jest/globals';

// Mock next/cache to bypass unstable_cache issues in Jest environment
jest.mock('next/cache', () => ({
    unstable_cache: (fn: any) => fn,
}));

// Mock getPlatformFees
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(() => Promise.resolve({
        baseDeliveryFee: 1500,
        additionalItemFee: 200,
        minOrderAmount: 1000,
        maxOrderAmount: 500000,
    })),
}));

import { calculateDeliveryAction } from '@/app/actions/marketplace/_payment';

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

    it('calculates flat rate of 2000 for city center delivery under 10KM and under 5kg', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 5,
            weight: 3,
            isWithinCityCenter: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(2000);
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
            expect(result.data.fee).toBe(2100); // 2000 base + 5 * 20
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
            expect(result.data.fee).toBe(3000); // 2000 base + 1000 weight surcharge
        }
    });

    it('calculates outside city center surcharge: 3000 base fee instead of 2000', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 5,
            weight: 3,
            isWithinCityCenter: false, // 3000 base
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(3000);
        }
    });

    it('calculates complex case: outside city center, over distance and weight limits', async () => {
        const result = await calculateDeliveryAction(mockCartItems, {
            distance: 15, // 5KM over -> +100
            weight: 12, // 7kg over -> +1000
            isWithinCityCenter: false, // 3000 base
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.fee).toBe(4100); // 3000 base + 100 distance + 1000 weight
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
            expect(result.data.fee).toBe(2000);
        }
    });
});
