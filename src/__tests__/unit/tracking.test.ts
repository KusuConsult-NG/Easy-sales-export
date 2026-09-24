/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "tracking should be realtime. when purchases are made how will
 *   seller notify buyers that goods are shipped?"
 *
 * ── THIS SUITE USED TO ASSERT THE FABRICATION ───────────────────────────────
 *
 *   Its own test was named "should return SIMULATED tracking updates for a
 *   valid tracking number", and it checked `providerName === "MockLogistics"`.
 *   It passed for years, and what it was pinning was a buyer watching a parcel
 *   cross Nigeria through "Sorting Facility" and "Regional Transit Hub" — a
 *   journey MockLogisticsProvider built out of the order's own dates.
 *
 *   The action took a TRACKING NUMBER and answered about it with no check that
 *   the caller had anything to do with the order, which was safe only because
 *   the answer was invented. Reading the real order means saying who may read
 *   it, and that is asserted below.
 *
 * ── WHAT IT ANSWERS NOW ─────────────────────────────────────────────────────
 *
 *   The order's own events, each carrying the moment it was actually written:
 *   placed, paid, shipped (with what the seller said about how it is
 *   travelling), delivered. A stage that has not happened is ABSENT rather
 *   than pending — an empty timeline row is the same kind of claim as an
 *   invented one.
 *
 *   The seller still notifies the buyer the instant they press Mark as
 *   Shipped; that part was always real. See lib/shipment-record.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const STRANGER = 'stranger-1';
const ORDER = 'order-1';

let store: FakeDbHandle;

function actAs(userId: string, roles: string[] = ['general_user']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: userId, roles, email: `${userId}@example.test`, name: userId } },
        error: null,
    }));
}

/** An order that has been paid for and shipped by a rider. */
function seedOrder(extra: Record<string, unknown> = {}) {
    store.seed(COLLECTIONS.MARKETPLACE_ORDERS, ORDER, {
        id: ORDER,
        buyerId: BUYER,
        sellerIds: [SELLER],
        status: 'shipped',
        createdAt: new Date('2026-09-01T09:00:00.000Z').toISOString(),
        paidAt: new Date('2026-09-01T09:05:00.000Z').toISOString(),
        shippedAt: new Date('2026-09-02T14:30:00.000Z').toISOString(),
        shipment: { method: 'self_delivery', courierName: 'Musa the rider', courierPhone: '08031234567' },
        ...extra,
    });
}

const tracking = async () => import('@/app/actions/order-management');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

describe('what the buyer is shown about a parcel', () => {
    it('REFUSES WITHOUT AN ORDER', async () => {
        const { getTrackingUpdatesAction } = await tracking();

        const result = await getTrackingUpdatesAction('');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Order id is required');
    });

    it('THE ORDER\'S OWN EVENTS, in the order they happened', async () => {
        seedOrder();
        const { getTrackingUpdatesAction } = await tracking();

        const result: any = await getTrackingUpdatesAction(ORDER);

        expect(result.success).toBe(true);
        expect(result.data.events.map((e: any) => e.status)).toEqual(['placed', 'paid', 'shipped']);
        //   Delivered has not happened, so it is not in the list. The old
        //   timeline drew every stage whether or not it had occurred.
        expect(result.data.events.map((e: any) => e.at)).toEqual([
            '2026-09-01T09:00:00.000Z',
            '2026-09-01T09:05:00.000Z',
            '2026-09-02T14:30:00.000Z',
        ]);
    });

    it('and the shipped event says who is carrying it', async () => {
        seedOrder();
        const { getTrackingUpdatesAction } = await tracking();

        const result: any = await getTrackingUpdatesAction(ORDER);
        const shipped = result.data.events.find((e: any) => e.status === 'shipped');

        expect(shipped.note).toBe('Musa the rider — 08031234567');
        expect(result.data.shipment).toMatchObject({ method: 'self_delivery' });
    });

    it('a carrier shipment names the carrier and its number instead', async () => {
        seedOrder({ shipment: { method: 'carrier', carrier: 'GIG Logistics', trackingNumber: 'GIG889321' } });
        const { getTrackingUpdatesAction } = await tracking();

        const result: any = await getTrackingUpdatesAction(ORDER);
        const shipped = result.data.events.find((e: any) => e.status === 'shipped');

        expect(shipped.note).toBe('GIG Logistics — tracking GIG889321');
    });

    it('NO PROVIDER IS CLAIMED, because none is connected', async () => {
        //   This asserted `providerName === "MockLogistics"`. A screen reading
        //   a provider name is a screen about to tell somebody a carrier has
        //   their goods.
        seedOrder();
        const { getTrackingUpdatesAction } = await tracking();

        const result: any = await getTrackingUpdatesAction(ORDER);

        expect(result.data.providerName).toBeNull();
    });

    it('AND NO INVENTED STOPS — the journey is gone', async () => {
        seedOrder();
        const { getTrackingUpdatesAction } = await tracking();

        const result: any = await getTrackingUpdatesAction(ORDER);
        const text = JSON.stringify(result.data);

        for (const invented of ['Sorting Facility', 'Regional Transit Hub', 'Regional Distribution Center', 'WAVE Warehouse']) {
            expect(text).not.toContain(invented);
        }
    });
});

describe('and who may be shown it', () => {
    it('THE SELLER MAY', async () => {
        seedOrder();
        actAs(SELLER);
        const { getTrackingUpdatesAction } = await tracking();

        expect((await getTrackingUpdatesAction(ORDER)).success).toBe(true);
    });

    it('A STRANGER MAY NOT, and is not told the order exists', async () => {
        //   The same "not found" a missing id gets, so this does not become an
        //   oracle for which order ids are real.
        seedOrder();
        actAs(STRANGER);
        const { getTrackingUpdatesAction } = await tracking();

        const result = await getTrackingUpdatesAction(ORDER);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Order not found');
    });

    it('AND AN ADMIN MAY NOT — not from a token, anyway', async () => {
        /*
         *   My first version let an admin read this, via
         *   `hasAdminPermission(session.user.roles, …)`. #532's ratchet
         *   refused the change: roles off the SESSION TOKEN are the class #356
         *   recorded as a security defect, because a revoked admin keeps them
         *   until the token expires.
         *
         *   Converting it to a live role read was the other option. Nobody
         *   asked for admins to read a member's parcel timeline — the admin
         *   order screens have their own readers — so the branch went instead
         *   of growing a database round trip to support it.
         */
        seedOrder();
        actAs('admin-1', ['super_admin']);
        const { getTrackingUpdatesAction } = await tracking();

        expect(await getTrackingUpdatesAction(ORDER)).toMatchObject({
            success: false,
            error: 'Order not found',
        });
    });
});
