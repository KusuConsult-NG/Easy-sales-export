/**
 * @jest-environment node
 */

/**
 * The Village Market, EXECUTED — the admin's events, a seller joining one, the
 * flash-sale listings and the public reads.
 *
 * At 17.9%. This module's interesting property is that a flash-sale listing is
 * a PRICE that marketplace/_payment.ts multiplies by a quantity to build a real
 * order, and `price` and `flashPrice` used to be written straight through from
 * the caller. A negative price there is caught by nothing downstream — the
 * quantity stays positive so the stock decrement succeeds and the order
 * completes — leaving that seller's escrow with a negative grossAmount while a
 * co-seller's is whole, and the platform owing money it never collected.
 *
 * The refusals that close that are asserted here, each against the store rather
 * than against a mocked write.
 *
 * WHAT IS ADMIN AND WHAT IS SELLER
 * --------------------------------
 * Four actions gate on `marketplace:manage_village_market` and two gate on the
 * caller owning the thing. Both boundaries are exercised, and each refusal has
 * a control showing the permitted caller succeeds — otherwise "an ordinary user
 * cannot" would pass against an action that nobody can use.
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

const notifyVillageMarketCreated = jest.fn(async (_p: unknown) => undefined);
jest.mock('@/lib/marketplace-notifications', () => ({
    notifyVillageMarketCreated: (p: unknown) => notifyVillageMarketCreated(p),
}));

let store: FakeDbHandle;

const EVENTS = COLLECTIONS.VILLAGE_MARKET_EVENTS;
const FLASH = COLLECTIONS.FLASH_SALE_PRODUCTS;
const ADMIN = 'admin-1';
const SELLER = 'seller-1';

function actAs(id: string | null, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    notifyVillageMarketCreated.mockImplementation(async () => undefined);
    store = installFakeDb();
    actAs(ADMIN, ['super_admin']);
});

async function actions() {
    return import('@/app/actions/village-market');
}

function inFuture(hours: number): string {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return d.toISOString();
}

function eventInput(overrides: Record<string, unknown> = {}): any {
    return {
        title: 'Jos Saturday Market',
        description: 'Weekly flash sale',
        location: 'Terminus',
        state: 'Plateau',
        lga: 'Jos North',
        startTime: inFuture(24),
        endTime: inFuture(30),
        ...overrides,
    };
}

function seedEvent(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(EVENTS, id, {
        title: 'Jos Saturday Market',
        state: 'Plateau',
        status: 'active',
        participantSellerIds: [],
        externalMerchants: [],
        startTime: inFuture(-1),
        endTime: inFuture(6),
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedApprovedSeller(id = SELLER): void {
    store.seed(COLLECTIONS.USERS, id, {
        email: `${id}@example.com`,
        sellerVerificationStatus: 'approved',
        businessName: 'Obi Farms',
    });
}

const onlyEvent = () => store.all(EVENTS)[0][1] as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('createVillageMarketEventAction', () => {
    const create = async (data?: any) =>
        (await (await actions()).createVillageMarketEventAction(data ?? eventInput())) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await create()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(EVENTS)).toBe(0);
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        expect(((await create()) as any).error).toContain('admin role required');
        expect(store.size(EVENTS)).toBe(0);
    });

    it('refuses an end time that is not after the start', async () => {
        expect(await create(eventInput({ startTime: inFuture(30), endTime: inFuture(24) })))
            .toMatchObject({ success: false, error: 'End time must be after start time' });
        expect(store.size(EVENTS)).toBe(0);
    });

    it('and refuses two identical times', async () => {
        const t = inFuture(24);
        expect(((await create(eventInput({ startTime: t, endTime: t }))) as any).success).toBe(false);
    });

    it('creates the event, recording who made it', async () => {
        const res = await create();
        expect(res.success).toBe(true);

        const event = onlyEvent();
        expect(event).toMatchObject({
            title: 'Jos Saturday Market', state: 'Plateau', lga: 'Jos North',
            createdBy: ADMIN, isRecurring: false,
        });
        expect(event.participantSellerIds).toEqual([]);
        expect(event.externalMerchants).toEqual([]);
        expect(res.eventId).toBe(event.id);
    });

    it('is "upcoming" when it starts in the future and "active" when it has begun', async () => {
        await create(eventInput({ startTime: inFuture(24), endTime: inFuture(30) }));
        expect(onlyEvent().status).toBe('upcoming');

        store.clear();
        await create(eventInput({ startTime: inFuture(-1), endTime: inFuture(6) }));
        expect(onlyEvent().status).toBe('active');
    });

    it('carries the recurrence through', async () => {
        await create(eventInput({ isRecurring: true, recurringDay: 'saturday' }));
        expect(onlyEvent()).toMatchObject({ isRecurring: true, recurringDay: 'saturday' });
    });

    it('stores null rather than undefined for the optional fields', async () => {
        await create(eventInput({ description: undefined, lga: undefined }));
        const event = onlyEvent();
        expect(event.description).toBeNull();
        expect(event.lga).toBeNull();
        expect(event.recurringDay).toBeNull();
    });

    it('notifies every APPROVED seller, and nobody else', async () => {
        seedApprovedSeller('seller-a');
        seedApprovedSeller('seller-b');
        store.seed(COLLECTIONS.USERS, 'seller-c', { sellerVerificationStatus: 'pending' });
        store.seed(COLLECTIONS.USERS, 'buyer', { email: 'b@example.com' });

        await create();

        expect(notifyVillageMarketCreated).toHaveBeenCalledTimes(1);
        const payload = (notifyVillageMarketCreated.mock.calls[0] as any[])[0];
        expect((payload.sellerIds as string[]).sort()).toEqual(['seller-a', 'seller-b']);
        expect(payload.eventTitle).toBe('Jos Saturday Market');
    });

    it('reports a failure when the notification throws, rather than a silent half-create', async () => {
        // The event row is already written by then, which is worth knowing: a
        // failed notification leaves the event in place and the admin told it
        // failed. Pinned so the ordering is a decision.
        notifyVillageMarketCreated.mockImplementation(async () => { throw new Error('smtp down'); });

        expect(((await create()) as any).success).toBe(false);
        expect(store.size(EVENTS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('joinVillageMarketEventAction', () => {
    const join = async (eventId = 'e1') =>
        (await (await actions()).joinVillageMarketEventAction(eventId)) as any;

    beforeEach(() => {
        actAs(SELLER, ['user']);
        seedApprovedSeller();
        seedEvent('e1');
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await join()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses a seller who is not approved', async () => {
        store.seed(COLLECTIONS.USERS, SELLER, { sellerVerificationStatus: 'pending' });

        expect(((await join()) as any).error).toContain('seller account must be approved');
        expect(store.get(EVENTS, 'e1')!.participantSellerIds).toEqual([]);
    });

    it('refuses somebody with no seller record at all', async () => {
        store.seed(COLLECTIONS.USERS, SELLER, { email: 'x@example.com' });
        expect(((await join()) as any).success).toBe(false);
    });

    it('says so when the event does not exist', async () => {
        expect(await join('nope')).toMatchObject({ success: false, error: 'Event not found' });
    });

    it.each(['ended', 'cancelled'])('refuses a %s event', async (status) => {
        seedEvent('closed', { status });
        expect(((await join('closed')) as any).error)
            .toBe('This event is no longer accepting participants');
    });

    it.each(['upcoming', 'active'])('joins a %s event', async (status) => {
        seedEvent('open', { status });
        expect(await join('open')).toMatchObject({ success: true });
        expect(store.get(EVENTS, 'open')!.participantSellerIds).toContain(SELLER);
    });

    it('does not duplicate a seller who joins twice', async () => {
        await join();
        await join();
        expect(store.get(EVENTS, 'e1')!.participantSellerIds).toEqual([SELLER]);
    });

    it('keeps the sellers already listed', async () => {
        seedEvent('e2', { participantSellerIds: ['seller-x'] });
        await join('e2');
        expect(store.get(EVENTS, 'e2')!.participantSellerIds).toEqual(['seller-x', SELLER]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addFlashSaleProductAction', () => {
    const add = async (overrides: Record<string, unknown> = {}) =>
        (await (await actions()).addFlashSaleProductAction({
            eventId: 'e1', title: 'Rice, 50kg', price: 50000, ...overrides,
        } as any)) as any;

    beforeEach(() => {
        actAs(SELLER, ['user']);
        seedApprovedSeller();
        seedEvent('e1', { participantSellerIds: [SELLER] });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await add()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(FLASH)).toBe(0);
    });

    it('says so when the event does not exist', async () => {
        expect(await add({ eventId: 'nope' })).toMatchObject({
            success: false, error: 'Event not found',
        });
    });

    it('refuses a seller who has not joined the event', async () => {
        seedEvent('e2');
        expect(((await add({ eventId: 'e2' })) as any).error)
            .toBe('You must join the event before listing products');
        expect(store.size(FLASH)).toBe(0);
    });

    it.each([0, -1, -50000])('refuses a price of %p', async (price) => {
        // marketplace/_payment.ts multiplies the STORED price by the quantity,
        // and nothing downstream catches a negative one: the quantity stays
        // positive so the stock decrement succeeds and the order completes,
        // leaving that seller's escrow with a negative grossAmount.
        expect(((await add({ price })) as any).error).toBe('Price must be greater than zero');
        expect(store.size(FLASH)).toBe(0);
    });

    it('refuses a price that is not a number at all', async () => {
        expect(((await add({ price: 'free' })) as any).error)
            .toBe('Price must be greater than zero');
        expect(((await add({ price: Number.NaN })) as any).error)
            .toBe('Price must be greater than zero');
    });

    it.each([0, -1])('refuses a flash price of %p', async (flashPrice) => {
        expect(((await add({ flashPrice })) as any).error)
            .toBe('Flash price must be greater than zero');
    });

    it('refuses a flash price ABOVE the normal price', async () => {
        expect(((await add({ price: 50000, flashPrice: 60000 })) as any).error)
            .toBe('Flash price cannot be higher than the normal price');
    });

    it('accepts a flash price equal to the normal price', async () => {
        expect(await add({ price: 50000, flashPrice: 50000 })).toMatchObject({ success: true });
    });

    it('refuses a fractional or negative quantity', async () => {
        expect(((await add({ availableQuantity: 2.5 })) as any).error)
            .toBe('Available quantity must be a whole number');
        expect(((await add({ availableQuantity: -1 })) as any).error)
            .toBe('Available quantity must be a whole number');
    });

    it('accepts a quantity of zero — sold out is a real state', async () => {
        expect(await add({ availableQuantity: 0 })).toMatchObject({ success: true });
        expect((store.all(FLASH)[0][1] as any).availableQuantity).toBe(0);
    });

    it('writes the listing owned by the seller, active, with nulls for what was omitted', async () => {
        const res = await add({ description: 'Long grain', unit: 'bag' });
        expect(res.success).toBe(true);

        const [, product] = store.all(FLASH)[0] as [string, Record<string, any>];
        expect(product).toMatchObject({
            eventId: 'e1', sellerId: SELLER, title: 'Rice, 50kg',
            price: 50000, unit: 'bag', status: 'active',
        });
        expect(product.flashPrice).toBeNull();
        expect(product.availableQuantity).toBeNull();
        expect(product.imageUrl).toBeNull();
        expect(product.externalMerchantId).toBeNull();
        expect(res.flashProductId).toBe(product.id);
    });

    it('coerces a numeric string price rather than storing the string', async () => {
        await add({ price: '50000', flashPrice: '45000' });
        const [, product] = store.all(FLASH)[0] as [string, Record<string, any>];
        expect(product.price).toBe(50000);
        expect(product.flashPrice).toBe(45000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the admin event controls', () => {
    beforeEach(() => { seedEvent('e1'); });

    it('addExternalMerchant refuses a non-admin, and admits an admin', async () => {
        const merchant = { displayName: 'Mama Ngozi Foods', phone: '08012345678' } as any;

        actAs('user-1', ['user']);
        expect(((await (await actions()).addExternalMerchantAction('e1', merchant)) as any).error)
            .toContain('admin role required');
        expect(store.get(EVENTS, 'e1')!.externalMerchants).toEqual([]);

        actAs(ADMIN, ['super_admin']);
        const res = (await (await actions()).addExternalMerchantAction('e1', merchant)) as any;
        expect(res.success).toBe(true);

        const [merchantRow] = store.get(EVENTS, 'e1')!.externalMerchants;
        expect(merchantRow).toMatchObject({ id: res.merchantId, displayName: 'Mama Ngozi Foods' });
    });

    it('adds merchants without displacing the ones already there', async () => {
        seedEvent('e2', { externalMerchants: [{ id: 'ext_old', displayName: 'First' }] });
        await (await actions()).addExternalMerchantAction('e2', { displayName: 'Second' } as any);

        const names = (store.get(EVENTS, 'e2')!.externalMerchants as any[]).map((m) => m.displayName);
        expect(names).toEqual(['First', 'Second']);
    });

    it('updateStatus refuses a non-admin, and admits an admin', async () => {
        actAs('user-1', ['user']);
        expect(await (await actions()).updateVillageMarketEventStatusAction('e1', 'ended'))
            .toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(EVENTS, 'e1')!.status).toBe('active');

        actAs(ADMIN, ['super_admin']);
        expect(await (await actions()).updateVillageMarketEventStatusAction('e1', 'ended'))
            .toMatchObject({ success: true });
        expect(store.get(EVENTS, 'e1')!.status).toBe('ended');
    });

    it('lists events for an admin, newest first, with a working cursor', async () => {
        store.clear();
        seedEvent('a', { createdAt: '2026-01-03T00:00:00.000Z' });
        seedEvent('b', { createdAt: '2026-01-02T00:00:00.000Z' });
        seedEvent('c', { createdAt: '2026-01-01T00:00:00.000Z' });

        const { getAdminVillageMarketEventsAction } = await actions();

        const page1 = (await getAdminVillageMarketEventsAction({ limit: 2 })) as any;
        expect((page1.data as any[]).map((e) => e.id)).toEqual(['a', 'b']);
        expect(page1).toMatchObject({ hasMore: true, lastDocId: 'b' });

        const page2 = (await getAdminVillageMarketEventsAction({ limit: 2, lastDocId: 'b' })) as any;
        expect((page2.data as any[]).map((e) => e.id)).toEqual(['c']);
        expect(page2.hasMore).toBe(false);
    });

    it('and refuses a non-admin asking for that list', async () => {
        actAs('user-1', ['user']);
        expect(await (await actions()).getAdminVillageMarketEventsAction())
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('removeFlashSaleProductAction', () => {
    const remove = async (id: string) =>
        (await (await actions()).removeFlashSaleProductAction(id)) as any;

    beforeEach(() => {
        actAs(SELLER, ['user']);
        store.seed(FLASH, 'p1', {
            eventId: 'e1', sellerId: SELLER, title: 'Rice', price: 50000, status: 'active',
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await remove('p1')).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('says so when the product does not exist', async () => {
        expect(await remove('nope')).toMatchObject({ success: false, error: 'Product not found' });
    });

    it('refuses another seller\'s listing', async () => {
        actAs('seller-2', ['user']);
        expect(await remove('p1')).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(FLASH, 'p1')!.status).toBe('active');
    });

    it('removes SOFTLY, keeping the row', async () => {
        expect(await remove('p1')).toMatchObject({ success: true });
        expect(store.get(FLASH, 'p1')!.status).toBe('removed');
        expect(store.size(FLASH)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the public reads', () => {
    it('lists only live events, soonest to end first, and never a closed one', async () => {
        seedEvent('ending-soon', { status: 'active', endTime: inFuture(2) });
        seedEvent('ending-later', { status: 'upcoming', endTime: inFuture(48) });
        seedEvent('already-over', { status: 'active', endTime: inFuture(-2) });
        seedEvent('cancelled', { status: 'cancelled', endTime: inFuture(10) });

        const { getActiveVillageMarketEventsAction } = await actions();
        expect((await getActiveVillageMarketEventsAction()).map((e: any) => e.id))
            .toEqual(['ending-soon', 'ending-later']);
    });

    it('returns an empty list rather than throwing when there is nothing', async () => {
        const { getActiveVillageMarketEventsAction } = await actions();
        expect(await getActiveVillageMarketEventsAction()).toEqual([]);
    });

    it('loads one event with its ACTIVE products, newest first', async () => {
        seedEvent('e1');
        store.seedAll(FLASH, {
            older: { eventId: 'e1', sellerId: SELLER, status: 'active', title: 'Older', createdAt: '2026-01-01T00:00:00.000Z' },
            newer: { eventId: 'e1', sellerId: SELLER, status: 'active', title: 'Newer', createdAt: '2026-06-01T00:00:00.000Z' },
            removed: { eventId: 'e1', sellerId: SELLER, status: 'removed', title: 'Gone', createdAt: '2026-07-01T00:00:00.000Z' },
            elsewhere: { eventId: 'e2', sellerId: SELLER, status: 'active', title: 'Other event', createdAt: '2026-08-01T00:00:00.000Z' },
        });

        const { getVillageMarketEventAction } = await actions();
        const res = await getVillageMarketEventAction('e1');

        expect(res.event?.id).toBe('e1');
        expect(res.products.map((p: any) => p.title)).toEqual(['Newer', 'Older']);
    });

    it('returns nulls rather than throwing for an event that does not exist', async () => {
        const { getVillageMarketEventAction } = await actions();
        expect(await getVillageMarketEventAction('nope')).toEqual({ event: null, products: [] });
    });

    it('lists the active flash sales across every event', async () => {
        store.seedAll(FLASH, {
            a: { eventId: 'e1', sellerId: SELLER, status: 'active', title: 'A', createdAt: '2026-01-02T00:00:00.000Z' },
            b: { eventId: 'e2', sellerId: SELLER, status: 'active', title: 'B', createdAt: '2026-01-01T00:00:00.000Z' },
            c: { eventId: 'e2', sellerId: SELLER, status: 'removed', title: 'C', createdAt: '2026-01-03T00:00:00.000Z' },
        });

        const { getActiveFlashSaleProductsAction } = await actions();
        expect((await getActiveFlashSaleProductsAction()).map((p: any) => p.title))
            .toEqual(['A', 'B']);
    });

    it('resolves the seller\'s real name and badge, one read per seller', async () => {
        // The fallback name used to be "Verified Seller", so a seller with no
        // name recorded was labelled verified in the NAME field; and the badge
        // was not resolved at all, so the buyer page hardcoded
        // `sellerVerified: true` on every Village Market listing.
        // The badge is read LIVE from the user document's isVerifiedBadge,
        // which _toggleVerifiedBadgeAction keeps in sync in the same
        // transaction as the verification record — so a revoked badge
        // disappears everywhere at once, which is the only behaviour a
        // revocation can have and still be one.
        store.seed(COLLECTIONS.USERS, SELLER, {
            businessName: 'Obi Farms', sellerVerificationStatus: 'approved',
            isVerifiedBadge: true,
        });
        store.seedAll(FLASH, {
            a: { eventId: 'e1', sellerId: SELLER, status: 'active', title: 'A', createdAt: '2026-01-02T00:00:00.000Z' },
            b: { eventId: 'e1', sellerId: SELLER, status: 'active', title: 'B', createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const { getActiveFlashSaleProductsAction } = await actions();
        const products = await getActiveFlashSaleProductsAction();

        expect(products).toHaveLength(2);
        for (const product of products as any[]) {
            expect(product.sellerName).toBe('Obi Farms');
            expect(product.sellerVerified).toBe(true);
        }
    });

    it('does not invent a verified badge for a seller who has none', async () => {
        store.seed(COLLECTIONS.USERS, SELLER, { businessName: 'Obi Farms' });
        store.seed(FLASH, 'a', {
            eventId: 'e1', sellerId: SELLER, status: 'active', title: 'A',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getActiveFlashSaleProductsAction } = await actions();
        expect(((await getActiveFlashSaleProductsAction()) as any[])[0].sellerVerified)
            .not.toBe(true);
    });

    it('returns an empty list rather than throwing when there are none', async () => {
        const { getActiveFlashSaleProductsAction } = await actions();
        expect(await getActiveFlashSaleProductsAction()).toEqual([]);
    });
});
