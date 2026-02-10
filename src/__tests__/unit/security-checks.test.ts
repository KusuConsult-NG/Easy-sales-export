/**
 * Unit Tests for Security Validation
 * 
 * Run with: npm run test -- security-checks.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Security Checks', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        // Reset environment before each test
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    describe('validateProductionSecrets', () => {
        it('should pass in development mode with weak secrets', async () => {
            process.env.NODE_ENV = 'development';
            process.env.NEXTAUTH_SECRET = 'demo-secret-key';

            const { validateProductionSecrets } = await import('@/lib/security-checks');

            // Should not throw
            expect(() => validateProductionSecrets()).not.toThrow();
        });

        it('should fail in production mode with weak secrets', async () => {
            process.env.NODE_ENV = 'production';
            process.env.NEXTAUTH_SECRET = 'demo-secret-key';
            process.env.MFA_SECRET_KEY = 'placeholder';
            process.env.QR_ENCRYPTION_KEY = 'test-secret';

            // Re-import to get fresh module with new env
            jest.resetModules();
            const { validateProductionSecrets } = await import('@/lib/security-checks');

            expect(() => validateProductionSecrets()).toThrow(/WEAK SECRETS DETECTED/);
        });

        it('should fail with short secrets in production', async () => {
            process.env.NODE_ENV = 'production';
            process.env.NEXTAUTH_SECRET = 'short';
            process.env.MFA_SECRET_KEY = 'short';
            process.env.QR_ENCRYPTION_KEY = 'short';

            jest.resetModules();
            const { validateProductionSecrets } = await import('@/lib/security-checks');

            expect(() => validateProductionSecrets()).toThrow(/too short/);
        });

        it('should pass with strong secrets in production', async () => {
            process.env.NODE_ENV = 'production';
            process.env.NEXTAUTH_SECRET = 'a'.repeat(64); // 64 character random string
            process.env.MFA_SECRET_KEY = 'b'.repeat(64);
            process.env.QR_ENCRYPTION_KEY = 'c'.repeat(64);

            jest.resetModules();
            const { validateProductionSecrets } = await import('@/lib/security-checks');

            expect(() => validateProductionSecrets()).not.toThrow();
        });
    });

    describe('validateRequiredEnvVars', () => {
        it('should fail when required vars are missing', async () => {
            process.env.NODE_ENV = 'production';
            delete process.env.NEXTAUTH_SECRET;
            delete process.env.PAYSTACK_SECRET_KEY;

            jest.resetModules();
            const { validateRequiredEnvVars } = await import('@/lib/security-checks');

            expect(() => validateRequiredEnvVars()).toThrow(/MISSING REQUIRED/);
        });
    });
});
