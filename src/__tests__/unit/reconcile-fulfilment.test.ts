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

/** Collections whose scan should report itself as truncated. */
let TRUNCATED: Set<string> = new Set();

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        // A chainable stub: the route now uses .select(...).all().get() and
        // .where(...).all().get(), and the snapshot carries `truncated`. A stub
        // that only had .get() made every one of these throw.
        collection: (name: string) => {
            const filters: Array<[string, string, any]> = [];
            const q: any = {
                select: () => q,
                all: () => q,
                where: (f: string, op: string, v: any) => { filters.push([f, op, v]); return q; },
                get: async () => {
                    let rows = COLLECTION_DATA[name] || [];
                    for (const [f, op, v] of filters) {
                        if (op === '==') rows = rows.filter((d) => (d.data as any)[f] === v);
                    }
                    return {
                        docs: rows.map((d) => ({ id: d.id, data: () => d.data })),
                        empty: rows.length === 0,
                        truncated: TRUNCATED.has(name),
                    };
                },
            };
            return q;
        },
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
        TRUNCATED = new Set();
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

    it('reports a claim stranded at pending_fulfilment', async () => {
        // processExportInvestment claims as "pending_fulfilment" and promotes to
        // "completed" or "overfunded_review" once the overfunding branch
        // resolves — it cannot know the status before the branch runs. A crash
        // between the two leaves the row here.
        //
        // Every artefact check above filters to status === "completed", so a
        // stranded row would be invisible to all of them. It needs no artefact
        // lookup to be a problem: the payment was claimed and never fulfilled.
        const p = payment('exp-stranded', 'export_investment', 'investor-1');
        p.data.status = 'pending_fulfilment';
        COLLECTION_DATA['processedPayments'] = [p];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.strandedClaims.count).toBe(1);
        expect(body.strandedClaims.references[0].reference).toBe('exp-stranded');
        // Must count toward the alarm, not merely be listed beside it —
        // otherwise a run with stranded payments still reports "ok".
        expect(body.totalUnfulfilled).toBe(1);
        expect(body.status).toBe('unfulfilled_payments_found');
    });

    it('reports no stranded claims when every row reached a final status', async () => {
        // Vacuity guard for the test above.
        const p = payment('exp-ok', 'export_investment', 'investor-2');
        COLLECTION_DATA['processedPayments'] = [p];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.strandedClaims.count).toBe(0);
    });

    it('surfaces an order charged for stock that was not there', async () => {
        // Both stock-reservation paths mark an order paid_awaiting_refund when
        // the reservation fails after the payment is claimed, and the comment
        // beside each says nothing yet PROCESSES those refunds. Nothing
        // surfaced them either — the money was owed and no job mentioned it.
        COLLECTION_DATA['processedPayments'] = [];
        COLLECTION_DATA['marketplaceOrders'] = [{
            id: 'ord-1',
            data: {
                orderId: 'ORD-1',
                buyerId: 'buyer-1',
                paymentStatus: 'paid_awaiting_refund',
                status: 'cancelled_out_of_stock',
                refundAmount: 12_500,
                refundReason: 'Insufficient stock for Yam Tubers',
            },
        }];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.refundsOwed.count).toBe(1);
        expect(body.refundsOwed.totalAmount).toBe(12_500);
        expect(body.refundsOwed.orders[0].orderId).toBe('ORD-1');
        // Must count toward the alarm: money owed to a buyer is not an "ok" run.
        expect(body.totalUnfulfilled).toBe(1);
        expect(body.status).toBe('unfulfilled_payments_found');
    });

    it('reports a payout that failed and was flagged for a human', async () => {
        // order-management.ts sets escrowPendingManualRelease when the Paystack
        // transfer to a seller fails. NOTHING read that field — not a screen,
        // not a query, not this job — so the seller stayed unpaid, the buyer
        // stayed charged, and the flag sat there.
        COLLECTION_DATA['processedPayments'] = [];
        COLLECTION_DATA['marketplaceOrders'] = [{
            id: 'ord-stuck',
            data: {
                orderId: 'ORD-STUCK',
                sellerId: 'seller-9',
                paymentStatus: 'escrow_held',
                escrowReleased: false,
                escrowPendingManualRelease: true,
                escrowReleaseError: 'Paystack transfer failed: insufficient balance',
                sellerAmountPaid: 48_000,
            },
        }];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.payoutsStuck.count).toBe(1);
        expect(body.payoutsStuck.totalAmount).toBe(48_000);
        expect(body.payoutsStuck.orders[0]).toMatchObject({
            orderId: 'ORD-STUCK',
            sellerId: 'seller-9',
            error: 'Paystack transfer failed: insufficient balance',
        });
        // Must count toward the alarm: a seller who has not been paid is not an
        // "ok" run, for the same reason money owed to a buyer is not.
        expect(body.totalUnfulfilled).toBe(1);
        expect(body.status).toBe('unfulfilled_payments_found');
    });

    it('reports no stuck payouts when every release succeeded', async () => {
        // Vacuity guard: a field-name typo would report 0 either way.
        COLLECTION_DATA['processedPayments'] = [];
        COLLECTION_DATA['marketplaceOrders'] = [{
            id: 'ord-paid',
            data: {
                orderId: 'ORD-PAID',
                sellerId: 'seller-1',
                paymentStatus: 'completed',
                escrowReleased: true,
                escrowPendingManualRelease: false,
            },
        }];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.payoutsStuck.count).toBe(0);
        expect(body.status).toBe('ok');
    });

    it('reports no refunds owed when no order is awaiting one', async () => {
        // Vacuity guard: a collection-name typo would report 0 either way.
        COLLECTION_DATA['processedPayments'] = [];
        COLLECTION_DATA['marketplaceOrders'] = [{
            id: 'ord-2',
            data: { orderId: 'ORD-2', buyerId: 'b2', paymentStatus: 'escrow_held' },
        }];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.refundsOwed.count).toBe(0);
        expect(body.status).toBe('ok');
    });

    it('refuses to report ok when an artefact scan came back incomplete', async () => {
        // THE test for the truncation defect. Every artefact scan used a plain
        // .get(), which stops at DEFAULT_QUERY_LIMIT (5,000) and returns a short
        // result that looks complete. USERS is ~41,000 rows, so the academy
        // check was building its fulfilled-set from an eighth of the table and
        // reporting every payment outside that slice as unfulfilled.
        //
        // The scans use .all() now. This asserts the remaining case: if even
        // that hits its ceiling, the run must not be able to say "ok", because
        // the answer is unknown rather than clean.
        COLLECTION_DATA['processedPayments'] = [
            payment('ac-1', 'academy_registration', 'student-1'),
        ];
        COLLECTION_DATA['users'] = [
            { id: 'student-1', data: { serviceRegistrations: { academy: { paymentStatus: 'completed' } } } },
        ];
        TRUNCATED = new Set(['users']);

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.status).toBe('incomplete_scan');
        expect(body.incompleteScans).toContain('academy_registration');
    });

    it('reports no incomplete scans when every scan was complete', async () => {
        // Vacuity guard: without this, the assertion above would pass even if
        // incompleteScans were populated unconditionally.
        COLLECTION_DATA['processedPayments'] = [
            payment('ac-2', 'academy_registration', 'student-2'),
        ];
        COLLECTION_DATA['users'] = [
            { id: 'student-2', data: { serviceRegistrations: { academy: { paymentStatus: 'completed' } } } },
        ];

        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const body = await (await GET(req())).json();

        expect(body.incompleteScans).toEqual([]);
        expect(body.status).toBe('ok');
    });

    it('refuses an unauthenticated call', async () => {
        const { GET } = await import('@/app/api/cron/reconcile-fulfilment/route');
        const res = await GET(req('https://x/api/cron/reconcile-fulfilment', null));

        expect(res.status).toBe(401);
    });
});
