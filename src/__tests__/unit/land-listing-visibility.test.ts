/**
 * @jest-environment node
 */

/**
 * The land verification queue was a public feed.
 *
 * `getLandListings(filters)` had no caller check of any kind and honoured a
 * `status` filter:
 *
 *     const targetStatuses = filters.status === 'verified'
 *         ? ['verified', 'approved'] : [filters.status];
 *
 * So anyone could call it with `{ status: 'pending_verification' }` and receive
 * every unverified land listing as a full document — the admin's
 * verificationNotes and rejectionReason, the owner's id and email, for people
 * whose land has not been approved for listing anywhere yet. `/land/verify`, an
 * admin page, is the only caller that ever passes a non-public status.
 *
 * `getLandListing(id)` had the same hole one listing at a time: no session, any
 * status, whole document. It has no UI caller at all, which is not a defence —
 * every export of a "use server" module is a reachable endpoint.
 *
 * WHAT IS DELIBERATELY STILL OPEN
 * -------------------------------
 * Browsing VERIFIED land, without signing in. That is what the module is for,
 * and a fix that required a session to see farmland for sale would be a
 * regression dressed as a security improvement. The line is drawn at status:
 * verified and approved are public, the review queue is not.
 *
 * THE SMALL ONE
 * -------------
 * `verifyLandListing` checked `roles.includes('admin')`, so a super_admin
 * without the literal 'admin' role was refused — the one account that should
 * never be locked out of a queue. It checks both now, and deliberately does NOT
 * switch to isAdmin(), which would widen verification to moderator, support and
 * every module admin.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const SUPER = 'super-1';
const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const LISTING = 'listing-1';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

/**
 *   #397 moved verifyLandListing off a raw .update() onto an atomic claim, so a
 *   decision cannot land on a listing with a buyer's money against it.
 *
 *   The claim is MODELLED here rather than stubbed to `{ claimed: true }`. The
 *   tests below are about WHO MAY VERIFY, and a stub that always claims would
 *   pass just as happily with the status guard deleted — the vacuity #386 and
 *   #395 both had to be talked out of. This answers from the status
 *   setListing() just wrote, so an authorisation test still drives a real
 *   transition and a locked listing is still refused.
 */
let currentListingStatus = 'pending_verification';
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({
        claimed: false, status: currentListingStatus, exists: true,
    })),
    claimStatusTransitionFromAny: jest.fn(async ({ fromAny, to }: any) => {
        // Mirrors the real filter: `to → to` is not a transition.
        const startingPoints = (fromAny as string[]).filter((f) => f !== to);
        return {
            claimed: startingPoints.includes(currentListingStatus),
            status: currentListingStatus,
            exists: true,
        };
    }),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

/** One listing, in whatever status the test needs, with review fields present. */
function setListing(status: string, extra: Record<string, any> = {}) {
    currentListingStatus = status;
    const data = {
        title: 'Two hectares near Ikeja',
        description: 'Good soil, borehole on site, fenced perimeter.',
        ownerId: OWNER,
        ownerEmail: 'owner@example.com',
        status,
        price: 4_500_000,
        size: 2,
        location: { lat: 6.6, lng: 3.35, address: '1 Road', city: 'Ikeja', state: 'Lagos' },
        features: [],
        images: ['https://img/1.jpg'],
        verificationNotes: 'Survey plan does not match the coordinates supplied.',
        rejectionReason: 'Documents incomplete',
        verifiedBy: ADMIN,
        createdAt: { toDate: () => new Date('2026-01-01') },
        updatedAt: { toDate: () => new Date('2026-01-02') },
        ...extra,
    };
    const snap = {
        exists: true, empty: false,
        docs: [{ id: LISTING, ref: { id: LISTING }, data: () => data }],
        ref: { id: LISTING },
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

async function listWithStatus(status?: string) {
    const { getLandListings } = await import('@/app/actions/land-actions');
    return getLandListings(status ? ({ status } as any) : undefined);
}

async function readOne() {
    const { getLandListing } = await import('@/app/actions/land-actions');
    return getLandListing(LISTING);
}

describe('getLandListings — the review queue needs an admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setListing('pending_verification');
    });

    it('refuses a stranger asking for pending listings', async () => {
        // THE test. This is the query /land/verify makes, and it was open to
        // anyone.
        setSession(null);

        const r: any = await listWithStatus('pending_verification');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(r.data).toBeNull();
    });

    it('refuses a signed-in non-admin asking for pending listings', async () => {
        setSession(STRANGER, ['farmer']);

        const r: any = await listWithStatus('pending_verification');

        expect(r.success).toBe(false);
    });

    it('refuses a stranger asking for rejected listings', async () => {
        // Rejected listings carry the reason they were rejected.
        setSession(null);

        const r: any = await listWithStatus('rejected');

        expect(r.success).toBe(false);
    });

    it('lets an admin read the queue, which is the whole point of the page', async () => {
        // Vacuity guard. A guard that refused everyone would empty
        // /land/verify with no other symptom.
        setSession(ADMIN, ['admin']);

        const r: any = await listWithStatus('pending_verification');

        expect(r.success).toBe(true);
    });

    it('still lets anyone browse verified land without signing in', async () => {
        // The deliberate hole. Requiring a session to see farmland for sale
        // would be a regression dressed as a security fix.
        setSession(null);
        setListing('verified');

        const r: any = await listWithStatus('verified');

        expect(r.success).toBe(true);
    });

    it('still serves an unfiltered browse to a stranger', async () => {
        // No status filter is the ordinary public listing page.
        setSession(null);
        setListing('verified');

        const r: any = await listWithStatus();

        expect(r.success).toBe(true);
    });
});

describe('getLandListing — one listing at a time, same rule', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('hides a pending listing from a stranger', async () => {
        setSession(null);
        setListing('pending_verification');

        const r: any = await readOne();

        // Reported as "no such listing" rather than "forbidden", so the endpoint
        // does not confirm an id exists to someone who may not see it.
        expect(r.data).toBeNull();
    });

    it('hides a rejected listing from another signed-in user', async () => {
        setSession(STRANGER, ['farmer']);
        setListing('rejected');

        const r: any = await readOne();

        expect(r.data).toBeNull();
    });

    it('shows a pending listing to its owner, with the reason it is pending', async () => {
        // The owner has to be able to read why their land was rejected, so the
        // internal fields stay for them.
        setSession(OWNER, ['farmer']);
        setListing('pending_verification');

        const r: any = await readOne();

        expect(r.data).not.toBeNull();
        expect(r.data.verificationNotes).toBeTruthy();
    });

    it('shows a pending listing to an admin', async () => {
        setSession(ADMIN, ['admin']);
        setListing('pending_verification');

        const r: any = await readOne();

        expect(r.data).not.toBeNull();
    });

    it('strips the review fields for a public viewer of a verified listing', async () => {
        // A verified listing is public, but the admin's notes about it are not.
        setSession(null);
        setListing('verified');

        const r: any = await readOne();

        expect(r.data).not.toBeNull();
        expect(r.data.verificationNotes).toBeUndefined();
        expect(r.data.rejectionReason).toBeUndefined();
        expect(r.data.ownerEmail).toBeUndefined();
        // The listing itself still arrives, or this test proves nothing.
        expect(r.data.title).toContain('Two hectares');
        expect(r.data.price).toBe(4_500_000);
    });
});

describe('verifyLandListing — who may verify', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setListing('pending_verification');
    });

    async function verify(id: string, roles: string[]) {
        setSession(id, roles);
        const { verifyLandListing } = await import('@/app/actions/land-actions');
        return verifyLandListing({ listingId: LISTING, verified: true, notes: 'Survey plan checks out' } as any);
    }

    it('lets a super_admin verify, which the literal role check refused', async () => {
        // A super_admin without the plain 'admin' role was locked out of the
        // queue by `roles.includes('admin')`.
        const r: any = await verify(SUPER, ['super_admin']);

        expect(r.success).toBe(true);
    });

    it('still lets a plain admin verify', async () => {
        const r: any = await verify(ADMIN, ['admin']);

        expect(r.success).toBe(true);
    });

    it('still refuses a farmer', async () => {
        // Verifying your own land would be the whole game — verified listings
        // are what buyers trust and what farm-nation escrow transfers.
        const r: any = await verify(OWNER, ['farmer']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthorized/i);
    });

    it('ACCEPTS THE FARM-NATION ADMIN, WHICH THE MATRIX SAYS OWNS THIS JOB', async () => {
        //   #265 The guard was `admin || super_admin` under a note reading
        //        "verifying land is not their job" — of moderator, support and
        //        every module admin. Right about all of those but one:
        //        land:verify_listings is granted to super_admin, admin AND
        //        farm_nation_admin, and to no other module admin. The matrix
        //        is the definition of whose job it is, and the guard disagreed
        //        with it.
        const r: any = await verify('fn-admin-1', ['farm_nation_admin']);

        expect(r.success).toBe(true);
    });

    it('REFUSES A LISTING WITH A BUYER PAYING FOR IT, AND SAYS SO', async () => {
        /**
         *   #397 The behaviour the claim exists for.
         *
         *   Farm Nation holds a buyer's money against `pending_escrow`. The
         *   raw .update() this replaced wrote the decision regardless:
         *   approving put the parcel back on the public market with the escrow
         *   still open, and rejecting took it off the market with the money
         *   still held and nothing in the flow to release it. #137's fault.
         */
        setListing('pending_escrow');

        const r: any = await verify(ADMIN, ['admin']);

        expect(r.success).toBe(false);
        // Naming the state is the point — an admin told only "no" goes looking.
        expect(String(r.error)).toContain('pending_escrow');
        expect(String(r.error)).toMatch(/purchase in progress/i);
    });

    it('and still verifies a listing that is merely awaiting review', async () => {
        // Vacuity guard for the test above: a refusal proves nothing if the
        // action refuses everything.
        setListing('pending_verification');

        const r: any = await verify(ADMIN, ['admin']);

        expect(r.success).toBe(true);
    });

    it('does not widen verification to every module admin', async () => {
        // isAdmin() would have accepted these, and it is still not the choice.
        // Naming the permission admits exactly the three roles the matrix
        // lists — which is neither the old pair nor isAdmin().
        for (const role of ['moderator', 'support', 'wave_admin', 'academy_admin']) {
            const r: any = await verify(`${role}-1`, [role]);
            expect(r.success).toBe(false);
        }
    });
});
