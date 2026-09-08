/**
 * @jest-environment node
 */

/**
 *   #510 THE ONE ACTION FILE NO TEST HAD EVER EXECUTED, AND WHAT WAS IN IT.
 *
 *   Re-deriving which module files are genuinely unexamined — after #508 and
 *   #509 both landed on files that turned out to be thoroughly audited, just
 *   unnumbered — gave a much sharper measurement than "carries no #nnn marker":
 *   which action files does NO test import?
 *
 *   The answer was four, three of them barrel re-exports covered by
 *   admin-barrel-parity. _wv_admin_shipments.ts was the only file with real
 *   logic that no test had ever run. It held four defects.
 *
 * ── 1. THE READ WAS OPEN TO EVERY ADMIN ROLE, THE WRITE WAS NOT ─────────────
 *
 *   _createWaveShipmentAction asks `hasAdminPermission(roles,
 *   "wave:manage_training")`. _getWaveShipmentsAction asked `isAdmin(roles)` —
 *   true for ALL TEN admin roles, including support, moderator and every other
 *   module's own admin. So an academy_admin could list every WAVE shipment:
 *   member names, member EMAIL ADDRESSES, destinations, carriers.
 *
 *   admin-content.ts already fixed this exact shape and said why — "isAdmin() is
 *   true for every admin role, so one gate covered six collections belonging to
 *   four different modules". Here the weaker gate was on the READ, which is the
 *   one that hands the data over.
 *
 * ── 2. AND IT HAD NO BOUND AT ALL ───────────────────────────────────────────
 *
 *   `.orderBy("createdAt","desc").get()` — the whole collection, on every page
 *   load, for ever. #465 measured what that costs on a grown collection here:
 *   `canceling statement due to statement timeout`.
 *
 * ── 3. THE DELIVERY ESTIMATE, FOR THE NINTH TIME ────────────────────────────
 *
 *   `new Date(Date.now() + 7 days)` carries the current time of day into a
 *   delivery promise. #493 found precisely this in the marketplace, wrote
 *   lib/delivery-estimate.ts and moved three order screens onto it. WAVE
 *   shipments were never looked at.
 *
 * ── 4. THE ORDER REFERENCE REPEATED EVERY 16.7 MINUTES ──────────────────────
 *
 *   `ORD-${Date.now().toString().slice(-6)}` is the last six digits of the epoch
 *   in milliseconds, cycling every 10^6 ms. MEASURED, deterministically:
 *   2,500 shipments one second apart produce 1,500 repeats, the first between
 *   shipment #0 and #1000 — both ORD-000000.
 *
 *   (My first attempt at that measurement was built wrong and reported zero
 *   collisions. It is recorded because a number I do not understand is not
 *   evidence, and the second script is deterministic where the first drifted.)
 *
 *   It is not the document key, so nothing was overwritten. It is the reference
 *   a member quotes and a support admin searches, and it belonged to several
 *   shipments at once.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the read gate returned to isAdmin              KILLED
 *     the listing bound removed                      KILLED
 *     the estimate hand-rolled again                 KILLED
 *     the order id shortened again                   KILLED
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

jest.mock('@/lib/logistics', () => ({
    getLogisticsProvider: () => ({
        createShipment: async () => ({ trackingNumber: 'TRK-GENERATED-1' }),
    }),
}));

let store: FakeDbHandle;

const SHIPMENTS = COLLECTIONS.WAVE_SHIPMENTS;
const MEMBER = 'member-1';

function actAs(id: string, roles: string[]): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com` } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('wave-admin', ['wave_admin']);
    store.seed(COLLECTIONS.USERS, MEMBER, {
        firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com',
    });
});

async function actions() {
    return import('@/app/actions/wave/_wv_admin_shipments');
}

const create = async (over: Record<string, unknown> = {}) =>
    (await (await actions()).createWaveShipmentAction({
        memberId: MEMBER,
        productName: 'Shea butter, 20kg',
        destination: 'Rotterdam',
        carrier: 'DHL',
        ...over,
    } as any)) as any;

const list = async () => (await (await actions()).getWaveShipmentsAction()) as any;

const rows = () => store.all(SHIPMENTS).map(([id, doc]) => ({ id, ...(doc as any) }));

// ─────────────────────────────────────────────────────────────────────────────
describe('#510 — the read is scoped to the module that owns the data', () => {
    it('AN ACADEMY ADMIN CANNOT LIST WAVE SHIPMENTS', async () => {
        //   THE test. isAdmin() admitted all ten admin roles to a list carrying
        //   member names, email addresses and destinations.
        actAs('academy-1', ['academy_admin']);

        expect(await list()).toMatchObject({ success: false, error: 'Admin access required' });
    });

    it('AND NEITHER CAN SUPPORT', async () => {
        actAs('support-1', ['support']);

        expect((await list()).success).toBe(false);
    });

    it('AND A WAVE ADMIN STILL CAN — the refusal is a permission, not a wall', async () => {
        //   The control, and the reason the action exists.
        expect((await list()).success).toBe(true);
    });

    it('and the read and the write now ask the same question', async () => {
        //   Two doors onto one resource. A fix that tightened the read while
        //   leaving the write elsewhere would have moved the asymmetry, not
        //   closed it.
        actAs('academy-1', ['academy_admin']);

        expect((await create()).success).toBe(false);
        expect((await list()).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#510 — the listing is bounded', () => {
    it('IT ASKS FOR A LIMIT', () => {
        //   Behavioural coverage of a 500-row bound would mean seeding 501
        //   shipments on every run. The rule is pinned instead, and the reason
        //   is stated: an unbounded read of a growing collection is what #465
        //   measured timing out.
        const body = require('fs')
            .readFileSync('src/app/actions/wave/_wv_admin_shipments.ts', 'utf-8');

        expect(body).toContain('.limit(WAVE_SHIPMENT_PAGE_SIZE)');
        expect(body).toMatch(/const WAVE_SHIPMENT_PAGE_SIZE = 500/);
    });

    it('and it still returns the shipments that exist', async () => {
        await create();

        const res = await list();
        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#510 — a delivery estimate is a day, not a minute', () => {
    it('IT LANDS AT THE END OF THE DAY, NOT AT THE HOUR IT WAS CREATED', async () => {
        //   #493's rule, reached by its ninth door.
        await create();

        const estimate = new Date(rows()[0].estimatedDelivery);
        expect(estimate.getHours()).toBe(23);
        expect(estimate.getMinutes()).toBe(59);
    });

    it('AND IT IS SEVEN CALENDAR DAYS OUT', async () => {
        await create();

        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(rows()[0].estimatedDelivery); end.setHours(0, 0, 0, 0);

        expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(7);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#510 — the order reference identifies one shipment', () => {
    it('TWO SHIPMENTS DO NOT SHARE A REFERENCE', async () => {
        //   The old form repeated every 16.7 minutes. Two created back to back
        //   would not collide under EITHER form, so this pins the shape that
        //   makes collision improbable rather than pretending to reproduce a
        //   16-minute wait.
        await create();
        await create({ productName: 'Hibiscus, 50kg' });

        const refs = rows().map((r) => r.orderId);
        expect(new Set(refs).size).toBe(2);
    });

    it('AND THE REFERENCE CARRIES THE FULL TIMESTAMP, NOT SIX DIGITS OF IT', async () => {
        //   The measurement in the header is about `slice(-6)`. This is the
        //   property that makes it false.
        await create();

        const ref: string = rows()[0].orderId;
        expect(ref).toMatch(/^ORD-\d{13}-\d{6}$/);
    });

    it('and the shipment still records the member it belongs to', async () => {
        //   The vacuity guard for this whole block.
        await create();

        expect(rows()[0]).toMatchObject({
            memberId: MEMBER,
            memberName: 'Ada Obi',
            memberEmail: 'ada@example.com',
            status: 'pending',
        });
    });

    it('and a tracking number is generated when none is supplied', async () => {
        await create();
        expect(rows()[0].trackingNumber).toBe('TRK-GENERATED-1');
    });

    it('and a supplied tracking number is kept', async () => {
        await create({ trackingNumber: 'TRK-MINE' });
        expect(rows()[0].trackingNumber).toBe('TRK-MINE');
    });

    it('and a shipment for an unknown member is refused', async () => {
        expect(await create({ memberId: 'ghost' }))
            .toMatchObject({ success: false, error: 'Member not found' });
        expect(rows()).toHaveLength(0);
    });

    it('and a missing required field is refused', async () => {
        expect((await create({ destination: '' })).success).toBe(false);
        expect(rows()).toHaveLength(0);
    });
});
