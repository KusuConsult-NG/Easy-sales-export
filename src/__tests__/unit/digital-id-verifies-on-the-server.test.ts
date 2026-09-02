/**
 * @jest-environment node
 */

/**
 *   #344 THE DIGITAL ID VERIFIER RAN IN THE BROWSER, AGAINST A KEY THE BROWSER
 *        DOES NOT HAVE — AND HAD A DEFAULT KEY TO FALL BACK ON.
 *
 *        lib/digital-id.ts signs and encrypts a member's ID card with
 *        process.env.QR_ENCRYPTION_KEY, falling back to the literal
 *        'default-qr-secret-change-in-production'. Two doors verify a card:
 *
 *          /verify-id/scan   POSTs to /api/qr/verify — server-side, the real
 *                            key, an admin check, an audit row per attempt.
 *          /verify-id        called verifyDigitalIDQR() DIRECTLY, in a
 *                            "use client" component. QR_ENCRYPTION_KEY is not
 *                            NEXT_PUBLIC_, so in the client bundle it is
 *                            undefined and the fallback was used — every
 *                            genuine card read as "Invalid QR code", and a
 *                            card forged with the public default read as
 *                            valid. Broken by construction, both ways.
 *
 *        Same shape as #169 (MFA_SECRET_KEY's default) and #339 (two doors,
 *        one hardened). The page now uses the route, and the module refuses to
 *        run without the key.
 *
 *        Nothing in the product yet calls generateDigitalIDCard, so no real
 *        card has been issued — recorded rather than repaired, because wiring
 *        the generator is a feature, not a fix.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const KEY = 'a-test-key-that-is-at-least-thirty-two-chars-long';
const saved = process.env.QR_ENCRYPTION_KEY;

beforeEach(() => { process.env.QR_ENCRYPTION_KEY = KEY; });
afterEach(() => {
    if (saved === undefined) delete process.env.QR_ENCRYPTION_KEY;
    else process.env.QR_ENCRYPTION_KEY = saved;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#344 — the module refuses to run without its key', () => {
    it('VERIFY THROWS, naming the variable, when QR_ENCRYPTION_KEY is unset', async () => {
        // THE test. This used to fall back to a string in the source.
        delete process.env.QR_ENCRYPTION_KEY;
        const { verifyDigitalIDQR } = await import('@/lib/digital-id');

        expect(() => verifyDigitalIDQR('anything')).toThrow(/QR_ENCRYPTION_KEY/);
    });

    it('and so does the generator', async () => {
        delete process.env.QR_ENCRYPTION_KEY;
        const { generateDigitalIDQR } = await import('@/lib/digital-id');

        await expect(generateDigitalIDQR('u1', 'ESE-2026-ABCDE', 'Ada', 'a@x.com', 'member'))
            .rejects.toThrow(/QR_ENCRYPTION_KEY/);
    });

    it('the default string is gone from the source', () => {
        expect(source('src/lib/digital-id.ts')).not.toContain('default-qr-secret');
    });

    it('a card signed with the key round-trips — the vacuity guard', async () => {
        const { generateDigitalIDQR, verifyDigitalIDQR } = await import('@/lib/digital-id');
        const { encryptData, hashData } = await import('@/lib/security');

        // generateDigitalIDQR returns a PNG data URL; rebuild the encrypted
        // payload the same way it does, so verify can be exercised directly.
        await generateDigitalIDQR('u1', 'ESE-2026-ABCDE', 'Ada', 'a@x.com', 'member');
        const ts = Date.now();
        const exp = ts + 86_400_000;
        const signature = hashData(`u1ESE-2026-ABCDE${ts}${exp}${KEY}`);
        const encrypted = encryptData(JSON.stringify({
            userId: 'u1', memberNumber: 'ESE-2026-ABCDE', fullName: 'Ada', email: 'a@x.com',
            role: 'member', timestamp: ts, expiresAt: exp, signature,
        }), KEY);

        const result = verifyDigitalIDQR(encrypted);
        expect(result.valid).toBe(true);
        expect(result.payload?.memberNumber).toBe('ESE-2026-ABCDE');
    });

    it('a card whose SIGNATURE was tampered with is refused, even under the right key', async () => {
        // Decrypting with the right key is not the whole check: the payload is
        // signed over userId/memberNumber/timestamp/expiresAt, and a card whose
        // body was rewritten after signing must fail here rather than pass on
        // the strength of the encryption alone.
        const { verifyDigitalIDQR } = await import('@/lib/digital-id');
        const { encryptData, hashData } = await import('@/lib/security');
        const ts = Date.now();
        const exp = ts + 86_400_000;
        const tampered = encryptData(JSON.stringify({
            userId: 'u1', memberNumber: 'ESE-2026-ABCDE', fullName: 'Ada', email: '', role: 'member',
            timestamp: ts, expiresAt: exp,
            signature: hashData(`u1ESE-2026-ABCDE${ts}${exp + 1}${KEY}`),   // signed over a different expiry
        }), KEY);

        const result = verifyDigitalIDQR(tampered);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/signature/i);
    });

    it('and a card signed with the OLD default is refused under a real key', async () => {
        const { verifyDigitalIDQR } = await import('@/lib/digital-id');
        const { encryptData, hashData } = await import('@/lib/security');
        const OLD = 'default-qr-secret-change-in-production';

        const ts = Date.now();
        const exp = ts + 86_400_000;
        const forged = encryptData(JSON.stringify({
            userId: 'u1', memberNumber: 'X', fullName: 'Forger', email: '', role: 'super_admin',
            timestamp: ts, expiresAt: exp, signature: hashData(`u1X${ts}${exp}${OLD}`),
        }), OLD);

        expect(verifyDigitalIDQR(forged).valid).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#344 — both verify pages go through the server', () => {
    it('THE PARENT PAGE NO LONGER IMPORTS THE VERIFIER INTO THE BROWSER', () => {
        const page = source('src/app/verify-id/page.tsx');

        expect(page).toContain('"use client"');
        expect(page).not.toMatch(/import\s*\{[^}]*\bverifyDigitalIDQR\b[^}]*\}\s*from/);
        expect(page).not.toContain('verifyDigitalIDQR(');
        expect(page).toContain('fetch("/api/qr/verify"');
    });

    it('and the scan page still does, so there is one verifier', () => {
        expect(source('src/app/verify-id/scan/page.tsx')).toContain('fetch("/api/qr/verify"');
    });

    it('the route is the only caller of the verifier, and it audits every attempt', () => {
        const route = source('src/app/api/qr/verify/route.ts');

        expect(route).toContain('verifyDigitalIDQR(qrData)');
        expect(route).toContain('createAuditLog(');
        expect(route).toContain('requireSession()');
    });

    it('RECORDED: nothing in the product generates a card yet', () => {
        // Not a defect to fix here — wiring the generator is a feature — but a
        // fact the next reader should not have to rediscover: the verifier
        // has had nothing genuine to verify.
        const { execSync } = require('child_process');
        const callers: string = execSync(
            "grep -rl 'generateDigitalIDCard\\|generateDigitalIDQR' --include=*.ts --include=*.tsx src/app src/components src/lib || true",
            { encoding: 'utf-8' },
        );
        const outside = callers.split('\n').filter((f) => f && !f.endsWith('lib/digital-id.ts'));
        expect(outside).toEqual([]);
    });
});
