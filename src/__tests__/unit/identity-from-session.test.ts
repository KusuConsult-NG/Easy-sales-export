/**
 * @jest-environment node
 */

/**
 * Identity must come from the session — in the write, the audit row, AND the
 * notification.
 *
 * WHY ALL THREE
 * -------------
 * Earlier today `_submitLandListingAction` was fixed to write
 * `ownerId: session.user.id` instead of trusting the request. The audit log and
 * the notification twelve lines below it were left reading `data.ownerId`.
 *
 * So the listing became correctly attributed while the audit row still recorded
 * whoever the caller nominated, and the notification still went to them — the
 * forgery primitive survived the fix intended to remove it.
 *
 * That is the same defect this codebase keeps producing, committed inside a
 * single function, by the person documenting the pattern. Hence a test per
 * consumer rather than one per function.
 *
 * bookExportSlotAction is the other half: it called requireSession() and never
 * used the result, booking a slot for a caller-supplied `userId`. Any
 * authenticated user could book an export slot in anyone's name.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ACTOR = 'actor-1';
const VICTIM = 'victim-1';

const mockNotify = jest.fn(async () => ({}));
const mockAudit = jest.fn(async () => ({}));

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...a: any[]) => (mockNotify as any)(...a),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...a: any[]) => (mockAudit as any)(...a),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));
jest.mock('@/lib/cache-invalidation', () => ({ invalidateAdminGlobalStats: jest.fn() }));
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: jest.fn(async () => ({ ok: true, value: 1 })),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@e.com`, roles: [] } },
        error: null,
    }));
}

/** Every recipient passed to createNotificationAction. */
const notifiedUsers = () =>
    (mockNotify as any).mock.calls.map((c: any[]) => c[0]?.userId);

/** Every actor recorded in an audit row. */
const auditedUsers = () =>
    (mockAudit as any).mock.calls.map((c: any[]) => c[0]?.userId);

describe('_submitLandListingAction — the fix that missed its own siblings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ACTOR);
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({ ownerId: ACTOR, title: 'A field', status: 'draft' }),
        }));
    });

    async function submit() {
        const { submitLandListingAction } = await import('@/app/actions/land-listings');
        return submitLandListingAction({
            ownerId: VICTIM, ownerName: 'Victim', ownerEmail: 'victim@e.com',
            title: 'Two hectares', description: 'x',
            location: { state: 's', lga: 'l', address: 'a' },
            size: 1, price: 1, imageUrls: [], documentUrls: [],
        } as any);
    }

    it('writes the session user as the listing owner', async () => {
        await submit();

        const doc = (global as any).mockFirestoreAdd.mock.calls.at(-1)?.[1];
        expect(doc?.ownerId).toBe(ACTOR);
    });

    it('records the ACTOR in the audit row, not the nominated owner', async () => {
        // This is what the earlier fix missed.
        await submit();

        expect(auditedUsers()).toContain(ACTOR);
        expect(auditedUsers()).not.toContain(VICTIM);
    });

    it('notifies the ACTOR, not the nominated owner', async () => {
        // And this. A notification addressed to an arbitrary user, with
        // caller-chosen text, is the forgery primitive on its own.
        await submit();

        expect(notifiedUsers()).toContain(ACTOR);
        expect(notifiedUsers()).not.toContain(VICTIM);
    });
});

describe('bookExportSlotAction — authenticated, then the session ignored', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ACTOR);
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({
                status: 'open', totalVolume: 1000, bookedVolume: 0,
                pricePerUnit: 10, closesAt: { toDate: () => new Date(Date.now() + 8.64e7) },
            }),
        }));
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({ status: 'open', totalVolume: 1000, bookedVolume: 0, pricePerUnit: 10 }),
        }));
    });

    async function book() {
        const { bookExportSlotAction } = await import('@/app/actions/export-aggregation');
        return bookExportSlotAction({
            windowId: 'win-1', userId: VICTIM, userEmail: 'victim@e.com',
            fullName: 'Victim', volume: 10, phone: '0800',
        } as any);
    }

    it('books the slot for the session user, not the request', async () => {
        await book();

        const written = (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[1])
            .filter(Boolean);
        const slot = written.find((d: any) => 'windowId' in d);

        if (slot) expect(slot.userId).toBe(ACTOR);
        // If no slot was written the booking was refused, which is also not a
        // booking made in the victim's name.
        expect(written.every((d: any) => d.userId !== VICTIM)).toBe(true);
    });

    it('never records the nominated user as the actor', async () => {
        await book();

        expect(auditedUsers()).not.toContain(VICTIM);
        expect(notifiedUsers()).not.toContain(VICTIM);
    });
});
