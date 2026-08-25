/**
 * @jest-environment node
 */

/**
 *   #237 AN OWNER EDIT OR DELETE ERASED A BUYER'S RESERVATION.
 *
 *        A buyer reserving a parcel claims the LAND_LISTINGS row to "pending"
 *        (_fn_purchases.ts) and goes to Paystack. Fulfilment and cancellation
 *        both advance it FROM "pending" via claimStatusTransition — that is the
 *        whole double-sale defence built in #135–#139.
 *
 *        The owner's own paths in land-actions.ts wrote straight through it:
 *
 *          updateLandListing   status: "pending_verification", unconditionally
 *          deleteLandListing   status: "deleted"
 *
 *        An owner edit landing while the buyer paid re-priced and re-reviewed
 *        the parcel under them; a delete tombstoned it. Either way the claim
 *        that fulfils or refunds the purchase can never move the row again —
 *        the money taken, the purchase stranded. `sold` was editable too.
 *
 *        This is the owner's copy of the fault the ADMIN decision paths were
 *        already taught about (#137 / DECISION_LOCKED_STATUSES). The rule is
 *        shared: OWNER_MUTABLE_STATUSES in land-listing-status.ts, the same
 *        shape as APPROVABLE_FROM — review states, for-sale states, and
 *        `rejected` so an owner can fix a refused listing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    isOwnerMutable,
    OWNER_MUTABLE_STATUSES,
    DECISION_LOCKED_STATUSES,
} from '@/lib/land-listing-status';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;

const actions = async () => await import('@/app/actions/land-actions');

const actAs = (id: string | null, roles: string[] = ['land_owner']) =>
    mockRequireSession.mockResolvedValue(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, email: `${id}@e.com`, roles } }, error: null });

const seedListing = (status: string, extra: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, 'plot-1', {
        ownerId: OWNER, title: 'Plot 1', size: 2, price: 500_000,
        location: { state: 'Plateau', city: 'Jos', lat: 9.9, lng: 8.9 },
        status,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });

const update = async () => (await (await actions()).updateLandListing({
    listingId: 'plot-1', price: 750_000,
} as any)) as any;

const del = async () => (await (await actions()).deleteLandListing('plot-1')) as any;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(OWNER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#237 — a reservation survives its owner', () => {
    it('THE OWNER CANNOT EDIT A LISTING A BUYER HAS RESERVED', async () => {
        seedListing('pending', { pendingBuyerId: 'buyer-7', previousStatus: 'verified' });

        const res = await update();

        // Was: success, status rewritten to pending_verification, the buyer's
        // claim path dead.
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/purchase is in progress/i);
        expect(store.get(LISTINGS, 'plot-1')?.status).toBe('pending');
        expect(store.get(LISTINGS, 'plot-1')?.pendingBuyerId).toBe('buyer-7');
        expect(store.get(LISTINGS, 'plot-1')?.price).toBe(500_000);
    });

    it('NOR DELETE IT', async () => {
        seedListing('pending', { pendingBuyerId: 'buyer-7' });

        const res = await del();

        expect(res.success).toBe(false);
        expect(store.get(LISTINGS, 'plot-1')?.status).toBe('pending');
    });

    it.each(['pending_payment', 'pending_escrow', 'payment_confirmed', 'pending_transfer', 'sold', 'leased'])(
        'and a listing in %s is locked the same way', async (status) => {
            seedListing(status);

            expect(await update()).toMatchObject({ success: false });
            expect(await del()).toMatchObject({ success: false });
            expect(store.get(LISTINGS, 'plot-1')?.status).toBe(status);
        });

    // ── everything an owner should be able to do still works ────────────────

    it.each(['pending_verification', 'verified', 'available', 'approved', 'rejected', 'draft'])(
        'still edits a listing in %s', async (status) => {
            seedListing(status);

            expect(await update()).toMatchObject({ success: true });
            expect(store.get(LISTINGS, 'plot-1')?.price).toBe(750_000);
            // An edit goes back through review, as before.
            expect(store.get(LISTINGS, 'plot-1')?.status).toBe('pending_verification');
        });

    it('still deletes a verified listing', async () => {
        seedListing('verified');

        expect(await del()).toMatchObject({ success: true });
        expect(store.get(LISTINGS, 'plot-1')?.status).toBe('deleted');
    });

    it('still edits a legacy row with no status at all', async () => {
        seedListing(undefined as unknown as string);
        const row = store.get(LISTINGS, 'plot-1')!;
        delete (row as any).status;

        expect(await update()).toMatchObject({ success: true });
    });

    it('still refuses somebody who is not the owner', async () => {
        seedListing('verified');
        actAs('intruder-1');

        expect(await update()).toMatchObject({ success: false });
        expect(await del()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rule agrees with the vocabulary it lives beside', () => {
    it('no owner-mutable status is decision-locked', () => {
        for (const s of OWNER_MUTABLE_STATUSES) {
            expect(DECISION_LOCKED_STATUSES).not.toContain(s);
        }
    });

    it('"pending" — the reservation — is mutable by NOBODY\'s list', () => {
        expect(OWNER_MUTABLE_STATUSES).not.toContain('pending');
        expect(isOwnerMutable('pending')).toBe(false);
    });

    it('a missing status is mutable, an unknown one is not', () => {
        expect(isOwnerMutable(undefined)).toBe(true);
        expect(isOwnerMutable(null)).toBe(true);
        expect(isOwnerMutable('')).toBe(true);
        expect(isOwnerMutable('some_future_status')).toBe(false);
    });
});
