/**
 * @jest-environment node
 */

/**
 *   THE DASHBOARD PAID SEVEN NETWORK LATENCIES TO DRAW ONE PAGE.
 *
 *   THE OWNER: "fix the dashboard counts. still slow."
 *
 *   `getDashboardStats` issues roughly thirty database reads. Almost all of
 *   them are HEAD counts, which #473 measured on this very page as "29 calls,
 *   1,415 ms — correct and cheap". They were not the problem.
 *
 *   The problem was the SHAPE. Every group was internally parallel and each
 *   group was waited out before the next one was started:
 *
 *       1  activeUsers + four safeCounts
 *       2  getPlatformMetrics + getGlobalPendingApprovals
 *       3  revenue by month              six aggregates
 *       4  user growth by month          six counts
 *       5  getModuleRegistrationStats
 *       6  recent transactions           ONE read, waited for alone
 *       7  getUserSegmentsCached         ONE read, waited for alone
 *
 *   Nothing in 3-7 reads anything 1-2 produces. The month windows come from
 *   `lastNMonths(6)`, the transaction filter from `options`, and the last two
 *   take no argument at all. So five of those seven waits existed only because
 *   of the order the statements happened to be written in.
 *
 *   ── HOW THIS MEASURES IT, WITHOUT TIMING ANYTHING ──────────────────────────
 *
 *   A wall-clock assertion in jest would measure jest. This counts ROUNDS
 *   instead, which is the thing that costs: every `.get()` is held open, and
 *   once no more arrive the whole batch is released together. The number of
 *   release rounds needed to finish the method IS the number of sequential
 *   waves — exactly what a caller pays a network latency for, one per round.
 *
 *   Deterministic, and it fails in the honest direction: re-introduce a
 *   `const x = await somethingElse()` between two independent reads and the
 *   round count rises by one whatever the machine is doing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 *   The reads that do not go through the firestore compat seam: the two RPCs
 *   (`count_user_segments` from 029, `count_module_registrations` from 049) and
 *   the module-registration fallback's eight queries.
 *
 *   WHICH MIGRATIONS ARE APPLIED IS A VARIABLE HERE, because it changes the
 *   answer and the difference is the point. 049 present is one wave; 049 absent
 *   is the documented fallback, and it costs an extra one.
 */
const deployed = { moduleCountsRpc: true };

jest.mock('@/lib/supabase', () => {
    const refused = Promise.resolve({ data: null, error: { message: 'not available in this test' }, count: 0 });
    const q: any = {
        select: () => q,
        or: () => refused,
        eq: () => q,
        then: (a: any, b: any) => refused.then(a, b),
    };
    return {
        supabaseAdmin: {
            rpc: (name: string) => {
                if (name === 'count_module_registrations' && deployed.moduleCountsRpc) {
                    return Promise.resolve({
                        data: [{
                            wave: 1, academy: 2, cooperatives: 3, cooperative_onboarding: 4,
                            farm_nation: 5, export_hub: 6, export_onboarding: 7, marketplace: 8,
                        }],
                        error: null,
                    });
                }
                return refused;
            },
            from: () => q,
        },
        supabase: { rpc: () => refused, from: () => q },
    };
});

const EMPTY = {
    exists: false,
    empty: true,
    size: 0,
    docs: [],
    data: () => ({ count: 0, total: 0, totalRevenue: 0, totalTransactions: 0 }),
};

/** Let every already-resolvable microtask and timer callback run. */
async function settleQueues(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await new Promise((r) => setImmediate(r));
    }
}

/**
 * Runs `work`, holding every database read open until nothing new is issued,
 * then releasing the whole batch at once. Returns one entry per round with how
 * many reads were in flight together.
 */
async function roundsOf<T>(work: () => Promise<T>): Promise<{ rounds: number[]; result: T }> {
    let waiting: Array<() => void> = [];

    (global as any).mockFirestoreGet.mockImplementation(
        () => new Promise((resolve) => { waiting.push(() => resolve(EMPTY)); }),
    );
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(EMPTY));

    let settled = false;
    const promise = work().then((v) => { settled = true; return v; });

    const rounds: number[] = [];
    for (let guard = 0; guard < 40 && !settled; guard++) {
        await settleQueues();
        if (settled || waiting.length === 0) break;
        rounds.push(waiting.length);
        const batch = waiting;
        waiting = [];
        for (const release of batch) release();
    }

    await settleQueues();
    return { rounds, result: await promise };
}

describe('the admin dashboard is one wave of reads, not seven', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deployed.moduleCountsRpc = true;
    });

    it('FINISHES IN ONE ROUND OF DATABASE READS', async () => {
        const { AnalyticsService } = await import('@/services/analytics.service');
        const { rounds } = await roundsOf(() => new AnalyticsService().getDashboardStats());

        //   MEASURED BOTH WAYS on this branch, against the same 31 reads:
        //
        //       before   [5, 11, 1, 6, 6, 1, 1]   seven rounds
        //       after    [31]                      one
        //
        //   Named rather than compared bare, so a regression prints the shape
        //   it regressed into rather than just a number.
        expect({ waves: rounds.length, perWave: rounds }).toEqual({ waves: 1, perWave: [31] });
    });

    it('AND THE READS ARE STILL ALL THERE — this did not get fast by asking less', async () => {
        const { AnalyticsService } = await import('@/services/analytics.service');
        const { rounds } = await roundsOf(() => new AnalyticsService().getDashboardStats());

        //   THE CONTROL. A method that collapsed to one round by dropping
        //   twenty queries would pass the assertion above and be a worse
        //   dashboard. The first round carries the great majority of the work.
        //   THE CONTROL. A method that collapsed to one round by dropping
        //   twenty queries would pass the assertion above and be a worse
        //   dashboard. Thirty-one is what the seven-wave version issued, summed
        //   across its rounds: the same questions, asked at the same time.
        const total = rounds.reduce((a, b) => a + b, 0);
        expect({ totalReads: total }).toEqual({ totalReads: 31 });
    });

    it('AND THE DATE-FILTERED BRANCH IS ONE ROUND TOO', async () => {
        //   The other branch, which starts a windowed user count the plain one
        //   does not — and must not start the plain metrics call beside it, or
        //   it pays for both. One round, and FEWER reads than the plain path,
        //   because the filtered metrics call is the only one issued.
        const { AnalyticsService } = await import('@/services/analytics.service');
        const { rounds } = await roundsOf(() =>
            new AnalyticsService().getDashboardStats({ dateFrom: '2026-01-01', dateTo: '2026-06-30' }),
        );

        expect({ waves: rounds.length }).toEqual({ waves: 1 });
    });

    it('AND WITHOUT MIGRATION 049 IT COSTS EXACTLY ONE EXTRA WAVE — the degradation, measured', async () => {
        /*
         *   #909's fallback. `count_module_registrations` replaces eight
         *   sequential scans of `users` with one, and a deploy that lands
         *   before its migration must be SLOW rather than BROKEN — migration
         *   022's nine indexes were absent from production for months, so that
         *   is the normal case here, not the exception.
         *
         *   Two waves, not seven: the fallback is one extra round trip, and it
         *   is the only thing the missing function costs in shape. What it
         *   costs in WORK is the 822x in that migration's header.
         */
        deployed.moduleCountsRpc = false;

        const { AnalyticsService } = await import('@/services/analytics.service');
        const { rounds, result } = await roundsOf(() => new AnalyticsService().getDashboardStats());

        expect({ waves: rounds.length }).toEqual({ waves: 2 });

        /*
         *   AND THE PAYLOAD STILL ARRIVES WHOLE. A fallback that threw, or
         *   returned nothing, would also be two waves.
         *
         *   `moduleUsage` is asserted as a non-empty array rather than
         *   `length >= 0` — which is true of every array and was caught by
         *   #705's tautology ratchet on the first draft of this line. The
         *   service substitutes a "No data yet" entry when every module counts
         *   zero, which is what this deployment-less fixture produces, so an
         *   empty array here would mean the chart renders nothing at all.
         */
        expect({
            revenueMonths: result.revenueByMonth.length,
            growthMonths: result.userGrowthByMonth.length,
            moduleUsageEntries: result.moduleUsage.length > 0,
            totalUsersIsANumber: typeof result.platformOverview.totalUsers === 'number',
        }).toEqual({
            revenueMonths: 6,
            growthMonths: 6,
            moduleUsageEntries: true,
            totalUsersIsANumber: true,
        });
    });

    it('AND IT STILL RETURNS A WHOLE PAYLOAD', async () => {
        const { AnalyticsService } = await import('@/services/analytics.service');
        const { result } = await roundsOf(() => new AnalyticsService().getDashboardStats());

        //   Six months of each series, both charts present, headline figures
        //   readable. A restructuring that dropped a series would otherwise
        //   sail past both assertions above.
        expect({
            revenueMonths: result.revenueByMonth.length,
            growthMonths: result.userGrowthByMonth.length,
            hasOverview: typeof result.platformOverview.totalUsers === 'number',
            hasSegments: !!result.userSegments,
        }).toEqual({
            revenueMonths: 6,
            growthMonths: 6,
            hasOverview: true,
            hasSegments: true,
        });
    });
});
