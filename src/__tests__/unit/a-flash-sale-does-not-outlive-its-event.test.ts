/**
 * @jest-environment node
 */

/**
 *   #508 A FLASH SALE OUTLIVED ITS EVENT, FOR EVER.
 *
 *   getActiveFlashSaleProductsAction asked one question:
 *
 *       .where("status", "==", "active")
 *
 *   the PRODUCT's status. Nothing asked whether the product's EVENT was still
 *   running.
 *
 *   And ending an event does not touch its products.
 *   updateVillageMarketEventStatusAction writes the event document and stops; no
 *   other writer expires a flash product. The only thing that can is
 *   removeFlashSaleProductAction — the seller, one product at a time, by hand.
 *
 *   So an admin ends a two-day Village Market and every discounted price in it
 *   stays on the buyer's flash-sale page, at the discount, permanently.
 *
 * ── AND THEY ARE BUYABLE ────────────────────────────────────────────────────
 *
 *   _payment_orders.ts:326 and _payment_verify.ts:279 both decrement stock from
 *   FLASH_SALE_PRODUCTS when `item.isFlashSale`, so these are not decorative
 *   rows. A buyer can order one, and the seller is held to a price they offered
 *   for a weekend eighteen months ago.
 *
 * ── THE EVENT LIST ALREADY KNEW THE RULE ────────────────────────────────────
 *
 *   getActiveVillageMarketEventsAction, forty lines above, filters
 *   `status in ["upcoming","active"]` AND `endTime > now`. So the EVENT
 *   disappears from its listing on the same day its PRODUCTS carry on selling.
 *   One rule, two surfaces, applied on one of them — #486's class, and the
 *   eighth time this audit has met it.
 *
 *   The rule is stated once now, in isVillageMarketEventLive, so the two
 *   surfaces cannot drift apart again — and `endTime` is read through toMillis,
 *   which handles the Timestamp, the ISO string and the epoch number this
 *   collection has been written with.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 *   IT WRITES NOTHING. No product row is expired, no status is changed, no data
 *   is touched. The listing stops presenting them for sale; every row is exactly
 *   where it was. A cascade that marked thousands of historic products "expired"
 *   would be a migration, and this is a read.
 *
 *   THE EVENT DETAIL PAGE STILL SHOWS ITS PRODUCTS. getVillageMarketEventAction
 *   returns a past event with its listings, which is a record of what the event
 *   was — that is a reasonable thing to look at, and the screen can decide. What
 *   is not reasonable is the buy-now page offering them.
 *
 *   THE CHECKOUT BOUNDARY IS NOT CLOSED HERE, and saying so matters: a buyer who
 *   still holds a link to an expired flash product can reach the payment path,
 *   which reads the row directly. This file already argues the same shape about
 *   price — "Checkout now refuses a non-positive stored price as well. This is
 *   the source; that is the boundary" — and the boundary for expiry lives in
 *   _payment_orders.ts, which is its own surface with its own measurement. This
 *   finding closes the source.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the event filter removed                       KILLED
 *     the endTime check dropped from the rule        KILLED
 *     the status check dropped from the rule         KILLED
 *     an unreadable event allowed through            KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const EVENTS = COLLECTIONS.VILLAGE_MARKET_EVENTS;
const FLASH = COLLECTIONS.FLASH_SALE_PRODUCTS;

const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + 48 * HOUR).toISOString();
const past = () => new Date(Date.now() - 48 * HOUR).toISOString();

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, 'seller-1', {
        fullName: 'Ada Obi',
        sellerVerificationStatus: 'approved',
    });
});

const listFlash = async () =>
    (await import('@/app/actions/village-market')).getActiveFlashSaleProductsAction();

function seedEvent(id: string, extra: Record<string, unknown>): void {
    store.seed(EVENTS, id, { name: `Event ${id}`, status: 'active', endTime: future(), ...extra });
}

function seedProduct(id: string, eventId: string): void {
    store.seed(FLASH, id, {
        eventId,
        sellerId: 'seller-1',
        title: `Product ${id}`,
        price: 5000,
        flashPrice: 3000,
        status: 'active',
        createdAt: new Date().toISOString(),
    });
}

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#508 — a flash sale does not outlive its event', () => {
    it('A PRODUCT WHOSE EVENT ENDED IS NOT LISTED', async () => {
        //   THE test. The product's own status is still "active" — nothing
        //   expires it — and that was the only thing being asked.
        seedEvent('ended', { status: 'ended', endTime: past() });
        seedProduct('p-ended', 'ended');

        expect(await listFlash()).toEqual([]);
    });

    it('AND NEITHER IS ONE WHOSE EVENT WAS CANCELLED', async () => {
        seedEvent('cancelled', { status: 'cancelled', endTime: future() });
        seedProduct('p-cancelled', 'cancelled');

        expect(await listFlash()).toEqual([]);
    });

    it('AND NEITHER IS ONE WHOSE EVENT SIMPLY RAN OUT OF TIME', async () => {
        //   The status can still say "active" while endTime has passed — the
        //   admin has to press End, and nothing does it for them. The event
        //   listing already treats this as over; the product listing did not.
        seedEvent('expired', { status: 'active', endTime: past() });
        seedProduct('p-expired', 'expired');

        expect(await listFlash()).toEqual([]);
    });

    it('AND A LIVE EVENT\'S PRODUCTS ARE STILL LISTED', async () => {
        //   The vacuity guard, and the whole point of the feature. A fix that
        //   emptied the page would satisfy every assertion above.
        seedEvent('live', { status: 'active', endTime: future() });
        seedProduct('p-live', 'live');

        expect(ids(await listFlash())).toEqual(['p-live']);
    });

    it('AND AN UPCOMING EVENT COUNTS AS LIVE', async () => {
        //   "upcoming" is in the same set the event listing uses. Dropping it
        //   would hide a sale before it opened.
        seedEvent('soon', { status: 'upcoming', endTime: future() });
        seedProduct('p-soon', 'soon');

        expect(ids(await listFlash())).toEqual(['p-soon']);
    });

    it('AND THE LIVE ONES SURVIVE ALONGSIDE THE DEAD ONES', async () => {
        //   The realistic case: one page, several events, some finished.
        seedEvent('live', { status: 'active', endTime: future() });
        seedEvent('ended', { status: 'ended', endTime: past() });
        seedProduct('p-live', 'live');
        seedProduct('p-dead', 'ended');

        expect(ids(await listFlash())).toEqual(['p-live']);
    });

    it('and a product whose event no longer exists is dropped', async () => {
        //   Fails closed. The confident wrong answer here is "this is on sale",
        //   and its cost is a buyer paying a price nobody is offering.
        seedProduct('orphan', 'no-such-event');

        expect(await listFlash()).toEqual([]);
    });

    it('and an event with no endTime is not live', async () => {
        //   The creator requires one, so its absence means a hand-made row.
        seedEvent('undated', { status: 'active', endTime: null });
        seedProduct('p-undated', 'undated');

        expect(await listFlash()).toEqual([]);
    });

    it('and nothing is written — the rows are exactly where they were', async () => {
        //   This finding is a read. No product is expired, no status changed.
        seedEvent('ended', { status: 'ended', endTime: past() });
        seedProduct('p-ended', 'ended');

        await listFlash();

        expect(store.get(FLASH, 'p-ended')).toMatchObject({ status: 'active' });
        expect(store.get(EVENTS, 'ended')).toMatchObject({ status: 'ended' });
    });
});
