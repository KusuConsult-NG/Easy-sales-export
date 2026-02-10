/**
 * Integration Tests for Paystack Bank Verification
 * 
 * These tests verify the Paystack API integration works correctly
 * 
 * Run with: npm run test -- paystack.test.ts
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { getBankList, verifyBankAccount } from '@/app/actions/paystack';

describe('Paystack Integration', () => {
    describe('getBankList', () => {
        it('should fetch list of Nigerian banks', async () => {
            const result = await getBankList();

            expect(result.success).toBe(true);
            expect(result.banks).toBeDefined();
            expect(Array.isArray(result.banks)).toBe(true);

            if (result.banks && result.banks.length > 0) {
                const firstBank = result.banks[0];
                expect(firstBank).toHaveProperty('id');
                expect(firstBank).toHaveProperty('name');
                expect(firstBank).toHaveProperty('code');
                expect(firstBank).toHaveProperty('slug');
            }
        });

        it('should include major Nigerian banks', async () => {
            const result = await getBankList();

            if (result.success && result.banks) {
                const bankNames = result.banks.map(b => b.name.toLowerCase());

                // Check for some major banks
                const hasMajorBank = bankNames.some(name =>
                    name.includes('access') ||
                    name.includes('gtbank') ||
                    name.includes('zenith') ||
                    name.includes('first bank')
                );

                expect(hasMajorBank).toBe(true);
            }
        });
    });

    describe('verifyBankAccount', () => {
        it('should reject invalid account number format', async () => {
            const result = await verifyBankAccount('123', '044');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toContain('10 digits');
        });

        it('should reject empty inputs', async () => {
            const result = await verifyBankAccount('', '');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle network errors gracefully', async () => {
            // Test with invalid bank code to trigger API error
            const result = await verifyBankAccount('0123456789', 'INVALID_CODE');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        // NOTE: To test actual verification, you need a valid test account
        // Uncomment and update with a real test account number
        // it('should verify valid test account', async () => {
        //     const result = await verifyBankAccount('0123456789', '044');
        //     
        //     if (result.success) {
        //         expect(result.accountName).toBeDefined();
        //         expect(typeof result.accountName).toBe('string');
        //         expect(result.accountName.length).toBeGreaterThan(0);
        //     }
        // });
    });
});
