/**
 * @jest-environment node
 */

/**
 * The cooperative's money totals were sums over a silently capped query.
 *
 * The adapter caps a `.get()` that carries no `.limit()` at
 * DEFAULT_QUERY_LIMIT — 5,000 rows — and returns them looking exactly like a
 * complete result. Three aggregations read cooperative_transactions and
 * cooperative_loans that way:
 *
 *   getCooperativeStatsAction     totalContributions, totalSavings,
 *                                 totalTransactionAmount, totalLoans, and the
 *                                 30/60-day buckets behind monthlyGrowth
 *   getContributionReportsAction  totalContributions, memberCount,
 *                                 averageContribution, topContributors, and
 *                                 every month of the six-month trend
 *
 * So on the day cooperative_transactions passed five thousand rows, the admin
 * dashboard began under-reporting the cooperative's money — with nothing on the
 * screen to say so, and no figure moving in a way anybody would notice. The
 * rows dropped are arbitrary: there is no orderBy on either query.
 *
 * `.all()` is the adapter's own answer for a caller that genuinely needs every
 * row, and an aggregation is exactly that. It reports at error level if it hits
 * its far higher runaway ceiling, and the snapshot's `truncated` flag is passed
 * out in the payload so a partial total can be told from a complete one by the
 * caller rather than only in a log.
 *
 * AND THE MEMBER'S "RECENT TRANSACTIONS" WERE NOT THE RECENT ONES
 * ---------------------------------------------------------------
 * getDashboardDataAction fetched fifty transactions with no ordering — the note
 * said the orderBy had been removed "to bypass missing index error while index
 * is provisioning" — then sorted those fifty in memory and showed the newest
 * ten. Truncating before sorting is only safe when the truncation is itself
 * ordered. For a member with more than fifty transactions the dashboard's
 * recent activity could be entirely stale while newer entries existed.
 *
 * The index was not a live concern: the two other readers of this exact
 * collection order by this exact field, with no fallback, today.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPORTS = 'src/app/actions/cooperative/_coop_admin_reports.ts';
const DASHBOARD = 'src/app/actions/cooperative/_dashboard.ts';
const MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const ADMIN_MONEY = 'src/app/actions/cooperative/_coop_admin_money.ts';
const ADAPTER = 'src/lib/supabase-db.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

describe('the cap this is about is real', () => {
    it('an unbounded .get() stops at the default limit and says nothing to the caller', () => {
        // THE premise. Without this the aggregations would simply be slow.
        const adapter = code(ADAPTER);

        expect(adapter).toContain('this._limit ?? DEFAULT_QUERY_LIMIT');
        expect(adapter).toContain('was truncated');
    });

    it('while .all() exists precisely for a caller that needs every row', () => {
        const adapter = code(ADAPTER);

        expect(adapter).toContain('all(): this');
        expect(adapter).toContain('q._unbounded = true;');
    });
});

describe('the admin cooperative statistics', () => {
    const stats = fn(REPORTS, '_getCooperativeStatsAction');

    it('read every transaction, not the first five thousand', () => {
        // THE test.
        expect(stats).toContain('.select("type", "status", "amount", "date").all().get()');
    });

    it('and every loan', () => {
        expect(stats).toContain('await loansQuery.all().get()');
    });

    it('and report a partial total as partial', () => {
        expect(stats).toContain('const txnTruncated = Boolean((txnSnapshot as any).truncated);');
        expect(stats).toContain('const loansTruncated = Boolean((loansStream as any).truncated);');
        expect(stats).toContain('truncated: txnTruncated || loansTruncated,');
        expect(stats).toContain('understate the real figures');
    });

    it('which matters because these really are running sums', () => {
        // Vacuity guard: if the figures were computed by the database this
        // would be a performance note, not a correctness one.
        expect(stats).toContain('totalContributions += amount;');
        expect(stats).toContain('totalTransactionAmount += amount;');
        expect(stats).toContain('totalLoans += Number(l.amount) || 0;');
    });
});

describe('the contribution report', () => {
    const report = fn(REPORTS, 'getContributionReportsAction');

    it('reads every completed transaction', () => {
        expect(report).toContain('.select("type", "amount", "userId", "date", "paidAt").all().get()');
        expect(report).toContain('const reportTruncated = Boolean((stream as any).truncated);');
        expect(report).toContain('truncated: reportTruncated,');
    });

    it('and no longer advertises a month filter it never applied', () => {
        // `options?: { month, year }` sat on the signature and was read nowhere
        // in the body, while the Redis key carried no month either — so a caller
        // passing one got the all-time report, and would have got a CACHED
        // all-time report even after filtering was added.
        expect(report).not.toContain('month?: number');
        expect(code(REPORTS)).toContain('export async function getContributionReportsAction(): Promise<');
    });

    it('and its cache key still separates the scoped view from the global one', () => {
        // Vacuity guard: removing the parameter must not have loosened the key.
        expect(report).toContain('adminScope ? `admin:coop-reports:${adminScope}` : "admin:coop-reports:global"');
    });
});

describe("a member's recent transactions", () => {
    const dashboard = fn(DASHBOARD, 'getDashboardDataAction');

    it('are ordered by the database before they are truncated', () => {
        // THE test. Fifty arbitrary rows sorted in memory is not "the ten most
        // recent"; it is the ten most recent of an arbitrary fifty.
        expect(dashboard).toContain(".orderBy('date', 'desc')");

        const order = dashboard.indexOf(".orderBy('date', 'desc')");
        const limit = dashboard.indexOf('.limit(50)');
        expect(order).toBeGreaterThan(-1);
        expect(limit).toBeGreaterThan(order);
    });

    it('and the stale note about a provisioning index is gone', () => {
        const raw = readFileSync(join(process.cwd(), DASHBOARD), 'utf-8');

        expect(raw).not.toContain("Removed .orderBy('date') to bypass missing index error");
    });

    it('which was never a live constraint — its two siblings order the same field', () => {
        // Vacuity guard: if no other reader could order this collection, adding
        // the orderBy would be a guess rather than a correction.
        expect(code(MONEY)).toContain('.orderBy("date", "desc")');
        expect(code(ADMIN_MONEY)).toContain('q.orderBy("date", "desc")');
    });

    it('and the in-memory sort is kept as a belt, not relied on', () => {
        expect(dashboard).toContain('new Date(b.date).getTime() - new Date(a.date).getTime()');
    });
});
