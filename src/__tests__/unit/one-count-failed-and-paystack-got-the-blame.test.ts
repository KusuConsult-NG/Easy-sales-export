/**
 * @jest-environment node
 */

/**
 *   #960 ONE COUNT FAILED AND THE SCREEN BLAMED PAYSTACK.
 *
 *   THE OWNER, from the live admin dashboard, with "we fixed this and its
 *   repeating":
 *
 *       Total Users      Unavailable   Could not be read — retry shortly
 *       Active Users     1,034         Logged in recently
 *       Total Revenue    Unavailable   Could not reach Paystack or the database
 *       Pending Escrows  3             Requires attention
 *
 *   Two tiles out and two fine — and the two that are out are exactly the pair
 *   getPlatformMetrics returns together, while the two that work are read
 *   elsewhere. That is the shape of the bug, visible in the report itself.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 *   The revenue aggregate sat in a try/catch and degraded on its own. The user
 *   count did not: it was awaited INSIDE THE RETURN OBJECT.
 *
 *       const totalUsersPromise = countLivePeople(...);       // not awaited
 *       { try { ...revenue aggregate... } catch { ... } }     // degrades
 *       return {
 *           totalRevenue,
 *           totalUsers: await totalUsersPromise,              // uncaught
 *           revenueAvailable: revenueSource !== null,
 *       };
 *
 *   So a rejected count threw out of the whole method, the caller took its
 *   `rejected` branch, and THAT branch cannot tell which read failed — so it
 *   sets `totalRevenue = 0` and `revenueAvailable = false` along with the user
 *   figures. The revenue number that had just been read successfully was
 *   discarded, and the screen said "could not reach Paystack or the database" on
 *   evidence nobody had.
 *
 *   #753 established the rule for this exact screen: "a figure that could not be
 *   read is unavailable, and the figures that WERE read are still worth
 *   showing." It was applied to the CALLER and not inside the method, so the
 *   granularity stopped one level too shallow — which is the shape #753 itself
 *   named: a correct rule applied to some of the places it names.
 *
 * ── AND WHY THE COUNT WAS FAILING, WHICH IS A SEPARATE HALF ─────────────────
 *
 *   countLivePeople reads the 42,845-row `users` table three times, twice
 *   filtering on a key inside `raw_data` with no index able to serve it. 053 adds
 *   those indexes and src/__tests__/pg/the-count-that-read-every-row.test.ts
 *   asserts the plans against a real PostgreSQL.
 *
 *   THE TWO HALVES SHIP INDEPENDENTLY ON PURPOSE, and that is the whole lesson
 *   of "we fixed this and its repeating". lib/migration-manifest records what
 *   happened last time: "NOTHING APPLIES THESE MIGRATIONS TO PRODUCTION … On the
 *   day this was written, two of them had not been: 050 and 051. 051 was the
 *   other half of a `count users` fix merged hours earlier, and the admin
 *   dashboard read 'Total Users — could not be read' the whole time."
 *
 *   So this half is written to be worth shipping ALONE: with the indexes
 *   unapplied the count may still fail, and the dashboard will then lose one
 *   tile instead of two and will not accuse a payment provider of being down.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const REVENUE = 4_250_000;

type Outcome = {
    unavailableFigures: string[];
    totalUsers: number;
    totalRevenue: number;
    revenueAvailable: boolean;
};

/**
 * Run getDashboardStats with the live-people count either working or rejecting,
 * and a revenue aggregate that always succeeds.
 *
 * The count is failed at `countLivePeople` — the boundary the timeout actually
 * crosses — rather than by breaking the database mock, so the revenue read is
 * left genuinely working. A mock that failed every read could not tell the fixed
 * code from the broken code, because both report everything unavailable.
 */
async function runWith({ countFails }: { countFails: boolean }): Promise<Outcome> {
    jest.resetModules();

    const TIMEOUT = Object.assign(
        new Error('canceling statement due to statement timeout'),
        { code: '57014' },
    );

    jest.doMock('@/lib/user-population', () => ({
        ...(jest.requireActual('@/lib/user-population') as Record<string, unknown>),
        countLivePeople: jest.fn(async () => {
            if (countFails) throw TIMEOUT;
            return 42_003;
        }),
    }));

    const { installFakeDb } = require('@/lib/testing/fake-db');
    const { COLLECTIONS } = require('@/lib/types/firestore');
    const store = installFakeDb();

    //   Two completed payments, so the revenue aggregate has something real to
    //   sum and "revenue survived" is a figure rather than a zero that happens
    //   to match.
    store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-1', {
        id: 'pay-1', status: 'completed', amount: REVENUE - 250_000,
        processedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-2', {
        id: 'pay-2', status: 'completed', amount: 250_000,
        processedAt: new Date('2026-09-02T00:00:00.000Z'),
    });

    const { AnalyticsService } = await import('@/services/analytics.service');
    const stats: any = await new AnalyticsService().getDashboardStats();

    const overview = stats?.platformOverview ?? {};
    return {
        unavailableFigures: overview.unavailableFigures ?? [],
        totalUsers: overview.totalUsers,
        totalRevenue: overview.totalRevenue,
        revenueAvailable: overview.revenueAvailable,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#960 — the count fails, and only the count is reported as unavailable', () => {
    it('THE CONTROL: with the count working, nothing is unavailable', async () => {
        /*
         *   First, so that everything below is a difference from a known-good
         *   run. Without this the assertions could all be passing because the
         *   harness never reaches the code at all.
         */
        const out = await runWith({ countFails: false });

        expect(out.unavailableFigures).toEqual([]);
        expect(out.totalUsers).toBe(42_003);
        expect(out.revenueAvailable).toBe(true);
        expect(out.totalRevenue).toBe(REVENUE);
    }, 60000);

    it('THE FIX: a rejected count marks totalUsers AND LEAVES THE REVENUE ALONE', async () => {
        /*
         *   The owner's screen, minus the false sentence. `totalUsers` is
         *   honestly unavailable; revenue is the figure that was actually read.
         *
         *   THIS IS THE MUTATION TARGET. Put `totalUsers: await
         *   totalUsersPromise` back in the return object and this goes red on
         *   both halves at once: revenueAvailable false and totalRevenue 0.
         */
        const out = await runWith({ countFails: true });

        expect(out.unavailableFigures).toContain('totalUsers');

        expect(out.revenueAvailable).toBe(true);
        expect(out.totalRevenue).toBe(REVENUE);
    }, 60000);

    it('AND IT DOES NOT CLAIM THE TRANSACTION COUNT IS UNREADABLE EITHER', async () => {
        /*
         *   The old reject branch pushed BOTH "totalUsers" and
         *   "totalTransactions", because it could not tell which read failed.
         *   totalTransactions comes from the same aggregate as revenue, so it was
         *   read fine, and saying otherwise is the same false claim in a second
         *   place.
         */
        const out = await runWith({ countFails: true });

        expect(out.unavailableFigures).not.toContain('totalTransactions');
    }, 60000);

    it('THE FIGURE THE TILE WOULD DRAW: "Unavailable" for users, a real sum for revenue', async () => {
        /*
         *   The two rules joined at the point the screen applies them, because
         *   that is where the owner read the wrong sentence. revenueDisplay is
         *   #665's shared decision — the same function DashboardClient calls — so
         *   this asserts the words, not a paraphrase of them.
         */
        /*
         *   #960 THE FIRST VERSION OF THIS TEST SURVIVED THE MUTANT AND WAS
         *        THEREFORE MEASURING NOTHING.
         *
         *        It did `expect(JSON.stringify(revenueDisplay(...)))
         *        .not.toContain('Could not reach Paystack')`. revenueDisplay
         *        returns a STATE — "exact" | "partial" | "unavailable" — and
         *        revenueNote turns that into the sentence. So the assertion was
         *        comparing the word "unavailable" against a phrase it could never
         *        contain, and passed with the defect fully restored.
         *
         *        Now it goes through the same two functions DashboardClient
         *        calls, in the same order, and asserts the state AND the sentence.
         */
        const out = await runWith({ countFails: true });
        const { revenueDisplay, revenueNote } = await import('@/lib/revenue-display');

        const unreadable = new Set(out.unavailableFigures);
        expect(unreadable.has('totalUsers')).toBe(true);

        const display = revenueDisplay(out.revenueAvailable, false);
        expect(display).toBe('exact');

        const note = revenueNote(display);
        expect(note).toBeNull();
        expect(String(note)).not.toContain('Could not reach Paystack');
    }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#960 — the sibling site, where a users count spoke for the escrows', () => {
    /**
     * getPlatformHealthMetrics had the same rule at the same wrong granularity:
     * `Promise.all`, so one failing read returned THREE unavailable figures —
     * including `activeEscrows`, which is a different collection and was read
     * successfully. Honest, and coarse enough to be misleading: a `users`
     * timeout has nothing to say about how many escrows hold money.
     */
    async function healthWith({ countFails }: { countFails: boolean }) {
        jest.resetModules();

        jest.doMock('@/lib/user-population', () => ({
            ...(jest.requireActual('@/lib/user-population') as Record<string, unknown>),
            countLivePeople: jest.fn(async () => {
                if (countFails) throw new Error('canceling statement due to statement timeout');
                return 1_234;
            }),
        }));

        const { installFakeDb } = require('@/lib/testing/fake-db');
        const { COLLECTIONS } = require('@/lib/types/firestore');
        const store = installFakeDb();

        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'esc-1', { id: 'esc-1', status: 'funded' });
        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'esc-2', { id: 'esc-2', status: 'funded' });

        const { AnalyticsService } = await import('@/services/analytics.service');
        return await AnalyticsService.getPlatformHealthMetrics() as any;
    }

    it('THE CONTROL: everything read, and no unavailable list at all', async () => {
        const out = await healthWith({ countFails: false });

        //   ABSENT, not empty: an absent list means no claim was made, which is
        //   the distinction #753 drew for unavailableFigures and the reason a
        //   caller tests membership rather than emptiness.
        expect(out.unavailable).toBeUndefined();
        expect(out.totalUsers).toBe(1_234);
        expect(out.activeEscrows).toBe(2);
    });

    it('A FAILING USER COUNT NO LONGER SPEAKS FOR THE ESCROW FIGURE', async () => {
        const out = await healthWith({ countFails: true });

        expect(out.unavailable).toEqual(expect.arrayContaining(['totalUsers', 'activeUsers']));
        expect(out.unavailable).not.toContain('activeEscrows');

        //   And the escrow count is the real one, not a zero standing in for it.
        expect(out.activeEscrows).toBe(2);
    });
});
