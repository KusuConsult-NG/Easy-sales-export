/**
 * @jest-environment node
 */

/**
 * The admin land verification queue, EXECUTED.
 *
 *   #148 The list was gated on isAdmin() — true for all TEN admin roles — while
 *        spreading the whole land listing into every row: the owner's email and
 *        phone, and the URLs of their C of O, survey plan and tax clearance, the
 *        legal documents proving title to a parcel. Everything you can DO from
 *        this screen requires "land:verify_listings", held by super_admin, admin
 *        and farm_nation_admin only. So a support user or an academy_admin could
 *        not act on a single row and could read every deed on the platform.
 *
 * The rest executes rules earlier findings asserted structurally: the tab-to-
 * status sets, and the queue label that defaulted every unrecognised status to
 * "pending" and so offered Approve/Reject on sold parcels and live escrows.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const OWNER = 'owner-1';

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
    actAs('admin-1', ['farm_nation_admin']);
});

const queue = async (options: Record<string, unknown> = {}) =>
    (await (await import('@/app/actions/farm-nation-admin/_fna_verifications'))
        .getAdminLandVerificationsAction(options as never)) as any;

const seedListing = (id: string, over: Record<string, unknown> = {}) =>
    store.seed(LISTINGS, id, {
        id, title: `Parcel ${id}`, ownerId: OWNER, ownerName: 'Emeka Nwosu',
        ownerEmail: 'emeka@example.com', ownerPhone: '08040000000',
        status: 'pending_verification', price: 5_000_000, size: 2,
        state: 'Enugu', lga: 'Enugu North',
        documents: { landTitle: 'https://files/cofo.pdf', surveyPlan: 'https://files/survey.pdf' },
        createdAt: '2026-05-01T00:00:00.000Z',
        ...over,
    });

const rows = (res: any): any[] => res.data?.verifications ?? res.data ?? [];

// ─────────────────────────────────────────────────────────────────────────────
describe('getAdminLandVerificationsAction', () => {
    beforeEach(() => { seedListing('l1'); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await queue()).toMatchObject({ success: false });
    });

    // ── #148 ────────────────────────────────────────────────────────────────
    it.each(['general_user', 'support', 'moderator', 'academy_admin', 'marketplace_admin', 'wave_admin', 'export_admin', 'cooperative_admin'])(
        'REFUSES %s — they cannot act on this queue, so they may not read the deeds', async (role) => {
            actAs('other-1', [role]);
            expect(await queue()).toMatchObject({ success: false });
        });

    it.each(['super_admin', 'admin', 'farm_nation_admin'])(
        'admits %s — the roles that hold land:verify_listings', async (role) => {
            actAs('admin-x', [role]);

            const res = await queue();
            expect(res.success).toBe(true);
            expect(rows(res)).toHaveLength(1);
            expect(rows(res)[0].documents.landTitle).toBe('https://files/cofo.pdf');
        });

    it('labels a purchasable listing verified, whatever the spelling', async () => {
        seedListing('a', { status: 'available' });
        seedListing('v', { status: 'verified' });

        const byId = Object.fromEntries(rows(await queue()).map((r: any) => [r.id, r.verificationStatus]));
        expect(byId.a).toBe('verified');
        expect(byId.v).toBe('verified');
    });

    it('DOES NOT LABEL A SOLD OR IN-ESCROW PARCEL AS PENDING', async () => {
        // The label defaulted to "pending" for every unrecognised status, and
        // the page renders Approve and Reject on anything it is told is
        // pending — so an admin was invited to decide on sold parcels and
        // parcels with a buyer's money held against them.
        seedListing('sold', { status: 'sold' });
        seedListing('escrow', { status: 'pending_escrow' });

        const byId = Object.fromEntries(rows(await queue()).map((r: any) => [r.id, r.verificationStatus]));
        expect(byId.sold).toBe('unavailable');
        expect(byId.escrow).toBe('unavailable');
    });

    it('normalises documents held as an array', async () => {
        seedListing('arr', {
            documents: ['https://files/x_title_a.pdf', 'https://files/x_survey_b.pdf'],
        });

        const row = rows(await queue()).find((r: any) => r.id === 'arr');
        expect(row.documents).toMatchObject({
            landTitle: 'https://files/x_title_a.pdf',
            surveyPlan: 'https://files/x_survey_b.pdf',
        });
    });

    it('filters by tab, using the shared status sets', async () => {
        seedListing('p', { status: 'pending_verification' });
        seedListing('a', { status: 'available' });
        seedListing('r', { status: 'rejected' });

        expect(rows(await queue({ status: 'verified' })).map((r: any) => r.id).sort()).toEqual(['a']);
        expect(rows(await queue({ status: 'rejected' })).map((r: any) => r.id)).toEqual(['r']);
    });

    it('searches across the owner and the location', async () => {
        seedListing('other', { ownerName: 'Zoe Adaeze', state: 'Kano', lga: 'Kano' });

        const res = await queue({ search: 'zoe' });
        expect(rows(res).map((r: any) => r.id)).toEqual(['other']);
    });

    it('returns an empty queue rather than failing', async () => {
        store.clear();
        expect(await queue()).toMatchObject({ success: true });
    });
});
