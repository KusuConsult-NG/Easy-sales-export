/**
 * @jest-environment node
 */

/**
 * Two cron routes ran for anyone when CRON_SECRET was not configured.
 *
 * THE BUG
 * -------
 *     if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return 401;
 *
 * With the variable unset, the template literal produces the string
 * `"Bearer undefined"`. A caller sending exactly `Authorization: Bearer
 * undefined` matched it, and the route ran.
 *
 * **CRON_SECRET is not currently configured** — it is on the list of things to
 * set after the next deploy — so this is the state the code would have shipped
 * in.
 *
 * WHAT THE TWO ROUTES DO
 * ----------------------
 *   release-escrow   releases escrow and pays sellers
 *   gdpr-purge       deletes user accounts and scrubs PII
 *
 * An open trigger for the first is an open trigger for payouts. An open trigger
 * for the second is an open trigger for data destruction.
 *
 * gdpr-purge's gate read "validate in production, or whenever a secret exists",
 * which sounds safe and is not: in production with no secret it still entered
 * the branch and compared against `"Bearer undefined"`.
 *
 * THE SHAPE, AGAIN
 * ----------------
 * `process-email-queue`, `reconcile-paystack` and `reconcile-fulfilment` have
 * always returned 500 when the secret is missing. Two of five did not. A rule
 * applied to some copies of a path and not others is the defect that has
 * recurred all week.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('@/lib/firestore-compat', () => ({
    FieldValue: { serverTimestamp: () => 'ts', increment: (n: number) => ({ _operand: n }) },
    Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d: Date) => ({ toDate: () => d }) },
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));

const ORIGINAL = process.env.CRON_SECRET;

function request(auth?: string) {
    return {
        headers: { get: (k: string) => (k.toLowerCase() === 'authorization' && auth ? auth : null) },
        nextUrl: { searchParams: new URLSearchParams() },
    } as any;
}

describe('cron routes refuse to run without a configured secret', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.CRON_SECRET;
    });
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = ORIGINAL;
    });

    it('release-escrow refuses "Bearer undefined" when the secret is unset', async () => {
        // THE test. This exact header defeated the old comparison.
        const { GET } = await import('@/app/api/cron/release-escrow/route');

        const res: any = await GET(request('Bearer undefined'));

        expect(res.status).toBe(500);
    });

    it('gdpr-purge refuses "Bearer undefined" when the secret is unset', async () => {
        // The destructive one: it deletes accounts and scrubs PII.
        const { GET } = await import('@/app/api/cron/gdpr-purge/route');

        const res: any = await GET(request('Bearer undefined'));

        expect(res.status).toBe(500);
    });

    it('release-escrow refuses a missing header too', async () => {
        const { GET } = await import('@/app/api/cron/release-escrow/route');

        const res: any = await GET(request());

        expect(res.status).toBe(500);
    });

    it('gdpr-purge refuses a missing header too', async () => {
        const { GET } = await import('@/app/api/cron/gdpr-purge/route');

        const res: any = await GET(request());

        expect(res.status).toBe(500);
    });
});

describe('with a secret configured', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.CRON_SECRET = 'a-real-secret';
    });
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = ORIGINAL;
    });

    it('release-escrow still rejects a wrong secret', async () => {
        const { GET } = await import('@/app/api/cron/release-escrow/route');

        const res: any = await GET(request('Bearer guessed-it'));

        expect(res.status).toBe(401);
    });

    it('gdpr-purge still rejects a wrong secret', async () => {
        const { GET } = await import('@/app/api/cron/gdpr-purge/route');

        const res: any = await GET(request('Bearer guessed-it'));

        expect(res.status).toBe(401);
    });

    // The two vacuity guards below assert on the REASON, not the status.
    //
    // Every assertion above is satisfied by a route that refuses everyone —
    // which would silently disable escrow auto-release and the retention sweep.
    // But a correct secret still yields 500 here, because the route gets past
    // auth and then hits an unmocked database: the body is "Internal Server
    // Error", not "CRON_SECRET not configured".
    //
    // Asserting `status !== 500` would therefore fail for the wrong reason and
    // tempt the next person to delete the guard. Asserting the reason is what
    // actually distinguishes "refused the caller" from "ran and then broke".
    it('release-escrow accepts the correct secret and gets past the gate', async () => {
        const { GET } = await import('@/app/api/cron/release-escrow/route');

        const res: any = await GET(request('Bearer a-real-secret'));
        const body = await res.json().catch(() => ({}));

        expect(res.status).not.toBe(401);
        expect(JSON.stringify(body)).not.toMatch(/not configured/i);
    });

    it('gdpr-purge accepts the correct secret and gets past the gate', async () => {
        const { GET } = await import('@/app/api/cron/gdpr-purge/route');

        const res: any = await GET(request('Bearer a-real-secret'));
        const body = await res.json().catch(() => ({}));

        expect(res.status).not.toBe(401);
        expect(JSON.stringify(body)).not.toMatch(/not configured/i);
    });
});
