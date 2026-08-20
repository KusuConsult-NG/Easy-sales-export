/**
 * @jest-environment node
 */

/**
 * export-admin.ts — 9 endpoints, no tests.
 *
 * DEFECT 1: ONE ENDPOINT HAD NO CALLER CHECK
 * ------------------------------------------
 * `getAdminExportCatalogAction` had no session check of any kind. Its eight
 * siblings all call isAdmin, its name says Admin, and its only caller is
 * /admin/export/catalog — so any unauthenticated request could page through the
 * export catalogue.
 *
 * The rows are whole documents. `createExportCatalogAction` spreads
 * `...productData` in with no schema, so an entry holds whatever the admin form
 * sent, and serializeDocs returns all of it.
 *
 * It was not standing in for a public endpoint. There is no unauthenticated
 * catalogue reader anywhere in the codebase — participants read their own
 * products through getUserExportProductsAction, which is session-scoped.
 *
 * DEFECT 2: ORDER STATUS WAS A FREE STRING
 * ----------------------------------------
 * `updateAdminExportOrderStatusAction(orderId, status: string)` wrote whatever
 * it was given. The vocabulary export-payment.ts actually writes is small —
 * pending_payment, processing, completed, cancelled_out_of_stock — and nothing
 * checked against it, so a typo like "shiped" became the order's permanent
 * state. Buyer dashboards filter on these strings, so an order in an unknown
 * state stops appearing anywhere.
 *
 * This is an admin endpoint, so the risk is a mistake rather than an attack, and
 * a whitelist makes the mistake impossible.
 *
 * WHAT THE WHITELIST MUST NOT DO
 * ------------------------------
 * Break the admin page. /admin/export/orders offers exactly five values —
 * pending_payment, processing, shipped, delivered, cancelled — and every one is
 * asserted below. A whitelist that rejected one of them would be a worse bug
 * than the one it fixes, and it would be invisible until an admin tried to ship
 * an order.
 *
 * NOT CHANGED
 * -----------
 * `reviewExportProductAction` does not claim its transition, so approving an
 * already-approved product re-sends the approval email. Every write it makes is
 * idempotent and no money moves — the same finding as academy approval, and the
 * same reasoning for leaving it: an admin re-approving to force a resend is
 * plausible, and suppressing it is a product call.
 *
 * `createExportCatalogAction` spreads unvalidated `productData` into the
 * document. It is admin-only, so this is admin authority rather than mass
 * assignment by a stranger — but it is why the unguarded read above mattered,
 * and it is recorded here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const PARTICIPANT = 'participant-1';
const ORDER = 'order-1';
const PRODUCT = 'prod-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => undefined),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/email-notifications', () => ({
    sendExportProductApprovalEmail: jest.fn(async () => ({})),
    sendExportProductRejectionEmail: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

function setDocs(data: Record<string, any> = {}) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: PRODUCT, ref: { id: PRODUCT }, data: () => ({ name: 'Cocoa', isActive: true, ...data }) }],
        ref: { id: PRODUCT },
        data: () => ({ name: 'Cocoa', isActive: true, ...data }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

describe('getAdminExportCatalogAction — the endpoint that let anyone read', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDocs();
    });

    async function fetchCatalog() {
        const { getAdminExportCatalogAction } = await import('@/app/actions/export-admin');
        return getAdminExportCatalogAction({});
    }

    it('refuses a caller with no session at all', async () => {
        // THE test. There was no session check here whatsoever.
        setSession(null);

        const r: any = await fetchCatalog();

        expect(r.success).toBe(false);
        expect(r.data).toBeNull();
    });

    it('refuses a signed-in non-admin', async () => {
        setSession(PARTICIPANT, ['export_participant']);

        const r: any = await fetchCatalog();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });

    it('still serves an admin', async () => {
        // Vacuity guard, and it matters more than usual: the admin catalogue
        // page is this endpoint's only caller, so a guard that refused everyone
        // would empty that page with no other symptom.
        setSession(ADMIN, ['admin']);

        const r: any = await fetchCatalog();

        expect(r.success).toBe(true);
    });
});

describe('updateAdminExportOrderStatusAction — the status vocabulary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setDocs();
    });

    async function setStatus(status: string) {
        const { updateAdminExportOrderStatusAction } = await import('@/app/actions/export-admin');
        return updateAdminExportOrderStatusAction(ORDER, status);
    }

    it('refuses a status that is not in the vocabulary, and writes nothing', async () => {
        const r: any = await setStatus('shiped');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unknown order status/i);
        expect(allWrites().filter((p) => p && 'status' in p)).toEqual([]);
    });

    it('refuses an empty status', async () => {
        const r: any = await setStatus('');

        expect(r.success).toBe(false);
        expect(allWrites().filter((p) => p && 'status' in p)).toEqual([]);
    });

    // Exactly the five the admin page offers. If the whitelist ever stops
    // accepting one of these, an admin cannot move an order and nothing else
    // reports it — a worse failure than the free string this replaced.
    const uiOffers = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled'];

    for (const status of uiOffers) {
        it(`accepts "${status}", which /admin/export/orders offers`, async () => {
            const r: any = await setStatus(status);

            expect(r.success).toBe(true);
            const written = allWrites().find((p) => p && 'status' in p);
            expect(written?.status).toBe(status);
        });
    }

    it('accepts the statuses the payment path writes', async () => {
        // export-payment.ts writes these directly, so an order can already hold
        // one. The admin page pre-fills the dropdown with the order's current
        // status, and saving it unchanged must not be rejected.
        for (const status of ['completed', 'cancelled_out_of_stock']) {
            jest.clearAllMocks();
            const r: any = await setStatus(status);
            expect(r.success).toBe(true);
        }
    });

    it('refuses a non-admin regardless of the status', async () => {
        setSession(PARTICIPANT, ['export_participant']);

        const r: any = await setStatus('processing');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });
});

describe('the other endpoints refuse a non-admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(PARTICIPANT, ['export_participant']);
        setDocs();
    });

    const cases: Array<[string, any[]]> = [
        ['createExportCatalogAction', [{ name: 'Cocoa', isActive: true }]],
        ['getExportRequestStatsAction', []],
        ['getExportCatalogStatsAction', []],
        ['deleteExportCatalogAction', [PRODUCT]],
        ['getAdminPendingExportProductsAction', []],
        ['reviewExportProductAction', [PRODUCT, 'approve']],
        ['getAdminExportOrdersAction', []],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses`, async () => {
            const mod: any = await import('@/app/actions/export-admin');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        });
    }

    it('lets an admin approve a product, so the refusals above are not vacuous', async () => {
        setSession(ADMIN, ['admin']);
        const { reviewExportProductAction } = await import('@/app/actions/export-admin');

        const r: any = await reviewExportProductAction(PRODUCT, 'approve');

        expect(r.success).toBe(true);
        const written = allWrites().find((p) => p && 'status' in p);
        expect(written?.status).toBe('live');
        expect(written?.isActive).toBe(true);
    });

    it('a rejection takes the product off the catalogue', async () => {
        // The pair of the case above: reject must clear isActive, or a rejected
        // product stays live and readable.
        setSession(ADMIN, ['admin']);
        const { reviewExportProductAction } = await import('@/app/actions/export-admin');

        await reviewExportProductAction(PRODUCT, 'reject');

        const written = allWrites().find((p) => p && 'status' in p);
        expect(written?.status).toBe('rejected');
        expect(written?.isActive).toBe(false);
    });
});
