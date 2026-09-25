/**
 * @jest-environment jsdom
 */

/**
 *   #925 THREE ADMIN CHARTS NO TEST HAD NAMED, AND THE PAGE'S OWN COMMENT GAVE
 *   THE FIRST ONE AWAY.
 *
 *   src/app/admin/analytics/page.tsx, two elements after it renders
 *   AnalyticsCharts:
 *
 *       <div></div> {/* Spacer since Module Usage is now handled by
 *                      AnalyticsCharts inside its own grid *\/}
 *
 *   The page deleted its module-usage chart, left an empty div where it had been,
 *   and passed `moduleUsage={moduleUsage}` to a component whose interface declared
 *   the prop and whose body never destructured it. The move happened halfway: the
 *   space was made, the data was handed over, nothing drew it.
 *
 *   THE SERIES IS REAL, and analytics.service goes out of its way to keep it
 *   drawable — nine `{ module, count }` rows from the canonical registration
 *   stats, zeroes filtered, and `[{ module: "No data yet", count: 1 }]` rather
 *   than an empty array when there is nothing, which is a deliberate "so the chart
 *   has something to show". Nothing showed it.
 *
 *   Rendered now, as a card in the grid the page already accounted for. Optional
 *   and conditional: admin/DashboardClient passes the other two props and not this
 *   one, and must not gain a blank third card.
 *
 * ── AND THE SAME MONEY, SHOWN TWO WAYS ──────────────────────────────────────
 *
 *   ContributionTrendChart and DashboardLineChart read the SAME series —
 *   `reports.monthlyTrend` from getCooperativeReportsAction, `{ month, amount }`
 *   where amount is naira. The bar chart on /admin/cooperatives/contributions
 *   formatted it; the line chart on /admin/cooperatives/dashboard did not. One
 *   admin, two screens, "₦1,240,000" on one and "1240000" on the other with
 *   nothing to say it was money rather than a count of contributions.
 *
 *   AnalyticsCharts already states the platform's rule and is the reason this is a
 *   defect rather than a preference: its REVENUE chart formats and its USER GROWTH
 *   chart deliberately does not. A money series gets formatCurrency. This is one.
 *
 * ── AND A MIRROR-IMAGE PAIR OF GUARDS, RECORDED ─────────────────────────────
 *
 *   ContributionTrendChart guards empty data ITSELF and its caller passes
 *   `reports?.monthlyTrend` unguarded — so the component's guard is load-bearing.
 *   DashboardLineChart is the exact mirror: no guard of its own, and its caller
 *   checks `length > 0` before rendering it. Each has one half. Neither is broken
 *   today and both are pinned, because the halves are one edit apart from being
 *   swapped.
 *
 *   `jest` is the GLOBAL here, per #392.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { formatCurrency } from '@/lib/utils';

/*
 *   recharts measures its container, and jsdom reports every element as 0×0 — so
 *   ResponsiveContainer renders NOTHING and every assertion about a bar or a line
 *   would be vacuous. Given an explicit size it renders. This is the fifth harness
 *   gap this audit has had to close, and the same shape as the others: without it
 *   a correct chart and a missing one look identical from the assertion's side.
 */
jest.mock('recharts', () => {
    const actual = jest.requireActual('recharts') as any;
    return {
        ...actual,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
            <actual.ResponsiveContainer width={800} height={300}>{children}</actual.ResponsiveContainer>
        ),
    };
});

import AnalyticsCharts from '@/components/admin/AnalyticsCharts';
import ContributionTrendChart from '@/components/admin/ContributionTrendChart';
import DashboardLineChart from '@/components/admin/DashboardLineChart';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const ANALYTICS = 'src/components/admin/AnalyticsCharts.tsx';
const BAR = 'src/components/admin/ContributionTrendChart.tsx';
const LINE = 'src/components/admin/DashboardLineChart.tsx';
const ANALYTICS_PAGE = 'src/app/admin/analytics/page.tsx';
const COOP_DASHBOARD = 'src/app/admin/cooperatives/dashboard/page.tsx';
const COOP_CONTRIBUTIONS = 'src/app/admin/cooperatives/contributions/page.tsx';

const REVENUE = [{ month: 'Jan', revenue: 1_240_000 }, { month: 'Feb', revenue: 980_000 }];
const USERS = [{ month: 'Jan', users: 41 }, { month: 'Feb', users: 58 }];
const MODULES = [
    { module: 'WAVE Apps', count: 12 },
    { module: 'Academy', count: 7 },
    { module: 'Export Onboarding', count: 3 },
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#925 — the chart the page made room for', () => {
    it('THE CONTROL: the two charts that always worked still render', () => {
        //   If recharts drew nothing under jsdom, every assertion below would pass
        //   for the wrong reason.
        render(<AnalyticsCharts revenueByMonth={REVENUE} userGrowthByMonth={USERS} />);

        expect(screen.getByText('Revenue Trend (6 Months)')).toBeTruthy();
        expect(screen.getByText('User Growth (6 Months)')).toBeTruthy();
    });

    it('THE DEFECT: module usage is drawn when the data is passed', () => {
        render(
            <AnalyticsCharts
                revenueByMonth={REVENUE} userGrowthByMonth={USERS} moduleUsage={MODULES} />);

        expect(screen.getByText('Module Usage')).toBeTruthy();
        //   The category labels, which is the whole content of the chart.
        for (const { module } of MODULES) {
            expect(screen.getByText(module)).toBeTruthy();
        }
    });

    it('and NOT drawn when a caller does not pass it', () => {
        //   admin/DashboardClient passes revenue and users only, and must not gain
        //   an empty third card.
        render(<AnalyticsCharts revenueByMonth={REVENUE} userGrowthByMonth={USERS} />);

        expect(screen.queryByText('Module Usage')).toBeNull();
    });

    it('nor for an empty series, which the service never sends anyway', () => {
        render(
            <AnalyticsCharts revenueByMonth={REVENUE} userGrowthByMonth={USERS} moduleUsage={[]} />);

        expect(screen.queryByText('Module Usage')).toBeNull();
    });

    it('draws the service\'s "No data yet" row rather than an empty card', () => {
        //   analytics.service substitutes this instead of an empty array,
        //   deliberately. Now something renders it.
        render(
            <AnalyticsCharts
                revenueByMonth={REVENUE} userGrowthByMonth={USERS}
                moduleUsage={[{ module: 'No data yet', count: 1 }]} />);

        expect(screen.getByText('No data yet')).toBeTruthy();
    });

    it('and the page still passes it, which is what made this findable', () => {
        const page = code(ANALYTICS_PAGE);

        expect(page).toContain('moduleUsage={moduleUsage}');
        expect(code(ANALYTICS)).toContain('userGrowthByMonth, moduleUsage }');
    });

    it('the service still produces the series it is drawn from', () => {
        const service = code('src/services/analytics.service.ts');

        expect(service).toContain('module: "WAVE Apps"');
        expect(service).toContain('moduleUsage.length ? moduleUsage : [{ module: "No data yet", count: 1 }]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#925 — money is shown as money on both cooperative screens', () => {
    const TREND = [{ month: 'Jan', amount: 1_240_000 }, { month: 'Feb', amount: 980_000 }];

    it('THE CONTROL: both charts render the same series', () => {
        const bar = render(<ContributionTrendChart monthlyTrend={TREND} />);
        expect(bar.container.querySelector('.recharts-bar')).toBeTruthy();
        bar.unmount();

        const line = render(<DashboardLineChart monthlyTrend={TREND} />);
        expect(line.container.querySelector('.recharts-line')).toBeTruthy();
    });

    it('and BOTH now format the tooltip as currency', () => {
        //   The rule AnalyticsCharts already states: a money series gets
        //   formatCurrency. Asserted at source because a recharts tooltip only
        //   exists once a pointer hovers it, which jsdom has no way to do.
        const formatter = 'formatter={(value: any) => formatCurrency(value)}';

        expect(code(BAR)).toContain(formatter);
        expect(code(LINE)).toContain(formatter);
    });

    it('and the money rule is the one AnalyticsCharts draws, not a new one', () => {
        const analytics = code(ANALYTICS);
        const revenue = analytics.slice(analytics.indexOf('Revenue Trend'), analytics.indexOf('User Growth'));
        const growth = analytics.slice(analytics.indexOf('User Growth'), analytics.indexOf('Module Usage'));

        //   Revenue formats. User growth — a COUNT — deliberately does not, and
        //   that contrast is what makes the line chart a defect rather than taste.
        expect(revenue).toContain('formatCurrency');
        expect(growth).not.toContain('formatCurrency');
    });

    it('and the module-usage card follows the COUNT side of that rule', () => {
        const analytics = code(ANALYTICS);
        const modules = analytics.slice(analytics.indexOf('Module Usage'));

        expect(modules).not.toContain('formatCurrency');
        expect(modules).toContain('dataKey="count"');
    });

    it('formatCurrency really renders naira, so the claim above means something', () => {
        expect(formatCurrency(1_240_000)).toContain('₦');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#925 — the mirror-image guards, recorded', () => {
    it('the bar chart guards empty data itself, and its caller does not', () => {
        //   Load-bearing: the page passes `reports?.monthlyTrend`, which can be
        //   undefined.
        expect(code(BAR)).toContain('if (!monthlyTrend || monthlyTrend.length === 0)');
        expect(code(COOP_CONTRIBUTIONS)).toContain('monthlyTrend={reports?.monthlyTrend}');
    });

    it('and the line chart is the exact mirror — caller guards, component does not', () => {
        expect(code(COOP_DASHBOARD))
            .toContain('reports?.monthlyTrend && reports.monthlyTrend.length > 0');
        expect(code(LINE)).not.toContain('length === 0');
    });

    it('THE BEHAVIOUR: the bar chart says so rather than drawing an empty frame', () => {
        //   A chart with axes and no bars reads as "zero", which is a claim about
        //   the business. "No trend data available" is a claim about the data.
        render(<ContributionTrendChart monthlyTrend={[]} />);

        expect(screen.getByText('No trend data available')).toBeTruthy();
    });

    it('and tolerates an undefined series, which is what its caller can hand it', () => {
        render(<ContributionTrendChart monthlyTrend={undefined as unknown as any[]} />);

        expect(screen.getByText('No trend data available')).toBeTruthy();
    });

    it('THE LEDGER — chart components in the tree, and which state the money rule', () => {
        //   Three, and all three now agree about currency. A fourth that plots an
        //   amount without formatCurrency is the thing to catch.
        const CHARTS = [ANALYTICS, BAR, LINE];
        const plotsMoney = CHARTS.filter((rel) => /dataKey="(amount|revenue)"/.test(code(rel)));
        const formats = plotsMoney.filter((rel) => code(rel).includes('formatCurrency'));

        expect(plotsMoney).toEqual(CHARTS);
        expect(formats).toEqual(CHARTS);
        expect(ledgerVerdict(plotsMoney.length - formats.length, 0)).toBe(LEDGER_HELD);
    });
});
