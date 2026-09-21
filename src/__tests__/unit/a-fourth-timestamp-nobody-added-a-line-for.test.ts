/**
 * @jest-environment node
 */

/**
 *   THE LIST OF TIMESTAMPS TO CONVERT WAS WRITTEN BY HAND, AND A FOURTH ONE
 *   ARRIVED.
 *
 *   Both land list readers shaped their rows like this:
 *
 *       return {
 *           id: doc.id,
 *           ...data,                                       // everything, RAW
 *           location: readLandLocation(data),
 *           createdAt: safeToISOString(data.createdAt, ...),
 *           updatedAt: safeToISOString(data.updatedAt, ...),
 *           verifiedAt: safeToISOStringOptional(data.verifiedAt) ?? null,
 *       };
 *
 *   Three fields converted by name, everything else spread raw. #867 then added
 *   `priceReducedAt` to this collection and nobody added a fourth line, so a
 *   stored Timestamp crossed the server→client boundary. From production:
 *
 *       Only plain objects, and a few built-ins, can be passed to Client
 *       Components. Classes or null prototypes are not supported.
 *         {... priceReducedAt: {_seconds: ..., _nanoseconds: 850000000,
 *          seconds: ..., nanoseconds: ...} ...}
 *
 *   three times in one session. It throws during RENDER, so the listing simply
 *   does not appear.
 *
 * ── WHY IT LANDED EXACTLY WHERE THE OWNER SAW IT ────────────────────────────
 *
 *   `priceReducedAt` is written ONLY by priceReductionPatch — that is, only
 *   when an owner cuts the price. So the crash lands on precisely the listings
 *   that have just been EDITED, and on HOT DEALS, which is the feature that
 *   field exists to drive. "The item doesn't render, neither does it show on
 *   hot deals" is one defect, seen from two screens.
 *
 *   THE ASSERTION IS NOT "priceReducedAt IS A STRING". That would pin this one
 *   field and leave the fifth to be found in production too. What has to be
 *   true is that NOTHING unserialisable survives anywhere in the row — which is
 *   also what catches the GeoPoint that readLandLocation spreads through from
 *   `...obj`, a class instance one row of test data away from the same crash.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
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

/**
 * A stored Timestamp, exactly as production logged it — BOTH spellings, which
 * is what the adapter hands back.
 */
const storedTimestamp = (iso: string) => {
    const ms = new Date(iso).getTime();
    const secs = Math.floor(ms / 1000);
    //   A class instance, not a literal. React refuses these by PROTOTYPE, so a
    //   plain object with the same keys would not reproduce the defect and the
    //   test would pass against the broken code.
    class FakeTimestamp {
        _seconds = secs;
        _nanoseconds = 850_000_000;
        seconds = secs;
        nanoseconds = 850_000_000;
        toDate() { return new Date(ms); }
    }
    return new FakeTimestamp();
};

/**
 * Everything React will refuse, found anywhere in the tree.
 *
 * Deliberately not a check for one field: the defect is a MISSED field, so the
 * assertion has to be about the whole row.
 */
function unserialisablePaths(value: unknown, path = '$'): string[] {
    if (value === null || value === undefined) return [];
    if (typeof value !== 'object') return [];

    if (Array.isArray(value)) {
        return value.flatMap((v, i) => unserialisablePaths(v, `${path}[${i}]`));
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        //   Date is one of the built-ins React accepts.
        if (!(value instanceof Date)) return [`${path} (${value.constructor?.name ?? 'unknown'})`];
    }

    const v = value as Record<string, unknown>;
    if (typeof v.toDate === 'function') return [`${path} (timestamp-like)`];

    return Object.entries(v).flatMap(([k, val]) => unserialisablePaths(val, `${path}.${k}`));
}

const seed = (id: string, extra: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, id, {
        ownerId: OWNER, title: 'Ten hectares near Jos', size: 2, price: 500_000,
        location: { state: 'Plateau', city: 'Jos', lat: 9.9, lng: 8.9 },
        status: 'verified',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        ...extra,
    });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: OWNER, email: 'o@e.com', roles: ['land_owner'] } }, error: null,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the instrument itself', () => {
    it('A RAW STORED TIMESTAMP IS SOMETHING REACT REFUSES', () => {
        //   Vacuity guard. If unserialisablePaths could not see the thing the
        //   production log shows, every assertion below would pass against the
        //   broken code and prove nothing.
        expect(unserialisablePaths({ priceReducedAt: storedTimestamp('2026-02-01T00:00:00Z') }))
            .toHaveLength(1);
    });

    it('and a plain row is accepted', () => {
        expect(unserialisablePaths({ a: 1, b: 'x', c: [{ d: null }], e: new Date() })).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a price-reduced listing survives the boundary', () => {
    it('MY PROPERTIES RETURNS NOTHING REACT WILL REFUSE — the defect', async () => {
        //   THE test. This is the screen the owner edits from, and
        //   priceReducedAt is written the moment they cut a price.
        seed('plot-1', {
            previousPrice: 800_000,
            priceReducedAt: storedTimestamp('2026-02-01T00:00:00Z'),
        });

        const res = await (await actions()).getMyLandListings() as any;

        expect(res.success).toBe(true);
        expect(unserialisablePaths(res.data)).toEqual([]);
    });

    it('AND THE PUBLIC LIST DOES TOO — which is what Hot Deals reads', async () => {
        seed('plot-1', {
            previousPrice: 800_000,
            priceReducedAt: storedTimestamp('2026-02-01T00:00:00Z'),
        });

        const res = await (await actions()).getLandListings({ status: 'verified' } as any) as any;

        expect(res.success).toBe(true);
        expect(unserialisablePaths(res.data)).toEqual([]);
    });

    it('AND THE FIELD IS STILL THERE, not dropped to make it safe', async () => {
        //   Deleting the field would satisfy every assertion above and silently
        //   remove the Hot Deal badge the value exists for.
        seed('plot-1', {
            previousPrice: 800_000,
            priceReducedAt: storedTimestamp('2026-02-01T00:00:00Z'),
        });

        const row = ((await (await actions()).getMyLandListings() as any).data ?? [])[0];

        expect(row.previousPrice).toBe(800_000);
        expect(new Date(row.priceReducedAt).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('and a GeoPoint is flattened too — asserted DIRECTLY, and here is why', () => {
        /*
         *   readLandLocation spreads `...obj`, so whatever the stored location
         *   carried rides along — including the GeoPoint the create path writes.
         *   Same crash, different field.
         *
         *   THIS CANNOT BE TESTED THROUGH THE ACTION, and saying so is better
         *   than a test that looks like it does. lib/testing/fake-db seeds with
         *   `JSON.parse(JSON.stringify(v))`, which strips prototypes — so a
         *   class instance handed to store.seed arrives at the reader as a plain
         *   object and is never the thing React refuses. An earlier version of
         *   this test did exactly that and PASSED against the unfixed code.
         *
         *   (The priceReducedAt tests above are unaffected: the same harness
         *   re-hydrates timestamps on read, so a real Timestamp does reach the
         *   reader there. That is why those two die under the mutant and this
         *   one did not.)
         */
        const { serializeValue } = require('@/lib/firestore-serialize');
        class FakeGeoPoint { _latitude = 9.9; _longitude = 8.9; }

        const before = { location: { state: 'Plateau', geopoint: new FakeGeoPoint() } };
        expect(unserialisablePaths(before)).toHaveLength(1);

        expect(unserialisablePaths(serializeValue(before))).toEqual([]);
        expect(serializeValue(before).location.geopoint._latitude).toBe(9.9);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the ordinary row is unchanged', () => {
    it('POSITIVE CONTROL: A LISTING WITH NO PRICE CUT STILL COMES BACK', async () => {
        //   The direction that must not move. A reader that returned nothing
        //   would pass every "nothing unserialisable" assertion above.
        seed('plot-1');

        const res = await (await actions()).getMyLandListings() as any;

        expect(res.data).toHaveLength(1);
        expect(res.data[0].title).toBe('Ten hectares near Jos');
        expect(res.data[0].price).toBe(500_000);
    });

    it('POSITIVE CONTROL: and the three hand-converted dates are still ISO strings', async () => {
        seed('plot-1', { verifiedAt: storedTimestamp('2026-03-01T00:00:00Z') });

        const row = ((await (await actions()).getMyLandListings() as any).data ?? [])[0];

        expect(typeof row.createdAt).toBe('string');
        expect(typeof row.updatedAt).toBe('string');
        expect(new Date(row.verifiedAt).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it('and the location is still normalised, not flattened by the serializer', async () => {
        seed('plot-1');

        const row = ((await (await actions()).getMyLandListings() as any).data ?? [])[0];

        expect(row.location.state).toBe('Plateau');
        expect(row.location.lat).toBe(9.9);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/actions/land-actions.ts, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop serializeValue from getMyLandListings   1  "MY PROPERTIES RETURNS
 *   — the defect                                    NOTHING REACT WILL REFUSE"
 *
 *   drop it from _getLandListings                1  "AND THE PUBLIC LIST DOES
 *                                                   TOO"
 *
 *   drop it from BOTH                            2  "MY PROPERTIES RETURNS
 *                                                   NOTHING REACT WILL REFUSE"
 *
 *   delete priceReducedAt instead of             1  "AND THE FIELD IS STILL
 *   serializing it                                  THERE"
 *
 *   return [] from the reader                    2  "POSITIVE CONTROL: A
 *                                                   LISTING WITH NO PRICE CUT"
 *
 *   MEASURED, not predicted. The first draft of this table said 3/1/4, and the
 *   run said 1/1/2 — because the GeoPoint case cannot reach the reader through
 *   fake-db at all (see the note on that test). The numbers here are what the
 *   suite actually reported.
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the note above serializeValue         0  SURVIVED ✓
 */
