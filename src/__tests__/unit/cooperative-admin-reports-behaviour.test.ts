/**
 * @jest-environment node
 */

/**
 * The cooperative admin dashboard's three read actions, EXECUTED — the stats
 * panel, the contribution report and the recent-activity feed.
 *
 * At 4.5%, and every number on that dashboard is a running sum over a query.
 * With a call-recorder harness the query returned whatever the test stubbed, so
 * a total could be summing the wrong field, over the wrong collection, for the
 * wrong cooperative, and nothing would say so. These run the arithmetic.
 *
 * WHAT THE MONEY TOTALS DEPEND ON
 * -------------------------------
 * Three things that are easy to get wrong and impossible to see from the
 * screen:
 *
 *   - Platform onboarding fees are EXCLUDED. `membership_registration` and
 *     `registration_fee` are money the platform took, not the cooperative's, and
 *     counting them inflates the cooperative's balance.
 *   - Only COMPLETED transactions move savings. A pending or failed
 *     contribution counts towards the transaction tally and towards nothing
 *     financial.
 *   - The queries use `.all()`, not `.get()`. A plain `.get()` stops at the
 *     adapter's 5,000-row cap and returns looking complete, so on the day the
 *     collection passed five thousand rows the dashboard would have begun
 *     under-reporting silently. `truncated` is surfaced in the payload so a
 *     partial total can be told from a complete one.
 *
 * ADMIN SCOPING IS AN IDOR BOUNDARY, NOT A CONVENIENCE
 * ----------------------------------------------------
 * A cooperative-scoped admin must see only their own cooperative's money. That
 * is asserted for all three actions, each with a global-admin control showing
 * the scoping is a filter and not an empty result.
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

const getCooperativeMemberMetrics = jest.fn(async (_scope?: string) => ({
    totalApplications: 12,
    paidMembersCount: 9,
    unpaidMembers: 3,
    pendingCount: 2,
    approvedCount: 8,
    suspendedCount: 1,
    orphanedPaymentsCount: 0,
}));
jest.mock('@/services', () => ({
    userMetricsService: {
        getCooperativeMemberMetrics: (scope?: string) => getCooperativeMemberMetrics(scope),
    },
}));

let store: FakeDbHandle;

const TXNS = COLLECTIONS.COOPERATIVE_TRANSACTIONS;
const LOANS = COLLECTIONS.COOPERATIVE_LOANS;

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    getCooperativeMemberMetrics.mockImplementation(async () => ({
        totalApplications: 12,
        paidMembersCount: 9,
        unpaidMembers: 3,
        pendingCount: 2,
        approvedCount: 8,
        suspendedCount: 1,
        orphanedPaymentsCount: 0,
    }));
    store = installFakeDb();
    actAs('admin-1');
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_admin_reports');
}

/** An ISO timestamp `daysAgo` days before now. */
function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
}

function seedTxn(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(TXNS, id, {
        type: 'contribution',
        status: 'completed',
        amount: 10000,
        userId: 'member-1',
        cooperativeId: 'coop-a',
        date: daysAgo(1),
        ...extra,
    });
}

const stats = async () => ((await (await actions()).getCooperativeStatsAction()) as any).data.stats;
const reports = async () => ((await (await actions()).getContributionReportsAction()) as any).data.reports;

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeStatsAction — who may read it', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getCooperativeStatsAction } = await actions();
        expect(await getCooperativeStatsAction()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['user'] });

        const { getCooperativeStatsAction } = await actions();
        expect(await getCooperativeStatsAction()).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('re-reads the roles from the database when the session is stale', async () => {
        // A promotion that has not reached the JWT yet. The session says user,
        // the record says admin, and the record wins — in the permissive
        // direction only, which is why the refusal above still holds.
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['admin'] });

        const { getCooperativeStatsAction } = await actions();
        expect(((await getCooperativeStatsAction()) as any).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeStatsAction — the money', () => {
    it('is all zeroes for a cooperative with no transactions', async () => {
        expect(await stats()).toMatchObject({
            totalContributions: 0, totalSavings: 0, totalLoans: 0,
            totalTransactions: 0, totalTransactionAmount: 0, monthlyGrowth: 0,
        });
    });

    it('carries the member counts straight from the metrics service', async () => {
        expect(await stats()).toMatchObject({
            totalMembers: 12, paidMembers: 9, unpaidMembers: 3,
            pendingMembers: 2, activeMembers: 8, suspendedMembers: 1,
        });
    });

    it('survives the metrics service failing, with zeroes rather than an error', async () => {
        getCooperativeMemberMetrics.mockImplementation(async () => { throw new Error('down'); });
        seedTxn('t1', { amount: 5000 });

        const s = await stats();
        expect(s.totalMembers).toBe(0);
        // ...and the financial half is still computed.
        expect(s.totalContributions).toBe(5000);
    });

    it('sums completed contributions into contributions AND savings', async () => {
        seedTxn('t1', { amount: 10000 });
        seedTxn('t2', { amount: 5000 });

        expect(await stats()).toMatchObject({ totalContributions: 15000, totalSavings: 15000 });
    });

    it('counts fixed savings towards savings but not contributions', async () => {
        seedTxn('t1', { type: 'fixed_savings', amount: 20000 });

        expect(await stats()).toMatchObject({ totalContributions: 0, totalSavings: 20000 });
    });

    it('subtracts a completed withdrawal from savings', async () => {
        seedTxn('t1', { type: 'contribution', amount: 30000 });
        seedTxn('t2', { type: 'withdrawal', amount: 12000 });

        expect(await stats()).toMatchObject({ totalContributions: 30000, totalSavings: 18000 });
    });

    it.each(['membership_registration', 'registration_fee'])(
        'EXCLUDES the platform onboarding fee %p entirely', async (type) => {
            // That is money the platform took, not the cooperative's. Counting
            // it inflates the cooperative's balance on the admin dashboard.
            seedTxn('fee', { type, amount: 25000 });
            seedTxn('real', { type: 'contribution', amount: 1000 });

            const s = await stats();
            expect(s.totalTransactions).toBe(1);
            expect(s.totalTransactionAmount).toBe(1000);
            expect(s.totalSavings).toBe(1000);
        });

    it('counts a pending or failed transaction, but moves no money', async () => {
        seedTxn('a', { status: 'pending', amount: 7000 });
        seedTxn('b', { status: 'failed', amount: 3000 });
        seedTxn('c', { status: 'completed', amount: 1000 });

        const s = await stats();
        expect(s).toMatchObject({
            totalTransactions: 3, completedTransactions: 1,
            pendingTransactions: 1, failedTransactions: 1,
        });
        expect(s.totalTransactionAmount).toBe(11000);
        expect(s.totalContributions).toBe(1000);
    });

    it('treats an unreadable amount as zero rather than NaN', async () => {
        seedTxn('a', { amount: 'lots' });
        seedTxn('b', { amount: 4000 });

        expect(await stats()).toMatchObject({ totalContributions: 4000 });
    });

    it('splits the last 30 days from the 30 before them, and reports the growth', async () => {
        seedTxn('recent', { amount: 15000, date: daysAgo(5) });
        seedTxn('previous', { amount: 10000, date: daysAgo(45) });
        seedTxn('ancient', { amount: 99000, date: daysAgo(200) });

        const s = await stats();
        expect(s.monthlyContributions).toBe(15000);
        expect(s.monthlyGrowth).toBe(50);
        // The ancient one still counts towards the all-time total.
        expect(s.totalContributions).toBe(124000);
    });

    it('reports zero growth rather than dividing by zero', async () => {
        seedTxn('recent', { amount: 15000, date: daysAgo(5) });

        expect(await stats()).toMatchObject({ monthlyGrowth: 0, monthlyContributions: 15000 });
    });

    it('reports a NEGATIVE growth honestly', async () => {
        seedTxn('recent', { amount: 5000, date: daysAgo(5) });
        seedTxn('previous', { amount: 10000, date: daysAgo(45) });

        expect(await stats()).toMatchObject({ monthlyGrowth: -50 });
    });

    it('ignores a contribution with no date, for the monthly split only', async () => {
        seedTxn('undated', { amount: 8000, date: undefined });

        const s = await stats();
        expect(s.totalContributions).toBe(8000);
        expect(s.monthlyContributions).toBe(0);
    });

    it('sums the loan book and counts it by state', async () => {
        store.seedAll(LOANS, {
            a: { memberId: 'm1', amount: 100000, status: 'disbursed', cooperativeId: 'coop-a' },
            b: { memberId: 'm2', amount: 50000, status: 'approved', cooperativeId: 'coop-a' },
            c: { memberId: 'm3', amount: 25000, status: 'pending', cooperativeId: 'coop-a' },
            d: { memberId: 'm4', amount: 10000, status: 'rejected', cooperativeId: 'coop-a' },
        });

        expect(await stats()).toMatchObject({
            totalLoans: 185000, activeLoans: 2, pendingLoans: 1,
        });
    });

    it('reports truncated:false when nothing was dropped', async () => {
        seedTxn('t1');
        expect((await stats()).truncated).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeStatsAction — admin scoping', () => {
    it('a scoped admin sees only their own cooperative\'s money', async () => {
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });
        seedTxn('mine', { cooperativeId: 'coop-a', amount: 1000 });
        seedTxn('theirs', { cooperativeId: 'coop-b', amount: 999999 });
        store.seedAll(LOANS, {
            mine: { amount: 5000, status: 'disbursed', cooperativeId: 'coop-a' },
            theirs: { amount: 500000, status: 'disbursed', cooperativeId: 'coop-b' },
        });

        const s = await stats();
        expect(s.totalContributions).toBe(1000);
        expect(s.totalLoans).toBe(5000);
    });

    it('and the metrics service is asked for that scope too', async () => {
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });

        await stats();
        expect(getCooperativeMemberMetrics).toHaveBeenCalledWith('coop-a');
    });

    it('a super_admin sees every cooperative — the scoping is a filter, not an empty result', async () => {
        actAs('admin-1', ['super_admin']);
        seedTxn('mine', { cooperativeId: 'coop-a', amount: 1000 });
        seedTxn('theirs', { cooperativeId: 'coop-b', amount: 2000 });

        expect((await stats()).totalContributions).toBe(3000);
        expect(getCooperativeMemberMetrics).toHaveBeenCalledWith(undefined);
    });

    it('an admin with no cooperativeId is global', async () => {
        actAs('admin-2', ['admin']);
        seedTxn('a', { cooperativeId: 'coop-a', amount: 1000 });
        seedTxn('b', { cooperativeId: 'coop-b', amount: 2000 });

        expect((await stats()).totalContributions).toBe(3000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getContributionReportsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getContributionReportsAction } = await actions();
        expect(await getContributionReportsAction()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['user'] });

        const { getContributionReportsAction } = await actions();
        expect(await getContributionReportsAction()).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('is empty, not an error, for a cooperative with no contributions', async () => {
        const r = await reports();
        expect(r).toMatchObject({
            totalContributions: 0, memberCount: 0, averageContribution: 0,
        });
        expect(r.topContributors).toEqual([]);
        expect(r.monthlyTrend).toHaveLength(6);
    });

    it('counts CONTRIBUTORS, not transactions, for the member count', async () => {
        // The average is per member, so counting rows would understate it for
        // anybody who contributed twice.
        seedTxn('a', { userId: 'm1', amount: 1000 });
        seedTxn('b', { userId: 'm1', amount: 3000 });
        seedTxn('c', { userId: 'm2', amount: 2000 });

        const r = await reports();
        expect(r.totalContributions).toBe(6000);
        expect(r.memberCount).toBe(2);
        expect(r.averageContribution).toBe(3000);
    });

    it('counts only contributions, ignoring every other transaction type', async () => {
        seedTxn('a', { type: 'contribution', amount: 1000 });
        seedTxn('b', { type: 'fixed_savings', amount: 90000 });
        seedTxn('c', { type: 'withdrawal', amount: 500 });
        seedTxn('d', { type: 'membership_registration', amount: 25000 });

        expect((await reports()).totalContributions).toBe(1000);
    });

    it('ignores a contribution that never completed', async () => {
        seedTxn('a', { status: 'pending', amount: 50000 });
        seedTxn('b', { status: 'completed', amount: 1000 });

        expect((await reports()).totalContributions).toBe(1000);
    });

    it('ranks the top contributors by total, largest first, capped at ten', async () => {
        const rows: Record<string, Record<string, unknown>> = {};
        for (let n = 1; n <= 12; n++) {
            rows[`t${n}`] = {
                type: 'contribution', status: 'completed', amount: n * 1000,
                userId: `member-${n}`, cooperativeId: 'coop-a', date: daysAgo(1),
            };
        }
        store.seedAll(TXNS, rows);

        const top = (await reports()).topContributors;
        expect(top).toHaveLength(10);
        expect(top[0]).toMatchObject({ userId: 'member-12', total: 12000 });
        expect(top[9]).toMatchObject({ userId: 'member-3', total: 3000 });
    });

    it('does not credit a contribution that names no member', async () => {
        seedTxn('a', { userId: undefined, amount: 5000 });

        const r = await reports();
        // It still counts towards the total — the money was contributed — but
        // it cannot be attributed to anybody.
        expect(r.totalContributions).toBe(5000);
        expect(r.memberCount).toBe(0);
        expect(r.topContributors).toEqual([]);
    });

    it('buckets the last six months, and drops anything older', async () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
        const twoMonthsBack = new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString();
        const tooOld = new Date(now.getFullYear(), now.getMonth() - 9, 15).toISOString();

        seedTxn('a', { amount: 1000, date: thisMonth });
        seedTxn('b', { amount: 2000, date: twoMonthsBack });
        seedTxn('c', { amount: 9000, date: tooOld });

        const r = await reports();
        const total = r.monthlyTrend.reduce((sum: number, b: any) => sum + b.amount, 0);
        expect(total).toBe(3000);
        // ...while the all-time total keeps the old one.
        expect(r.totalContributions).toBe(12000);
        expect(r.monthlyTrend[5].amount).toBe(1000);
        expect(r.monthlyTrend[3].amount).toBe(2000);
    });

    it('prefers the Paystack-sourced paidAt over the date field', async () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
        const longAgo = new Date(now.getFullYear() - 2, 0, 15).toISOString();

        seedTxn('a', { amount: 4000, paidAt: thisMonth, date: longAgo });

        expect((await reports()).monthlyTrend[5].amount).toBe(4000);
    });

    it('a scoped admin reports only their own cooperative', async () => {
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });
        seedTxn('mine', { cooperativeId: 'coop-a', amount: 1000, userId: 'm1' });
        seedTxn('theirs', { cooperativeId: 'coop-b', amount: 999999, userId: 'm2' });

        const r = await reports();
        expect(r.totalContributions).toBe(1000);
        expect(r.memberCount).toBe(1);
    });

    it('and a global admin sees both', async () => {
        seedTxn('a', { cooperativeId: 'coop-a', amount: 1000, userId: 'm1' });
        seedTxn('b', { cooperativeId: 'coop-b', amount: 2000, userId: 'm2' });

        expect((await reports()).totalContributions).toBe(3000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getRecentActivityAction', () => {
    const activity = async () =>
        ((await (await actions()).getRecentActivityAction()) as any).data.activities;

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getRecentActivityAction } = await actions();
        expect(await getRecentActivityAction()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['user'] });

        const { getRecentActivityAction } = await actions();
        expect(await getRecentActivityAction()).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('is an empty list, not an error, when nothing has happened', async () => {
        expect(await activity()).toEqual([]);
    });

    it('lists the most recent first, and stops at ten', async () => {
        const rows: Record<string, Record<string, unknown>> = {};
        for (let n = 1; n <= 15; n++) {
            rows[`t${n}`] = {
                type: 'contribution', status: 'completed', amount: 1000,
                userId: 'm1', cooperativeId: 'coop-a', date: daysAgo(n),
            };
        }
        store.seedAll(TXNS, rows);

        const list = await activity();
        expect(list).toHaveLength(10);
        expect(new Date(list[0].timestamp).getTime())
            .toBeGreaterThan(new Date(list[9].timestamp).getTime());
    });

    it('describes each entry with its type and amount', async () => {
        seedTxn('t1', { type: 'contribution', amount: 12500, userId: 'm7' });

        const [entry] = await activity();
        expect(entry).toMatchObject({ type: 'contribution', userId: 'm7' });
        expect(entry.description).toContain('12,500');
    });

    it('includes transactions of every status — this is activity, not money', async () => {
        seedTxn('a', { status: 'failed', amount: 1000 });
        expect(await activity()).toHaveLength(1);
    });

    it('a scoped admin sees only their own cooperative\'s activity', async () => {
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });
        seedTxn('mine', { cooperativeId: 'coop-a', userId: 'm1' });
        seedTxn('theirs', { cooperativeId: 'coop-b', userId: 'm2' });

        const list = await activity();
        expect(list).toHaveLength(1);
        expect(list[0].userId).toBe('m1');
    });

    it('and a global admin sees both', async () => {
        seedTxn('a', { cooperativeId: 'coop-a', userId: 'm1', date: daysAgo(1) });
        seedTxn('b', { cooperativeId: 'coop-b', userId: 'm2', date: daysAgo(2) });

        expect(await activity()).toHaveLength(2);
    });
});
