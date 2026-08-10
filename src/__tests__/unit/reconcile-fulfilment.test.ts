/**
 * @jest-environment node
 */

/**
 * Fulfilment reconciliation.
 *
 * WHY THIS EXISTS
 * ---------------
 * reconcile-paystack asks "was the payment RECORDED?", comparing Paystack's
 * transactions against processed_payments by reference. Run against production
 * on 2026-08-09 it reported discrepancies: 0 — over a 30-day window containing
 * eight cooperative registrations that were paid and never fulfilled. Every one
 * of them HAD its processed_payments row; what was missing was the
 * cooperative_members row.
 *
 * A payment recorded but not fulfilled is invisible to a reference-level check.
 * This route asks the other question, and the first test below is the exact
 * scenario the old one missed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/** Per-collection fixtures: collection name -> docs. */
let COLLECTION_DATA: Record<string, Array<{ id: string; data: Record<string, any> }>> = {};

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => ({
            get: async () => ({
                docs: (COLLECTION_DATA[name] || []).map((d) => ({
                    id: d.id,
                    data: () => d.data,
                })),
                empty: (COLLECTION_DATA[name] || []).length === 0,
            }),
        }),
    },
}));

const SECRET = 'test-cron-secret';

function req(url = 'https://x/api/cron/reconcile-fulfilment', auth: string | null = `Bearer ${SECRET}`) {
    return {
        headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? auth : null) },
        nextUrl: new URL(url),
    } as any;
}

/** A completed payment processed today. */
function payment(reference: string, type: string, userId: string) {
    return {
        id: reference,
        data: {
            reference, type, userId,
            status: 'completed',
            processedAt: new Date().toISOString(),
        },
    };
}

describe('reconcile-fulfilment', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.CRON_SECRET = SECRET;
        COLLECTION_DATA = {};
    });

    it('finds a registration that was paid but never produced a membership', async () => {
        // THE test. This is precisely the shape reconcile-paystack reported as
        // "discrepancies: 0" while eight members sat unregistered.
        COLLECTION_DATA['processedPayments'] = [
            payment('ref-paid-ok', 'cooperative_membership_registration', 'user-ok'),
            payment('ref-paid-broken', 'cooperative_membership_registration', 'user-broken'),
        ];
        COLLECTION_DATA['cooperative_members'] = [
            { id: 'user-ok', data: { userId: 'user-ok' } },
            // user-broken has no membership row — paid, never fulfilled.
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.status).toBe('unfulfilled_payments_found');
        expect(body.totalUnfulfilled).toBe(1);
        const coop = body.byType['cooperative_membership_registration'];
        expect(coop.checked).toBe(2);
        expect(coop.unfulfilled).toBe(1);
        expect(coop.references[0]).toMatchObject({ reference: 'ref-paid-broken', userId: 'user-broken' });
    });

    it('reports ok when every payment produced its artefact', async () => {
        COLLECTION_DATA['processedPayments'] = [
            payment('ref-1', 'cooperative_membership_registration', 'user-1'),
        ];
        COLLECTION_DATA['cooperative_members'] = [{ id: 'user-1', data: { userId: 'user-1' } }];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.status).toBe('ok');
        expect(body.totalUnfulfilled).toBe(0);
    });

    it('does not count an order still sitting at pending_payment as fulfilled', async () => {
        // The row EXISTS but nothing happened to it. Presence alone would be a
        // false pass, which is the failure mode this whole route exists for.
        COLLECTION_DATA['processedPayments'] = [payment('ord-1', 'marketplace_order', 'buyer-1')];
        COLLECTION_DATA['marketplaceOrders'] = [
            { id: 'o1', data: { paymentReference: 'ord-1', paymentStatus: 'pending' } },
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.byType['marketplace_order'].unfulfilled).toBe(1);
    });

    it('counts an order that moved past pending as fulfilled', async () => {
        COLLECTION_DATA['processedPayments'] = [payment('ord-2', 'marketplace_order', 'buyer-1')];
        COLLECTION_DATA['marketplaceOrders'] = [
            { id: 'o2', data: { paymentReference: 'ord-2', paymentStatus: 'completed' } },
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.byType['marketplace_order'].unfulfilled).toBe(0);
        expect(body.status).toBe('ok');
    });

    it('names the payment types it did NOT check', async () => {
        // A reconciler that silently ignores a type reads as an all-clear.
        // academy_registration IS checked now, so it must NOT appear here —
        // this test is what would catch a type quietly falling out of coverage.
        COLLECTION_DATA['processedPayments'] = [
            payment('w-1', 'wallet_funding', 'user-1'),
            payment('w-2', 'wallet_funding', 'user-2'),
            payment('c-1', 'contribution', 'user-3'),
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.notChecked).toMatchObject({ wallet_funding: 2, contribution: 1 });
        expect(body.notChecked.academy_registration).toBeUndefined();
        expect(body.status).toBe('ok');
    });

    it('finds an academy registration that never granted access', async () => {
        COLLECTION_DATA['processedPayments'] = [
            payment('ac-ok', 'academy_registration', 'student-ok'),
            payment('ac-bad', 'academy_registration', 'student-bad'),
        ];
        COLLECTION_DATA['users'] = [
            { id: 'student-ok', data: { serviceRegistrations: { academy: { paymentStatus: 'completed' } } } },
            { id: 'student-bad', data: { roles: [] } },
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        const acad = body.byType['academy_registration'];
        expect(acad.checked).toBe(2);
        expect(acad.unfulfilled).toBe(1);
        expect(acad.references[0]).toMatchObject({ reference: 'ac-bad' });
    });

    it('ignores payments outside the window', async () => {
        const old = payment('old-1', 'cooperative_membership_registration', 'user-old');
        old.data.processedAt = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
        COLLECTION_DATA['processedPayments'] = [old];
        COLLECTION_DATA['cooperative_members'] = [];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.paymentsInWindow).toBe(0);
        expect(body.totalUnfulfilled).toBe(0);
    });

    it('widens the window on request', async () => {
        const old = payment('old-2', 'cooperative_membership_registration', 'user-old');
        old.data.processedAt = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
        COLLECTION_DATA['processedPayments'] = [old];
        COLLECTION_DATA['cooperative_members'] = [];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req('https://x/api/cron/reconcile-fulfilment?days=180'))).json();

        expect(body.windowDays).toBe(180);
        expect(body.totalUnfulfilled).toBe(1);
    });

    it('ignores payments that are not completed', async () => {
        const p = payment('pend-1', 'cooperative_membership_registration', 'user-p');
        p.data.status = 'overfunded_review';
        COLLECTION_DATA['processedPayments'] = [p];
        COLLECTION_DATA['cooperative_members'] = [];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.paymentsInWindow).toBe(0);
    });

    it('refuses an unauthenticated call', async () => {
        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const res = await GET(req('https://x/api/cron/reconcile-fulfilment', null));

        expect(res.status).toBe(401);
    });
});
