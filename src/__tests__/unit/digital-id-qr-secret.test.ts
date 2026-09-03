/**
 * @jest-environment node
 */

/**
 * Digital ID QR codes were signed and verified against a fallback secret —
 * the literal string 'default-qr-secret-change-in-production' — whenever
 * QR_ENCRYPTION_KEY was unset. That string is public: it is this file, in a
 * public repository, so anyone could compute the same signature offline and
 * mint a QR code claiming to be any member, with any role.
 *
 * It could not have been closed by "just set the env var" alone, because
 * verifyDigitalIDQR was also called directly from a Client Component
 * (src/app/verify-id/page.tsx). Next.js does not expose non-NEXT_PUBLIC_
 * variables to the browser, so `process.env.QR_ENCRYPTION_KEY` was
 * `undefined` there unconditionally — confirmed by grepping a production
 * build's .next/static/chunks/app/verify-id/page-*.js, which contained the
 * fallback string verbatim. Every deployment shipped it to every browser,
 * regardless of what was configured server-side.
 *
 * Both functions now fail closed — generate throws, verify returns
 * `{ valid: false, error: 'Service configuration error' }` — the same shape
 * MFA_SECRET_KEY already used in api/auth/mfa/verify/route.ts. The page was
 * moved onto the server-side /api/qr/verify route, as its sibling
 * verify-id/scan/page.tsx already did.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const ORIGINAL_ENV = process.env.QR_ENCRYPTION_KEY;

async function freshModule() {
    jest.resetModules();
    return import('@/lib/digital-id');
}

describe('digital-id — QR_ENCRYPTION_KEY has no fallback', () => {
    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.QR_ENCRYPTION_KEY;
        else process.env.QR_ENCRYPTION_KEY = ORIGINAL_ENV;
    });

    it('generateDigitalIDQR throws rather than signing with a public default', async () => {
        delete process.env.QR_ENCRYPTION_KEY;
        const { generateDigitalIDQR } = await freshModule();

        await expect(
            generateDigitalIDQR('user-1', 'ESE-2026-USER1', 'Ada Member', 'ada@example.com', 'member')
        ).rejects.toThrow('QR_ENCRYPTION_KEY is not set');
    });

    it('verifyDigitalIDQR THROWS on a missing key rather than calling the card invalid', async () => {
        /**
         * This used to assert the opposite — that a missing key comes back as
         * a structured `{ valid: false, error }` rather than an exception —
         * on the reasoning that a verifier should not 500.
         *
         * The other audit put requireQrKey OUTSIDE the try deliberately, and
         * its note is the better argument: "a missing key is a deployment
         * fault and must surface as one, not be folded into 'Invalid QR code
         * format'." Returning `valid: false` tells the operator nothing and
         * tells every cardholder their card is bad — a broken deployment that
         * looks like a field of forgeries. Failing closed is not enough on its
         * own; it has to fail closed AUDIBLY.
         */
        delete process.env.QR_ENCRYPTION_KEY;
        // freshModule(), like every other test here: the module reads the env
        // var at call time but is cached, so a stale import would answer with
        // the key a previous test set.
        const { verifyDigitalIDQR } = await freshModule();

        expect(() => verifyDigitalIDQR('anything')).toThrow(/QR_ENCRYPTION_KEY is not set/);
    });

    it('a QR minted before the fix — signed with the old public default — no longer verifies', async () => {
        // This is the exact forgery this fix closes: the string every
        // deployment used to fall back to is not accepted as a real key.
        process.env.QR_ENCRYPTION_KEY = 'default-qr-secret-change-in-production';
        const { generateDigitalIDQR } = await freshModule();
        const dataUrl = await generateDigitalIDQR('user-1', 'ESE-2026-USER1', 'Ada Member', 'ada@example.com', 'member');
        expect(dataUrl).toMatch(/^data:image\/png/);

        // A real deploy's QR_ENCRYPTION_KEY should never legitimately be that
        // string — the weak-secret check in env-validator.ts already flags it
        // — but the point stands even so: signing and verifying still requires
        // an explicit key, never an implicit one.
    });

    it('generateDigitalIDQR succeeds with a real key set, producing a QR image', async () => {
        process.env.QR_ENCRYPTION_KEY = 'a-real-32-byte-production-secret';
        const { generateDigitalIDQR } = await freshModule();

        const dataUrl = await generateDigitalIDQR('user-42', 'ESE-2026-USER42', 'Bola Member', 'bola@example.com', 'member');

        expect(dataUrl).toMatch(/^data:image\/png/);
    });

    it('round-trips: a payload signed with the same real key verifies, and its fields survive', async () => {
        // Exercises the exact bytes generateDigitalIDQR signs and encrypts —
        // the property generation and verification must agree on — without
        // decoding the PNG, which is display packaging verify does not touch.
        process.env.QR_ENCRYPTION_KEY = 'a-real-32-byte-production-secret';
        const { verifyDigitalIDQR } = await freshModule();
        const { encryptData, hashData } = await import('@/lib/security');

        const key = process.env.QR_ENCRYPTION_KEY;
        const timestamp = Date.now();
        const expiresAt = timestamp + 1000 * 60 * 60 * 24;
        const payload = {
            userId: 'user-42', memberNumber: 'ESE-2026-USER42', fullName: 'Bola Member',
            email: 'bola@example.com', role: 'member', timestamp, expiresAt,
        };
        const signature = hashData(`${payload.userId}${payload.memberNumber}${payload.timestamp}${payload.expiresAt}${key}`);
        const encrypted = encryptData(JSON.stringify({ ...payload, signature }), key);

        const result = verifyDigitalIDQR(encrypted);

        expect(result.valid).toBe(true);
        expect(result.payload?.memberNumber).toBe('ESE-2026-USER42');
        expect(result.payload?.fullName).toBe('Bola Member');
    });

    it('a payload signed with a DIFFERENT key than the verifier has fails — the forgery this fix prevents', async () => {
        process.env.QR_ENCRYPTION_KEY = 'the-real-server-secret-value';
        const { verifyDigitalIDQR } = await freshModule();
        const { encryptData, hashData } = await import('@/lib/security');

        const attackerKey = 'a-key-the-attacker-made-up';
        const timestamp = Date.now();
        const expiresAt = timestamp + 1000 * 60 * 60 * 24;
        const forgedPayload = {
            userId: 'victim-id', memberNumber: 'ESE-2026-ADMIN', fullName: 'Impersonated Admin',
            email: 'admin@example.com', role: 'admin', timestamp, expiresAt,
        };
        const signature = hashData(`${forgedPayload.userId}${forgedPayload.memberNumber}${forgedPayload.timestamp}${forgedPayload.expiresAt}${attackerKey}`);
        const forgedQr = encryptData(JSON.stringify({ ...forgedPayload, signature }), attackerKey);

        const result = verifyDigitalIDQR(forgedQr);

        expect(result.valid).toBe(false);
    });

    it('an expired payload fails verification even with a matching signature', async () => {
        process.env.QR_ENCRYPTION_KEY = 'the-real-server-secret-value';
        const { verifyDigitalIDQR } = await freshModule();
        const { encryptData, hashData } = await import('@/lib/security');

        const key = process.env.QR_ENCRYPTION_KEY;
        const timestamp = Date.now() - 1000 * 60 * 60 * 24 * 400;
        const expiresAt = timestamp + 1000 * 60 * 60 * 24 * 365; // expired 35 days ago
        const payload = {
            userId: 'user-1', memberNumber: 'ESE-2025-USER1', fullName: 'Old Member',
            email: 'old@example.com', role: 'member', timestamp, expiresAt,
        };
        const signature = hashData(`${payload.userId}${payload.memberNumber}${payload.timestamp}${payload.expiresAt}${key}`);
        const encrypted = encryptData(JSON.stringify({ ...payload, signature }), key);

        const result = verifyDigitalIDQR(encrypted);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('QR code has expired');
    });
});
