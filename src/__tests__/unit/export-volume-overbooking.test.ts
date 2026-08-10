/**
 * @jest-environment node
 */

/**
 * Export window volume — two doors onto one counter, neither of them bounded.
 *
 * WHAT WAS WRONG
 * --------------
 * Both paths checked remaining volume and then raised currentVolume, with no
 * lock between the two. Two bookings for the remaining volume both passed and
 * the window went over target.
 *
 * export-booking.ts createBookingAction — check, then FieldValue.increment,
 *   with NO TRANSACTION AT ALL. That is why every sweep of the atomic-money
 *   migration missed the file: those tables are ordered by runTransaction count
 *   and this file has none. It appears nowhere in atomic-money-migration.md.
 *
 * export-aggregation.ts bookExportSlotAction — the worse of the two:
 *
 *     currentVolume: windowData.currentVolume + data.volume
 *
 *   an ABSOLUTE write from a stale read, not the sentinel, so migration 010
 *   cannot help it. It does not merely overbook — it ERASES any other write to
 *   currentVolume in between, including the other door's increment, so the
 *   window then believes less volume is taken than really is.
 *
 * Migration 010 made both worse rather than better, as it did for escrow,
 * cooperative savings and stock: the increments used to lose one another, which
 * accidentally hid the overshoot.
 *
 * See docs/audit/integrity-sweep-2026-08-10.md (F4).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockCeiling = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: (...args: any[]) => mockCeiling(...args),
    claimPaymentOnce: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function setWindow(data: Record<string, any> = {}) {
    const snap = {
        exists: true,
        docs: [],
        empty: false,
        id: 'win-1',
        data: () => ({
            targetVolume: 10_000,
            currentVolume: 9_000,
            slotPrice: 50,
            status: 'open',
            endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            ...data,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** Any direct .update() that still moves the counter itself. */
function volumeWrites() {
    const direct = ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'currentVolume' in f);
    const inTx = ((global as any).mockFirestoreTxUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'currentVolume' in f);
    return [...direct, ...inTx];
}

function touched(name: string) {
    return ((global as any).mockFirestoreCollection.mock.calls as any[])
        .some(([n]) => n === name);
}

describe('export-booking — createBookingAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setWindow();
        mockCeiling.mockResolvedValue({ ok: true, value: 9_500, reason: null });
    });

    async function book(quantity = 500) {
        const { createBookingAction } = await import('@/app/actions/export-booking');
        return createBookingAction({ exportWindowId: 'win-1', quantity, totalPrice: quantity * 50 });
    }

    it('reserves the volume through the bounded primitive', async () => {
        await book(500);

        expect(mockCeiling).toHaveBeenCalledTimes(1);
        expect(mockCeiling).toHaveBeenCalledWith(expect.objectContaining({
            collection: 'exportWindows',
            id: 'win-1',
            field: 'currentVolume',
            amount: 500,
            ceilingField: 'targetVolume',
        }));
    });

    it('never raises currentVolume itself', async () => {
        await book(500);

        expect(volumeWrites()).toHaveLength(0);
    });

    it('creates no booking when the window is at capacity', async () => {
        // THE test. Two bookings for the last 500kg both passed before.
        mockCeiling.mockResolvedValue({ ok: false, value: 10_000, reason: 'at_capacity' });

        const result: any = await book(500);

        expect(result.success).toBe(false);
        expect(touched('export_bookings')).toBe(false);
    });

    it('does reach the booking collection when there is room', async () => {
        // Vacuity guard for the test above — see the note on its counterpart in
        // the aggregation block about why success is not asserted here.
        await book(500);

        expect(touched('export_bookings')).toBe(true);
    });

    it('reserves before it writes the booking, never the other way round', async () => {
        // The loser must be told the volume is gone, not left holding a booking
        // against capacity that does not exist.
        const order: string[] = [];
        mockCeiling.mockImplementation(() => {
            order.push('reserve');
            return Promise.resolve({ ok: true, value: 9_500, reason: null });
        });
        (global as any).mockFirestoreCollection.mockImplementation((n: string) => {
            if (n === 'export_bookings') order.push('booking');
        });

        await book(500);

        // Assert both happened before asserting their order. Without this, the
        // pre-fix code passes trivially: it never reserves, so indexOf('reserve')
        // is -1 and -1 is less than any real index.
        expect(order).toContain('reserve');
        expect(order).toContain('booking');
        expect(order.indexOf('reserve')).toBeLessThan(order.indexOf('booking'));
    });

    it('reports the remaining volume from the locked read', async () => {
        mockCeiling.mockResolvedValue({ ok: false, value: 9_800, reason: 'at_capacity' });

        const result: any = await book(500);

        expect(result.error).toContain('200kg');
    });
});

describe('export-aggregation — bookExportSlotAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setWindow();
        mockCeiling.mockResolvedValue({ ok: true, value: 9_500, reason: null });
    });

    async function book(volume = 500) {
        const { bookExportSlotAction } = await import('@/app/actions/export-aggregation');
        return bookExportSlotAction({
            windowId: 'win-1',
            userId: 'member-1',
            userEmail: 'member-1@example.com',
            fullName: 'Ada Obi',
            volume,
        });
    }

    it('reserves the volume through the bounded primitive', async () => {
        await book(500);

        expect(mockCeiling).toHaveBeenCalledWith(expect.objectContaining({
            collection: 'exportWindows',
            field: 'currentVolume',
            amount: 500,
            ceilingField: 'targetVolume',
        }));
    });

    it('never writes currentVolume itself', async () => {
        // The absolute write is the specific defect here: it erased the other
        // door's increment, not just its own.
        await book(500);

        expect(volumeWrites()).toHaveLength(0);
    });

    it('creates no slot when the window is at capacity', async () => {
        mockCeiling.mockResolvedValue({ ok: false, value: 10_000, reason: 'at_capacity' });

        const result: any = await book(500);

        expect(result.success).toBe(false);
        expect(touched('export_slots')).toBe(false);
    });

    it('does reach the slot collection when there is room', async () => {
        // Guards the assertion above from passing vacuously: if the collection
        // name were wrong, touched() would return false either way and the
        // at-capacity test would prove nothing.
        //
        // Deliberately does NOT assert result.success. The shared jest harness
        // has no .add() on a collection (jest.setup.js), so any action that
        // creates a document through collection().add() throws and returns its
        // generic error no matter what. That is a harness gap, not a behaviour
        // of this code — and it is why the at-capacity assertions above are
        // written against the collection being reached rather than against the
        // returned success flag.
        await book(500);

        expect(touched('export_slots')).toBe(true);
    });

    it('still refuses a closed window before reserving anything', async () => {
        setWindow({ status: 'closed' });

        const result: any = await book(500);

        expect(result.success).toBe(false);
        expect(mockCeiling).not.toHaveBeenCalled();
    });
});
