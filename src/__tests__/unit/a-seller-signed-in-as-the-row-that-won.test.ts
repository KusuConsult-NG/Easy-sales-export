/**
 * @jest-environment node
 */

/**
 *   #904 (SECOND CAUSE) A SELLER'S LISTINGS, FILED UNDER THE PROFILE THEY NO
 *   LONGER SIGN IN AS.
 *
 *       "My properties are not listed under my property tab"
 *
 *   Migration 040 answered the cause where the owner was written under the
 *   wrong KEY NAME. This is the one where the key is right and the VALUE is a
 *   profile that has since been superseded: the seller listed the parcel on one
 *   of their rows, an admin settled the duplicate with the #724 tool, and the
 *   listing kept `ownerId: <the id that lost>` while the seller arrives as the
 *   id that won — profile-choice ranks a superseded row last (#490).
 *
 *   Both faults empty the same screen, and an empty screen is indistinguishable
 *   from owning nothing.
 *
 * ── EXECUTED, NOT SCANNED ───────────────────────────────────────────────────
 *
 *   Its sibling suite proves the RULE — that the backward walk agrees with the
 *   forward one, and refuses a row belonging to somebody else. This one runs
 *   the seller's actual screens against a fake database, because a rule that is
 *   right and a query that never reaches it would pass every test there.
 *
 *   The fake database is the one `fake-db-matches-postgres.test.ts` holds to
 *   real PostgreSQL, which is what makes the `in` these actions now emit
 *   something measured rather than assumed.
 *
 * ── AND THE CONTROL IS THE POINT ────────────────────────────────────────────
 *
 *   040 refused to hand back a listing whose two owner keys DISAGREED, because
 *   that is what a sale looks like afterwards. The same trap is here: a profile
 *   row can carry OUR auth id and point at somebody else. If this widening
 *   reached that row's listings, the screen would show a stranger's land — and,
 *   since the ownership gates share the rule, let us delete it.
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

/** The row the seller signs in as — the one that won the duplicate. */
const LIVE = 'seller-live';
/** The row they listed their first parcels on, superseded onto LIVE. */
const OLD = 'seller-superseded';
/** Somebody else entirely, whose profile happens to share our auth id. */
const STRANGER = 'stranger-live';

const seedProfiles = () => {
    store.seed(COLLECTIONS.USERS, LIVE, { id: LIVE, email: 's@e.com', supabaseAuthId: LIVE });
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 's@e.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { id: STRANGER, email: 'x@e.com', supabaseAuthId: STRANGER });
    /*
     *   THE CONTROL ROW. It carries our auth id AND points at the stranger, so
     *   the backward query returns it and `pointerOf` must refuse it. This is
     *   040's disagreeing-keys case in the identity layer.
     */
    store.seed(COLLECTIONS.USERS, 'not-ours', {
        id: 'not-ours', supabaseAuthId: LIVE, _migratedTo: STRANGER,
    });
};

const seedListing = (id: string, ownerId: string, over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.LAND_LISTINGS, id, {
        id,
        title: `Plot ${id}`,
        ownerId,
        status: 'verified',
        price: 5_000_000,
        size: 2,
        location: { state: 'Enugu', lga: 'Oji River', address: 'Ugwuoba' },
        createdAt: '2026-09-12T10:32:43.735Z',
        updatedAt: '2026-09-12T10:32:43.735Z',
        ...over,
    });

const signedInAs = (id: string, roles: string[] = ['farmer']) =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles, email: 's@e.com', name: 'S' } }, error: null,
    });

const myLandListings = async () => {
    const { getMyLandListings } = await import('@/app/actions/land-actions');
    return await getMyLandListings() as any;
};

const myProperties = async () => {
    const { getMyPropertiesAction } = await import('@/app/actions/farm-nation/_fn_listings');
    return await getMyPropertiesAction() as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProfiles();
    signedInAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — My Properties, as the seller actually opens it', () => {
    it('THE REPORTED CASE: the listing made on the superseded profile is there', async () => {
        seedListing('before-the-merge', OLD);

        const res = await myLandListings();

        expect(res.success).toBe(true);
        expect(res.data.map((l: any) => l.id)).toEqual(['before-the-merge']);
    });

    it('AND BEFORE THIS, IT WAS NOT — the defect, run rather than described', async () => {
        /*
         *   The same seed with the pointer removed is the world as it was: the
         *   listing exists, the seller owns it, and the query cannot see it.
         *   Without this the test above could pass on a fake database that
         *   simply ignored the owner filter.
         */
        store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 's@e.com' });
        seedListing('before-the-merge', OLD);

        const res = await myLandListings();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(0);
    });

    it('AND THE LIVE PROFILE\'S OWN LISTINGS ARE STILL THERE', async () => {
        seedListing('before-the-merge', OLD);
        seedListing('after-the-merge', LIVE);

        const res = await myLandListings();

        expect(res.data.map((l: any) => l.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });

    it('THE CONTROL: A STRANGER\'S LAND IS NOT HANDED OVER', async () => {
        //   `not-ours` carries our auth id and points at the stranger, so the
        //   backward query returns that profile and the rule must refuse it.
        seedListing('theirs', STRANGER);
        seedListing('also-theirs', 'not-ours');
        seedListing('ours', OLD);

        const res = await myLandListings();

        expect(res.data.map((l: any) => l.id)).toEqual(['ours']);
    });

    it('AND A SELLER WITH NO DUPLICATES SEES EXACTLY WHAT THEY SEE TODAY', async () => {
        //   The vacuity guard, and the claim that the common case is unchanged.
        signedInAs(STRANGER);
        seedListing('theirs', STRANGER);
        seedListing('ours', OLD);

        const res = await myLandListings();

        expect(res.data.map((l: any) => l.id)).toEqual(['theirs']);
    });

    it('AND THE OTHER DOOR ONTO THE SAME SCREEN AGREES', async () => {
        //   Two actions render My Properties. One widened and not the other is
        //   the same screen answering two ways depending on the route in.
        seedListing('before-the-merge', OLD);
        seedListing('after-the-merge', LIVE);

        const res = await myProperties();

        expect(res.success).toBe(true);
        expect(res.data.properties.map((p: any) => p.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — and what appears can be opened, edited and deleted', () => {
    const getListing = async (id: string) => {
        const { getLandListing } = await import('@/app/actions/land-actions');
        return await getLandListing(id) as any;
    };

    it('A REJECTED LISTING OPENS FOR ITS OWNER — which is why that branch exists', async () => {
        /*
         *   `rejected` is not a public status, so the gate decides. Its own
         *   comment says the owner "needs to read why they were rejected", and
         *   `!==` refused exactly the owner it was written to admit.
         */
        seedListing('rejected-1', OLD, { status: 'rejected', rejectionReason: 'Survey plan unclear' });

        const res = await getListing('rejected-1');

        expect(res.data).not.toBeNull();
        expect(res.data.id).toBe('rejected-1');
    });

    it('AND CARRIES THE REVIEW NOTES, not the stripped public payload', async () => {
        seedListing('rejected-2', OLD, { status: 'rejected', rejectionReason: 'Survey plan unclear' });

        const res = await getListing('rejected-2');

        expect(res.data.rejectionReason).toBe('Survey plan unclear');
    });

    it('AND A STRANGER STILL CANNOT OPEN IT', async () => {
        //   The control on the same gate: widening it for the owner must not
        //   open a listing under review to somebody walking ids.
        seedListing('rejected-3', OLD, { status: 'rejected' });
        signedInAs(STRANGER);

        const res = await getListing('rejected-3');

        expect(res.data).toBeNull();
    });

    it('THE EDIT IS ALLOWED — #884\'s "can users now edit their listing?"', async () => {
        seedListing('editable', OLD, { status: 'rejected' });

        const { updateLandListing } = await import('@/app/actions/land-actions');
        const res = await updateLandListing({ listingId: 'editable', price: 6_000_000 }) as any;

        expect(res.error).not.toBe('Unauthorized to edit this listing');
        expect(res.success).toBe(true);
    });

    it('AND A STRANGER\'S EDIT IS STILL REFUSED', async () => {
        seedListing('not-editable', OLD, { status: 'rejected' });
        signedInAs(STRANGER);

        const { updateLandListing } = await import('@/app/actions/land-actions');
        const res = await updateLandListing({ listingId: 'not-editable', price: 6_000_000 }) as any;

        expect(res).toMatchObject({ success: false, error: 'Unauthorized to edit this listing' });
    });

    it('THE DELETE IS ALLOWED, AND A STRANGER\'S IS NOT', async () => {
        seedListing('mine-to-delete', OLD, { status: 'rejected' });
        seedListing('not-mine', LIVE, { status: 'rejected' });

        const { deleteLandListing } = await import('@/app/actions/land-actions');
        const ours = await deleteLandListing('mine-to-delete') as any;

        signedInAs(STRANGER);
        const theirs = await deleteLandListing('not-mine') as any;

        expect(ours.success).toBe(true);
        expect(theirs).toMatchObject({ success: false, error: 'Unauthorized to delete this listing' });
    });
});
