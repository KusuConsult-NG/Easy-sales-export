/**
 * @jest-environment node
 */

/**
 * The two defects the module sweep surfaced.
 *
 * AN UNAUTHENTICATED ENDPOINT THAT SPENDS SOMEBODY ELSE'S MONEY
 * ------------------------------------------------------------
 * `syncShipmentWithCarrierAction(shipmentId)` had no session check. Every other
 * WAVE endpoint has one, which is exactly why grouping by module found it: it
 * was not anomalous in its file, it was anomalous among its siblings.
 *
 * Three consequences followed:
 *
 *   It calls getLogisticsProvider().trackShipment() on every invocation, so an
 *   anonymous caller could drive the platform's outbound carrier API usage
 *   without limit — a bill, and a rate limit, that belong to somebody else.
 *
 *   It WRITES the returned status and update history onto the shipment.
 *
 *   Its three distinct replies — "Shipment not found", "No tracking number
 *   explicitly linked", and success — told an unauthenticated caller which
 *   shipment ids exist and which are live.
 *
 * Shipments carry memberId, written by _admin.ts when the shipment is created,
 * so ownership was available the whole time. A caller who is neither the member
 * nor an admin now gets the same "not found" a missing id gets.
 *
 * A COUNTER THAT LOST UPDATES
 * ---------------------------
 * `_getPropertyByIdAction` incremented a view count with
 *
 *     await propertyRef.update({ viewCount: (data.viewCount || 0) + 1 });
 *
 * Read, add in JavaScript, write the absolute result back. Two views landing
 * together read the same number and one is lost. The endpoint is public, so
 * concurrent reads are the normal case rather than the exception.
 *
 * This is the read-adjust-write shape closed for BALANCES in #138. The sweep for
 * it then covered money only; repeating it for persisted counters found this as
 * the single remaining site — everything else matching the pattern is an
 * in-memory tally over an array, which is fine. FieldValue.increment(1) is the
 * primitive the codebase already uses next door in wave/_actions.ts.
 *
 * NOT DEFECTS, AND WHY
 * --------------------
 * The sweep also flagged, and reading cleared:
 *
 *   confirmWalletFundingAction   money with no session, and correct. The
 *                                Paystack reference IS the credential; the
 *                                amount and the user come from Paystack rather
 *                                than the caller; the charged amount is checked
 *                                against the metadata; and creditWalletOnce
 *                                makes a replay a no-op crediting the rightful
 *                                owner.
 *
 *   deleteMyNotification         reported unguarded because its session check is
 *                                one level down in currentUserId(). It verifies
 *                                ownership and answers "not found" across users.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const MEMBER = 'member-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';

const mockTrackShipment = jest.fn(async () => [
    { status: 'in_transit', location: 'Lagos', timestamp: new Date() },
]) as jest.Mock<any>;

jest.mock('@/lib/logistics', () => ({
    getLogisticsProvider: () => ({
        trackShipment: (...a: any[]) => mockTrackShipment(...a),
        createShipment: jest.fn(),
    }),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: jest.fn(async () => ({ ok: true, value: 1 })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

function setDoc(data: Record<string, any> | null) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: data !== null,
        empty: data === null,
        size: data ? 1 : 0,
        docs: [],
        data: () => data ?? {},
    }));
}

describe('the shipment sync belongs to the shipment', () => {
    const SHIPMENT = { memberId: MEMBER, trackingNumber: 'TRK-1', status: 'pending', updates: [] };

    beforeEach(() => {
        jest.clearAllMocks();
        mockTrackShipment.mockResolvedValue([{ status: 'in_transit', location: 'Lagos', timestamp: new Date() }]);
        setDoc(SHIPMENT);
    });

    async function sync() {
        const { syncShipmentWithCarrierAction } = await import('@/app/actions/wave/_actions');
        return syncShipmentWithCarrierAction('WSH-1') as any;
    }

    it('refuses an unauthenticated caller', async () => {
        // THE test. This was reachable with no session at all.
        setSession(null);

        const r = await sync();

        expect(r.success).toBe(false);
    });

    it('does not call the carrier for an unauthenticated caller', async () => {
        // The consequence that costs money: an outbound API call per invocation,
        // billed to the platform, triggerable by anyone.
        setSession(null);

        await sync();

        expect(mockTrackShipment).not.toHaveBeenCalled();
    });

    it('refuses a signed-in stranger, and does not call the carrier', async () => {
        setSession(STRANGER, ['wave_participant']);

        const r = await sync();

        expect(r.success).toBe(false);
        expect(mockTrackShipment).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('answers a stranger with "not found", not "unauthorized"', async () => {
        // Three distinct replies used to tell an anonymous caller which shipment
        // ids exist and which are live.
        setSession(STRANGER, ['wave_participant']);

        const r = await sync();

        expect(String(r.error)).toMatch(/not found/i);
    });

    it('serves the member whose shipment it is', async () => {
        // Vacuity guard. Every refusal above passes against an action that does
        // nothing at all, so the feature has to be shown working.
        setSession(MEMBER, ['wave_participant']);

        const r = await sync();

        expect(r.success).toBe(true);
        expect(mockTrackShipment).toHaveBeenCalledWith('TRK-1');
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
    });

    it('serves an admin', async () => {
        setSession(ADMIN, ['admin']);

        expect((await sync()).success).toBe(true);
    });

    it('still refuses a shipment with no tracking number, for its owner', async () => {
        // Pre-existing behaviour, pinned — and now only reachable by someone
        // entitled to learn it.
        setSession(MEMBER, ['wave_participant']);
        setDoc({ memberId: MEMBER, status: 'pending' });

        const r = await sync();

        expect(r.success).toBe(false);
        expect(mockTrackShipment).not.toHaveBeenCalled();
    });
});

describe('the view counter cannot lose an update', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDoc({ title: 'A property', viewCount: 41, ownerId: 'owner-1' });
    });

    it('increments atomically rather than reading and writing back', async () => {
        // THE test. `(data.viewCount || 0) + 1` writes an absolute value, so two
        // concurrent views both write 42 and one view is lost. The endpoint is
        // public, so that is the normal case.
        const { getPropertyByIdAction } = await import('@/app/actions/farm-nation');

        const r: any = await getPropertyByIdAction('prop-1');

        expect(r.success).toBe(true);

        const patch = (global as any).mockFirestoreUpdate.mock.calls
            .map((c: any[]) => c[1])
            .find((p: any) => p && 'viewCount' in p);

        expect(patch).toBeDefined();
        // The sentinel, not a number computed in JavaScript.
        expect(typeof patch.viewCount).not.toBe('number');
        expect(JSON.stringify(patch.viewCount ?? '')).not.toContain('42');
    });

    it('still returns the property', async () => {
        // Vacuity guard.
        const { getPropertyByIdAction } = await import('@/app/actions/farm-nation');

        const r: any = await getPropertyByIdAction('prop-1');

        expect(r.data.property.title).toBe('A property');
    });

    it('leaves no hand-rolled persisted counter behind it', async () => {
        // The sweep for this shape. Everything else matching it is an in-memory
        // tally over an array, which is correct; this was the only site writing
        // a computed counter back to the database.
        const { execSync } = await import('child_process');

        const hits = execSync(
            `grep -rn "update({ *[a-zA-Z]*: *(.*|| 0) + 1" src/app src/lib || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).trim();

        expect(hits).toBe('');
    });
});
