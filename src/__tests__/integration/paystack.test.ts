/**
 * Integration Tests for Paystack Bank Verification
 * 
 * These tests verify the Paystack API integration works correctly
 * 
 * Run with: npm run test -- paystack.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Use global jest to ensure hoisting works correctly with SWC
jest.mock('@/lib/session-guard', () => ({
    requireSession: jest.fn().mockResolvedValue({
        success: true,
        error: null,
        data: { user: { id: 'test-user', email: 'test@example.com' } }
    })
}));

jest.mock('../../lib/session-guard', () => ({
    requireSession: jest.fn().mockResolvedValue({
        success: true,
        error: null,
        data: { user: { id: 'test-user', email: 'test@example.com' } }
    })
}));

import { getBankList, verifyBankAccount } from '@/app/actions/paystack';

// Mock global fetch for Paystack API calls
const originalFetch = global.fetch;
beforeAll(() => {
    process.env.PAYSTACK_SECRET_KEY = 'mock_secret_key';
    
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
        if (url.includes('api.paystack.co/bank?country=nigeria')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    status: true,
                    message: 'Banks retrieved',
                    data: [
                        { id: 1, name: 'Access Bank', code: '044', slug: 'access-bank' },
                        { id: 2, name: 'Guaranty Trust Bank', code: '058', slug: 'gtbank' }
                    ]
                })
            } as any);
        }
        if (url.includes('api.paystack.co/bank/resolve')) {
            if (url.includes('bank_code=INVALID_CODE') || url.includes('account_number=0123456789')) {
                return Promise.resolve({
                    ok: false,
                    status: 400,
                    json: () => Promise.resolve({
                        status: false,
                        message: 'Could not resolve account name'
                    })
                } as any);
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    status: true,
                    message: 'Account resolved',
                    data: {
                        account_number: '0123456789',
                        account_name: 'JOHN DOE',
                        bank_id: 1
                    }
                })
            } as any);
        }
        return originalFetch ? originalFetch(url, options) : Promise.reject(new Error('Fetch not mocked'));
    }) as any;
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe('Paystack Integration', () => {
    describe('getBankList', () => {
        it('should fetch list of Nigerian banks', async () => {
            const result = await getBankList();

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data?.banks).toBeDefined();
                expect(Array.isArray(result.data?.banks)).toBe(true);

                if (result.data?.banks && result.data.banks.length > 0) {
                    const firstBank = result.data.banks[0];
                    expect(firstBank).toHaveProperty('id');
                    expect(firstBank).toHaveProperty('name');
                    expect(firstBank).toHaveProperty('code');
                    expect(firstBank).toHaveProperty('slug');
                }
            }
        });

        it('should include major Nigerian banks', async () => {
            const result = await getBankList();

            if (result.success && result.data?.banks) {
                const bankNames = (result.data.banks as any[]).map((b: any) => b.name.toLowerCase());

                // Check for some major banks
                const hasMajorBank = bankNames.some((name: string) =>
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
            if (!result.success) {
                expect(result.error).toBeDefined();
                expect(result.error).toContain('10 digits');
            }
        });

        it('should reject empty inputs', async () => {
            const result = await verifyBankAccount('', '');

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBeDefined();
            }
        });

        it('should handle network errors gracefully', async () => {
            // Test with invalid bank code to trigger API error
            const result = await verifyBankAccount('0123456789', 'INVALID_CODE');

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBeDefined();
            }
        });

        // NOTE: To test actual verification, you need a valid test account
        // Uncomment and update with a real test account number
        // it('should verify valid test account', async () => {
        //     const result = await verifyBankAccount('0123456789', '044');
        //     
        //     if (result.success) {
        //         expect(result.data?.accountName).toBeDefined();
        //         expect(typeof result.data?.accountName).toBe('string');
        //         expect(result.data?.accountName.length).toBeGreaterThan(0);
        //     }
        // });
    });
});
