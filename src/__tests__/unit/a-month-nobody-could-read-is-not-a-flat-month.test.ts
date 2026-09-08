/**
 * @jest-environment node
 */

/**
 *   #517 A MONTH NOBODY COULD READ WAS DRAWN AS A MONTH WITH NO SALES — AND
 *        THEN THE SERIES DECLARED ITSELF EXACT.
 *
 *   getDashboardStats builds the revenue chart from six per-month aggregates.
 *   The catch around each one returned
 *
 *       { month: label, revenue: 0 }
 *
 *   so one aggregate timing out put a zero bar on the admin dashboard, which is
 *   indistinguishable from a month in which nothing was sold. And five lines
 *   after that loop:
 *
 *       // Per-month database aggregates are exact, so this path is complete.
 *       monthlyRevenueIsPartial = false;
 *
 *   A claim about completeness, made unconditionally, directly beneath the code
 *   that silently drops whole months. THE FLAG EXISTED FOR EXACTLY THIS and was
 *   hard-coded to the wrong value on the one path that needed it — the fallback
 *   path, which is the path taken whenever Paystack is unreachable, which is
 *   also when the database is most likely to be having a bad day.
 *
 *   The user-growth series had the same shape one function down —
 *   `catch (_e) { return { month: label, users: 0 } }`, with no logger at all —
 *   so a failed count drew a month in which nobody joined.
 *
 *   Both keep the zero, so the chart still has six bars and its shape. What
 *   changes is that the months which could not be read are NAMED, and the
 *   "partial" flag is now earned rather than asserted.
 *
 * ── AND THE CONTRACT EXISTED TWICE ──────────────────────────────────────────
 *
 *   AnalyticsData and FinancialOverview were declared in
 *   packages/services/src/contracts.ts AND in actions/admin-analytics.ts — two
 *   hand-maintained copies, character for character, which a diff confirmed were
 *   IDENTICAL. That is exactly the state lib/recent-activity.ts describes a
 *   duplicate sitting in: "right up until somebody changes one of them."
 *
 *   Adding the two fields above made me that somebody. The service implements
 *   the package's contract; the dashboard imported the other copy; the build
 *   failed. It failed LOUDLY, which was luck — these fields are optional, and a
 *   widened optional field on the copy nobody imports produces no error at all,
 *   just a value that silently never arrives. actions/admin-analytics.ts
 *   re-exports the package's types now; callers importing from it are unchanged.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   `activeUsers` counts users whose `updatedAt` is within 30 days, and every
 *   write to a user row touches `updatedAt` — so I expected to find a metric
 *   measuring admin activity rather than member activity. It is NOT a defect:
 *   lib/recent-activity.ts is this platform's stated rule for the question, and
 *   its header argues the key deliberately — "it is a NATIVE column on users and
 *   every write touches it, so it is the only field on the row that actually
 *   tracks activity", with nothing writing `lastLoginAt`. The query here agrees
 *   with that rule. It hand-writes the 30 instead of reading
 *   RECENT_ACTIVITY_DAYS, which is worth knowing and is not worth a finding.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     monthlyRevenueIsPartial hard-coded false again  KILLED
 *     a failed revenue month not named                KILLED
 *     a failed user-growth month not named            KILLED
 *     the user-growth catch silent again              KILLED
 *     the default branch back to Promise.all          KILLED
 *     reword this header                              SURVIVED, as intended
 *
 * ── ONE MORE, FOUND WHILE BUILDING THE TEST ─────────────────────────────────
 *
 *   My first failure-injection broke every USERS count, and two assertions blew
 *   up rather than failing — which was the instrument telling me something. The
 *   date-filtered branch reads its metrics through Promise.allSettled, with the
 *   comment "A rejected metrics call is not zero revenue, it is no answer". The
 *   DEFAULT branch used Promise.all, so the same failure threw out of
 *   getDashboardStats and took the charts, the counts and the module usage with
 *   it. The more robust of the two paths was the one behind a filter, and the
 *   plain page load was the fragile one. Both use allSettled now.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

/**
 * The four segment counters come from a Postgres function through a REAL
 * Supabase client, not through the db adapter the fake replaces. Unmocked, this
 * test opens a network connection, hangs for 25 seconds and then imports after
 * teardown. Its correctness is held by
 * pg/the-sql-segments-agree-with-the-javascript.test.ts, which classifies the
 * same documents in SQL and in JavaScript — this finding is about the two
 * monthly series, so the RPC just answers.
 */
jest.mock('@/lib/supabase', () => {
    // .from('users').select(..).or(..) is a chainable builder that is awaited
    // for { count, error }. Every method returns the builder; the builder is
    // thenable.
    const builder: any = new Proxy(
        {
            then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
        },
        {
            get(target, prop) {
                if (prop in target) return (target as any)[prop];
                return () => builder;
            },
        },
    );
    return {
        supabaseAdmin: {
            rpc: async () => ({ data: [{ active: 1, pending: 0, stalled: 0, ghost: 0 }], error: null }),
            from: () => builder,
        },
    };
});

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    // No Paystack key: the service takes the database fallback, which is the
    // path this finding is about and the only one a test can exercise honestly.
    delete process.env.PAYSTACK_SECRET_KEY;
});

const stats = async () => {
    const { AnalyticsService } = await import('@/services/analytics.service');
    return (await new AnalyticsService().getDashboardStats()) as any;
};

/**
 * Fail reads of one collection by KIND, leaving everything else working.
 *
 * The revenue series reads PROCESSED_PAYMENTS with an aggregate; the user
 * series reads USERS with a count. Breaking a whole collection would take other
 * figures down with it and prove less.
 */
function breakReads(collection: string, kind: string, needFilters = false): void {
    const g = globalThis as any;
    const real = g.mockFirestoreGet.getMockImplementation();
    g.mockFirestoreGet.mockImplementation((...args: any[]) => {
        const d = g.__firestoreAccess;
        const filtered = (d?.query?.filters?.length ?? 0) > 0;
        if (d?.collection === collection && d?.kind === kind && (!needFilters || filtered)) {
            return Promise.reject(new Error('canceling statement due to statement timeout'));
        }
        return real(...args);
    });
}

const code = () => stripComments(
    readFileSync('src/services/analytics.service.ts', 'utf-8'),
    { label: 'analytics.service.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#517 — the revenue chart', () => {
    it('A MONTH THAT COULD NOT BE READ IS NAMED', async () => {
        //   THE test. A zero bar and a bar nobody could draw look identical, and
        //   only one of them is a fact about the business.
        breakReads(COLLECTIONS.PROCESSED_PAYMENTS, 'aggregate');

        const res = await stats();

        expect(res.unavailableMonths.length).toBeGreaterThan(0);
        expect(res.monthlyRevenueIsPartial).toBe(true);
    });

    it('AND THE SERIES NO LONGER CALLS ITSELF EXACT WHEN IT IS NOT', async () => {
        //   `monthlyRevenueIsPartial = false` was set unconditionally, five
        //   lines below the catch that drops months.
        breakReads(COLLECTIONS.PROCESSED_PAYMENTS, 'aggregate');

        expect((await stats()).monthlyRevenueIsPartial).toBe(true);
    });

    it('AND THE CHART STILL HAS ITS SIX BARS', async () => {
        //   The zero stays deliberately: a chart that loses a month changes
        //   shape, and the point is to label the bar, not to remove it.
        breakReads(COLLECTIONS.PROCESSED_PAYMENTS, 'aggregate');

        const res = await stats();
        expect(res.revenueByMonth).toHaveLength(6);
        expect(res.revenueByMonth.every((m: any) => typeof m.revenue === 'number')).toBe(true);
    });

    it('and a healthy read names nothing and is not partial', async () => {
        //   The control. A fix that always reported "partial" would satisfy
        //   every assertion above and tell an admin nothing.
        const res = await stats();

        expect(res.unavailableMonths).toEqual([]);
        expect(res.monthlyRevenueIsPartial).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#517 — the user growth chart', () => {
    it('A MONTH THAT COULD NOT BE COUNTED IS NAMED', async () => {
        //   Same shape, one function down, and its catch had no logger at all.
        breakReads(COLLECTIONS.USERS, 'count', true);

        const res = await stats();

        expect(res.userGrowthIsPartial).toBe(true);
        expect(res.unavailableMonths.length).toBeGreaterThan(0);
    });

    it('AND THE SERIES STILL RENDERS', async () => {
        breakReads(COLLECTIONS.USERS, 'count', true);

        expect((await stats()).userGrowthByMonth).toHaveLength(6);
    });

    it('and a healthy read is not partial', async () => {
        expect((await stats()).userGrowthIsPartial).toBe(false);
    });

    it('and neither catch is silent any more', () => {
        //   #308's class. The user-growth catch was `catch (_e)` with no log, so
        //   a month vanishing left no trace anywhere.
        const body = code();

        expect(body).toContain('[DashboardStats] monthly revenue aggregate failed');
        expect(body).toContain('[DashboardStats] user growth count failed');
        expect(body).not.toMatch(/catch \(_e\) \{\s*return \{ month: label, users: 0 \}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#517 — one failure does not take the whole dashboard down', () => {
    it('A FAILED METRICS CALL LEAVES THE REST OF THE PAGE STANDING', async () => {
        //   Found while narrowing the break above, which is why it is here: the
        //   date-filtered branch uses Promise.allSettled and says "A rejected
        //   metrics call is not zero revenue, it is no answer", while the
        //   DEFAULT branch used Promise.all — so the same failure threw out of
        //   getDashboardStats and took the charts, the counts and the module
        //   usage with it. The more robust branch was the one behind a filter.
        breakReads(COLLECTIONS.USERS, 'count');

        const res = await stats();

        expect(res.platformOverview.revenueAvailable).toBe(false);
        // The figures that DID read are still here.
        expect(res.revenueByMonth).toHaveLength(6);
        expect(res.counts).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#517 — the dashboard says which bars are not readings', () => {
    const page = () => stripComments(
        readFileSync('src/app/admin/DashboardClient.tsx', 'utf-8'),
        { label: 'DashboardClient.tsx' },
    );

    it('IT NAMES THE MONTHS IT COULD NOT READ', () => {
        //   Pinned on source, and the reason stated: this is a client component
        //   fed by a server action, so rendering it here would assert on the
        //   mock. The behaviour is asserted on the service above; this pins that
        //   the screen reads the distinction the service now draws.
        const src = page();

        expect(src).toContain('stats.unavailableMonths');
        expect(src).toMatch(/could not be read/);
        expect(src).toMatch(/not because there was no activity/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#517 — one contract, not two', () => {
    it('admin-analytics RE-EXPORTS THE PACKAGE TYPES RATHER THAN RESTATING THEM', () => {
        //   The copies were identical until this finding widened one of them.
        //   These fields are OPTIONAL, so the next divergence would not fail the
        //   build — it would just never arrive.
        const src = stripComments(
            readFileSync('src/app/actions/admin-analytics.ts', 'utf-8'),
            { label: 'admin-analytics.ts' },
        );

        expect(src).toContain('from "@easy-sales/services"');
        expect(src).not.toMatch(/export interface AnalyticsData\b/);
        expect(src).not.toMatch(/export interface FinancialOverview\b/);
    });

    it('AND THE PACKAGE CONTRACT CARRIES THE NEW FIELDS', () => {
        const src = readFileSync('packages/services/src/contracts.ts', 'utf-8');

        expect(src).toContain('userGrowthIsPartial?: boolean;');
        expect(src).toContain('unavailableMonths?: string[];');
    });
});
