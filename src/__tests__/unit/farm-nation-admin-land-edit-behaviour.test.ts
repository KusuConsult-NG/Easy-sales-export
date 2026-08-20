/**
 * @jest-environment node
 */

/**
 * The admin land editor, EXECUTED — updateAdminLandListingAction.
 *
 * farm-nation-admin/_fna_verifications.ts was at 25.7% statements. Two findings
 * came out of running its editor, and both are "one of two writers was
 * guarded":
 *
 *   #143 The OWNER's editor, updatePropertyAction, refuses to move price, size,
 *        type, category or lease terms while a purchase is in flight, and its
 *        comment sets out the sequence it prevents: the buyer is quoted and
 *        charged, the listing moves to pending_escrow, the price changes, and
 *        the buyer returns from Paystack to a verification that reads the NEW
 *        price and throws — after the payment is claimed, so they have paid and
 *        received nothing. This ADMIN editor wrote price, size and category
 *        unconditionally, so the whole sequence was still reachable through
 *        /admin/farm-nation/land-verification.
 *
 *   #144 It replaced `location` wholesale with `{ state, lga, address }`.
 *        LAND_LISTINGS holds two shapes: the land module stores an object with
 *        lat, lng, city, address, state and lga; farm-nation stores a plain
 *        string with state and lga as siblings. So an admin correcting a title
 *        on a land-module listing silently deleted its coordinates — and
 *        components/land/LandMap.tsx plots every pin from
 *        `listing.location.lat/lng` and labels it `location.city`. The listing
 *        dropped off the map, from an edit that never mentioned the map.
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

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const OWNER = 'owner-1';
const LISTING = 'land-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(ADMIN, ['admin']);
});

const verifications = () => import('@/app/actions/farm-nation-admin/_fna_verifications');

/** A land-module listing: `location` is an object carrying the map pin. */
const seedMapped = (over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, LISTING, {
        id: LISTING, title: 'Two hectares, Enugu', ownerId: OWNER,
        category: 'farmland', size: 2, price: 5_000_000, status: 'verified',
        location: {
            lat: 6.4531, lng: 7.5248, city: 'Enugu', address: '12 Market Road',
            state: 'Enugu', lga: 'Enugu North',
        },
        ...over,
    });

/** A farm-nation listing: `location` is a string, state/lga are siblings. */
const seedFlat = (over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, LISTING, {
        id: LISTING, title: 'Two hectares, Enugu', ownerId: OWNER,
        category: 'farmland', size: 2, price: 5_000_000, status: 'available',
        location: '12 Market Road, Enugu',
        state: 'Enugu', lga: 'Enugu North',
        ...over,
    });

const edit = async (over: Record<string, unknown> = {}) =>
    (await (await verifications()).updateAdminLandListingAction({
        listingId: LISTING,
        title: 'Two hectares, Enugu',
        category: 'farmland',
        state: 'Enugu',
        lga: 'Enugu North',
        size: 2,
        price: 5_000_000,
        ...over,
    } as never)) as any;

const listing = () => store.get(LISTINGS, LISTING) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('updateAdminLandListingAction', () => {
    beforeEach(() => { seedMapped(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await edit()).toMatchObject({ success: false });
    });

    it.each(['general_user', 'support', 'moderator', 'marketplace_admin', 'academy_admin'])(
        'refuses %s — editing a listing needs land:verify_listings', async (role) => {
            actAs('other-1', [role]);

            expect(await edit({ title: 'Renamed' })).toMatchObject({ success: false });
            expect(listing().title).toBe('Two hectares, Enugu');
        });

    it('refuses a listing that does not exist', async () => {
        store.clear();
        expect(await edit()).toMatchObject({ success: false, error: 'Land listing not found' });
    });

    it('corrects the title and the location', async () => {
        expect(await edit({ title: 'Two hectares, Nsukka', lga: 'Nsukka', address: '9 Farm Lane' }))
            .toMatchObject({ success: true });

        expect(listing().title).toBe('Two hectares, Nsukka');
        expect(listing().location).toMatchObject({ lga: 'Nsukka', address: '9 Farm Lane' });
    });

    // ── #144 ────────────────────────────────────────────────────────────────
    it('KEEPS THE MAP PIN WHEN CORRECTING ANYTHING ELSE', async () => {
        // LandMap plots from location.lat/lng and labels with location.city.
        // Replacing the object with { state, lga, address } deleted all three.
        await edit({ title: 'A corrected title' });

        expect(listing().location).toMatchObject({
            lat: 6.4531, lng: 7.5248, city: 'Enugu',
        });
    });

    it('keeps the recorded address when the edit does not carry one', async () => {
        await edit({ address: undefined });
        expect(listing().location.address).toBe('12 Market Road');
    });

    it('handles a farm-nation listing whose location is a plain string', async () => {
        // The other shape on the same collection. There is nothing to preserve,
        // and the write must not throw on it.
        seedFlat();

        expect(await edit({ lga: 'Nsukka' })).toMatchObject({ success: true });
        expect(listing().location).toMatchObject({ state: 'Enugu', lga: 'Nsukka' });
    });

    it('keeps the top-level state and lga in step with the object', async () => {
        seedFlat();

        await edit({ state: 'Anambra', lga: 'Awka South' });

        expect(listing()).toMatchObject({ state: 'Anambra', lga: 'Awka South' });
        expect(listing().location).toMatchObject({ state: 'Anambra', lga: 'Awka South' });
    });

    it('records the edit in the audit log', async () => {
        await edit({ price: 6_000_000 });

        expect((globalThis as unknown as { mockCreateAdminAuditLog: jest.Mock<any> }).mockCreateAdminAuditLog)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'land_updated', userId: ADMIN, targetId: LISTING,
            }));
    });

    it('writes the GPS coordinates when the edit carries them', async () => {
        await edit({ gpsCoordinates: { latitude: 6.5, longitude: 7.5 } });

        expect(listing().gpsCoordinates).toMatchObject({ latitude: 6.5, longitude: 7.5 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#143 — the terms a buyer was quoted on', () => {
    const IN_FLIGHT = [
        'pending', 'pending_escrow', 'pending_payment',
        'payment_confirmed', 'pending_transfer', 'sold', 'completed',
    ];

    it.each(IN_FLIGHT)('REFUSES TO REPRICE A %s LISTING', async (status) => {
        // The sequence the owner's editor already refuses: buyer charged the
        // quoted price, listing in escrow, price moved, buyer returns to a
        // verification that reads the new price and throws — after the payment
        // is claimed.
        seedMapped({ status });

        const res = await edit({ price: 50_000_000 });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/purchase in progress/i);
        expect(listing().price).toBe(5_000_000);
    });

    it.each(IN_FLIGHT)('refuses to resize or recategorise a %s listing', async (status) => {
        seedMapped({ status });

        expect((await edit({ size: 99 })).success).toBe(false);
        expect((await edit({ category: 'residential' })).success).toBe(false);
        expect(listing()).toMatchObject({ size: 2, category: 'farmland' });
    });

    it('still lets the title and location be corrected mid-purchase', async () => {
        // Correcting a typo harms nobody; it is the quoted terms that must not
        // move under the buyer.
        seedMapped({ status: 'pending_escrow' });

        expect(await edit({ title: 'Two hectares, Enugu (corrected)', lga: 'Nsukka' }))
            .toMatchObject({ success: true });

        expect(listing()).toMatchObject({ title: 'Two hectares, Enugu (corrected)' });
        expect(listing().location.lga).toBe('Nsukka');
    });

    it.each(['verified', 'available', 'pending_verification', 'rejected'])(
        'allows a reprice on a %s listing, which nobody is buying', async (status) => {
            seedMapped({ status });

            expect(await edit({ price: 6_000_000 })).toMatchObject({ success: true });
            expect(listing().price).toBe(6_000_000);
        });

    it('agrees with the owner\'s editor about which states lock the terms', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const read = (rel: string) =>
            stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

        const owner = read('src/app/actions/farm-nation/_fn_listings.ts');
        const admin = read('src/app/actions/farm-nation-admin/_fna_verifications.ts');

        for (const src of [owner, admin]) {
            const list = src.slice(src.indexOf('TERMS_LOCKED_IN'), src.indexOf(']', src.indexOf('TERMS_LOCKED_IN')));
            for (const status of IN_FLIGHT) {
                expect(list).toContain(`"${status}"`);
            }
        }
    });
});
