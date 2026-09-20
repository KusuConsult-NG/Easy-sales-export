/**
 * @jest-environment node
 */

/**
 *   EXPORT — AND THE WALLET'S LESSON POINTING THE OTHER WAY.
 *
 *   Two reads listed an investor's own investments by one id, so an investor
 *   whose profile was superseded saw a portfolio that renders, balances, and
 *   is short. That is the ordinary widening.
 *
 *   The interesting one is the third. `getUserExportStats` reads a CACHED
 *   AGGREGATE at INVESTOR_PORTFOLIOS.doc(userId) — the same doc-id shape as
 *   the wallet, and both its writers key on the live session id
 *   (payments/service.ts, export-payment.ts), so a superseded profile's
 *   portfolio is frozen at whatever it held.
 *
 *   FOR THE WALLET, THE ANSWER WAS TO SHOW THE LIVE ROW ALONE. A balance is
 *   SPENDABLE and migration 005 only ever moves the live row, so summing
 *   across profiles would put a figure on screen that checkout then refuses —
 *   worse than the ₦0 it showed before.
 *
 *   HERE IT IS THE OPPOSITE, and the difference is what the number means. A
 *   portfolio total is HISTORICAL: nothing is spent from it, it records what
 *   was invested and what is expected back. Summing is not a promise about
 *   what the investor can do — it is the true total, and it is the only figure
 *   that agrees with the investment LIST, which now spans every profile.
 *
 *   An aggregate counting three of five investments while the list shows all
 *   five is a page disagreeing with itself — the WAVE earnings defect in
 *   miniature, arriving through a cache instead of a subtraction.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LIVE = 'live-investor';
const OLD = 'superseded-investor';
const STRANGER = 'another-investor';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'investor@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'investor@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    (global as any).mockRequireSession.mockImplementation(() =>
        Promise.resolve({ session: { user: { id: LIVE, email: 'investor@example.com', roles: [] } }, error: null }));
});

const stats = async () => {
    const { getUserExportStatsAction } = await import('@/app/actions/export/_ex_investments');
    return ((await getUserExportStatsAction()) as any)?.data;
};

const investments = async () => {
    const { getMyExportInvestmentsAction } = await import('@/app/actions/export/_ex_investments');
    const r = (await getMyExportInvestmentsAction()) as any;
    return r?.data ?? [];
};

describe('the list and the total agree, across both profiles', () => {
    it('THE test — an investment under the old profile is listed', async () => {
        store.seed(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-old', {
            investorId: OLD, amount: 100_000, status: 'active',
            createdAt: new Date().toISOString(),
        });
        store.seed(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-new', {
            investorId: LIVE, amount: 50_000, status: 'active',
            createdAt: new Date().toISOString(),
        });

        expect(await investments()).toHaveLength(2);
    });

    it('AND THE AGGREGATE COUNTS THE SAME TWO — a page must not disagree with itself', async () => {
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, OLD, {
            totalInvested: 100_000, activeInvestments: 1, totalExpectedReturns: 120_000,
        });
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, LIVE, {
            totalInvested: 50_000, activeInvestments: 1, totalExpectedReturns: 60_000,
        });

        const s = await stats();

        expect(s).toMatchObject({ totalInvested: 150_000, activeInvestments: 2 });
    });

    it('and a portfolio that exists ONLY under the old profile is still found', async () => {
        //   The case the doc-id read missed entirely: stats read as all zeros
        //   for an investor who had put money in.
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, OLD, {
            totalInvested: 100_000, activeInvestments: 1, totalExpectedReturns: 120_000,
        });

        const s = await stats();

        expect(s).toMatchObject({ totalInvested: 100_000, activeInvestments: 1 });
    });

    it('and pending returns are still DERIVED, not invented', async () => {
        //   expected (120,000) less returned (0). The derivation the file
        //   already documents, now over the summed figures.
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, OLD, {
            totalInvested: 100_000, activeInvestments: 1, totalExpectedReturns: 120_000,
        });

        const s = await stats();

        expect(s.pendingReturns).toBe(120_000);
        expect(s.totalReturns).toBe(0);
    });
});

describe('and the controls', () => {
    it('another investor\'s portfolio is never summed in', async () => {
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, STRANGER, {
            totalInvested: 9_000_000, activeInvestments: 40,
        });
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, LIVE, {
            totalInvested: 50_000, activeInvestments: 1,
        });

        expect(await stats()).toMatchObject({ totalInvested: 50_000, activeInvestments: 1 });
    });

    it('nor their investments', async () => {
        store.seed(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-x', {
            investorId: STRANGER, amount: 700_000, status: 'active',
            createdAt: new Date().toISOString(),
        });

        expect(await investments()).toHaveLength(0);
    });

    it('and an investor with nothing still reads zero rather than throwing', async () => {
        //   The vacuity control: the fallback path, with no portfolio anywhere.
        expect(await stats()).toMatchObject({ totalInvested: 0, activeInvestments: 0 });
    });
});
