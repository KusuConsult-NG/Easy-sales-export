/**
 * @jest-environment node
 */

/**
 * "WHEN THEY CLICK ON MY PROPERTIES NOTHING IS SHOWN."
 * "CAN USERS NOW EDIT THEIR LISTING?"
 * "WHY IS THERE AN OPTION FOR SELLER TO MAKE AN OFFER WHEN THE LISTED PRODUCT
 *  BELONGS TO THE SELLER?"
 *
 * Three reports, and the first two are one defect.
 *
 * ── 1. THE EMPTY LIST WAS A CRASH ───────────────────────────────────────────
 *
 * land-actions.ts normalised every row it read with this, written out three
 * times — the browse catalogue, the detail reader, and My Properties:
 *
 *     location: {
 *         ...data.location,
 *         lat: data.location.geopoint?.latitude || data.location.lat,
 *         lng: data.location.geopoint?.longitude || data.location.lng,
 *     },
 *
 * `data.location` is not guarded, and FOUR things write to LAND_LISTINGS:
 *
 *   land-actions._createLandListing        location: { lat, lng, city, state, geopoint }
 *   land-listings.submitLandListingAction  location: { state, lga, address }   ← the live one
 *   farm-nation._listPropertyAction        location: <whatever the form sent>
 *   api/farm-nation/create-listing         NO location key at all — state, lga,
 *                                          address and gpsCoordinates, flat
 *
 * So on a row from that route `.geopoint` threw, inside the `.map()` and inside
 * the `try`. Executed before the fix, on a seeded row of each writer's shape:
 *
 *   getMyLandListings  → { success: false, error: "Failed to fetch your listings" }
 *   getLandListings    → { success: false, error: "Failed to fetch land listings" }
 *   getLandListing     → { success: false, error: "Failed to fetch listing" }
 *
 * and with ONE such row beside a good one, the good one was gone too. An owner
 * with four sound listings and one made through that route saw none of the five.
 * getLandListings is also the public browse catalogue AND the /land/verify
 * queue — and that route writes `status: "pending_verification"`, so its rows
 * land in that queue by definition. One row emptied the catalogue for everyone
 * and emptied the queue for the admin who could have resolved it.
 *
 * The sibling reader was never affected: farm-nation/_fn_listings.ts's
 * getMyPropertiesAction reads the same collection for the same owner through
 * `serializeDocs` and returns both rows. Two readers of one collection, one of
 * which assumed a shape the collection does not guarantee.
 *
 * ── 2. THE EDIT SCREEN WAS FINE. NOBODY COULD REACH IT ──────────────────────
 *
 * updateLandListing was executed against every owner-mutable status with the
 * exact payload edit-property/[id]/page.tsx sends, and accepted all of them;
 * a stranger is refused. The edit screen is reached from a card on My
 * Properties, which is the list that was empty. Nothing was wrong with editing
 * — there was no route to it.
 *
 * ── 3. AND THE OWNER WAS OFFERED THEIR OWN LAND ─────────────────────────────
 *
 * farm-nation-payment.ts refuses it — "You cannot purchase your own property".
 * marketplace/_quotes.ts refuses the equivalent — "You cannot request a quote
 * on your own listing". farm-nation/_fn_purchases.ts, the other path to a
 * purchase over the same collection, had no such test: an owner passed the
 * claim and took their OWN listing off the market, `pendingBuyerId` pointing at
 * themselves, until somebody cancelled it. The property page rendered the
 * reservation button on `status === "verified"` alone, for everybody.
 *
 * Both halves are closed here, and the page now offers the owner the two things
 * they would actually want on their own listing.
 *
 * ── AND THE FAILURE WAS INVISIBLE ───────────────────────────────────────────
 *
 * my-properties/page.tsx had `error` state, `setError`, an AlertCircle import
 * and a rendered red banner — and called `setError` from nowhere, so a failed
 * read ran neither branch and left the "no properties yet" empty state on
 * screen. /land/verify had no error state at all. Both surface it now, so the
 * next cause of a failed read cannot present itself as an empty catalogue.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';
import { normaliseLandLocation, landTimestampToIso } from '@/lib/land-listing-shape';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => undefined),
}));
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: async (_f: unknown, p: string) => `https://cdn.test/${p}`,
}));

// The same in-memory claim farm-nation-purchases-behaviour.test.ts uses: the
// real one issues a conditional UPDATE over the network, which the fake store
// does not serve.
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, {
        ...current,
        ...(p.patch ?? {}),
        ...(p.recordPreviousAs ? { [p.recordPreviousAs]: status } : {}),
        status: p.to,
    });
    return { claimed: true, status: p.to };
}) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

declare const global: any;

const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const OWNER = 'owner-1';
let store: FakeDbHandle;

function actAs(id: string, roles: string[] = ['general_user']) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: 'Ada Obi' } },
        error: null,
    }));
}

/** The row /api/farm-nation/create-listing writes: no `location` object. */
function routeCreatedRow(id: string, extra: Record<string, unknown> = {}) {
    store.seed(LISTINGS, id, {
        userId: OWNER, ownerId: OWNER, title: 'Cassava plot at Epe',
        state: 'Lagos', lga: 'Epe', address: '12 Epe Road',
        gpsCoordinates: { latitude: 6.58, longitude: 3.98 },
        size: 2, price: 4_500_000, totalPrice: 4_500_000,
        status: 'pending_verification', verificationStatus: 'pending',
        images: [], documents: {},
        createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
        ...extra,
    });
}

/** The row submitLandListingAction writes: the live UI's shape. */
function liveWriterRow(id: string, extra: Record<string, unknown> = {}) {
    store.seed(LISTINGS, id, {
        ownerId: OWNER, title: 'Five hectares in Jos',
        location: { state: 'Plateau', lga: 'Jos North', address: '12 Rayfield Road' },
        size: 5, price: 5_000_000, status: 'pending_verification',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(OWNER);
});

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('the three readers survive every writer in the collection', () => {
    it.each([
        ['My Properties', 'getMyLandListings'],
        ['the browse catalogue', 'getLandListings'],
    ])('%s returns the route-created listing — this returned "Failed to fetch…"', async (
        _label, fn,
    ) => {
        routeCreatedRow('R1', { status: 'verified' });

        const actions: any = await import('@/app/actions/land-actions');
        const res = await actions[fn](fn === 'getLandListings' ? {} : undefined);

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
        expect(res.data[0].id).toBe('R1');
    });

    it('the detail reader returns it too', async () => {
        routeCreatedRow('R1', { status: 'verified' });
        const { getLandListing } = await import('@/app/actions/land-actions');
        const res: any = await getLandListing('R1');

        expect(res.success).toBe(true);
        expect(res.data?.id).toBe('R1');
    });

    it('ONE such row does not take the OTHER listings down with it', async () => {
        // The shape of the report. The owner had listings that were perfectly
        // readable on their own, and saw none of them.
        liveWriterRow('GOOD-1');
        liveWriterRow('GOOD-2', { title: 'Two hectares at Ilorin' });
        routeCreatedRow('BAD');

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getMyLandListings();

        expect(res.success).toBe(true);
        expect(res.data.map((l: any) => l.id).sort()).toEqual(['BAD', 'GOOD-1', 'GOOD-2']);
    });

    it('and the sibling reader, which never had the fault, still agrees with them', async () => {
        // getMyPropertiesAction goes through serializeDocs and returned both
        // rows throughout. If the two readers of one collection disagree about
        // what an owner owns, one of them is wrong — that was the whole defect.
        liveWriterRow('GOOD-1');
        routeCreatedRow('BAD');

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const { getMyPropertiesAction } = await import('@/app/actions/farm-nation/_fn_listings');

        const mine: any = await getMyLandListings();
        const siblings: any = await getMyPropertiesAction();

        expect(mine.data.map((l: any) => l.id).sort())
            .toEqual(siblings.data.properties.map((p: any) => p.id).sort());
    });

    it('a listing with no location and no coordinates at all still lists', async () => {
        // The minimum a row can carry. Surviving it is the point: the reader
        // must not decide that a malformed row means the owner owns nothing.
        store.seed(LISTINGS, 'BARE', { ownerId: OWNER, title: 'bare', status: 'verified' });

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getMyLandListings();

        expect(res.success).toBe(true);
        expect(res.data[0].location).toEqual({});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the location is recovered, not merely survived', () => {
    it('a route-created listing shows where it is', async () => {
        // Defaulting `location` to {} would have stopped the crash and shown
        // the owner a listing with no place on it. The row does carry its
        // location — flat, in the fields that route writes.
        routeCreatedRow('R1');

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getMyLandListings();

        expect(res.data[0].location).toMatchObject({
            state: 'Lagos', lga: 'Epe', address: '12 Epe Road', lat: 6.58, lng: 3.98,
        });
    });

    it('coordinates come from whichever of the three spellings the row uses', () => {
        expect(normaliseLandLocation({ location: { geopoint: { latitude: 9.9, longitude: 8.9 } } }))
            .toMatchObject({ lat: 9.9, lng: 8.9 });
        expect(normaliseLandLocation({ location: { lat: 9.9, lng: 8.9 } }))
            .toMatchObject({ lat: 9.9, lng: 8.9 });
        expect(normaliseLandLocation({ gpsCoordinates: { latitude: 9.9, longitude: 8.9 } }))
            .toMatchObject({ lat: 9.9, lng: 8.9 });
    });

    it('and the `location` object WINS over the flat fields, which go stale on edit', async () => {
        // A route-created row edited through updateLandListing gets a proper
        // `location` object written and keeps its original flat `state`. If the
        // flat field won, the owner's edit would appear not to have taken.
        routeCreatedRow('R1', { status: 'verified' });

        expect(normaliseLandLocation({
            state: 'Lagos', lga: 'Epe',
            location: { state: 'Plateau', lga: 'Jos North' },
        })).toMatchObject({ state: 'Plateau', lga: 'Jos North' });
    });

    it('a timestamp is read for what it is, rather than assumed to be a Timestamp', () => {
        // The three copies called `(data.createdAt as Timestamp)?.toDate()`,
        // where the `?.` guards the field and not the method — a row holding a
        // plain string or a Date would have thrown exactly as `location` did.
        expect(landTimestampToIso('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
        expect(landTimestampToIso(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
        expect(landTimestampToIso({ toDate: () => new Date('2026-01-01T00:00:00.000Z') }))
            .toBe('2026-01-01T00:00:00.000Z');
        expect(landTimestampToIso(null)).toBeNull();
        expect(landTimestampToIso('not a date')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the writer stores the shape its readers query', () => {
    function file(name: string): File {
        return new File(['x'], name, { type: 'application/pdf' });
    }

    function request() {
        const form = new FormData();
        const fields: Record<string, string> = {
            title: 'Two hectares at Epe', category: 'farmland',
            description: 'Cleared farmland with road access.',
            state: 'Lagos', lga: 'Epe', address: '12 Epe Road',
            size: '2', unit: 'hectares', pricePerUnit: '2250000', totalPrice: '4500000',
            latitude: '6.58', longitude: '3.98',
        };
        for (const [k, v] of Object.entries(fields)) form.set(k, v);
        form.set('landTitle', file('deed.pdf'));
        form.set('surveyPlan', file('survey.pdf'));
        return { formData: async () => form } as any;
    }

    it('/api/farm-nation/create-listing writes a `location` object', async () => {
        // Not only a rendering problem: the catalogue filters are
        // `.where('location.state', '==', ...)` and `.where('location.city',
        // '==', ...)`, which a top-level `state` cannot match. A listing made
        // here was unfindable by state.
        store.seed(COLLECTIONS.USERS, OWNER, {
            email: `${OWNER}@example.com`, name: 'Ada Obi',
            serviceRegistrations: { 'farm-nation': { status: 'approved' } },
            roles: ['general_user', 'farm_nation_participant'],
        });

        const { POST } = await import('@/app/api/farm-nation/create-listing/route');
        const res = await POST(request());
        const body = await res.json();
        expect(body.success).toBe(true);

        const stored = store.get(LISTINGS, body.data.listingId);
        expect(stored?.location).toMatchObject({
            state: 'Lagos', lga: 'Epe', address: '12 Epe Road', lat: 6.58, lng: 3.98,
        });
        // The flat fields stay beside it, as `userId` was kept beside `ownerId`.
        expect(stored?.state).toBe('Lagos');
    });

    it('and the listing it wrote is then readable by My Properties end to end', async () => {
        store.seed(COLLECTIONS.USERS, OWNER, {
            email: `${OWNER}@example.com`, name: 'Ada Obi',
            serviceRegistrations: { 'farm-nation': { status: 'approved' } },
            roles: ['general_user', 'farm_nation_participant'],
        });

        const { POST } = await import('@/app/api/farm-nation/create-listing/route');
        await POST(request());

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getMyLandListings();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
        expect(res.data[0].title).toBe('Two hectares at Epe');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an owner can edit their listing', () => {
    // Exactly what edit-property/[id]/page.tsx sends.
    const payload = (listingId: string) => ({
        listingId,
        title: 'Five hectares in Jos, Plateau',
        description: 'Fertile farmland with borehole access and road frontage.',
        location: {
            address: '12 Rayfield Road', state: 'Plateau', lga: 'Jos North',
            city: 'Jos North', lat: 0, lng: 0,
        },
        price: 6_000_000, size: 5, category: 'farmland', features: ['borehole'],
        availableForSale: true, availableForRent: false, availableForLease: false,
        type: 'sale' as const, escrowAvailable: true,
    });

    it.each([
        ['pending_verification — what the live writer creates', 'pending_verification'],
        ['verified — an approved listing', 'verified'],
        ['rejected — the case editing exists for', 'rejected'],
        ['available', 'available'],
    ])('%s', async (_label, status) => {
        liveWriterRow('L1', { status });

        const { updateLandListing } = await import('@/app/actions/land-actions');
        const res: any = await updateLandListing(payload('L1') as any);

        expect(res.success).toBe(true);
        expect(store.get(LISTINGS, 'L1')?.title).toBe('Five hectares in Jos, Plateau');
    });

    it('including a route-created one, whose edit lands in `location`', async () => {
        routeCreatedRow('R1');

        const { updateLandListing } = await import('@/app/actions/land-actions');
        expect((await updateLandListing(payload('R1') as any) as any).success).toBe(true);
        expect(store.get(LISTINGS, 'R1')?.location).toMatchObject({ state: 'Plateau' });
    });

    it('and a stranger cannot', async () => {
        liveWriterRow('L1', { status: 'verified' });
        actAs('somebody-else');

        const { updateLandListing } = await import('@/app/actions/land-actions');
        const res: any = await updateLandListing(payload('L1') as any);

        expect(res.success).toBe(false);
        expect(res.error).toContain('Unauthorized');
        expect(store.get(LISTINGS, 'L1')?.title).toBe('Five hectares in Jos');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an owner is not a buyer of their own land', () => {
    async function member(id: string) {
        store.seed(COLLECTIONS.USERS, id, {
            email: `${id}@example.com`, name: 'Ada Obi',
            serviceRegistrations: { cooperatives: { status: 'approved' } },
        });
    }

    const buyerInfo = {
        fullName: 'Ada Obi', email: 'buyer@example.com',
        phone: '08011111111', purpose: 'farming',
        zoningComplianceDeclarationAccepted: true,
    };

    it('initiatePropertyPurchaseAction refuses the owner — this reserved their own listing', async () => {
        await member(OWNER);
        liveWriterRow('L1', { status: 'verified', name: 'Five hectares in Jos' });

        const { initiatePropertyPurchaseAction } = await import('@/app/actions/farm-nation/_fn_purchases');
        const res: any = await initiatePropertyPurchaseAction('L1', buyerInfo as any);

        expect(res.success).toBe(false);
        expect(res.error).toBe('You cannot purchase your own property');
        // And it is refused BEFORE the claim, so the listing is still on sale.
        expect(store.get(LISTINGS, 'L1')?.status).toBe('verified');
        expect(store.get(LISTINGS, 'L1')?.pendingBuyerId).toBeUndefined();
    });

    it('and a real buyer is still let through', async () => {
        // The other direction: the guard must refuse the owner and nobody else.
        await member('buyer-2');
        liveWriterRow('L1', { status: 'verified', name: 'Five hectares in Jos' });
        actAs('buyer-2');

        const { initiatePropertyPurchaseAction } = await import('@/app/actions/farm-nation/_fn_purchases');
        const res: any = await initiatePropertyPurchaseAction('L1', buyerInfo as any);

        expect(res.success).toBe(true);
        expect(store.get(LISTINGS, 'L1')?.pendingBuyerId).toBe('buyer-2');
    });

    it('and the sibling checkout path refuses the owner as it always did', async () => {
        // farm-nation-payment.ts had this rule; _fn_purchases.ts did not. Both
        // are asserted so the pair cannot drift apart again.
        const payment = source('src/app/actions/farm-nation-payment.ts');
        const purchases = source('src/app/actions/farm-nation/_fn_purchases.ts');
        for (const code of [payment, purchases]) {
            expect(code).toContain('You cannot purchase your own property');
        }
    });

    it('and the property page does not offer the owner a reservation button', () => {
        const page = source('src/app/farm-nation/property/[id]/page.tsx');
        expect(page).toContain('isOwnViewer');
        // The buy button is now behind the owner test rather than behind the
        // status alone.
        expect(page).toMatch(/isOwnViewer \?[\s\S]*?property\.status === "verified"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a failed read can no longer look like an empty catalogue', () => {
    it('My Properties feeds the error banner it already rendered', () => {
        const page = source('src/app/farm-nation/(member)/my-properties/page.tsx');
        // `setError` was declared and called from nowhere. Both branches now.
        expect(page).toMatch(/} else \{\s*setError\(result\.error/);
        expect(page.match(/setError\(/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('/land/verify — the queue a route-created listing sits in — has one at all', () => {
        const page = source('src/app/land/verify/page.tsx');
        expect(page).toMatch(/} else \{\s*setError\(result\.error/);
        expect(page).toContain('{error}');
    });

    it('and no reader dereferences `data.location` without guarding it', () => {
        // The fourth copy of a three-copy defect is the one this codebase keeps
        // producing. There is one normaliser now; this is what says so.
        const code = source('src/app/actions/land-actions.ts');
        expect(code).not.toContain('data.location.geopoint');
        expect(code.match(/normaliseLandListingRow</g)?.length).toBe(3);
    });
});
