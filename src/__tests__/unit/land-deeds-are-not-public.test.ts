/**
 * @jest-environment node
 */

/**
 *   #340 THE DEEDS TO EVERY PARCEL OF LAND WERE PUBLIC, AND SO WAS THE REVIEW
 *        QUEUE.
 *
 *        LAND_LISTINGS documents carry, written by the module's own creators:
 *
 *          documents    { landTitle, surveyPlan, taxClearance } — the
 *                       certificate of occupancy, the survey plan and the tax
 *                       clearance. The papers proving title to the parcel.
 *          ownerEmail,  taken from the owner's user document at listing time.
 *          ownerPhone
 *          verificationNotes, rejectionReason, verifiedBy
 *                       the admin's review and the admin's own user id.
 *
 *        #148 gated the ADMIN queue over this collection on
 *        "land:verify_listings", and said why in a comment that is still there:
 *        "the URLs of their C of O, survey plan and tax clearance. Those are the
 *        legal documents proving title to a parcel of land."
 *
 *        lib/land-visibility.ts was then written to keep the review fields out
 *        of public payloads, after the same defect was found in
 *        /api/farm-nation/listings. Its header states the reasoning:
 *
 *            "Those documents carry the admin's verificationNotes and
 *             rejectionReason, the owner's id and email, and they belong to
 *             people who have not agreed to be listed anywhere yet."
 *
 *        FOUR READERS, ONE OF THEM USED IT.
 *
 *          api/farm-nation/listings          stripped — the one it was written for
 *          land-actions.ts                   stripped
 *          land-listings.ts searchLand…      NOT stripped
 *          land-listings.ts getPropertyById  NOT stripped, and no status filter
 *          farm-nation/_fn_listings.ts
 *            getPropertyByIdAction           NOT stripped, and no status filter
 *
 *        Two actions share the name getPropertyByIdAction over one collection,
 *        which is how one of them was fixed and the other was not. Both are
 *        public — /farm-nation/property/[id] sits outside the (member) group and
 *        farm-nation/layout.tsx only sets metadata — so ANY id returned the
 *        whole document at ANY status. A rejected application was readable, with
 *        the reason it was rejected, by anyone who could guess an id.
 *
 *        AND THE STRIP ITSELF WAS SHORT. It removed ownerEmail and left
 *        ownerPhone beside it, and it never mentioned `documents` at all — so
 *        even the two readers that DID call it published the deeds.
 *
 *        The only public consumer of `documents` was a badge on the Farm Nation
 *        home page testing `property.documents.length > 0`. `documents` is an
 *        OBJECT in both writers, so `.length` is undefined, `undefined > 0` is
 *        false, and every listing ever created read "Unverified Land" —
 *        including the ones an admin had verified. It reads the status now,
 *        which is the fact the badge was always trying to state.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    INTERNAL_LAND_FIELDS,
    REVIEW_ONLY_LAND_STATUSES,
    isLandListingViewable,
    stripInternalLandFields,
} from '@/lib/land-visibility';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const OWNER = 'owner-1';
const C_OF_O = 'https://cdn.test/certificate-of-occupancy.pdf';

let store: FakeDbHandle;

function actAs(id: string | null, roles: string[] = ['user']) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com` } }, error: null },
    ));
}

function seed(id: string, extra: Record<string, unknown> = {}) {
    store.seed(LISTINGS, id, {
        ownerId: OWNER,
        ownerName: 'Ada Obi',
        ownerEmail: 'owner-1@example.com',
        ownerPhone: '08011111111',
        title: 'Five hectares in Jos',
        name: 'Five hectares in Jos',
        description: 'Fertile farmland',
        location: { state: 'Plateau', lga: 'Jos North' },
        size: 5,
        price: 5_000_000,
        status: 'available',
        documents: { landTitle: C_OF_O, surveyPlan: 'https://cdn.test/survey.pdf' },
        verificationNotes: 'inspected 3 Jan',
        rejectionReason: null,
        verifiedBy: 'admin-7',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(null);
});

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#340 — the strip now names what it was written to remove', () => {
    it('DOCUMENTS AND OWNERPHONE ARE INTERNAL', () => {
        // THE test. `documents` is the deeds; `ownerPhone` sat beside the
        // ownerEmail this list already removed.
        expect(INTERNAL_LAND_FIELDS).toContain('documents');
        expect(INTERNAL_LAND_FIELDS).toContain('ownerPhone');
    });

    it('and the fields it already removed are still removed', () => {
        for (const field of ['ownerEmail', 'verificationNotes', 'rejectionReason', 'verifiedBy']) {
            expect(INTERNAL_LAND_FIELDS).toContain(field);
        }
    });

    it('the strip removes them from an actual listing', () => {
        const out = stripInternalLandFields({
            title: 'Five hectares', price: 1, documents: { landTitle: C_OF_O },
            ownerPhone: '080', ownerEmail: 'a@b.c', verifiedBy: 'admin-7',
        }) as Record<string, unknown>;

        expect(out.title).toBe('Five hectares');   // vacuity guard
        expect(out.documents).toBeUndefined();
        expect(out.ownerPhone).toBeUndefined();
        expect(out.ownerEmail).toBeUndefined();
        expect(out.verifiedBy).toBeUndefined();
    });

    it('a listing still in — or thrown out of — the review queue is not viewable', () => {
        for (const status of ['draft', 'pending_verification', 'inspection_scheduled',
            'rejected', 'deleted']) {
            expect(REVIEW_ONLY_LAND_STATUSES).toContain(status);
            expect(isLandListingViewable(status)).toBe(false);
        }
    });

    it('but a sold or leased parcel still is — that is the end of a listing, not a secret', () => {
        // The counterpart guard. Refusing these would break the detail page for
        // every completed sale.
        for (const status of ['verified', 'available', 'approved', 'sold', 'leased',
            'pending_escrow']) {
            expect(isLandListingViewable(status)).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#340 — the public search no longer ships the review fields', () => {
    it('SEARCH RESULTS CARRY NO DEEDS, NO OWNER CONTACT, NO ADMIN NOTES', async () => {
        seed('l1', { status: 'verified' });
        const { searchLandListingsAction } = await import('@/app/actions/land-listings');

        const res = (await searchLandListingsAction({})) as any;
        expect(res.success).toBe(true);
        const [listing] = res.data.listings;

        expect(listing.title).toBe('Five hectares in Jos');   // vacuity guard
        expect(listing.documents).toBeUndefined();
        expect(listing.ownerEmail).toBeUndefined();
        expect(listing.ownerPhone).toBeUndefined();
        expect(listing.verificationNotes).toBeUndefined();
        expect(JSON.stringify(res.data)).not.toContain(C_OF_O);
    });

    it('and the search is still public and still returns the for-sale listings', async () => {
        seed('l1', { status: 'verified' });
        seed('l2', { status: 'available' });
        seed('l3', { status: 'pending_verification' });
        const { searchLandListingsAction } = await import('@/app/actions/land-listings');

        const res = (await searchLandListingsAction({})) as any;
        expect(res.data.listings).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#340 — farm-nation's getPropertyByIdAction, the SECOND action of that name", () => {
    async function get(id: string) {
        const { getPropertyByIdAction } = await import('@/app/actions/farm-nation/_fn_listings');
        return (await getPropertyByIdAction(id)) as any;
    }

    it('A STRANGER GETS THE LISTING WITHOUT THE DEEDS', async () => {
        seed('l1', { status: 'available' });

        const res = await get('l1');
        expect(res.success).toBe(true);
        expect(res.data.property.name).toBe('Five hectares in Jos');   // vacuity guard
        expect(res.data.property.documents).toBeUndefined();
        expect(res.data.property.ownerEmail).toBeUndefined();
        expect(res.data.property.ownerPhone).toBeUndefined();
        expect(JSON.stringify(res.data)).not.toContain(C_OF_O);
    });

    it('AND IS REFUSED A LISTING IN THE REVIEW QUEUE', async () => {
        seed('l1', { status: 'rejected', rejectionReason: 'Title does not match' });

        const res = await get('l1');
        expect(res.success).toBe(false);
        expect(JSON.stringify(res)).not.toContain('Title does not match');
    });

    it('the OWNER still gets their own record whole', async () => {
        actAs(OWNER);
        seed('l1', { status: 'pending_verification' });

        const res = await get('l1');
        expect(res.success).toBe(true);
        expect(res.data.property.documents.landTitle).toBe(C_OF_O);
        expect(res.data.property.ownerEmail).toBe('owner-1@example.com');
    });

    it('and so does an admin who may verify listings', async () => {
        actAs('admin-7', ['farm_nation_admin']);
        seed('l1', { status: 'rejected' });

        const res = await get('l1');
        expect(res.success).toBe(true);
        expect(res.data.property.documents.landTitle).toBe(C_OF_O);
    });

    it('an admin role with no land permission is a stranger here', async () => {
        actAs('a1', ['academy_admin']);
        seed('l1', { status: 'rejected' });

        expect((await get('l1')).success).toBe(false);
    });

    it('the view counter still runs — the strip is on the way OUT, not the way in', async () => {
        seed('l1', { status: 'available', viewCount: 4 });
        await get('l1');

        expect((store.get(LISTINGS, 'l1') as any).viewCount).toBe(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#340 — the badge that could never say "Verified"', () => {
    it('THE HOME PAGE NO LONGER TESTS documents.length', () => {
        // `documents` is an object in both writers, so `.length` was undefined
        // and `undefined > 0` is false on every listing that has ever existed.
        const page = source('src/app/farm-nation/page.tsx');

        expect(page).not.toContain('property.documents.length');
        expect(page).toContain('isPurchasable(property.status)');
    });

    it('and it really is an object, in both writers', () => {
        // The claim above, pinned. If a writer ever produces an array the badge
        // reasoning changes and this fails.
        expect(source('src/app/actions/farm-nation/_fn_listings.ts')).toContain('documents: {}');
        expect(source('src/app/api/farm-nation/create-listing/route.ts'))
            .toContain('const documents: any = {}');
    });

    it('isPurchasable answers the question the badge asks', async () => {
        const { isPurchasable } = await import('@/lib/land-listing-status');

        expect(isPurchasable('verified')).toBe(true);
        expect(isPurchasable('available')).toBe(true);
        expect(isPurchasable('approved')).toBe(true);
        expect(isPurchasable('pending_verification')).toBe(false);
        expect(isPurchasable('rejected')).toBe(false);
    });

    it("the property page no longer prints the owner's email address", () => {
        expect(source('src/app/farm-nation/property/[id]/page.tsx'))
            .not.toContain('{property.ownerEmail}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#340 — every public reader of this collection now shares one rule', () => {
    it('all four call the shared strip', () => {
        // The ratchet. A fifth reader that spreads a listing without this is the
        // defect coming back under a new name.
        for (const file of [
            'src/app/api/farm-nation/listings/route.ts',
            'src/app/actions/land-actions.ts',
            'src/app/actions/land-listings.ts',
            'src/app/actions/farm-nation/_fn_listings.ts',
        ]) {
            expect(source(file)).toContain('stripInternalLandFields');
        }
    });

    it('and both actions named getPropertyByIdAction check viewability', () => {
        for (const file of [
            'src/app/actions/land-listings.ts',
            'src/app/actions/farm-nation/_fn_listings.ts',
        ]) {
            expect(source(file)).toContain('isLandListingViewable(');
            expect(source(file)).toContain('hasAdminPermission(viewer.roles, "land:verify_listings")');
        }
    });
});
