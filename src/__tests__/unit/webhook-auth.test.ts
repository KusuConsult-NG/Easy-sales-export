/**
 * @jest-environment node
 */

/**
 * The three webhooks nothing tested: africastalking, resend, qoreid.
 *
 * All three are unauthenticated entry points — no session, authenticated by a
 * shared secret or an HMAC signature — and all three had the same latent bug,
 * already fixed on main: the verification ran inside `if (secret) { ... }` or
 * `if (signatureHeader) { ... }`, so an unset secret or an omitted header
 * skipped the check and fell through to processing the payload. A guard
 * conditional on the caller's own input is not a guard.
 *
 * The fixes make them fail CLOSED. These tests are what proves that stays true:
 * the fix is one deleted `else` away from regressing, and nothing would have
 * caught it. The Paystack webhook (paystack-webhook-claim.test.ts) is the
 * fourth; this file covers the other three.
 *
 * The assertions are on WHO IS TURNED AWAY, and that no write happens when they
 * are. Asserting only on a 200 would pass against the broken versions, because
 * returning 200 is exactly what they did.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import crypto from 'node:crypto';

// One shared db spy across all three routes. `.set()` is the write each webhook
// performs; asserting it was NOT called is how "rejected before any effect" is
// proven, not merely "returned 401".
const mockSet = jest.fn() as jest.Mock<any>;
const dbMock = {
    collection: () => ({
        doc: () => ({ set: (...a: any[]) => mockSet(...a) }),
    }),
};

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: dbMock,
    getAdminDb: () => dbMock,
}));
jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// next/headers is only used by the qoreid and resend routes.
let currentHeaders: Record<string, string> = {};
jest.mock('next/headers', () => ({
    headers: async () => ({ get: (k: string) => currentHeaders[k.toLowerCase()] ?? null }),
}));

beforeEach(() => {
    jest.clearAllMocks();
    currentHeaders = {};
    delete process.env.AT_WEBHOOK_SECRET;
    delete process.env.QOREID_WEBHOOK_SECRET;
    delete process.env.QOREID_SECRET_KEY;
    delete process.env.RESEND_WEBHOOK_SECRET;
});

// ─── Africa's Talking — shared secret in a query parameter ────────────────────

describe("africastalking webhook", () => {
    async function post(urlSecret: string | null, body: Record<string, string>) {
        const { POST } = await import('@/app/api/webhooks/africastalking/route');
        const qs = urlSecret === null ? '' : `?secret=${encodeURIComponent(urlSecret)}`;
        const req = {
            url: `https://app.test/api/webhooks/africastalking${qs}`,
            headers: { get: () => 'application/json' },
            json: async () => body,
        } as any;
        return POST(req);
    }

    it('refuses (500) when AT_WEBHOOK_SECRET is unset — fails closed, no write', async () => {
        const res = await post('anything', { id: 'm1', status: 'Success' });
        expect(res.status).toBe(500);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('rejects (401) a missing secret', async () => {
        process.env.AT_WEBHOOK_SECRET = 'right';
        const res = await post(null, { id: 'm1', status: 'Success' });
        expect(res.status).toBe(401);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('rejects (401) a wrong secret', async () => {
        process.env.AT_WEBHOOK_SECRET = 'right';
        const res = await post('wrong', { id: 'm1', status: 'Success' });
        expect(res.status).toBe(401);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('accepts the correct secret and logs the delivery report', async () => {
        process.env.AT_WEBHOOK_SECRET = 'right';
        const res = await post('right', { id: 'm1', status: 'Success', phoneNumber: '+234800' });
        expect(res.status).toBe(200);
        expect(mockSet).toHaveBeenCalledTimes(1);
    });
});

// ─── Identity provider — retired, and it must REFUSE rather than 404 ─────────

/**
 *   #485 THIS BLOCK USED TO PROVE THE HMAC GUARD ON A RECEIVER FOR AN EXTERNAL
 *        IDENTITY PROVIDER. The provider is out of service, the receiver is
 *        retired, and the collection it staged into was never read by anything.
 *
 *        The assertions are replaced rather than deleted, because "retired" has
 *        a failure mode of its own: an endpoint that quietly accepts and drops
 *        writes, or one that 404s so a misconfigured caller cannot tell a
 *        retirement from a typo. It must refuse, explicitly, and write nothing.
 */
describe("retired identity-provider webhook", () => {
    async function post(signature: string | null, event: any) {
        const { POST } = await import('@/app/api/webhooks/identity-provider/route');
        if (signature !== null) currentHeaders['x-qoreid-signature'] = signature;
        void event;
        return POST();
    }

    it('REFUSES EVERY DELIVERY WITH 410 GONE, SIGNED OR NOT', async () => {
        //   410 and not 404: a caller still configured to post here gets an
        //   answer that says the endpoint was retired, not that the URL is
        //   wrong. That is the difference between a five-minute diagnosis and
        //   an afternoon.
        process.env.QOREID_WEBHOOK_SECRET = 'anything';
        const res = await post('deadbeef', { event: 'verification.completed' });
        expect(res.status).toBe(410);
    });

    it('AND WRITES NOTHING — the staging collection had no consumer', async () => {
        //   The receiver's real behaviour was to accumulate unread rows from
        //   unauthenticated callers. Retiring it has to stop the write, not
        //   just the processing.
        const res = await post(null, { event: 'verification.completed' });
        expect(res.status).toBe(410);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('and it does not depend on a secret that is no longer set', async () => {
        //   It answered 500 to everything when the secret was unset, which is
        //   what production actually did. A retired endpoint must not need
        //   configuration to refuse correctly.
        delete process.env.QOREID_WEBHOOK_SECRET;
        const res = await post('deadbeef', { event: 'x' });
        expect(res.status).toBe(410);
        expect(mockSet).not.toHaveBeenCalled();
    });
});

// ─── Resend — Svix-signed, or refuse ──────────────────────────────────────────

describe("resend webhook", () => {
    async function post(event: any, headersIn: Record<string, string> = {}) {
        currentHeaders = Object.fromEntries(
            Object.entries(headersIn).map(([k, v]) => [k.toLowerCase(), v])
        );
        const { POST } = await import('@/app/api/webhooks/resend/route');
        const req = { text: async () => JSON.stringify(event) } as any;
        return POST(req);
    }

    it('refuses (500) when RESEND_WEBHOOK_SECRET is unset — fails closed, no write', async () => {
        const res = await post({ type: 'email.bounced', data: { to: ['x@y.com'] } });
        expect(res.status).toBe(500);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('rejects (400) when the svix headers are missing', async () => {
        process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
        const res = await post({ type: 'email.bounced', data: { to: ['x@y.com'] } });
        expect(res.status).toBe(400);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('rejects (400) when the svix signature does not verify', async () => {
        process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
        const res = await post(
            { type: 'email.bounced', data: { to: ['x@y.com'] } },
            { 'svix-id': 'msg_1', 'svix-timestamp': '1', 'svix-signature': 'v1,deadbeef' }
        );
        expect(res.status).toBe(400);
        expect(mockSet).not.toHaveBeenCalled();
    });
});
