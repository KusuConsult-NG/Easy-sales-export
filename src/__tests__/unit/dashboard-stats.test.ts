/**
 * @jest-environment node
 */

/**
 * Four of the six figures on the main dashboard read zero for everybody.
 *
 * THE EXPORT THREE
 * ----------------
 * `getDashboardStatsAction` filtered EXPORT_WINDOWS by `userId` three times —
 * for totalExports, activeOrders, and the export half of totalEscrow.
 *
 * **A window has no userId.** export-aggregation.ts is the only thing that
 * creates one, and its document is
 *
 *     { title, commodity, targetVolume, currentVolume, slotPrice,
 *       startDate, endDate, destination, status, createdAt, createdBy }
 *
 * `createdBy` being the ADMIN who opened it. A user has no relationship to a
 * window at all — their participation is a SLOT or a BOOKING:
 *
 *     EXPORT_SLOTS     { windowId, userId, volume, totalCost, status }
 *     EXPORT_BOOKINGS  { userId, exportWindowId, quantity, totalPrice, status }
 *
 * Both are queried now, because both are written and neither is a superset —
 * they are the two doors export-booking.ts's own comment describes.
 *
 * The export escrow sum was doubly wrong: windows have no `amount` field
 * either, so even a matching row would have summed undefined.
 *
 * THE COOPERATIVE ONE
 * -------------------
 *     const cooperativeId = userData?.cooperativeId;
 *     if (cooperativeId) { ...read the membership... }
 *
 * Nothing in the codebase writes `cooperativeId` onto a USER document — it
 * lives on the membership record and on withdrawal rows. The gate never
 * opened, so cooperativeSavings was reported as 0 to every member, including
 * one with money.
 *
 * The membership record is keyed BY the user id — platform.ts and admin.ts both
 * write `COOPERATIVE_MEMBERS.doc(userId)` — so it is read directly now. The
 * gate was never needed to find it.
 *
 * WHY THIS KIND SURVIVES
 * ----------------------
 * A dashboard of zeros looks exactly like a user who has not started yet.
 * Nobody reports it. The same shape as the vendor dashboard in #132 and the
 * forensics reconciliation in #118 — a query against a field nothing writes —
 * except this is the screen every user sees first.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * The marketplace escrow figure, which queries ESCROW_TRANSACTIONS by
 * `participants array-contains` — a field _escrow.ts really does write — and
 * the access control: every query is scoped to session.user.id, with no
 * caller-supplied id anywhere.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p), createAdminAuditLog: jest.fn(async () => ({})) }));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

/**
 * Answers by collection. `count()` results carry a data().count; document
 * queries carry docs.
 */
function setWorld(opts: {
    slots?: any[];
    bookings?: any[];
    member?: Record<string, any> | null;
    marketplaceEscrow?: any[];
    enrollments?: number;
} = {}) {
    const slots = opts.slots ?? [];
    const bookings = opts.bookings ?? [];
    const member = opts.member ?? null;
    const escrows = opts.marketplaceEscrow ?? [];
    const enrollments = opts.enrollments ?? 0;

    const docs = (rows: any[]) => rows.map((r, i) => ({ id: `d${i}`, data: () => r }));

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        switch (idOrCollection) {
            case 'export_slots':
                return Promise.resolve({ empty: slots.length === 0, size: slots.length, docs: docs(slots), data: () => ({}) });
            case 'export_bookings':
                return Promise.resolve({ empty: bookings.length === 0, size: bookings.length, docs: docs(bookings), data: () => ({}) });
            case 'escrow_transactions':
                return Promise.resolve({ empty: escrows.length === 0, size: escrows.length, docs: docs(escrows), data: () => ({}) });
            case 'enrollments_aggregate':
            case 'enrollments':
                return Promise.resolve({ empty: true, size: 0, docs: [], data: () => ({ count: enrollments }) });
            case USER:
                // Either the user document or the membership record, both at
                // doc(userId). The user doc deliberately has NO cooperativeId —
                // that is the point of the gate finding.
                return Promise.resolve(
                    member
                        ? { exists: true, empty: false, docs: [], data: () => member }
                        : { exists: true, empty: false, docs: [], data: () => ({ onboardingCompleted: true }) }
                );
            default:
                return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({ count: 0 }) });
        }
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

async function stats() {
    const { getDashboardStatsAction } = await import('@/app/actions/dashboard');
    return getDashboardStatsAction();
}

describe('the export figures come from records a user actually has', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
    });

    it('counts a user\'s slots and bookings', async () => {
        // THE test. Every one of these used to be counted against
        // EXPORT_WINDOWS, which has no userId, so the answer was always 0.
        setWorld({
            slots: [{ status: 'pending', totalCost: 40_000 }],
            bookings: [{ status: 'in_transit', totalPrice: 60_000 }],
        });

        const r: any = await stats();

        expect(r.success).toBe(true);
        expect(r.data.totalExports).toBe(2);
    });

    it('counts only the unsettled ones as active', async () => {
        setWorld({
            slots: [{ status: 'pending', totalCost: 40_000 }, { status: 'completed', totalCost: 10_000 }],
            bookings: [{ status: 'in_transit', totalPrice: 60_000 }],
        });

        const r: any = await stats();

        expect(r.data.activeOrders).toBe(2);
    });

    it('sums the money held against them', async () => {
        // Windows have no `amount` field either, so the old sum would have
        // added undefined even if a row had matched.
        setWorld({
            slots: [{ status: 'pending', totalCost: 40_000 }],
            bookings: [{ status: 'in_transit', totalPrice: 60_000 }],
        });

        const r: any = await stats();

        expect(r.data.totalEscrow).toBe(100_000);
    });

    it('adds marketplace escrow, which was already correct', async () => {
        // ESCROW_TRANSACTIONS by `participants array-contains` — a field
        // _escrow.ts really does write.
        setWorld({
            slots: [{ status: 'pending', totalCost: 40_000 }],
            marketplaceEscrow: [{ status: 'funded', amount: 25_000 }],
        });

        const r: any = await stats();

        expect(r.data.totalEscrow).toBe(65_000);
    });

    it('reports zero for a user with no exports, without erroring', async () => {
        // The honest zero, which must still work — it is what the broken
        // version returned for everybody and is correct here.
        setWorld({});

        const r: any = await stats();

        expect(r.success).toBe(true);
        expect(r.data.totalExports).toBe(0);
        expect(r.data.totalEscrow).toBe(0);
    });
});

describe('cooperative savings no longer sit behind a gate that never opens', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
    });

    it('reads the membership record even though the user doc has no cooperativeId', async () => {
        // THE test for this half. Nothing writes cooperativeId onto a user
        // document, so the old `if (cooperativeId)` was never entered.
        setWorld({ member: { savingsBalance: 750_000 } });

        const r: any = await stats();

        expect(r.data.cooperativeSavings).toBe(750_000);
    });

    it('falls back to the legacy balance field', async () => {
        setWorld({ member: { balance: 120_000 } });

        const r: any = await stats();

        expect(r.data.cooperativeSavings).toBe(120_000);
    });

    it('reports zero when there is no membership at all', async () => {
        setWorld({ member: null });

        const r: any = await stats();

        expect(r.data.cooperativeSavings).toBe(0);
    });
});

describe('access control', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        setWorld({});

        const r: any = await stats();

        expect(r.success).toBe(false);
    });

    it('takes no user id as a parameter', async () => {
        // Every query is scoped to session.user.id and there is no argument to
        // substitute. Asserted on the signature, since adding one later would
        // not fail a behavioural test.
        const mod: any = await import('@/app/actions/dashboard');

        expect(mod.getDashboardStatsAction.length).toBe(0);
    });
});
