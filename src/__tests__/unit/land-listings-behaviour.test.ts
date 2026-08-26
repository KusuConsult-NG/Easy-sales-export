/**
 * @jest-environment node
 */

/**
 * Land listings, EXECUTED — create, submit, the admin verdicts, the public
 * search, the inquiry intake and the inquiry inbox.
 *
 * At 31%, and this file carries more fixed IDOR findings than any other in the
 * codebase. Four of its actions took the identity from a PARAMETER:
 *
 *   createLandListingAction      no session at all; `ownerId` from the caller,
 *                                so a listing could be created in anyone's name
 *   submitForVerificationAction  compared the record's owner against a value the
 *                                caller supplied — worse than no check, because
 *                                it reads as one
 *   submitLandInquiryAction      `listingOwnerId` and `listingTitle` passed
 *                                straight into a notification: an open endpoint
 *                                for sending any user a message with an
 *                                attacker-chosen title and body
 *   getLandInquiriesAction       queried on the caller's own `userId` argument,
 *                                turning a deliberately public intake form into
 *                                a bulk export of the buyer contact details it
 *                                collects
 *
 * Every one of those is a comparison between two values, and a call-recorder
 * harness could not distinguish "compares the session" from "compares the
 * argument" — both look like a `.where()` that never ran. These execute them.
 *
 * THE PUBLIC SEARCH IS THE OTHER HALF
 * -----------------------------------
 * It filtered on `status == "verified"` alone — a FOURTH vocabulary for the same
 * idea — so listings farm-nation creates as "available", and any an admin marked
 * "approved", never appeared in search results. Invisible inventory. The shared
 * PURCHASABLE_STATUSES set is asserted here status by status.
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
    revalidateTag: jest.fn(),
    // updateTag too — a missing export is undefined at the call site, the
    // call throws, and the action's catch reports a generic failure (#252).
    updateTag: jest.fn(),
    revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

const createNotificationAction = jest.fn(async (_p: unknown) => ({ success: true }));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (p: unknown) => createNotificationAction(p),
}));

const claimStatusTransitionFromAny = jest.fn(async (_args: unknown) =>
    ({ claimed: true, status: 'pending_verification', exists: true } as {
        claimed: boolean; status: string | null; exists?: boolean;
    }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: unknown) => claimStatusTransitionFromAny(args),
    claimStatusTransition: (args: unknown) => claimStatusTransitionFromAny(args),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const ADMIN = 'admin-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const INQUIRIES = COLLECTIONS.LAND_INQUIRIES;

function actAs(id: string | null, roles: string[] = ['user'], name = 'Ada Obi'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    createNotificationAction.mockImplementation(async () => ({ success: true }));
    claimStatusTransitionFromAny.mockImplementation(async () =>
        ({ claimed: true, status: 'pending_verification', exists: true }));
    store = installFakeDb();
    actAs(OWNER);
});

async function actions() {
    return import('@/app/actions/land-listings');
}

function listingInput(overrides: Record<string, unknown> = {}): any {
    return {
        ownerId: OWNER,
        ownerName: 'Ada Obi',
        ownerEmail: 'owner-1@example.com',
        title: 'Five hectares in Jos',
        description: 'Fertile farmland close to the road',
        location: { state: 'Plateau', lga: 'Jos North', address: 'Rayfield' },
        size: 5,
        price: 5_000_000,
        ...overrides,
    };
}

function seedListing(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(LISTINGS, id, {
        ownerId: OWNER,
        ownerName: 'Ada Obi',
        ownerEmail: 'owner-1@example.com',
        title: 'Five hectares in Jos',
        description: 'Fertile farmland',
        location: { state: 'Plateau', lga: 'Jos North', address: 'Rayfield' },
        size: 5,
        price: 5_000_000,
        status: 'available',
        soilType: 'loamy',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

const onlyListing = () => store.all(LISTINGS)[0][1] as Record<string, any>;
const titles = (res: any) => (res.data.listings as any[]).map((l) => l.title);

// ─────────────────────────────────────────────────────────────────────────────
describe('createLandListingAction', () => {
    const create = async (data?: any) =>
        (await (await actions()).createLandListingAction(data ?? listingInput())) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await create()).toMatchObject({ success: false });
        expect(store.size(LISTINGS)).toBe(0);
    });

    it('takes the owner from the SESSION, ignoring the ownerId parameter', async () => {
        // The parameter is retained so existing callers compile and is
        // deliberately not trusted.
        actAs('real-caller', ['user'], 'Ngozi Eze');

        expect((await create(listingInput({ ownerId: 'somebody-else' }))).success).toBe(true);

        const listing = onlyListing();
        expect(listing.ownerId).toBe('real-caller');
        expect(listing.ownerName).toBe('Ngozi Eze');
        expect(listing.ownerEmail).toBe('real-caller@example.com');
    });

    it('creates it as a DRAFT, with no images or documents', async () => {
        await create();

        const listing = onlyListing();
        expect(listing.status).toBe('draft');
        expect(listing.images).toEqual([]);
        expect(listing.documents).toEqual([]);
    });

    it('writes the eleven fields it accepts and NOTHING a caller adds', async () => {
        // `...data` came first and the trusted values after it, which handled
        // callers OVERWRITING the fields below and did nothing about callers
        // ADDING fields those lines never mention. LandListing declares
        // `verified`, `verificationStatus`, `verifiedBy`, `verifiedAt` and
        // `escrowAvailable` — every one of them a record of an admin decision.
        await create(listingInput({
            verified: true,
            verificationStatus: 'approved',
            verifiedBy: 'nobody',
            verifiedAt: '2020-01-01T00:00:00.000Z',
            escrowAvailable: true,
            status: 'verified',
            viewCount: 9999,
        }));

        const listing = onlyListing();
        expect(listing.status).toBe('draft');
        expect(listing.verified).toBeUndefined();
        expect(listing.verificationStatus).toBeUndefined();
        expect(listing.verifiedBy).toBeUndefined();
        expect(listing.verifiedAt).toBeUndefined();
        expect(listing.escrowAvailable).toBeUndefined();
        expect(listing.viewCount).toBeUndefined();
    });

    it('omits the optional fields entirely rather than writing undefined', async () => {
        await create(listingInput({ category: undefined, soilType: undefined }));

        const listing = onlyListing();
        expect('category' in listing).toBe(false);
        expect('soilType' in listing).toBe(false);
    });

    it('carries the optional fields through when they are given', async () => {
        await create(listingInput({ category: 'farmland', soilType: 'loamy', waterSource: 'borehole' }));

        expect(onlyListing()).toMatchObject({
            category: 'farmland', soilType: 'loamy', waterSource: 'borehole',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitForVerificationAction', () => {
    const submit = async (id: string, ownerId: string) =>
        (await (await actions()).submitForVerificationAction(id, ownerId)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        seedListing('l1', { status: 'draft' });
        expect(await submit('l1', OWNER)).toMatchObject({ success: false });
        expect(store.get(LISTINGS, 'l1')!.status).toBe('draft');
    });

    it('says so when the listing does not exist', async () => {
        expect(await submit('nope', OWNER)).toMatchObject({
            success: false, error: 'Listing not found',
        });
    });

    it('compares the SESSION, not the ownerId argument', async () => {
        // The check was `listingData.ownerId !== ownerId` where ownerId is a
        // PARAMETER — and the listing's owner is readable from the public
        // getPropertyByIdAction, so passing the real owner's id made it pass.
        actAs('attacker', ['user']);
        seedListing('l1', { ownerId: OWNER, status: 'draft' });

        expect(await submit('l1', OWNER)).toMatchObject({
            success: false, error: 'Unauthorized',
        });
        expect(store.get(LISTINGS, 'l1')!.status).toBe('draft');
    });

    it('lets the real owner submit it', async () => {
        seedListing('l1', { status: 'draft' });

        expect(await submit('l1', 'ignored')).toMatchObject({ success: true });
        expect(store.get(LISTINGS, 'l1')!.status).toBe('pending_verification');
    });

    it('lets an admin submit it on the owner\'s behalf', async () => {
        actAs(ADMIN, ['super_admin']);
        seedListing('l1', { status: 'draft' });

        expect(await submit('l1', OWNER)).toMatchObject({ success: true });
        expect(store.get(LISTINGS, 'l1')!.status).toBe('pending_verification');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyLandListingAction and rejectLandListingAction', () => {
    const verify = async (id: string) =>
        (await (await actions()).verifyLandListingAction(id, ADMIN)) as any;
    const reject = async (id: string, reason = 'No survey plan') =>
        (await (await actions()).rejectLandListingAction(id, ADMIN, reason)) as any;

    beforeEach(() => {
        actAs(ADMIN, ['super_admin']);
        seedListing('l1', { status: 'pending_verification' });
    });

    it('both refuse a caller with no session', async () => {
        actAs(null);
        expect(await verify('l1')).toMatchObject({ success: false });
        expect(await reject('l1')).toMatchObject({ success: false });
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('both refuse a role without land:verify_listings', async () => {
        actAs('mod-1', ['moderator']);
        expect(((await verify('l1')) as any).error).toContain('Admin access required');
        expect(((await reject('l1')) as any).error).toContain('Admin access required');
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('both say so when the listing does not exist', async () => {
        expect(await verify('nope')).toMatchObject({ success: false, error: 'Listing not found' });
        expect(await reject('nope')).toMatchObject({ success: false, error: 'Listing not found' });
    });

    it('verify CLAIMS the transition rather than writing blind', async () => {
        // The third blind verify path in this module. It was an existence check
        // and an unconditional write, so applied to a listing in pending_escrow
        // it put land back on the public market while a buyer's money was held.
        await verify('l1');

        const args = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(args).toMatchObject({
            collection: LISTINGS, id: 'l1', to: 'verified',
            recordPreviousAs: 'statusBeforeVerification',
        });
        expect(args.fromAny).toEqual(expect.arrayContaining(['pending_verification', 'rejected']));
        expect(args.fromAny).not.toContain('pending_escrow');
    });

    it('verify writes verificationStatus as a STRING, and clears the old rejection', async () => {
        // The object shape was unqueryable — the pending queue asks the database
        // for `verificationStatus == "pending"` — and spreading the previous
        // value forward broke outright when it was the string create-listing
        // writes. The prior reason goes to the audit log, not the record.
        await verify('l1');

        const { patch } = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(patch).toMatchObject({
            verificationStatus: 'approved', verified: true, verifiedBy: ADMIN, rejectionReason: null,
        });
        expect(typeof patch.verificationStatus).toBe('string');
    });

    it('reject claims from its OWN set, and records the reason', async () => {
        await reject('l1', 'Survey plan is illegible');

        const args = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(args).toMatchObject({ to: 'rejected', recordPreviousAs: 'statusBeforeRejection' });
        expect(args.patch).toMatchObject({
            verificationStatus: 'rejected', verified: false,
            rejectionReason: 'Survey plan is illegible',
        });
    });

    it('both report the current status when the claim is refused', async () => {
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'pending_escrow', exists: true }));

        expect(((await verify('l1')) as any).error).toContain("'pending_escrow'");
        expect(((await verify('l1')) as any).error).toContain('purchase in progress');
        expect(((await reject('l1')) as any).error).toContain("'pending_escrow'");
    });

    it('and distinguish a missing status from a missing document', async () => {
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: true }));
        expect(((await verify('l1')) as any).error).toContain('no status recorded');

        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: false }));
        expect(((await verify('l1')) as any).error).toBe('Listing not found');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('searchLandListingsAction', () => {
    const search = async (filters: any = {}) =>
        (await (await actions()).searchLandListingsAction(filters)) as any;

    it('shows EVERY for-sale spelling, not only "verified"', async () => {
        // It filtered on "verified" alone — a fourth vocabulary for the same
        // idea — so listings farm-nation creates as "available", and any an
        // admin marked "approved", never appeared at all. Invisible inventory.
        store.seedAll(LISTINGS, {
            a: { title: 'Verified', status: 'verified', createdAt: '2026-01-05T00:00:00.000Z' },
            b: { title: 'Available', status: 'available', createdAt: '2026-01-04T00:00:00.000Z' },
            c: { title: 'Approved', status: 'approved', createdAt: '2026-01-03T00:00:00.000Z' },
            d: { title: 'Pending', status: 'pending_verification', createdAt: '2026-01-02T00:00:00.000Z' },
            e: { title: 'Rejected', status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' },
            f: { title: 'Mid-purchase', status: 'pending_escrow', createdAt: '2025-12-31T00:00:00.000Z' },
        });

        expect(titles(await search()).sort()).toEqual(['Approved', 'Available', 'Verified']);
    });

    it('orders newest first', async () => {
        store.seedAll(LISTINGS, {
            a: { title: 'Older', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z' },
            b: { title: 'Newer', status: 'verified', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        expect(titles(await search())).toEqual(['Newer', 'Older']);
    });

    it('filters by state in the query', async () => {
        seedListing('jos', { title: 'Jos', location: { state: 'Plateau', lga: 'Jos North', address: 'x' } });
        seedListing('lagos', {
            title: 'Lagos', location: { state: 'Lagos', lga: 'Ikeja', address: 'y' },
            createdAt: '2026-02-01T00:00:00.000Z',
        });

        expect(titles(await search({ state: 'Lagos' }))).toEqual(['Lagos']);
    });

    it('filters by price and size range', async () => {
        seedListing('small', { title: 'Small', size: 1, price: 1_000_000 });
        seedListing('mid', { title: 'Mid', size: 5, price: 5_000_000, createdAt: '2026-02-01T00:00:00.000Z' });
        seedListing('big', { title: 'Big', size: 50, price: 50_000_000, createdAt: '2026-03-01T00:00:00.000Z' });

        expect(titles(await search({ minPrice: 2_000_000, maxPrice: 10_000_000 }))).toEqual(['Mid']);
        expect(titles(await search({ minSize: 40 }))).toEqual(['Big']);
        expect(titles(await search({ maxSize: 2 }))).toEqual(['Small']);
    });

    it('filters by soil, water source and type', async () => {
        seedListing('a', { title: 'Loamy', soilType: 'loamy', waterSource: 'borehole', type: 'sale' });
        seedListing('b', {
            title: 'Sandy', soilType: 'sandy', waterSource: 'river', type: 'lease',
            createdAt: '2026-02-01T00:00:00.000Z',
        });

        expect(titles(await search({ soilType: 'sandy' }))).toEqual(['Sandy']);
        expect(titles(await search({ waterSource: 'borehole' }))).toEqual(['Loamy']);
        expect(titles(await search({ type: 'lease' }))).toEqual(['Sandy']);
    });

    it('matches a category held as a string, a comma list or an array', async () => {
        seedListing('a', { title: 'String', category: 'farmland' });
        seedListing('b', { title: 'List', category: 'grazing, farmland', createdAt: '2026-02-01T00:00:00.000Z' });
        seedListing('c', { title: 'Array', category: ['orchard', 'farmland'], createdAt: '2026-03-01T00:00:00.000Z' });
        seedListing('d', { title: 'Other', category: 'residential', createdAt: '2026-04-01T00:00:00.000Z' });

        expect(titles(await search({ category: 'farmland' })).sort())
            .toEqual(['Array', 'List', 'String']);
    });

    it('matches a CROP to the soils that suit it', async () => {
        seedListing('a', { title: 'Clayey', soilType: 'clayey' });
        seedListing('b', { title: 'Loamy', soilType: 'loamy', createdAt: '2026-02-01T00:00:00.000Z' });
        seedListing('c', { title: 'Sandy', soilType: 'sandy', createdAt: '2026-03-01T00:00:00.000Z' });

        // rice suits clayey and loamy; groundnut suits sandy and loamy.
        expect(titles(await search({ cropType: 'rice' })).sort()).toEqual(['Clayey', 'Loamy']);
        expect(titles(await search({ cropType: 'groundnut' })).sort()).toEqual(['Loamy', 'Sandy']);
    });

    it('falls back to a text match for a crop the matrix does not know', async () => {
        seedListing('a', { title: 'Cocoa estate', soilType: 'clayey' });
        seedListing('b', { title: 'Rice paddy', soilType: 'clayey', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(titles(await search({ cropType: 'cocoa' }))).toEqual(['Cocoa estate']);
    });

    it('reports a cursor only when the page is full, and continues from it', async () => {
        store.seedAll(LISTINGS, {
            a: { title: 'A', status: 'verified', createdAt: '2026-01-03T00:00:00.000Z' },
            b: { title: 'B', status: 'verified', createdAt: '2026-01-02T00:00:00.000Z' },
            c: { title: 'C', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const page1 = await search({ limit: 2 });
        expect(titles(page1)).toEqual(['A', 'B']);
        expect(page1.data.lastDocId).toBe('b');

        const page2 = await search({ limit: 2, lastDocId: 'b' });
        expect(titles(page2)).toEqual(['C']);
        expect(page2.data.lastDocId).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getPendingLandListingsAction and deleteLandListingAction', () => {
    it('the pending queue refuses a non-admin', async () => {
        expect(await (await actions()).getPendingLandListingsAction())
            .toMatchObject({ success: false, error: 'Unauthorized: Admin access required' });
    });

    it('and lists exactly the listings awaiting verification', async () => {
        actAs(ADMIN, ['super_admin']);
        seedListing('pending', { status: 'pending_verification' });
        seedListing('live', { status: 'verified' });
        seedListing('rejected', { status: 'rejected' });

        const res = (await (await actions()).getPendingLandListingsAction()) as any;
        expect((res.data as any[]).map((l) => l.id)).toEqual(['pending']);
    });

    it('delete refuses a role without land:verify_listings', async () => {
        actAs('mod-1', ['moderator']);
        seedListing('l1');

        expect(((await (await actions()).deleteLandListingAction('l1', ADMIN)) as any).error)
            .toContain('Admin access required');
        expect(store.get(LISTINGS, 'l1')).toBeDefined();
    });

    it('delete says so when the listing does not exist', async () => {
        actAs(ADMIN, ['super_admin']);
        expect(await (await actions()).deleteLandListingAction('nope', ADMIN))
            .toMatchObject({ success: false, error: 'Listing not found' });
    });

    /**
     * This test used to read "delete is PERMANENT — the row is gone, not
     * soft-flagged", and asserted store.size(LISTINGS) === 0.
     *
     * That was a faithful description of what the code did, and the code was
     * wrong. #301: land-listing-status.ts declares "deleted" in the vocabulary
     * and its own header says "delete sets `deleted`", while the action called
     * .delete() — and farm-nation settlement reads LAND_LISTINGS.doc(propertyId)
     * while settling a transaction, so destroying the row leaves that read
     * dangling. The owner's decision is that nothing is deleted.
     *
     * The assertion is inverted rather than removed, because "the row survives"
     * needs pinning at least as firmly as "the row is gone" did.
     */
    it('delete RETIRES the listing — the row survives, invisible to buyers', async () => {
        actAs(ADMIN, ['super_admin']);
        seedListing('l1');

        expect(await (await actions()).deleteLandListingAction('l1', ADMIN))
            .toMatchObject({ success: true });

        const row = store.get(LISTINGS, 'l1');
        expect(row).toBeDefined();
        expect(row?.status).toBe('deleted');
        expect(row?.retired).toBe(true);
        expect(row?.retiredBy).toBe(ADMIN);
        // "deleted" is in neither PURCHASABLE_STATUSES nor BROWSABLE_STATUSES,
        // so no buyer-facing screen shows it.
        expect(store.size(LISTINGS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitLandListingAction', () => {
    const submit = async (data?: any) =>
        (await (await actions()).submitLandListingAction(data ?? {
            ...listingInput(), imageUrls: ['https://cdn/1.jpg'], documentUrls: ['https://cdn/deed.pdf'],
        })) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await submit()).toMatchObject({ success: false });
        expect(store.size(LISTINGS)).toBe(0);
    });

    it('takes the owner from the SESSION, not the request', async () => {
        actAs('real-caller', ['user'], 'Ngozi Eze');

        await submit({
            ...listingInput({ ownerId: 'somebody-else', ownerName: 'Fake', ownerEmail: 'fake@x.com' }),
            imageUrls: [], documentUrls: [],
        });

        expect(onlyListing()).toMatchObject({
            ownerId: 'real-caller', ownerName: 'Ngozi Eze', ownerEmail: 'real-caller@example.com',
        });
    });

    it('lands at pending_verification with the uploaded URLs', async () => {
        await submit();

        expect(onlyListing()).toMatchObject({
            status: 'pending_verification',
            images: ['https://cdn/1.jpg'],
            documents: ['https://cdn/deed.pdf'],
        });
    });

    it('defaults the availability flags and the escrow offer', async () => {
        await submit();

        expect(onlyListing()).toMatchObject({
            availableForSale: true, availableForRent: false, availableForLease: false,
            escrowAvailable: true, type: 'sale',
        });
    });

    it('infers "lease" when it is for rent and not for sale', async () => {
        await submit({
            ...listingInput(), imageUrls: [], documentUrls: [],
            availableForSale: false, availableForRent: true,
        });

        expect(onlyListing().type).toBe('lease');
    });

    it('notifies the SUBMITTER, not the nominated owner', async () => {
        // The listing was fixed to take its owner from the session and the audit
        // row and this notification were left reading the request — one copy of
        // a path fixed and its siblings missed, inside a single function.
        actAs('real-caller', ['user']);

        await submit({
            ...listingInput({ ownerId: 'somebody-else' }), imageUrls: [], documentUrls: [],
        });

        expect(createNotificationAction).toHaveBeenCalledTimes(1);
        expect((createNotificationAction.mock.calls[0] as any[])[0])
            .toMatchObject({ userId: 'real-caller' });
    });

    it('carries the GPS coordinates through when given, and omits them otherwise', async () => {
        await submit({
            ...listingInput(), imageUrls: [], documentUrls: [],
            gpsCoordinates: { latitude: 9.9, longitude: 8.9 },
        });
        expect(onlyListing().gpsCoordinates).toEqual({ latitude: 9.9, longitude: 8.9 });

        store.clear();
        await submit({ ...listingInput(), imageUrls: [], documentUrls: [] });
        expect('gpsCoordinates' in onlyListing()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getPropertyByIdAction', () => {
    it('is public, and returns the listing whatever its status', async () => {
        actAs(null);
        seedListing('l1', { status: 'rejected' });

        const res = (await (await actions()).getPropertyByIdAction('l1')) as any;
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ id: 'l1', title: 'Five hectares in Jos' });
    });

    it('reports null rather than an error for one that does not exist', async () => {
        expect(await (await actions()).getPropertyByIdAction('nope'))
            .toEqual({ success: true, error: null, data: null });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitLandInquiryAction', () => {
    const inquire = async (overrides: Record<string, unknown> = {}) =>
        (await (await actions()).submitLandInquiryAction({
            listingId: 'l1',
            listingTitle: 'Five hectares in Jos',
            listingOwnerId: OWNER,
            buyerName: 'Chidi Okafor',
            buyerEmail: 'chidi@example.com',
            buyerPhone: '08099998888',
            message: 'Is this still available?',
            ...overrides,
        } as any)) as any;

    it('is PUBLIC — an enquirer should not need an account', async () => {
        actAs(null);
        seedListing('l1');

        expect(await inquire()).toMatchObject({ success: true });
        expect(store.size(INQUIRIES)).toBe(1);
    });

    it('requires the listing to exist, which it never did before', async () => {
        expect(await inquire()).toMatchObject({ success: false, error: 'Listing not found' });
        expect(store.size(INQUIRIES)).toBe(0);
        expect(createNotificationAction).not.toHaveBeenCalled();
    });

    it('refuses a listing with no owner to contact', async () => {
        seedListing('l1', { ownerId: undefined });

        expect(await inquire()).toMatchObject({
            success: false, error: 'This listing has no owner to contact',
        });
        expect(createNotificationAction).not.toHaveBeenCalled();
    });

    it('notifies the LISTING\'s owner with the LISTING\'s title', async () => {
        // Both came from the caller and went straight into
        // createNotificationAction — an open endpoint for sending any user a
        // message with an attacker-chosen title and body, wearing the
        // platform's branding.
        seedListing('l1', { ownerId: 'real-owner', title: 'Five hectares in Jos' });

        await inquire({ listingOwnerId: 'victim', listingTitle: 'Your account is suspended' });

        const payload = (createNotificationAction.mock.calls[0] as any[])[0];
        expect(payload.userId).toBe('real-owner');
        expect(payload.message).toContain('Five hectares in Jos');
        expect(payload.message).not.toContain('suspended');
    });

    it('and records the LISTING\'s values on the inquiry, after the spread', async () => {
        seedListing('l1', { ownerId: 'real-owner', title: 'Five hectares in Jos' });

        await inquire({ listingOwnerId: 'victim', listingTitle: 'Spoofed' });

        const [, inquiry] = store.all(INQUIRIES)[0] as [string, Record<string, any>];
        expect(inquiry.listingOwnerId).toBe('real-owner');
        expect(inquiry.listingTitle).toBe('Five hectares in Jos');
        expect(inquiry.status).toBe('pending');
        expect(inquiry.read).toBe(false);
        // The buyer's own details ARE the caller's to supply.
        expect(inquiry).toMatchObject({ buyerName: 'Chidi Okafor', buyerPhone: '08099998888' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the inquiry inbox', () => {
    const list = async (userId: string) =>
        (await (await actions()).getLandInquiriesAction(userId)) as any;
    const one = async (id: string) =>
        (await (await actions()).getLandInquiryByIdAction(id)) as any;

    function seedInquiry(id: string, ownerId = OWNER): void {
        store.seed(INQUIRIES, id, {
            listingId: 'l1',
            listingOwnerId: ownerId,
            listingTitle: 'Five hectares in Jos',
            buyerName: 'Chidi Okafor',
            buyerEmail: 'chidi@example.com',
            buyerPhone: '08099998888',
            message: 'Is this still available?',
            createdAt: '2026-01-01T00:00:00.000Z',
        });
    }

    it('the list refuses a caller with no session', async () => {
        actAs(null);
        expect(await list(OWNER)).toMatchObject({ success: false });
    });

    it('the list refuses one user naming ANOTHER landowner', async () => {
        // The session was established and never consulted: the query ran on the
        // caller's own argument. Since the intake is public by design, each row
        // carries buyerName, buyerEmail, buyerPhone and the message — so this
        // turned an open intake form into a bulk export of the contact details
        // it collected, for any owner, to anyone with an account.
        actAs('nosy-1', ['user']);
        seedInquiry('i1', OWNER);

        const res = await list(OWNER);
        expect(res).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(JSON.stringify(res)).not.toContain('08099998888');
    });

    it('returns the owner\'s own inbox, newest first', async () => {
        seedInquiry('older', OWNER);
        store.seed(INQUIRIES, 'newer', {
            listingOwnerId: OWNER, buyerName: 'Ngozi', createdAt: '2026-06-01T00:00:00.000Z',
        });
        seedInquiry('theirs', 'other-owner');

        const res = await list(OWNER);
        expect((res.data as any[]).map((i) => i.id)).toEqual(['newer', 'older']);
    });

    it('and lets an admin read any owner\'s inbox', async () => {
        actAs(ADMIN, ['super_admin']);
        seedInquiry('i1', OWNER);

        expect(((await list(OWNER)) as any).data).toHaveLength(1);
    });

    it('the single read refuses a caller with no session', async () => {
        actAs(null);
        seedInquiry('i1');
        expect(await one('i1')).toMatchObject({ success: false });
    });

    it('the single read refuses somebody who is not the listing owner', async () => {
        // Neither the ownership scan's read rule nor its write rule catches
        // this shape: an id parameter, one document fetched by id, no `.where`
        // at all. The submission notification links to
        // /farm-nation/inquiries/<id>, so ids travel.
        actAs('nosy-1', ['user']);
        seedInquiry('i1', OWNER);

        const res = await one('i1');
        expect(res).toMatchObject({ success: false, error: 'Inquiry not found' });
        expect(JSON.stringify(res)).not.toContain('chidi@example.com');
    });

    it('and says "not found" rather than confirming the id exists', async () => {
        actAs('nosy-1', ['user']);
        seedInquiry('i1', OWNER);

        const refused = await one('i1');
        const absent = await one('does-not-exist');
        expect(refused.error).toBe(absent.error);
    });

    it('lets the listing owner read it', async () => {
        seedInquiry('i1', OWNER);

        const res = await one('i1');
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ id: 'i1', buyerEmail: 'chidi@example.com' });
    });

    it('and lets an admin read it', async () => {
        actAs(ADMIN, ['super_admin']);
        seedInquiry('i1', OWNER);

        expect(((await one('i1')) as any).success).toBe(true);
    });
});
