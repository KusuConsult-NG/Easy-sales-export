/**
 * @jest-environment node
 */

/**
 * The sibling the file's own comment warned about.
 *
 * `bookExportSlotAction` carries a comment describing a defect fixed in it:
 *
 *     requireSession() was called and the result never used again. The slot was
 *     booked for `data.userId` — a caller-supplied id...
 *
 *     Every use in this function is replaced, not just the first. Fixing one
 *     copy and leaving its siblings is how this class keeps surviving.
 *
 * A hundred lines below, `getUserExportSlotsAction(userId)` called
 * requireSession(), checked only `sessionResult.error`, and then queried
 * `.where("userId", "==", userId)` on the caller-supplied id. The session was
 * fetched and never used.
 *
 * The sibling was left. Any authenticated user could read anyone's export
 * slots, which carry the booker's name, email and booked volume.
 *
 * THE SECOND: THE ACTOR WAS TAKEN FROM THE REQUEST
 * ------------------------------------------------
 * `createExportWindowAction` is properly gated by requireAdmin(), and then
 * wrote `createdBy: data.adminId` — a caller parameter — and passed the same id
 * to the audit log, while requireAdmin() had just returned the real actor and it
 * was discarded.
 *
 * So one admin could create a window attributed to another, with the audit entry
 * agreeing. Same shape as the dispute assignee in #122 and the property seller
 * in #103: a value the server already holds, taken from the client instead.
 *
 * THE THIRD: THE PRICE A BOOKING IS COMPUTED FROM
 * -----------------------------------------------
 * slotPrice was stored unvalidated. #127 made it the authoritative figure for
 * createBookingAction, which multiplies it by the tonnage — so this is the
 * source side of a check that already exists at the boundary.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const OTHER_ADMIN = 'admin-2';
const OWNER = 'owner-1';
const STRANGER = 'stranger-1';

const mockRequireAdmin = jest.fn() as jest.Mock<any>;
const mockAuditLog = jest.fn(async () => ({})) as jest.Mock<any>;

jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: (...a: any[]) => mockAuditLog(...a),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: jest.fn(async () => ({ ok: true, value: 10 })),
    claimPaymentOnce: jest.fn(), creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

function setWorld(slots: any[] = []) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: slots.length === 0, size: slots.length,
        docs: slots.map((s, i) => ({ id: `slot-${i}`, data: () => s })),
        data: () => ({ status: 'open', endDate: new Date(Date.now() + 86_400_000), targetVolume: 1000, currentVolume: 0, slotPrice: 850 }),
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: true, docs: [], data: () => ({}),
    }));
}

async function readSlots(target: string) {
    const { getUserExportSlotsAction } = await import('@/app/actions/export-aggregation');
    return getUserExportSlotsAction(target);
}

describe('getUserExportSlotsAction — the sibling that was left', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld([{ userId: OWNER, volume: 50, fullName: 'A Booker', userEmail: 'a@e.com' }]);
    });

    it('refuses a caller reading somebody else\'s slots', async () => {
        // THE test. Export slots carry the booker's name, email and volume.
        setSession(STRANGER, ['exporter']);

        const r: any = await readSlots(OWNER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });

    it('serves a caller their own slots', async () => {
        // Vacuity guard: a refusal that also blocked the owner would remove the
        // feature rather than secure it.
        setSession(OWNER, ['exporter']);

        const r: any = await readSlots(OWNER);

        expect(r.success).toBe(true);
        expect(Array.isArray(r.data)).toBe(true);
    });

    it('lets an export admin read another user\'s slots', async () => {
        setSession(ADMIN, ['export_admin']);

        const r: any = await readSlots(OWNER);

        expect(r.success).toBe(true);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await readSlots(OWNER);

        expect(r.success).toBe(false);
    });
});

describe('createExportWindowAction — the creator is who called', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockRequireAdmin.mockResolvedValue({ userId: ADMIN });
    });

    const validWindow = {
        title: 'Q3 Cocoa',
        commodity: 'cocoa',
        targetVolume: 10_000,
        slotPrice: 850,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        destination: 'Rotterdam',
        adminId: OTHER_ADMIN,
    };

    async function createWindow(overrides: Record<string, any> = {}) {
        const { createExportWindowAction } = await import('@/app/actions/export-aggregation');
        return createExportWindowAction({ ...validWindow, ...overrides } as any);
    }

    function windowWritten(): Record<string, any> | undefined {
        return (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'slotPrice' in d);
    }

    it('records the acting admin, not the id in the request', async () => {
        // data.adminId names a DIFFERENT admin on purpose.
        const r: any = await createWindow();

        expect(r.success).toBe(true);
        expect(windowWritten()?.createdBy).toBe(ADMIN);
        expect(windowWritten()?.createdBy).not.toBe(OTHER_ADMIN);
    });

    it('audits the acting admin too', async () => {
        // An audit entry that agrees with a false attribution vouches for it.
        await createWindow();

        expect(mockAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ userId: ADMIN })
        );
    });

    it('refuses a slot price of zero', async () => {
        // #127 made slotPrice the authoritative figure a booking is computed
        // from; this is the source side of that check.
        const r: any = await createWindow({ slotPrice: 0 });

        expect(r.success).toBe(false);
        expect(windowWritten()).toBeUndefined();
    });

    it('refuses a negative slot price', async () => {
        const r: any = await createWindow({ slotPrice: -850 });

        expect(r.success).toBe(false);
        expect(windowWritten()).toBeUndefined();
    });

    it('refuses a non-positive target volume', async () => {
        const r: any = await createWindow({ targetVolume: 0 });

        expect(r.success).toBe(false);
        expect(windowWritten()).toBeUndefined();
    });

    it('refuses a non-admin', async () => {
        mockRequireAdmin.mockResolvedValue({ error: 'Unauthorized' });

        const r: any = await createWindow();

        expect(r.success).toBe(false);
        expect(windowWritten()).toBeUndefined();
    });
});
