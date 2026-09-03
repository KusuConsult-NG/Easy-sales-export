/**
 * @jest-environment node
 */

/**
 * A booking recorded whatever price the browser calculated.
 *
 * `createBookingAction` took `totalPrice` as a parameter, checked only that it
 * was above zero, and stored it as the booking's money figure.
 * BookingWizard.tsx computes it as `volume * exportWindow.slotPrice` and sends
 * the result — so the arithmetic the server recorded was the client's.
 *
 * The server had `slotPrice` in the very document it had just read. And
 * export-aggregation.ts already does this correctly, one file over:
 *
 *     const totalCost = data.volume * windowData.slotPrice;
 *
 * The same "the sibling gets it right" evidence as the review path in #117 and
 * the dispute assignee in #122.
 *
 * WHY IT MATTERS MORE THAN A WRONG NUMBER
 * ---------------------------------------
 * A booking RESERVES capacity. incrementWithinCeiling raises the window's
 * currentVolume against its targetVolume before the booking row is written, so
 * a caller-chosen price meant consuming an export window's volume — the thing
 * that is actually scarce — while recording any total they liked against it.
 *
 * Nothing else in the codebase reads EXPORT_BOOKINGS today, so no automatic
 * charge follows. That makes this a record-integrity defect rather than a
 * direct theft, and it is described that way rather than inflated: the booking
 * is what operations would invoice from.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * The volume reservation, and it is worth saying so. It uses
 * incrementWithinCeiling with a ceiling field, reserves BEFORE writing the
 * booking, and its comment records the earlier defect — a read-compare-write
 * with no transaction, which every sweep of the atomic-money migration missed
 * because those sweeps were ordered by runTransaction count and this file has
 * none. Those properties are asserted here so they cannot regress.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BOOKER = 'booker-1';
const WINDOW = 'window-1';
const SLOT_PRICE = 850;

const mockIncrementWithinCeiling = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: (...a: any[]) => mockIncrementWithinCeiling(...a),
    claimPaymentOnce: jest.fn(), creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p), createAdminAuditLog: jest.fn(async () => ({})) }));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

function setWindow(overrides: Record<string, any> = {}) {
    const data = { slotPrice: SLOT_PRICE, targetVolume: 10_000, currentVolume: 0, status: 'open', ...overrides };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: overrides.missing ? false : true, empty: false, docs: [], data: () => data,
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
}

function bookingWritten(): Record<string, any> | undefined {
    return (global as any).mockFirestoreAdd.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .find((d: any) => d && 'exportWindowId' in d);
}

async function book(quantity: number, claimedTotal: number) {
    const { createBookingAction } = await import('@/app/actions/export-booking');
    return createBookingAction({ exportWindowId: WINDOW, quantity, totalPrice: claimedTotal } as any);
}

describe('createBookingAction — the price comes from the window', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BOOKER);
        setWindow();
        mockIncrementWithinCeiling.mockResolvedValue({ ok: true, value: 100 });
    });

    it('records slotPrice × quantity, not the total the caller sent', async () => {
        // THE test. 100 kg at ₦850 is ₦85,000, whatever the browser says.
        await book(100, 1);

        expect(bookingWritten()?.totalPrice).toBe(100 * SLOT_PRICE);
        expect(bookingWritten()?.totalPrice).not.toBe(1);
    });

    it('records the rate it used, so the figure can be checked later', async () => {
        // slotPrice can change; a booking that records only a total cannot be
        // reconciled against the window afterwards.
        await book(100, 1);

        expect(bookingWritten()?.slotPriceAtBooking).toBe(SLOT_PRICE);
    });

    it('refuses a window with no usable price rather than booking at zero', async () => {
        setWindow({ slotPrice: 0 });

        const r: any = await book(100, 85_000);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not priced/i);
    });

    it('refuses a window with a negative price', async () => {
        setWindow({ slotPrice: -850 });

        const r: any = await book(100, 85_000);

        expect(r.success).toBe(false);
    });

    it('does not reserve volume when the price is unusable', async () => {
        // Volume is the scarce thing here. Deriving the price BEFORE the
        // reservation means a bad window cannot consume capacity on its way to
        // failing.
        setWindow({ slotPrice: 0 });

        await book(100, 85_000);

        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
    });

    it('still books normally', async () => {
        // Vacuity guard. Every refusal above is satisfied by an action that
        // books nobody, which would close the export module.
        const r: any = await book(100, 85_000);

        expect(r.success).toBe(true);
        expect(bookingWritten()?.userId).toBe(BOOKER);
        expect(bookingWritten()?.quantity).toBe(100);
    });
});

describe('createBookingAction — the reservation that was already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BOOKER);
        setWindow();
        mockIncrementWithinCeiling.mockResolvedValue({ ok: true, value: 100 });
    });

    it('reserves against the ceiling before writing the booking', async () => {
        // Its comment records the earlier defect: a read-compare-write with no
        // transaction, which the atomic-money sweeps missed because they were
        // ordered by runTransaction count and this file has none.
        await book(100, 85_000);

        expect(mockIncrementWithinCeiling).toHaveBeenCalledWith(
            expect.objectContaining({
                field: 'currentVolume',
                ceilingField: 'targetVolume',
                amount: 100,
            })
        );
        expect(mockIncrementWithinCeiling.mock.invocationCallOrder[0])
            .toBeLessThan((global as any).mockFirestoreAdd.mock.invocationCallOrder[0]);
    });

    it('writes no booking when the window is at capacity', async () => {
        mockIncrementWithinCeiling.mockResolvedValue({ ok: false, reason: 'at_capacity', value: 10_000 });

        const r: any = await book(100, 85_000);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/available/i);
        expect(bookingWritten()).toBeUndefined();
    });

    it('refuses a non-positive quantity', async () => {
        const r: any = await book(-50, 85_000);

        expect(r.success).toBe(false);
        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await book(100, 85_000);

        expect(r.success).toBe(false);
        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
    });

    it('refuses a window that does not exist', async () => {
        setWindow({ missing: true });

        const r: any = await book(100, 85_000);

        expect(r.success).toBe(false);
        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
    });
});
