/**
 * @jest-environment node
 */

/**
 *   #884 ONE ROW WITH AN ODD DATE EMPTIED EVERY LISTING A SELLER HAD.
 *
 *   FROM THE OWNER'S PRODUCTION LOG, three times in one session:
 *
 *       getMyLandListings error:
 *       TypeError: b.verifiedAt.toDate is not a function
 *         at Array.map
 *         at async /app/.next/server/app/farm-nation/(member)/list-land/page.js
 *
 *   ASKED DIRECTLY, right after: "can users now edits their listing?" The honest
 *   answer was no, and not for the reason #878 fixed. That finding un-hid the
 *   screen; this is what the screen then did.
 *
 * ── WHY A STRING GETS THERE ─────────────────────────────────────────────────
 *
 *   A stored timestamp comes back in four shapes — a Timestamp, an ISO string, a
 *   Date, a number. The adapter converts strings to Timestamps on read, but only
 *   ones matching a FULL ISO pattern (`YYYY-MM-DDTHH:MM:SS`). A row whose
 *   `verifiedAt` is a date only, or a number, or written by a door that stored
 *   it differently, keeps whatever it had — and a string has no `.toDate()`.
 *
 * ── AND WHY ONE ROW TOOK ALL OF THEM ────────────────────────────────────────
 *
 *   The throw is inside the `.map()` that builds the list, so it unwinds the
 *   whole action, which returns `{ success: false }`. The seller sees an empty
 *   screen — not an error naming one bad listing, and not the other nine that
 *   were fine.
 *
 *   #439 is this exact shape on this exact collection: "One row, the entire
 *   page." Its fix became lib/land-location's readLandLocation, and the comment
 *   directly above the three broken lines CITES it — for the location. The dates
 *   on the next three lines were still done by hand.
 *
 *   EXECUTED against a fake database, because the defect is a throw and a source
 *   scan cannot see one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const OWNER = 'owner-1';

const seedListing = (id: string, over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.LAND_LISTINGS, id, {
        id,
        title: `Plot ${id}`,
        ownerId: OWNER,
        status: 'verified',
        price: 5_000_000,
        size: 2,
        location: { state: 'Enugu', lga: 'Oji River', address: 'Ugwuoba' },
        createdAt: '2026-09-12T10:32:43.735Z',
        updatedAt: '2026-09-12T10:32:43.735Z',
        ...over,
    });

const mine = async () => {
    const { getMyLandListings } = await import('@/app/actions/land-actions');
    return await getMyLandListings() as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: OWNER, roles: ['farmer'], email: 'o@e.com', name: 'O' } },
        error: null,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#884 — the seller can see what they listed', () => {
    it('THE REPORTED CRASH: a date-only verifiedAt no longer throws', async () => {
        /*
         *   The exact production failure. `"2026-09-12"` does not match the
         *   adapter's full-ISO pattern, so it arrives as a string, and
         *   `.toDate()` on a string is a TypeError.
         */
        seedListing('l-1', { verifiedAt: '2026-09-12' });

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });

    it('AND ONE BAD ROW NO LONGER TAKES THE GOOD ONES WITH IT', async () => {
        /*
         *   #439's sentence, on the same collection: "One row, the entire page."
         *   The throw was inside the .map, so a seller with nine sound listings
         *   and one odd date saw nothing at all.
         */
        seedListing('good-1');
        seedListing('bad-1', { verifiedAt: '2026-09-12' });
        seedListing('good-2');

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data.map((l: any) => l.id).sort()).toEqual(['bad-1', 'good-1', 'good-2']);
    });

    it('AND EVERY SHAPE A STORED TIMESTAMP TAKES IS SURVIVED', async () => {
        //   Four shapes, named in lib/date-utils and met by this collection.
        seedListing('iso', { verifiedAt: '2026-09-12T10:32:43.735Z' });
        seedListing('dateonly', { verifiedAt: '2026-09-12' });
        seedListing('millis', { verifiedAt: 1_757_672_000_000 });
        seedListing('nodate', { verifiedAt: undefined });
        seedListing('rubbish', { verifiedAt: 'not a date at all' });

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(5);
    });

    it('AND AN UNREADABLE DATE BECOMES null, not 1 January 1970', async () => {
        /*
         *   #608's rule: the epoch is this codebase's word for "unknown" and
         *   screens read it aloud as a real date. `verifiedAt` has a null branch
         *   already; the point is to reach it rather than throw past it.
         */
        seedListing('rubbish', { verifiedAt: 'not a date at all' });

        const res = await mine();

        expect(res.data[0].verifiedAt).toBeNull();
    });

    it('AND A GOOD DATE IS STILL READ, not flattened to null', async () => {
        //   The control: "never throws" is also satisfied by returning null for
        //   everything, which would silently blank every verification date.
        seedListing('iso', { verifiedAt: '2026-09-12T10:32:43.735Z' });

        const res = await mine();

        expect(res.data[0].verifiedAt).toBe('2026-09-12T10:32:43.735Z');
    });

    it('AND A DELETED LISTING IS STILL EXCLUDED — the existing rule', async () => {
        seedListing('live-1');
        seedListing('gone-1', { status: 'deleted' });

        const res = await mine();

        expect(res.data.map((l: any) => l.id)).toEqual(['live-1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#884 — and the two sibling readers had the identical three lines', () => {
    it('NO READER IN land-actions CALLS toDate ON A STORED DATE', () => {
        /*
         *   THREE COPIES of the same trio: the public catalogue, one listing by
         *   id, and the seller's own list. Only one of them was in the log, and
         *   fixing only that one is how this codebase's defects usually survive
         *   — "a rule applied to some of the places it names".
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments');

        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/land-actions.ts'), 'utf8'),
            { label: 'land-actions.ts' },
        );

        expect(src).not.toContain('.toDate()');
        //   And all three go through the shared reader.
        expect(src.split('safeToISOString(').length - 1).toBeGreaterThanOrEqual(6);
    });
});
