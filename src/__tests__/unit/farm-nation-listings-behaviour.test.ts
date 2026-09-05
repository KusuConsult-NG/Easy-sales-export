/**
 * @jest-environment node
 */

/**
 * Farm Nation property listings, EXECUTED — browse, view, list, edit, delete
 * and the document re-submission.
 *
 * At 11.2%, and four of this audit's findings live in this one file: the browse
 * query that showed buyers listings they could not buy, the view counter that
 * lost concurrent increments, the price that stayed editable after a buyer had
 * paid, and the document upload whose "reset verification status" wrote a value
 * nothing reads and left a rejected listing rejected forever.
 *
 * Each of those is a decision made from a stored document, so a call recorder
 * could assert the shape of the code and nothing about the answer.
 *
 * THE FILTERS RUN IN JAVASCRIPT, NOT IN THE QUERY
 * -----------------------------------------------
 * `getPropertiesAction` pages the collection FIRST (ordered, limited) and then
 * filters the page in memory. That ordering is load-bearing and easy to
 * misread: the page size bounds what is fetched, and every filter — including
 * the browsable-status one — narrows only within that page. So a buyer asking
 * for `limit: 20` can receive fewer than 20 results, and asking for a state can
 * return nothing while matching listings exist further down the collection.
 * Pinned below rather than changed, because fixing it is a query redesign and
 * the current behaviour is what the page is built against.
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

const claimStatusTransitionFromAny = jest.fn(async (_args: unknown) =>
    ({ claimed: true, status: 'rejected', exists: true } as {
        claimed: boolean; status: string | null; exists?: boolean;
    }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: unknown) => claimStatusTransitionFromAny(args),
    claimStatusTransition: (args: unknown) => claimStatusTransitionFromAny(args),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const TRANSACTIONS = COLLECTIONS.FARM_NATION_TRANSACTIONS;

function actAs(id: string | null, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    claimStatusTransitionFromAny.mockImplementation(async () =>
        ({ claimed: true, status: 'rejected', exists: true }));
    store = installFakeDb();
    actAs(OWNER);
});

async function actions() {
    return import('@/app/actions/farm-nation/_fn_listings');
}

function seedListing(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(LISTINGS, id, {
        name: 'Five hectares in Jos',
        description: 'Fertile farmland close to the road',
        location: 'Rayfield',
        state: 'Plateau',
        lga: 'Jos South',
        price: 5_000_000,
        size: 5,
        type: 'sale',
        category: 'farmland',
        features: ['road access'],
        ownerId: OWNER,
        status: 'available',
        verified: false,
        viewCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedCoopMember(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, OWNER, {
        email: 'ada@example.com',
        name: 'Ada Obi',
        phone: '08012345678',
        serviceRegistrations: { cooperatives: { status: 'active' } },
        ...extra,
    });
}

function listingInput(overrides: Record<string, unknown> = {}): any {
    return {
        name: 'Five hectares in Jos',
        description: 'Fertile farmland close to the road',
        location: 'Rayfield',
        state: 'Plateau',
        lga: 'Jos South',
        price: 5_000_000,
        size: 5,
        type: 'sale',
        category: 'farmland',
        features: ['road access'],
        ...overrides,
    };
}

const names = (res: any) => (res.data.properties as any[]).map((p) => p.name);

// ─────────────────────────────────────────────────────────────────────────────
describe('getPropertiesAction', () => {
    it('shows only listings a buyer could actually buy', async () => {
        // There was no status filter at all, so buyers were shown listings
        // awaiting verification, ones an admin had explicitly rejected, and
        // soft-deleted ones — and could start a purchase that then failed.
        store.seedAll(LISTINGS, {
            a: { name: 'Available', status: 'available', createdAt: '2026-01-05T00:00:00.000Z' },
            b: { name: 'Verified', status: 'verified', createdAt: '2026-01-04T00:00:00.000Z' },
            c: { name: 'Approved', status: 'approved', createdAt: '2026-01-03T00:00:00.000Z' },
            d: { name: 'Awaiting', status: 'pending_verification', createdAt: '2026-01-02T00:00:00.000Z' },
            e: { name: 'Rejected', status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' },
            f: { name: 'Deleted', status: 'deleted', createdAt: '2025-12-31T00:00:00.000Z' },
            g: { name: 'Mid-purchase', status: 'pending_escrow', createdAt: '2025-12-30T00:00:00.000Z' },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction()).sort())
            .toEqual(['Approved', 'Available', 'Verified']);
    });

    it('orders newest first', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'Older', status: 'available', createdAt: '2026-01-01T00:00:00.000Z' },
            b: { name: 'Newer', status: 'available', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction())).toEqual(['Newer', 'Older']);
    });

    it('searches name, location and state, case-insensitively', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'Rice farm', status: 'available', location: 'Rayfield', state: 'Plateau' },
            b: { name: 'Maize plot', status: 'available', location: 'Ikeja', state: 'Lagos' },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ search: 'RICE' }))).toEqual(['Rice farm']);
        expect(names(await getPropertiesAction({ search: 'ikeja' }))).toEqual(['Maize plot']);
        expect(names(await getPropertiesAction({ search: 'plateau' }))).toEqual(['Rice farm']);
    });

    it('filters by state, and "all" means no filter', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'Jos', status: 'available', state: 'Plateau' },
            b: { name: 'Lagos', status: 'available', state: 'Lagos' },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ state: 'Lagos' }))).toEqual(['Lagos']);
        expect(names(await getPropertiesAction({ state: 'all' })).sort()).toEqual(['Jos', 'Lagos']);
    });

    it('matches a category held as a string, a comma list, or an array', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'String', status: 'available', category: 'farmland' },
            b: { name: 'List', status: 'available', category: 'grazing, farmland' },
            c: { name: 'Array', status: 'available', category: ['orchard', 'farmland'] },
            d: { name: 'Other', status: 'available', category: 'residential' },
            e: { name: 'None', status: 'available', category: undefined },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ category: 'farmland' })).sort())
            .toEqual(['Array', 'List', 'String']);
    });

    it('filters by type', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'For sale', status: 'available', type: 'sale' },
            b: { name: 'To rent', status: 'available', type: 'rent' },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ type: 'rent' }))).toEqual(['To rent']);
    });

    it('filters by price and size range', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'Cheap small', status: 'available', price: 1_000_000, size: 1 },
            b: { name: 'Mid', status: 'available', price: 5_000_000, size: 5 },
            c: { name: 'Dear big', status: 'available', price: 50_000_000, size: 50 },
        });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ minPrice: 2_000_000, maxPrice: 10_000_000 })))
            .toEqual(['Mid']);
        expect(names(await getPropertiesAction({ minSize: 40 }))).toEqual(['Dear big']);
        expect(names(await getPropertiesAction({ maxSize: 2 }))).toEqual(['Cheap small']);
    });

    it('reports a cursor and whether more may follow', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'A', status: 'available', createdAt: '2026-01-03T00:00:00.000Z' },
            b: { name: 'B', status: 'available', createdAt: '2026-01-02T00:00:00.000Z' },
            c: { name: 'C', status: 'available', createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const { getPropertiesAction } = await actions();
        const page: any = await getPropertiesAction({ limit: 2 });

        expect(names(page)).toEqual(['A', 'B']);
        expect(page.meta).toEqual({ cursor: 'b', hasMore: true });
    });

    it('continues from a cursor', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'A', status: 'available', createdAt: '2026-01-03T00:00:00.000Z' },
            b: { name: 'B', status: 'available', createdAt: '2026-01-02T00:00:00.000Z' },
            c: { name: 'C', status: 'available', createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const { getPropertiesAction } = await actions();
        const page: any = await getPropertiesAction({ limit: 2, lastDocId: 'b' });

        expect(names(page)).toEqual(['C']);
        expect(page.meta.hasMore).toBe(false);
    });

    it('ignores a cursor pointing at nothing rather than failing', async () => {
        store.seedAll(LISTINGS, { a: { name: 'A', status: 'available' } });

        const { getPropertiesAction } = await actions();
        expect(names(await getPropertiesAction({ lastDocId: 'gone' }))).toEqual(['A']);
    });

    it('PAGES FIRST AND FILTERS AFTER, so a page can come back short', async () => {
        // Pinned as behaviour, not endorsed. The status and attribute filters
        // run in JavaScript over the page the query returned, so `limit` bounds
        // what is FETCHED and not what is returned — and a buyer filtering by
        // state can get nothing while matching listings sit further down.
        store.seedAll(LISTINGS, {
            a: { name: 'Rejected', status: 'rejected', state: 'Lagos', createdAt: '2026-01-03T00:00:00.000Z' },
            b: { name: 'Rejected too', status: 'rejected', state: 'Lagos', createdAt: '2026-01-02T00:00:00.000Z' },
            c: { name: 'Buyable', status: 'available', state: 'Lagos', createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const { getPropertiesAction } = await actions();
        const page: any = await getPropertiesAction({ limit: 2, state: 'Lagos' });

        expect(names(page)).toEqual([]);
        // ...and hasMore is true, so the caller can page on and find it.
        expect(page.meta.hasMore).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getPropertyByIdAction', () => {
    it('says so when the property does not exist', async () => {
        const { getPropertyByIdAction } = await actions();
        expect(await getPropertyByIdAction('nope'))
            .toMatchObject({ success: false, error: 'Property not found' });
    });

    it('returns the property, whatever its status — this is not the browse list', async () => {
        seedListing('p1', { status: 'rejected' });
        const { getPropertyByIdAction } = await actions();
        expect(((await getPropertyByIdAction('p1')) as any).data.property)
            .toMatchObject({ id: 'p1', name: 'Five hectares in Jos' });
    });

    it('counts the view ATOMICALLY, so concurrent views are not lost', async () => {
        // It read the value and wrote back `(data.viewCount || 0) + 1`, so two
        // views landing together both read the same number and one was lost.
        // The endpoint is public, so that is the normal case.
        seedListing('p1', { viewCount: 7 });

        const { getPropertyByIdAction } = await actions();
        await Promise.all([
            getPropertyByIdAction('p1'),
            getPropertyByIdAction('p1'),
            getPropertyByIdAction('p1'),
        ]);

        expect(store.get(LISTINGS, 'p1')!.viewCount).toBe(10);
    });

    it('starts the counter from a listing that has none', async () => {
        seedListing('p1', { viewCount: undefined });
        const { getPropertyByIdAction } = await actions();
        await getPropertyByIdAction('p1');

        expect(store.get(LISTINGS, 'p1')!.viewCount).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('listPropertyAction', () => {
    /**
     *   #432 — THIS ACTION IS RETIRED, AND THESE CASES REVIVE IT DELIBERATELY.
     *
     *   It wrote `status: "available"` — which isPurchasable() returns true for
     *   and the Farm Nation card labels "Verified Land" — beside
     *   `verified: false`, with `documents: {}` and `images: []`. It takes no
     *   files, so a listing created through it could never carry the title deed
     *   the product requires, and `available` is not the status the review queue
     *   reads, so no admin would ever have corrected it.
     *
     *   No screen calls it; it is reachable as a "use server" export regardless.
     *   Retired behind LEGACY_FARM_NATION_LISTING, with the status corrected to
     *   `pending_verification` so reviving it cannot put unverified land on sale.
     *
     *   The flag is set here rather than the cases deleted, for the reason #426
     *   established: the preserved implementation stays covered, and these
     *   assertions are what prove it still works when revived.
     */
    const PRIOR_FLAG = process.env.LEGACY_FARM_NATION_LISTING;
    beforeAll(() => { process.env.LEGACY_FARM_NATION_LISTING = 'enabled'; });
    afterAll(() => {
        if (PRIOR_FLAG === undefined) delete process.env.LEGACY_FARM_NATION_LISTING;
        else process.env.LEGACY_FARM_NATION_LISTING = PRIOR_FLAG;
    });

    it('REFUSES BY DEFAULT — the retirement, checked from the other side', async () => {
        // Without the flag it must not write at all, whatever else is true.
        delete process.env.LEGACY_FARM_NATION_LISTING;
        const { listPropertyAction } = await actions();
        const result: any = await listPropertyAction(listingInput());
        process.env.LEGACY_FARM_NATION_LISTING = 'enabled';

        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/retired/i);
        expect(store.all(COLLECTIONS.LAND_LISTINGS).length).toBe(0);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { listPropertyAction } = await actions();
        expect(await listPropertyAction(listingInput())).toMatchObject({ success: false });
        expect(store.size(LISTINGS)).toBe(0);
    });

    it('refuses a user record that does not exist', async () => {
        const { listPropertyAction } = await actions();
        expect(await listPropertyAction(listingInput()))
            .toMatchObject({ success: false, error: 'User not found' });
    });

    it('requires cooperative membership', async () => {
        store.seed(COLLECTIONS.USERS, OWNER, { email: 'ada@example.com' });
        const { listPropertyAction } = await actions();
        expect(((await listPropertyAction(listingInput())) as any).error)
            .toContain('Cooperative membership required');
        expect(store.size(LISTINGS)).toBe(0);
    });

    it('refuses a membership that is only pending', async () => {
        seedCoopMember({ serviceRegistrations: { cooperatives: { status: 'pending' } } });
        const { listPropertyAction } = await actions();
        expect(((await listPropertyAction(listingInput())) as any).success).toBe(false);
    });

    it.each(['active', 'approved'])('accepts a %s membership', async (status) => {
        seedCoopMember({ serviceRegistrations: { cooperatives: { status } } });
        const { listPropertyAction } = await actions();
        expect(await listPropertyAction(listingInput())).toMatchObject({ success: true });
    });

    it('reads the singular key spelling too', async () => {
        seedCoopMember({ serviceRegistrations: { cooperative: { status: 'active' } } });
        const { listPropertyAction } = await actions();
        expect(await listPropertyAction(listingInput())).toMatchObject({ success: true });
    });

    it('refuses a listing that fails the schema', async () => {
        seedCoopMember();
        const { listPropertyAction } = await actions();
        expect(((await listPropertyAction(listingInput({ price: -1 }))) as any).error)
            .toContain('Price must be positive');
        expect(store.size(LISTINGS)).toBe(0);
    });

    it('refuses a state that is not Nigerian', async () => {
        seedCoopMember();
        const { listPropertyAction } = await actions();
        expect(((await listPropertyAction(listingInput({ state: 'Atlantis' }))) as any).error)
            .toContain('Invalid State');
    });

    it('refuses an LGA that is not in that state', async () => {
        seedCoopMember();
        const { listPropertyAction } = await actions();
        expect(((await listPropertyAction(listingInput({ lga: 'Ikeja' }))) as any).error)
            .toContain('Invalid LGA');
    });

    it('creates the listing unverified, owned by the caller', async () => {
        /**
         *   #432 CORRECTION: "unverified" AND `status: 'available'` WERE NOT
         *   THE SAME THING, AND THIS PINNED BOTH.
         *
         *   The test name says unverified and the assertion said `available`.
         *   isPurchasable('available') is TRUE and the Farm Nation card renders
         *   "Verified Land" for any purchasable status — so the row said
         *   verified:false while the product treated it as on sale and
         *   verified. And `available` is not the status the review queue reads,
         *   so no admin would ever have resolved the contradiction.
         *
         *   The name was right and the value was wrong. `pending_verification`
         *   is what the live form path writes and what the queue reads.
         */
        seedCoopMember();
        const { listPropertyAction } = await actions();
        expect(await listPropertyAction(listingInput())).toMatchObject({ success: true });

        const [, listing] = store.all(LISTINGS)[0] as [string, Record<string, any>];
        expect(listing).toMatchObject({
            ownerId: OWNER,
            ownerName: 'Ada Obi',
            ownerEmail: 'ada@example.com',
            ownerPhone: '08012345678',
            status: 'pending_verification',
            verified: false,
            viewCount: 0,
            favoriteCount: 0,
        });
        expect(listing.images).toEqual([]);
    });

    it('and the status it writes is NOT one a buyer can purchase', async () => {
        // The assertion the case above was missing: "unverified" has to mean
        // something the product acts on, not just a flag beside a purchasable
        // status.
        const { isPurchasable } = await import('@/lib/land-listing-status');
        seedCoopMember();
        const { listPropertyAction } = await actions();
        await listPropertyAction(listingInput());

        const [, listing] = store.all(LISTINGS)[0] as [string, Record<string, any>];
        expect(isPurchasable(listing.status)).toBe(false);
    });

    it('does not let the caller choose the owner, the status or the verified flag', async () => {
        seedCoopMember();
        const { listPropertyAction } = await actions();
        await listPropertyAction(listingInput({
            ownerId: 'someone-else', status: 'verified', verified: true, viewCount: 9999,
        }));

        const [, listing] = store.all(LISTINGS)[0] as [string, Record<string, any>];
        expect(listing).toMatchObject({
            ownerId: OWNER, status: 'pending_verification', verified: false, viewCount: 0,
        });
    });

    it('normalises the state and LGA', async () => {
        seedCoopMember();
        const { listPropertyAction } = await actions();
        await listPropertyAction(listingInput({ state: 'plateau', lga: 'jos south' }));

        const [, listing] = store.all(LISTINGS)[0] as [string, Record<string, any>];
        expect(listing.state).toBe('Plateau');
        expect(listing.lga).toBe('Jos South');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyPropertiesAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getMyPropertiesAction } = await actions();
        expect(await getMyPropertiesAction()).toMatchObject({ success: false });
    });

    it('returns only the caller\'s listings, newest first, at any status', async () => {
        store.seedAll(LISTINGS, {
            a: { name: 'Mine old', ownerId: OWNER, status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' },
            b: { name: 'Mine new', ownerId: OWNER, status: 'available', createdAt: '2026-06-01T00:00:00.000Z' },
            c: { name: 'Theirs', ownerId: 'other', status: 'available', createdAt: '2026-07-01T00:00:00.000Z' },
        });

        const { getMyPropertiesAction } = await actions();
        expect(names(await getMyPropertiesAction())).toEqual(['Mine new', 'Mine old']);
    });

    it('is an empty list, not an error, for an owner with nothing', async () => {
        const { getMyPropertiesAction } = await actions();
        expect(((await getMyPropertiesAction()) as any).data.properties).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deletePropertyAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { deletePropertyAction } = await actions();
        expect(await deletePropertyAction('p1')).toMatchObject({ success: false });
    });

    it('says so when the property does not exist', async () => {
        const { deletePropertyAction } = await actions();
        expect(await deletePropertyAction('nope'))
            .toMatchObject({ success: false, error: 'Property not found' });
    });

    it('refuses somebody else\'s listing', async () => {
        seedListing('p1', { ownerId: 'other-owner' });
        const { deletePropertyAction } = await actions();
        expect(await deletePropertyAction('p1'))
            .toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(LISTINGS, 'p1')!.status).toBe('available');
    });

    it.each(['pending_payment', 'payment_confirmed'])(
        'refuses while a purchase is %s', async (status) => {
            seedListing('p1');
            store.seed(TRANSACTIONS, 't1', { propertyId: 'p1', status });

            const { deletePropertyAction } = await actions();
            expect(((await deletePropertyAction('p1')) as any).error)
                .toBe('Cannot delete property with active purchase requests');
            expect(store.get(LISTINGS, 'p1')!.status).toBe('available');
        });

    it('allows it when the only purchase attempt was cancelled', async () => {
        seedListing('p1');
        store.seed(TRANSACTIONS, 't1', { propertyId: 'p1', status: 'cancelled' });

        const { deletePropertyAction } = await actions();
        expect(await deletePropertyAction('p1')).toMatchObject({ success: true });
    });

    it('ignores a live purchase against a DIFFERENT property', async () => {
        seedListing('p1');
        store.seed(TRANSACTIONS, 't1', { propertyId: 'p2', status: 'pending_payment' });

        const { deletePropertyAction } = await actions();
        expect(await deletePropertyAction('p1')).toMatchObject({ success: true });
    });

    it('deletes SOFTLY, keeping the row', async () => {
        seedListing('p1');
        const { deletePropertyAction } = await actions();
        await deletePropertyAction('p1');

        const listing = store.get(LISTINGS, 'p1')!;
        expect(listing.status).toBe('deleted');
        expect(typeof listing.deletedAt).toBe('string');
        expect(store.size(LISTINGS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePropertyAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('p1', { name: 'New name' }))
            .toMatchObject({ success: false });
    });

    it('says so when the property does not exist', async () => {
        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('nope', { name: 'New name' }))
            .toMatchObject({ success: false, error: 'Property not found' });
    });

    it('refuses somebody else\'s listing', async () => {
        seedListing('p1', { ownerId: 'other-owner' });
        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('p1', { name: 'Hijacked' }))
            .toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(LISTINGS, 'p1')!.name).toBe('Five hectares in Jos');
    });

    it('edits the descriptive fields', async () => {
        seedListing('p1');
        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('p1', {
            name: 'Six hectares in Jos', description: 'Now with a borehole', location: 'Lamingo',
        })).toMatchObject({ success: true });

        expect(store.get(LISTINGS, 'p1')).toMatchObject({
            name: 'Six hectares in Jos', description: 'Now with a borehole', location: 'Lamingo',
        });
    });

    it('refuses an invalid state, and an LGA outside the state', async () => {
        seedListing('p1');
        const { updatePropertyAction } = await actions();

        expect(((await updatePropertyAction('p1', { state: 'Atlantis' })) as any).error)
            .toContain('Invalid State');
        expect(((await updatePropertyAction('p1', { lga: 'Ikeja' })) as any).error)
            .toContain('Invalid LGA');
        expect(store.get(LISTINGS, 'p1')!.state).toBe('Plateau');
    });

    it('re-validates the LGA against the NEW state when both change', async () => {
        seedListing('p1');
        const { updatePropertyAction } = await actions();

        expect(await updatePropertyAction('p1', { state: 'Lagos', lga: 'Ikeja' }))
            .toMatchObject({ success: true });
        expect(store.get(LISTINGS, 'p1')).toMatchObject({ state: 'Lagos', lga: 'Ikeja' });
    });

    it.each([
        'pending_escrow', 'pending_payment', 'payment_confirmed',
        'pending_transfer', 'sold', 'completed',
    ])('FREEZES the price once the listing is %s', async (status) => {
        // verifyPropertyPaymentAction compares what the buyer paid against the
        // LIVE listing price, so repricing between a buyer's initialisation and
        // their return from Paystack takes their money and refuses them.
        seedListing('p1', { status });

        const { updatePropertyAction } = await actions();
        const res: any = await updatePropertyAction('p1', { price: 50_000_000 });

        expect(res.success).toBe(false);
        expect(res.error).toContain('purchase in progress');
        expect(store.get(LISTINGS, 'p1')!.price).toBe(5_000_000);
    });

    it.each(['size', 'type', 'category', 'leaseDuration'])(
        'freezes %s the same way', async (field) => {
            seedListing('p1', { status: 'pending_escrow' });
            const value = field === 'size' ? 99 : field === 'leaseDuration' ? 10 : 'rent';

            const { updatePropertyAction } = await actions();
            expect(((await updatePropertyAction('p1', { [field]: value } as any)) as any).success)
                .toBe(false);
        });

    it('but leaves the DESCRIPTIVE fields editable mid-sale', async () => {
        // Correcting a typo mid-sale harms nobody; it is the terms the buyer was
        // quoted on that must not move under them.
        seedListing('p1', { status: 'pending_escrow' });

        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('p1', {
            name: 'Five hectares in Jos South', description: 'Corrected', location: 'Rayfield Road',
        })).toMatchObject({ success: true });

        expect(store.get(LISTINGS, 'p1')!.name).toBe('Five hectares in Jos South');
    });

    it('and the price IS editable while the listing is still on the market', async () => {
        // The control: the freeze is about a purchase in progress, not about
        // prices being immutable.
        seedListing('p1', { status: 'available' });

        const { updatePropertyAction } = await actions();
        expect(await updatePropertyAction('p1', { price: 6_000_000 }))
            .toMatchObject({ success: true });
        expect(store.get(LISTINGS, 'p1')!.price).toBe(6_000_000);
    });

    it('accepts a price of zero as a change, rather than treating it as absent', async () => {
        seedListing('p1', { status: 'available' });
        const { updatePropertyAction } = await actions();
        await updatePropertyAction('p1', { price: 0, size: 0 });

        expect(store.get(LISTINGS, 'p1')).toMatchObject({ price: 0, size: 0 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('uploadPropertyDocumentsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { uploadPropertyDocumentsAction } = await actions();
        expect(await uploadPropertyDocumentsAction('p1', { cOfO: 'u' }))
            .toMatchObject({ success: false });
    });

    it('says so when the property does not exist', async () => {
        const { uploadPropertyDocumentsAction } = await actions();
        expect(await uploadPropertyDocumentsAction('nope', { cOfO: 'u' }))
            .toMatchObject({ success: false, error: 'Property not found' });
    });

    it('refuses somebody else\'s listing', async () => {
        seedListing('p1', { ownerId: 'other-owner' });
        const { uploadPropertyDocumentsAction } = await actions();
        expect(await uploadPropertyDocumentsAction('p1', { cOfO: 'u' }))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('MERGES with the documents already attached', async () => {
        seedListing('p1', { documents: { surveyPlan: 'https://cdn/survey.pdf' } });

        const { uploadPropertyDocumentsAction } = await actions();
        await uploadPropertyDocumentsAction('p1', { cOfO: 'https://cdn/cofo.pdf' });

        expect(store.get(LISTINGS, 'p1')!.documents).toEqual({
            surveyPlan: 'https://cdn/survey.pdf',
            cOfO: 'https://cdn/cofo.pdf',
        });
    });

    it('re-enters the review queue when the listing was REJECTED', async () => {
        // It used to write `verificationStatus: "pending_review"` — a value
        // nothing reads — and never touch `status`, which is what the queues
        // select on. So an owner rejected for missing documents uploaded them
        // and the listing stayed rejected, permanently, one action from
        // approval and with no way to get there.
        seedListing('p1', { status: 'rejected', rejectionReason: 'No C of O' });

        const { uploadPropertyDocumentsAction } = await actions();
        expect(await uploadPropertyDocumentsAction('p1', { cOfO: 'https://cdn/cofo.pdf' }))
            .toMatchObject({ success: true });

        expect(claimStatusTransitionFromAny).toHaveBeenCalledTimes(1);
        const args = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(args).toMatchObject({
            collection: LISTINGS,
            id: 'p1',
            fromAny: ['rejected', 'draft'],
            to: 'pending_verification',
            recordPreviousAs: 'statusBeforeResubmission',
        });
        expect(args.patch).toMatchObject({
            verificationStatus: 'pending', verified: false, rejectionReason: null,
        });
    });

    it('and when it was a draft', async () => {
        seedListing('p1', { status: 'draft' });
        const { uploadPropertyDocumentsAction } = await actions();
        await uploadPropertyDocumentsAction('p1', { surveyPlan: 'https://cdn/s.pdf' });

        expect(claimStatusTransitionFromAny).toHaveBeenCalledTimes(1);
    });

    it.each(['available', 'verified', 'approved', 'pending_escrow', 'sold'])(
        'does NOT pull a %s listing off the market', async (status) => {
            seedListing('p1', { status });
            const { uploadPropertyDocumentsAction } = await actions();
            expect(await uploadPropertyDocumentsAction('p1', { cOfO: 'https://cdn/c.pdf' }))
                .toMatchObject({ success: true });

            expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
            expect(store.get(LISTINGS, 'p1')!.status).toBe(status);
        });

    it('still reports success when the resubmission is refused — the documents were saved', async () => {
        // A refusal means the listing moved on between the read and the write.
        // It is not an error for the caller: they asked to attach documents, and
        // the documents are attached.
        seedListing('p1', { status: 'rejected' });
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'available', exists: true }));

        const { uploadPropertyDocumentsAction } = await actions();
        expect(await uploadPropertyDocumentsAction('p1', { cOfO: 'https://cdn/c.pdf' }))
            .toMatchObject({ success: true });

        expect(store.get(LISTINGS, 'p1')!.documents).toEqual({ cOfO: 'https://cdn/c.pdf' });
    });
});
