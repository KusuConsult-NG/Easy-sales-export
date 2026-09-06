/**
 * Unit Tests for Security Validation
 * 
 * Run with: npm run test -- security-checks.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// Import once — validateProductionSecrets reads process.env at call time, not at import time
import { validateProductionSecrets, validateRequiredEnvVars } from '@/lib/security-checks';

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

    /**
     *   #441 TWO OF THESE FOUR TESTS ASSERTED NOTHING AT ALL, AND THE OTHER TWO
     *   ASSERTED SOMETHING THAT CANNOT HAPPEN.
     *
     * Found by a sweep for tests that cannot fail across all 571 suite files.
     * It returned exactly two: both were here, and both had
     * `expect(true).toBe(true)` as their only assertion, under names that
     * describe production security behaviour —
     *
     *     should fail in production mode with known-weak secret patterns
     *     should fail in production with secrets under 32 characters
     *
     * THE STATED REASON WAS FALSE, AND THIS FILE DISPROVED IT TWENTY LINES
     * LATER. The comment read: "Next.js's jest config (next/jest) sets
     * NODE_ENV=test and makes it read-only. We cannot override NODE_ENV to
     * 'production' within Jest's runner." The validateRequiredEnvVars test below
     * does exactly `(process.env as any).NODE_ENV = 'production'` and has always
     * passed. Measured directly before changing anything: the assignment works.
     *
     * AND THE OTHER TWO WERE VACUOUS IN A SUBTLER WAY. They asserted
     * `.not.toThrow()` on a function whose own source says it must NEVER throw —
     * it runs at module scope in the root layout, where throwing would crash
     * every Server Component render. So they passed for weak secrets and strong
     * ones alike. Four tests, no coverage of the behaviour they are named for.
     *
     * The function returns its findings now (it still logs, and still does not
     * throw — that part was right), so these can assert what it actually
     * decided.
     *
     * Mutation-tested: making validateProductionSecrets return [] regardless
     * kills four of these. Against the old ones it killed none.
     */
    describe('validateProductionSecrets', () => {
        function inProduction(secrets: Record<string, string | undefined>): string[] {
            (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
            for (const [key, value] of Object.entries(secrets)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            return validateProductionSecrets();
        }

        it('SAYS NOTHING IN DEVELOPMENT, EVEN FOR THE WEAKEST SECRETS', () => {
            (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
            process.env.NEXTAUTH_SECRET = 'demo-secret-key';
            process.env.MFA_SECRET_KEY = 'placeholder';
            process.env.QR_ENCRYPTION_KEY = 'test-secret';

            // The check is deliberately production-only. An empty list here
            // means "not checked", which is why the screen renders it as
            // nothing rather than as a clean bill of health.
            expect(validateProductionSecrets()).toEqual([]);
        });

        it('REPORTS EACH KNOWN-WEAK PATTERN IN PRODUCTION, BY VARIABLE NAME', () => {
            const findings = inProduction({
                NEXTAUTH_SECRET: 'demo-secret-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                MFA_SECRET_KEY: 'placeholder-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                QR_ENCRYPTION_KEY: 'c'.repeat(64),
            });

            // Long enough to pass the length rule, so this isolates the pattern
            // rule rather than passing for the other reason.
            expect(findings).toEqual([
                'NEXTAUTH_SECRET contains weak pattern: "demo-secret-key"',
                'MFA_SECRET_KEY contains weak pattern: "placeholder"',
            ]);
        });

        it('REPORTS A SECRET UNDER 32 CHARACTERS IN PRODUCTION', () => {
            const findings = inProduction({
                NEXTAUTH_SECRET: 'a'.repeat(31),
                MFA_SECRET_KEY: 'b'.repeat(64),
                QR_ENCRYPTION_KEY: 'c'.repeat(64),
            });

            expect(findings).toEqual(['NEXTAUTH_SECRET is too short (minimum 32 characters)']);
        });

        it('and reports one that is not set at all', () => {
            const findings = inProduction({
                NEXTAUTH_SECRET: undefined,
                MFA_SECRET_KEY: 'b'.repeat(64),
                QR_ENCRYPTION_KEY: 'c'.repeat(64),
            });

            expect(findings).toEqual(['NEXTAUTH_SECRET is not set']);
        });

        it('SAYS NOTHING FOR STRONG SECRETS IN PRODUCTION', () => {
            const findings = inProduction({
                NEXTAUTH_SECRET: 'a'.repeat(64),
                MFA_SECRET_KEY: 'b'.repeat(64),
                QR_ENCRYPTION_KEY: 'c'.repeat(64),
            });

            expect(findings).toEqual([]);
        });

        it('and NEVER THROWS — it runs at module scope in the root layout', () => {
            // The non-throwing behaviour is correct and is pinned, not removed.
            // Throwing here would crash every Server Component render.
            expect(() => inProduction({
                NEXTAUTH_SECRET: 'demo-secret',
                MFA_SECRET_KEY: undefined,
                QR_ENCRYPTION_KEY: '',
            })).not.toThrow();
        });

        it('and never puts a secret VALUE in a finding', () => {
            // The strings reach an admin screen. They name the variable and the
            // weakness; the secret itself must not travel with them.
            const secret = 'placeholder-super-secret-value-do-not-leak-me-0123';
            const findings = inProduction({
                NEXTAUTH_SECRET: secret,
                MFA_SECRET_KEY: 'b'.repeat(64),
                QR_ENCRYPTION_KEY: 'c'.repeat(64),
            });

            expect(findings).toHaveLength(1);
            expect(findings[0]).not.toContain(secret);
            expect(findings[0]).toContain('NEXTAUTH_SECRET');
        });

        it('PROVES THE PREMISE THE OLD SKIP RESTED ON WAS FALSE', () => {
            // "We cannot override NODE_ENV to 'production' within Jest's
            // runner." Measured, rather than argued about.
            (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
            expect(process.env.NODE_ENV).toBe('production');
        });
    });

    describe('validateRequiredEnvVars', () => {
        it('should fail when required vars are missing', () => {
            (process.env as any).NODE_ENV = 'production';
            delete process.env.NEXTAUTH_SECRET;
            delete process.env.PAYSTACK_SECRET_KEY;

            expect(() => validateRequiredEnvVars()).toThrow(/MISSING REQUIRED/);
        });
    });
});
