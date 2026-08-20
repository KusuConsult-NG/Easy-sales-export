/**
 * @jest-environment node
 */

/**
 * Land listings, EXECUTED — the browse feed, the single read, the owner's list,
 * the edit, the admin verification and the soft delete.
 *
 * At 38%. lib/land-visibility.ts was extracted FROM this file, and its header
 * explains why: the rule about what a stranger may see of a land listing was
 * "written down, implemented once, and the public endpoint spread the whole
 * document anyway". The endpoint it names is /api/farm-nation/listings. This is
 * the file the rule came from, and it had never been run.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
    invalidateServiceCache: async () => undefined,
}));

/**
 * claimStatusTransitionFromAny is a Postgres CAS — it calls supabaseAdmin.rpc
 * directly rather than going through the adapter, so the in-memory store cannot
 * see it. Backed by the same store here, with the SQL function's semantics:
 * claim only from one of `fromAny`, and record the status it came from.
 */
const mockClaimFromAny = jest.fn(async (args: any) => {
    const { collection, id, fromAny, to, patch, recordPreviousAs } = args;
    const doc = store.get(collection, id);
    if (!doc) return { claimed: false, exists: false, status: null };
    const current = doc.status ?? null;
    if (current === null) return { claimed: false, exists: true, status: null };
    if (!fromAny.includes(current)) return { claimed: false, exists: true, status: current };
    store.seed(collection, id, {
        ...doc,
        ...(patch ?? {}),
        ...(recordPreviousAs ? { [recordPreviousAs]: current } : {}),
        status: to,
    });
    return { claimed: true, exists: true, status: to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: any) => mockClaimFromAny(args),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';

function actAs(id: string | null, roles: string[] = []): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Authentication required' } }
                : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(null);
});

async function actions() {
    return import('@/app/actions/land-actions');
}

// ─── seeds ───────────────────────────────────────────────────────────────────

let seq = 0;

function seedListing(id: string, extra: Record<string, unknown> = {}): void {
    seq += 1;
    store.seed(COLLECTIONS.LAND_LISTINGS, id, {
        title: `Farmland parcel ${id}`,
        description: 'Twelve hectares of arable land with a borehole and road access.',
        ownerId: OWNER,
        ownerEmail: `${OWNER}@example.com`,
        price: 5_000_000,
        size: 12,
        soilQuality: 'loamy',
        status: 'verified',
        location: { lat: 6.85, lng: 7.39, address: '12 Farm Road', city: 'Nsukka', state: 'Enugu' },
        features: [],
        images: ['https://cdn/land.png'],
        createdAt: new Date(2026, 0, seq).toISOString(),
        updatedAt: new Date(2026, 0, seq).toISOString(),
        ...extra,
    });
}

/** A listing carrying everything the review process writes. */
function seedUnderReview(id: string, status: string): void {
    seedListing(id, {
        status,
        verificationNotes: 'Title deed does not match the survey plan.',
        rejectionReason: 'Ownership could not be confirmed.',
        verifiedBy: 'admin-9',
    });
}

// ─── the create ──────────────────────────────────────────────────────────────

describe('createLandListing', () => {
    const listing = {
        title: 'Twelve hectares near Nsukka',
        description: 'Arable land with a borehole, fenced perimeter and road access.',
        location: { lat: 6.85, lng: 7.39, address: '12 Farm Road', city: 'Nsukka', state: 'Enugu' },
        price: 5_000_000,
        size: 12,
        features: [],
        images: ['https://cdn/land.png'],
    };

    it('refuses a caller with no session', async () => {
        const { createLandListing } = await actions();
        expect(await createLandListing(listing as any)).toMatchObject({ success: false });
        expect(store.size(COLLECTIONS.LAND_LISTINGS)).toBe(0);
    });

    it('records the listing against its creator, awaiting review', async () => {
        actAs(OWNER);
        const { createLandListing } = await actions();

        expect(await createLandListing(listing as any)).toMatchObject({ success: true });

        const [, created] = store.all(COLLECTIONS.LAND_LISTINGS)[0];
        expect(created).toMatchObject({
            title: 'Twelve hectares near Nsukka',
            ownerId: OWNER,
            status: 'pending_verification',
            verifiedAt: null,
            verifiedBy: null,
        });
    });

    it('and the owner is the session, not the payload', async () => {
        // `...validated` is spread before ownerId is set, so a caller sending an
        // ownerId cannot claim somebody else's land. Pinned because the ORDER is
        // the whole guarantee.
        actAs(OWNER);
        const { createLandListing } = await actions();

        await createLandListing({ ...listing, ownerId: 'somebody-else' } as any);

        const [, created] = store.all(COLLECTIONS.LAND_LISTINGS)[0];
        expect(created.ownerId).toBe(OWNER);
    });

    it('refuses a listing with no image', async () => {
        actAs(OWNER);
        const { createLandListing } = await actions();

        const result: any = await createLandListing({ ...listing, images: [] } as any);
        expect(result.success).toBe(false);
        expect(result.error).toContain('At least one image required');
    });

    it('and a price that is not positive', async () => {
        actAs(OWNER);
        const { createLandListing } = await actions();

        expect((await createLandListing({ ...listing, price: 0 } as any) as any).error)
            .toContain('Price must be positive');
    });
});

// ─── the browse feed ─────────────────────────────────────────────────────────

describe('getLandListings', () => {
    /**
     * THE REVIEW QUEUE WAS THE DEFAULT PAGE.
     *
     * The admin gate on this action reads
     *
     *     const requestedStatus = filters?.status;
     *     const wantsNonPublic = requestedStatus !== undefined
     *                            && !PUBLIC_LAND_STATUSES.includes(requestedStatus);
     *
     * so it fires only when the caller ASKS for a non-public status. Omit the
     * filter entirely and `wantsNonPublic` is false, no session is required —
     * and the query below then applies no status predicate at all, because that
     * is also inside `if (filters?.status)`. Every listing came back: pending,
     * rejected, whatever, to a caller with no session.
     *
     * The gate refused the front door and left the wall open.
     */
    it('does not hand the review queue to a caller with no session', async () => {
        seedListing('public-1');
        seedUnderReview('pending-1', 'pending_verification');
        seedUnderReview('rejected-1', 'rejected');

        const { getLandListings } = await actions();
        const result: any = await getLandListings();

        expect(result.success).toBe(true);
        expect(result.data.map((l: any) => l.id)).toEqual(['public-1']);
    });

    it('and strips the review fields from the rows it does return', async () => {
        // stripInternalLandFields is applied by the single-listing read and by
        // /api/farm-nation/listings. This feed never called it, so a verified
        // listing carrying an earlier rejection handed over the admin's notes,
        // their user id and the owner's email.
        seedListing('public-1', {
            verificationNotes: 'Resubmitted with a corrected survey plan.',
            rejectionReason: 'Ownership could not be confirmed.',
            verifiedBy: 'admin-9',
        });

        const { getLandListings } = await actions();
        const [listing]: any = (await getLandListings() as any).data;

        expect(listing.verificationNotes).toBeUndefined();
        expect(listing.rejectionReason).toBeUndefined();
        expect(listing.verifiedBy).toBeUndefined();
        expect(listing.ownerEmail).toBeUndefined();
        // The listing itself is still there — this is a browse feed.
        expect(listing.title).toContain('Farmland parcel');
    });

    it('still refuses an explicit request for a non-public status', async () => {
        // Vacuity guard: the gate that did exist must keep working.
        seedUnderReview('pending-1', 'pending_verification');

        const { getLandListings } = await actions();
        expect(await getLandListings({ status: 'pending_verification' })).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('and serves it to an admin, unstripped', async () => {
        seedUnderReview('pending-1', 'pending_verification');
        actAs('admin-1', ['admin']);

        const { getLandListings } = await actions();
        const result: any = await getLandListings({ status: 'pending_verification' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].rejectionReason).toBe('Ownership could not be confirmed.');
    });

    it('leaves deleted listings out', async () => {
        seedListing('public-1');
        seedListing('gone', { status: 'deleted' });

        const { getLandListings } = await actions();
        expect(((await getLandListings() as any).data).map((l: any) => l.id)).toEqual(['public-1']);
    });

    /**
     * AND THE SEARCH FILTERS RAN OVER AN ARBITRARY PAGE.
     *
     * `.limit(50)` is applied by the database and the price, size, state, soil
     * and utility filters are applied in memory AFTERWARDS. So a search matched
     * only within the newest fifty listings: with a fifty-first cheaper parcel
     * in the catalogue, "under ₦2,000,000" returned nothing and looked exactly
     * like a catalogue with none.
     *
     * Same shape as the export window date filter and the admin marketplace
     * search — a predicate applied after a truncation it does not control.
     */
    it('finds a match that sits past the page limit', async () => {
        // The cheap parcel is seeded FIRST, so it is the OLDEST — and the query
        // orders createdAt desc and truncates. The five newer, dearer listings
        // fill the page, the in-memory price filter then runs over those five
        // alone, and the search reports no farmland under two million naira
        // while a parcel at one million sits in the catalogue.
        seedListing('cheap', { price: 1_000_000 });
        for (let i = 0; i < 5; i++) seedListing(`bulk-${i}`, { price: 9_000_000 });

        const { getLandListings } = await actions();
        const result: any = await getLandListings({ maxPrice: 2_000_000, limit: 3 });

        expect(result.data.map((l: any) => l.id)).toEqual(['cheap']);
    });

    it('and honours the caller\'s limit as a page size, not as a pre-filter', async () => {
        for (let i = 0; i < 6; i++) seedListing(`cheap-${i}`, { price: 1_000_000 });

        const { getLandListings } = await actions();
        const result: any = await getLandListings({ maxPrice: 2_000_000, limit: 3 });

        expect(result.data).toHaveLength(3);
    });
});

describe('getVerifiedLandListings', () => {
    it('returns only what a buyer may browse', async () => {
        seedListing('public-1');
        seedListing('available-1', { status: 'available' });
        seedUnderReview('pending-1', 'pending_verification');

        const { getVerifiedLandListings } = await actions();
        const ids = ((await getVerifiedLandListings() as any).data).map((l: any) => l.id);

        expect(ids.sort()).toEqual(['available-1', 'public-1']);
    });
});

// ─── the single read ─────────────────────────────────────────────────────────

describe('getLandListing', () => {
    it('returns a public listing to anybody, stripped', async () => {
        seedListing('public-1', { verificationNotes: 'ok', verifiedBy: 'admin-9' });

        const { getLandListing } = await actions();
        const listing: any = (await getLandListing('public-1') as any).data;

        expect(listing.id).toBe('public-1');
        expect(listing.verificationNotes).toBeUndefined();
    });

    it('hides one under review from a stranger, indistinguishably from a missing id', async () => {
        seedUnderReview('pending-1', 'pending_verification');
        actAs(STRANGER);

        const { getLandListing } = await actions();
        expect((await getLandListing('pending-1') as any).data).toBeNull();
        expect((await getLandListing('no-such-id') as any).data).toBeNull();
    });

    it('but shows it to its owner, with the reason it was rejected', async () => {
        seedUnderReview('rejected-1', 'rejected');
        actAs(OWNER);

        const { getLandListing } = await actions();
        const listing: any = (await getLandListing('rejected-1') as any).data;

        expect(listing.rejectionReason).toBe('Ownership could not be confirmed.');
    });
});

// ─── the owner's list ────────────────────────────────────────────────────────

describe('getMyLandListings', () => {
    it('refuses a caller with no session', async () => {
        const { getMyLandListings } = await actions();
        expect(await getMyLandListings()).toMatchObject({ success: false });
    });

    it('returns every status the owner holds, except deleted', async () => {
        seedListing('mine-public');
        seedUnderReview('mine-pending', 'pending_verification');
        seedListing('mine-gone', { status: 'deleted' });
        seedListing('theirs', { ownerId: 'someone-else' });
        actAs(OWNER);

        const { getMyLandListings } = await actions();
        const ids = ((await getMyLandListings() as any).data).map((l: any) => l.id);

        expect(ids.sort()).toEqual(['mine-pending', 'mine-public']);
    });
});

// ─── the edit ────────────────────────────────────────────────────────────────

describe('updateLandListing', () => {
    it('refuses somebody who does not own the listing', async () => {
        seedListing('public-1');
        actAs(STRANGER);

        const { updateLandListing } = await actions();
        expect(await updateLandListing({ listingId: 'public-1', price: 1 })).toMatchObject({
            success: false, error: 'Unauthorized to edit this listing',
        });
    });

    it('refuses a listing that does not exist', async () => {
        actAs(OWNER);
        const { updateLandListing } = await actions();

        expect(await updateLandListing({ listingId: 'nope', price: 1 })).toMatchObject({
            success: false, error: 'Listing not found',
        });
    });

    it('sends an edited listing back for review', async () => {
        seedListing('public-1');
        actAs(OWNER);

        const { updateLandListing } = await actions();
        expect(await updateLandListing({ listingId: 'public-1', price: 7_000_000 }))
            .toMatchObject({ success: true });

        const listing = store.get(COLLECTIONS.LAND_LISTINGS, 'public-1');
        expect(listing?.price).toBe(7_000_000);
        expect(listing?.status).toBe('pending_verification');
    });

    it('and does not leave the previous approval attached to it', async () => {
        // The status goes back to pending_verification, but verifiedAt and
        // verifiedBy stayed — so a listing awaiting review still read as
        // "verified by admin-9 on that date" to anything that renders them.
        seedListing('public-1', { verifiedBy: 'admin-9', verifiedAt: new Date(2026, 0, 5).toISOString() });
        actAs(OWNER);

        const { updateLandListing } = await actions();
        await updateLandListing({ listingId: 'public-1', price: 7_000_000 });

        const listing = store.get(COLLECTIONS.LAND_LISTINGS, 'public-1');
        expect(listing?.verifiedBy ?? null).toBeNull();
        expect(listing?.verifiedAt ?? null).toBeNull();
    });
});

// ─── the verification ────────────────────────────────────────────────────────

describe('verifyLandListing', () => {
    it('refuses a caller who is not an admin', async () => {
        seedUnderReview('pending-1', 'pending_verification');
        actAs(OWNER);

        const { verifyLandListing } = await actions();
        expect(await verifyLandListing({ listingId: 'pending-1', verified: true })).toMatchObject({
            success: false, error: 'Unauthorized - Admin only',
        });
    });

    it('verifies a listing awaiting review', async () => {
        seedUnderReview('pending-1', 'pending_verification');
        actAs('admin-1', ['admin']);

        const { verifyLandListing } = await actions();
        expect(await verifyLandListing({ listingId: 'pending-1', verified: true, notes: 'Deed checked' }))
            .toMatchObject({ success: true });

        expect(store.get(COLLECTIONS.LAND_LISTINGS, 'pending-1')).toMatchObject({
            status: 'verified', verifiedBy: 'admin-1', verificationNotes: 'Deed checked',
        });
    });

    it('and rejects one, recording why', async () => {
        seedUnderReview('pending-1', 'pending_verification');
        actAs('admin-1', ['super_admin']);

        const { verifyLandListing } = await actions();
        await verifyLandListing({
            listingId: 'pending-1', verified: false, rejectionReason: 'Survey plan missing',
        });

        expect(store.get(COLLECTIONS.LAND_LISTINGS, 'pending-1')).toMatchObject({
            status: 'rejected', rejectionReason: 'Survey plan missing',
        });
    });

    /**
     * THE SIXTH BLIND LAND STATUS WRITE.
     *
     * admin/_land.ts carries a comment headed "The FIFTH blind land status
     * write, and the most exposed of the five", listing what they had in common:
     * they read nothing, wrote the status unconditionally, and so reported
     * success for an id that does not exist and overwrote whatever state the
     * listing was actually in. All five were converted to
     * claimStatusTransitionFromAny.
     *
     * This one was not among them, and /land/verify — the admin verification
     * page — calls THIS one.
     *
     * The consequence the fifth's comment spells out applies here unchanged:
     * Farm Nation holds a buyer's money against `pending_escrow`. Approving from
     * there put the parcel back on the public market with the escrow still open;
     * rejecting from there took it off the market with the buyer's money still
     * held and nothing in the flow to release it.
     */
    it('refuses a listing id that does not exist', async () => {
        actAs('admin-1', ['admin']);

        const { verifyLandListing } = await actions();
        const result = await verifyLandListing({ listingId: 'no-such-listing', verified: true });

        expect(result.success).toBe(false);
        expect(store.size(COLLECTIONS.LAND_LISTINGS)).toBe(0);
    });

    it('and a listing whose money is already committed', async () => {
        seedListing('escrowed', { status: 'pending_escrow' });
        actAs('admin-1', ['admin']);

        const { verifyLandListing } = await actions();
        const result = await verifyLandListing({ listingId: 'escrowed', verified: true });

        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.LAND_LISTINGS, 'escrowed')?.status).toBe('pending_escrow');
    });
});

// ─── the delete ──────────────────────────────────────────────────────────────

describe('deleteLandListing', () => {
    it('refuses somebody who does not own the listing', async () => {
        seedListing('public-1');
        actAs(STRANGER);

        const { deleteLandListing } = await actions();
        expect(await deleteLandListing('public-1')).toMatchObject({
            success: false, error: 'Unauthorized to delete this listing',
        });
    });

    it('soft-deletes, keeping the row and who did it', async () => {
        seedListing('public-1');
        actAs(OWNER);

        const { deleteLandListing } = await actions();
        expect(await deleteLandListing('public-1')).toMatchObject({ success: true });

        expect(store.get(COLLECTIONS.LAND_LISTINGS, 'public-1')).toMatchObject({
            status: 'deleted', deletedBy: OWNER,
        });
    });
});

// ─── the statistics ──────────────────────────────────────────────────────────

describe('getLandStatistics', () => {
    it('refuses a caller who is not an admin', async () => {
        actAs(OWNER);
        const { getLandStatistics } = await actions();

        expect(await getLandStatistics()).toMatchObject({ success: false, error: 'Unauthorized - Admin only' });
    });

    it('counts by status and averages the price over what it counted', async () => {
        seedListing('v1', { price: 4_000_000, size: 10 });
        seedListing('v2', { price: 6_000_000, size: 20 });
        seedUnderReview('p1', 'pending_verification');
        seedUnderReview('r1', 'rejected');
        seedListing('gone', { status: 'deleted', price: 999_000_000 });
        actAs('admin-1', ['admin']);

        const { getLandStatistics } = await actions();
        const stats: any = (await getLandStatistics() as any).data;

        expect(stats.total).toBe(4);
        expect(stats.verified).toBe(2);
        expect(stats.pending).toBe(1);
        expect(stats.rejected).toBe(1);
        // The deleted listing's price is excluded from the total it averages.
        expect(stats.totalValue).toBe(4_000_000 + 6_000_000 + 5_000_000 + 5_000_000);
        expect(stats.byState.Enugu).toBe(4);
    });
});
