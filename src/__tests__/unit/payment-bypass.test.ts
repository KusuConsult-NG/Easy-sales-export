/**
 * @jest-environment node
 */

/**
 * A payment bypass that existed in seventeen places.
 *
 * WHAT WAS THERE
 * --------------
 * The literal `"zeredogo@gmail.com"` appeared 17 times across 8 files —
 * cooperative onboarding, academy payment, module access, and two layouts —
 * each granting `paymentStatus = "completed"` or equivalent. The code called it
 * a "Unified Bypass". It was unified in name only.
 *
 * IS IT A VULNERABILITY? NO — AND THAT WAS CHECKED
 * -----------------------------------------------
 *   - no self-service action changes a user's email
 *   - registration rejects duplicates via adminAuth.getUserByEmail
 *   - /api/auth/register returns 404 in production
 *
 * An attacker cannot obtain the address, so nobody else can reach the bypass.
 * It is a deliberate owner/test account and it is left working.
 *
 * WHY CONSOLIDATE IT THEN
 * -----------------------
 * A security-relevant rule that exists seventeen times will eventually differ in
 * one of them — the defect this codebase has produced all week. Seventeen copies
 * also cannot be switched off: removing the bypass before a launch, or auditing
 * who holds it, means finding every one.
 *
 * Behaviour is deliberately unchanged. The default is exactly the address that
 * was hard-coded.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { isPaymentBypassAccount, paymentBypassEnabled } from '@/lib/payment-bypass';

const ORIGINAL = process.env.PAYMENT_BYPASS_EMAILS;

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAYMENT_BYPASS_EMAILS;
    else process.env.PAYMENT_BYPASS_EMAILS = ORIGINAL;
});

describe('the default preserves existing behaviour', () => {
    beforeEach(() => { delete process.env.PAYMENT_BYPASS_EMAILS; });

    it('still bypasses the account that was hard-coded', async () => {
        // THE test. If this fails, consolidating the seventeen copies has
        // silently revoked the owner's access.
        expect(isPaymentBypassAccount('zeredogo@gmail.com')).toBe(true);
    });

    it('bypasses nobody else', async () => {
        // Vacuity guard: a helper returning true for everyone would make the
        // assertion above pass and hand free membership to the platform.
        expect(isPaymentBypassAccount('someone@gmail.com')).toBe(false);
        expect(isPaymentBypassAccount('attacker@evil.example')).toBe(false);
    });

    it('is safe on a missing email', async () => {
        // session.user.email is optional in the NextAuth types, and several of
        // the seventeen call sites passed it straight through.
        expect(isPaymentBypassAccount(null)).toBe(false);
        expect(isPaymentBypassAccount(undefined)).toBe(false);
        expect(isPaymentBypassAccount('')).toBe(false);
    });

    it('matches regardless of case, which the originals did not', async () => {
        // The original comparisons were exact-match, so an account registered
        // as `Zeredogo@gmail.com` got no bypass at all — the feature silently
        // failed for the one account it exists for, depending on typing.
        //
        // Normalising is a fix, not a widening: an attacker still cannot hold
        // the address in any casing.
        expect(isPaymentBypassAccount('Zeredogo@Gmail.com')).toBe(true);
        expect(isPaymentBypassAccount('  zeredogo@gmail.com  ')).toBe(true);
    });

    it('does not match a plus-addressed variant', async () => {
        // Gmail delivers zeredogo+x@gmail.com to the same mailbox, but it is a
        // different account here and must not inherit the bypass.
        expect(isPaymentBypassAccount('zeredogo+free@gmail.com')).toBe(false);
    });
});

describe('it can now be switched off without a deploy', () => {
    it('an empty variable disables every bypass', async () => {
        // The point of consolidating. Seventeen literals could not be turned
        // off before a launch without finding all of them.
        process.env.PAYMENT_BYPASS_EMAILS = '';

        expect(isPaymentBypassAccount('zeredogo@gmail.com')).toBe(false);
        expect(paymentBypassEnabled()).toBe(false);
    });

    it('accepts a different account', async () => {
        process.env.PAYMENT_BYPASS_EMAILS = 'newowner@example.com';

        expect(isPaymentBypassAccount('newowner@example.com')).toBe(true);
        expect(isPaymentBypassAccount('zeredogo@gmail.com')).toBe(false);
    });

    it('accepts several, comma separated', async () => {
        process.env.PAYMENT_BYPASS_EMAILS = 'a@example.com, b@example.com';

        expect(isPaymentBypassAccount('a@example.com')).toBe(true);
        expect(isPaymentBypassAccount('b@example.com')).toBe(true);
        expect(isPaymentBypassAccount('c@example.com')).toBe(false);
    });
});

describe('the literal must not come back', () => {
    it('appears nowhere outside the one module that owns it', async () => {
        // A ratchet. The whole point is one place to look; a new copy would
        // undo it silently.
        const { readdirSync, readFileSync, statSync } = await import('fs');
        const { join, relative } = await import('path');

        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx)$/.test(entry)) continue;
                const rel = relative(process.cwd(), full);
                if (rel.includes('payment-bypass')) continue;
                if (readFileSync(full, 'utf-8').includes('zeredogo@gmail.com')) offenders.push(rel);
            }
        };
        walk(join(process.cwd(), 'src'));

        if (offenders.length > 0) {
            throw new Error(
                `\n\nThe bypass email is hard-coded again in:\n\n` +
                offenders.map((o) => `  ${o}`).join('\n') +
                `\n\nUse isPaymentBypassAccount() from src/lib/payment-bypass.ts.\n` +
                `It was in 17 places once; one place is the entire point.\n`
            );
        }
        expect(offenders).toEqual([]);
    });
});
