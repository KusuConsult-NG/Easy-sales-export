/**
 * @jest-environment node
 */

/**
 * The Farm Nation member dashboard and the admin registrant list, EXECUTED.
 * _fn_dashboard.ts was at 14.3% and _fna_registrants.ts at 16.7%.
 *
 *   #145 `payment_confirmed` was counted in BOTH "properties acquired" and
 *        "pending transactions". It means the buyer has paid and the admin has
 *        NOT released escrow or transferred the title, so one purchase was
 *        reported as owned AND in progress, and its value added to total
 *        investment for land the buyer does not hold.
 *
 *   #146 The dashboard read `location.address` / `location.state`, which is the
 *        land module's object shape. Farm-nation's own listings store a plain
 *        STRING with state and lga as siblings, so every listing a member
 *        created showed a blank location and a blank state on their own
 *        dashboard.
 *
 *   #147 The registrant list hands every applicant's account number, account
 *        name and bank code — and, through a `...uData` spread, their hashed NIN
 *        and BVN — to any of the ten admin roles. Fourth copy of the defect
 *        closed on the withdrawal list, the marketplace escrow list and the
 *        farm-nation transaction list.
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

const MEMBER = 'member-1';
const ADMIN = 'admin-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const FN_TXNS = COLLECTIONS.FARM_NATION_TRANSACTIONS;
const USERS = COLLECTIONS.USERS;
const APPS = COLLECTIONS.FARM_NATION_APPLICATIONS;

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
    actAs(MEMBER);
    store.seed(USERS, MEMBER, { name: 'Ada Obi' });
});

const dashboard = async () =>
    (await (await import('@/app/actions/farm-nation/_fn_dashboard'))
        .getFarmNationDashboardStatsAction()) as any;

const registrants = async (options: Record<string, unknown> = {}) =>
    (await (await import('@/app/actions/farm-nation-admin/_fna_registrants'))
        .getStandardFarmNationRegistrantsAction(options as never)) as any;

const seedTx = (id: string, status: string, amount = 5_000_000) =>
    store.seed(FN_TXNS, id, {
        id, buyerId: MEMBER, propertyName: 'Two hectares', propertyPrice: amount,
        status, createdAt: `2026-0${id.slice(-1)}-01T00:00:00.000Z`,
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('getFarmNationDashboardStatsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await dashboard()).toMatchObject({ success: false });
    });

    it('returns zeroes rather than failing for a member with nothing', async () => {
        const res = await dashboard();
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({
            totalHectares: 0, activeListings: 0, propertiesAcquired: 0, pendingTransactions: 0,
        });
    });

    it('counts every for-sale spelling as an active listing', async () => {
        store.seedAll(LISTINGS, {
            a: { ownerId: MEMBER, status: 'available', size: 2, price: 1_000_000, title: 'A' },
            b: { ownerId: MEMBER, status: 'verified', size: 3, price: 2_000_000, title: 'B' },
            c: { ownerId: MEMBER, status: 'sold', size: 1, price: 500_000, title: 'C' },
            d: { ownerId: 'somebody-else', status: 'available', size: 9, price: 9, title: 'D' },
        });

        const res = await dashboard();
        expect(res.data).toMatchObject({
            activeListings: 2, completedDeals: 1, totalHectares: 6, portfolioValue: 3_500_000,
        });
    });

    // ── #145 ────────────────────────────────────────────────────────────────
    it('DOES NOT COUNT ONE PURCHASE AS BOTH ACQUIRED AND PENDING', async () => {
        seedTx('t1', 'payment_confirmed');
        seedTx('t2', 'completed');
        seedTx('t3', 'pending_payment');

        const res = await dashboard();

        expect(res.data.propertiesAcquired).toBe(1);          // t2 only
        expect(res.data.pendingTransactions).toBe(2);         // t1 and t3
        expect(res.data.totalInvestmentValue).toBe(5_000_000);
    });

    // ── #146 ────────────────────────────────────────────────────────────────
    it('SHOWS THE LOCATION OF A FARM-NATION LISTING, WHOSE location IS A STRING', async () => {
        store.seed(LISTINGS, 'fn', {
            ownerId: MEMBER, status: 'available', size: 2, price: 1, title: 'Farm-nation listing',
            location: '12 Market Road, Enugu', state: 'Enugu', lga: 'Enugu North',
        });

        const [listing] = (await dashboard()).data.recentListings;
        expect(listing.location).toBe('12 Market Road, Enugu');
        expect(listing.state).toBe('Enugu');
    });

    it('and of a land-module listing, whose location is an object', async () => {
        store.seed(LISTINGS, 'land', {
            ownerId: MEMBER, status: 'verified', size: 2, price: 1, title: 'Land-module listing',
            location: { address: '9 Farm Lane', city: 'Enugu', state: 'Enugu', lga: 'Nsukka', lat: 6.4, lng: 7.5 },
        });

        const [listing] = (await dashboard()).data.recentListings;
        expect(listing.location).toBe('9 Farm Lane');
        expect(listing.state).toBe('Enugu');
    });

    it('shows the newest listings and transactions first', async () => {
        seedTx('t1', 'completed');
        seedTx('t2', 'completed');

        const res = await dashboard();
        expect(res.data.recentTransactions[0].id).toBe('t2');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStandardFarmNationRegistrantsAction', () => {
    beforeEach(() => {
        store.seed(APPS, 'app-1', {
            id: 'app-1', userId: MEMBER, status: 'pending',
            profile: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08030000000' },
            submittedAt: '2026-05-01T00:00:00.000Z',
        });
        store.seed(USERS, MEMBER, {
            name: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
            nin: 'hashed-nin', bvn: 'hashed-bvn',
            bankDetails: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', bankCode: '058' },
        });
    });

    it('refuses a caller with no session, and an ordinary user', async () => {
        actAs(null);
        expect(await registrants()).toMatchObject({ success: false });

        actAs(MEMBER);
        expect(await registrants()).toMatchObject({ success: false });
    });

    // ── #147 ────────────────────────────────────────────────────────────────
    it.each(['farm_nation_admin', 'marketplace_admin', 'academy_admin', 'support', 'moderator', 'wave_admin'])(
        'GIVES %s THE LIST BUT NOT THE BANK DETAILS OR IDENTITY NUMBERS', async (role) => {
            actAs('other-admin', [role]);

            const res = await registrants();
            expect(res.success).toBe(true);

            const row = res.data.registrants?.[0] ?? res.data[0];
            expect(row.user.name).toBe('Ada Obi');
            expect(row.user.bankDetails).toBeUndefined();
            expect(row.data.nin).toBeUndefined();
            expect(row.data.bvn).toBeUndefined();
            expect(row.data.bankAccountNumber).toBeUndefined();
        });

    it.each(['admin', 'super_admin'])('gives %s the bank details', async (role) => {
        actAs('finance-admin', [role]);

        const res = await registrants();
        const row = res.data.registrants?.[0] ?? res.data[0];
        expect(row.user.bankDetails).toMatchObject({ accountNumber: '0123456789' });
    });
});
