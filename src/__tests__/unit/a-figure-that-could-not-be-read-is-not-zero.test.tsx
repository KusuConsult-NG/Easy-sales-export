/**
 * @jest-environment jsdom
 */

/**
 *   #753 EVERY HEADLINE FIGURE ON THE ADMIN DASHBOARD COLLAPSED A FAILED READ
 *        TO ZERO. ONE OF THE EIGHT SAID SO.
 *
 *   Reported by the owner, from the live dashboard:
 *
 *       Total Users     0             Total registered accounts
 *       Active Users    0             Logged in recently
 *       Total Revenue   Unavailable   Could not reach Paystack or the database
 *
 *   Three tiles, ONE outage, and only the third told the truth. This platform
 *   has roughly 42,600 accounts — the owner's own Ghost figure, 19,978 at
 *   46.9%, puts the denominator there — so "Total Users: 0" is not a stale
 *   number. It is a statement that the business does not exist, on the first
 *   screen an administrator opens BECAUSE something looks wrong.
 *
 * ── THE RULE WAS ALREADY WRITTEN DOWN. THREE TIMES. ─────────────────────────
 *
 *   Beside the zeros themselves, in analytics.service.ts:
 *
 *       // A rejected metrics call is not zero revenue, it is no answer.
 *       totalRevenue = 0;
 *       totalTransactions = 0;
 *       revenueAvailable = false;
 *
 *   `totalUsers = 0` is the line ABOVE that comment. The principle is stated
 *   correctly and applied to one of the three figures it is sitting on.
 *
 *   On the revenue tile: "A zero here is a real business figure; an outage
 *   rendered as ₦0 is indistinguishable from a day with no sales."
 *
 *   And on `unavailableMonths`: "a bar of zero and a bar that could not be
 *   drawn look identical on a chart, and only one of them is a fact about the
 *   business."
 *
 *   A CHART BAR WAS GIVEN THIS TREATMENT AND THE USER COUNT WAS NOT.
 *
 * ── WHY SEVEN RATCHETS DID NOT CATCH IT ─────────────────────────────────────
 *
 *   This audit has a long ratchet series on exactly this class — #384, #407,
 *   #408, #588, #592, #594, #742 — and every one of them looks for an EMPTY
 *   LIST or a positive empty-state SENTENCE: "All Caught Up!", "No Loan
 *   Applications Yet", "You're all caught up!". #742 built a banner for the
 *   twenty admin lists that said "nothing here" when the read had failed.
 *
 *   A NUMBER HAS NO EMPTY STATE. `0` renders as an ordinary figure in an
 *   ordinary tile, indistinguishable from a real measurement, and no sweep
 *   looking for a sentence can see it. The class was fixed thoroughly in the
 *   one shape somebody thought to look for.
 *
 * ── WHAT IS FIXED AND WHAT IS RECORDED ──────────────────────────────────────
 *
 *   The reported screen — /admin — in full: all eight figures, plus the two
 *   other places on it that render the same numbers (the "N pending
 *   applications" link and the registration pie chart, which captions itself
 *   "N Unique Accounts" and would have read "0 Unique Accounts").
 *
 *   SIX OTHER ADMIN SCREENS carry sixteen more figures with no availability
 *   concept at all. They are measured and pinned below rather than swept: each
 *   needs its own action to report which read failed, which is per-screen work,
 *   and doing seven at once with no coverage is how a repair becomes an outage.
 *
 *   AND EIGHT MORE IN THIS SAME SERVICE, found by this fix rather than by the
 *   report. `getFinancialOverview` carries the identical bare ternary on the
 *   MONEY figures — total escrow, outstanding loans, the abandoned, failed and
 *   successful payment counts, revenue, and the cooperative and WAVE payout
 *   totals — so an outage there reads as "nothing was paid out". Pinned
 *   exactly, below, so fixing them forces the number down rather than quietly
 *   widening an allowance.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const CLIENT = 'src/app/admin/DashboardClient.tsx';
const SERVICE = 'src/services/analytics.service.ts';

/** One method of the service, start anchor to the next method declaration. */
function method(name: string): string {
    const src = code(SERVICE);
    const a = src.indexOf(`async ${name}(`);
    expect({ name, found: a > -1 }).toEqual({ name, found: true });
    const b = src.slice(a + 1).search(/\n    (?:private )?async /);
    return b === -1 ? src.slice(a) : src.slice(a, a + 1 + b);
}

// ─────────────────────────────────────────────────────────────────────────────
//   THE SCREEN, RENDERED. The defect is a rendering one — the service's zero is
//   forced and correct — so the assertion that matters is what an administrator
//   actually reads.
// ─────────────────────────────────────────────────────────────────────────────

//   Typed, because `jest.fn()` from '@jest/globals' with no signature infers
//   its resolved value as `never` and rejects every fixture below.
const stats = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.mock('@/app/actions/admin-analytics', () => ({
    getDashboardStatsAction: (...a: unknown[]) => stats(...a),
    //   NON-NULL. With null the page renders "No registration data
    //   available" and never reaches the chart branch at all — a first draft
    //   stubbed null and the pie-chart test failed for that reason rather than
    //   the one it was about.
    getModuleRegistrationStatsAction: async () => ({
        wave: 10, academy: 10, cooperatives: 10, cooperativeOnboarding: 0,
        farmNation: 10, exportHub: 10, exportOnboarding: 0, marketplace: 10,
    }),
}));
jest.mock('next/dynamic', () => () => function Stub() { return null; });
jest.mock('framer-motion', () => ({
    motion: new Proxy({}, {
        get: () => function M({ children, ...p }: any) { return React.createElement('div', p, children); },
    }),
}));

/** A complete, healthy payload. Each test spoils exactly one thing in it. */
const payload = (overrides: Record<string, unknown> = {}) => ({
    platformOverview: {
        totalUsers: 42597,
        activeUsers: 3120,
        totalRevenue: 980000,
        monthlyRevenue: 0,
        totalTransactions: 812,
        revenueAvailable: true,
        revenueIsPartial: false,
        pendingApprovals: 4,
        recentActivityCount: 55,
        unavailableFigures: [],
        ...overrides,
    },
    counts: { pendingEscrows: 7, activeLandListings: 12, pendingLoans: 3 },
    revenueByMonth: [], monthlyRevenueIsPartial: false,
    userGrowthByMonth: [], userGrowthIsPartial: false, unavailableMonths: [],
    moduleUsage: [{ module: 'x', count: 1 }], userSegments: [],
    recentTransactions: [],
});

async function renderDashboard() {
    const { default: Dashboard } = await import('@/app/admin/DashboardClient');
    const r = render(<Dashboard />);
    await waitFor(() => expect(screen.queryByText(/Loading dashboard/i)).toBeNull());
    return r;
}

describe('#753 — an unreadable figure says so, where the owner was reading a zero', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('TOTAL USERS READS "Unavailable", NOT 0, WHEN ITS READ FAILED', async () => {
        /*
         *   THE reported defect, as one assertion. The owner's screen had this
         *   tile at 0 beside a revenue tile correctly saying Unavailable — one
         *   outage, two different stories.
         */
        stats.mockResolvedValue(payload({
            totalUsers: 0,
            unavailableFigures: ['totalUsers'],
        }));

        await renderDashboard();

        expect(screen.getByText('Total Users')).toBeTruthy();
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
        /*
         *   And the SUBTITLE stops asserting a fact about registrations.
         *
         *   Asserted on its exact text, and on the absence of the confident
         *   wording. A looser /could not be read/i matcher SURVIVED the mutant
         *   that reverted this line, because the pie-chart placeholder — held
         *   back by the same unreadable figure — contains that phrase too. Two
         *   elements said something similar and the test could not tell which
         *   one it had found.
         */
        expect(screen.getByText('Could not be read — retry shortly')).toBeTruthy();
        expect(screen.queryByText('Total registered accounts')).toBeNull();
    });

    it('AND A GENUINE ZERO IS STILL A ZERO — the vacuity guard', async () => {
        /*
         *   The half that makes this a fix rather than a blanket. Rendering
         *   "Unavailable" whenever a figure is 0 would satisfy the test above
         *   and lie in the other direction: a brand-new platform really does
         *   have no users, and a queue really does empty.
         */
        stats.mockResolvedValue(payload({ totalUsers: 0, unavailableFigures: [] }));

        await renderDashboard();

        //   getAllByText: several tiles legitimately read 0 in this fixture.
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
        expect(screen.queryByText(/could not be read/i)).toBeNull();
    });

    it('AND THE READABLE FIGURES BESIDE IT ARE STILL SHOWN', async () => {
        /*
         *   #517's rule, which this must not undo: "a figure that could not be
         *   read is unavailable, and the figures that WERE read are still worth
         *   showing". Blanking the whole dashboard because one read failed is
         *   the defect that finding fixed.
         */
        stats.mockResolvedValue(payload({
            totalUsers: 0,
            unavailableFigures: ['totalUsers'],
        }));

        await renderDashboard();

        expect(screen.getByText('3,120')).toBeTruthy();   // Active Users, read fine
        expect(screen.getByText('55')).toBeTruthy();      // Recent Activity
    });

    it('AND EVERY ONE OF THE EIGHT CAN SAY IT, NOT JUST THE TWO IN THE REPORT', async () => {
        /*
         *   The whole point of fixing the class rather than the symptom. The
         *   owner named two tiles; eight read the same way. Asserted by
         *   spoiling all of them at once and counting.
         */
        stats.mockResolvedValue({
            ...payload({
                totalUsers: 0, activeUsers: 0, totalTransactions: 0,
                pendingApprovals: 0, recentActivityCount: 0,
                revenueAvailable: false,
                unavailableFigures: [
                    'totalUsers', 'activeUsers', 'totalTransactions',
                    'pendingApprovals', 'recentActivityCount',
                    'pendingEscrows', 'activeLandListings', 'pendingLoans',
                ],
            }),
            counts: { pendingEscrows: 0, activeLandListings: 0, pendingLoans: 0 },
        });

        await renderDashboard();

        //   SEVEN: the six tiles carrying a figure from that set, plus
        //   revenue's own "Unavailable" from revenueAvailable: false. So
        //   nothing in the row reads as a measured zero. (A first draft said
        //   six and forgot the tile this finding started from.)
        expect(screen.getAllByText('Unavailable').length).toBe(7);
        /*
         *   And no TILE reads 0. Scoped to the stat-card values rather than
         *   `queryByText('0')` over the whole document — that threw on
         *   multiple matches, because "0" also appears in unrelated chrome
         *   (an icon's stroke width, a chart axis). The lie this finding is
         *   about lives in the tile, so the tile is what is asked.
         */
        /*
         *   Selected by data-testid, not by class. A first draft used
         *   `p.text-3xl` and broke the moment #758 made the tile responsive —
         *   `text-2xl sm:text-3xl` — for a change that made the tile BETTER.
         *   That is the "pins the spelling, not the property" trap this audit
         *   filed as #741, committed in a test I wrote for it.
         */
        const tileValues = Array.from(document.querySelectorAll('[data-testid="stat-value"]'))
            .map((el) => el.textContent?.trim());
        expect(tileValues).not.toContain('0');
        expect(tileValues.length).toBeGreaterThan(0);
    });

    it('AND THE PIE CHART IS HELD BACK RATHER THAN CAPTIONED "0 Unique Accounts"', async () => {
        /*
         *   RegistrationPieChart divides module registrations by the account
         *   total and prints it underneath. Handed the same unreadable zero it
         *   would caption the platform as having no accounts — the tile's lie
         *   in a place with no room to say "unavailable".
         */
        stats.mockResolvedValue(payload({
            totalUsers: 0,
            unavailableFigures: ['totalUsers'],
        }));

        await renderDashboard();

        expect(screen.getByText(/Registration breakdown unavailable/i)).toBeTruthy();
        expect(screen.queryByText(/Unique Accounts/i)).toBeNull();
    });

    it('and an ABSENT list is no claim, so nothing is blanked on an older payload', async () => {
        /*
         *   `unavailableFigures` is optional on the contract. A cached response
         *   or an older deploy carries no list, and the screen must then behave
         *   exactly as it did before — membership, never emptiness.
         */
        const p = payload();
        delete (p.platformOverview as Record<string, unknown>).unavailableFigures;
        stats.mockResolvedValue(p);

        await renderDashboard();

        expect(screen.getByText('42,597')).toBeTruthy();
        expect(screen.queryByText('Unavailable')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#753 — and the service is what names them', () => {
    it('THE FAILING READ IS RECORDED BY NAME, NOT AS A BOOLEAN PER FIGURE', () => {
        /*
         *   `revenueAvailable` is a per-figure flag, and adding seven more is
         *   how the ninth gets forgotten — which is precisely how this
         *   happened. A named set is asked one question by the screen, and a
         *   figure added later either joins it or is visibly absent.
         */
        const src = code(SERVICE);

        expect(src).toContain('const unavailableFigures: string[] = []');
        expect(src).toContain('unavailableFigures,');
    });

    it('AND EVERY ZERO-ON-FAILURE SITE FEEDS IT', () => {
        /*
         *   The vacuity guard on the assertion above: declaring the array and
         *   populating three of eight sites would satisfy it.
         *
         *   Counted from the code. `settled(...)` is the helper that records a
         *   name while returning 0; the two explicit `unavailableFigures.push`
         *   calls are the metrics branches, where one rejection blanks several
         *   figures at once and the helper does not fit.
         */
        const src = code(SERVICE);
        const viaHelper = [...src.matchAll(/=\s*settled\(/g)].length;
        const viaPush = [...src.matchAll(/unavailableFigures\.push\(/g)].length;

        /*
         *   SIXTEEN, not eight — #768 put getFinancialOverview's eight figures
         *   through the same helper, which is what closed the ledger below.
         *
         *   And viaPush is 2, not 3. The third was the push INSIDE the helper,
         *   which moved when the helper was lifted to module scope so both
         *   methods share one definition; it writes to the list it was handed
         *   (`into.push`) rather than naming one method's array. The two that
         *   remain are the metrics branches, where a single rejection blanks
         *   several figures at once and the helper does not fit.
         *
         *   Measured, not guessed — a first draft of the original test guessed
         *   6 and 2.
         */
        expect({ viaHelper, viaPush }).toEqual({ viaHelper: 16, viaPush: 2 });

        //   And the one definition really is one. Two `figureReader(…)` call
        //   sites — one per method — plus the declaration itself.
        expect([...src.matchAll(/figureReader\(/g)]).toHaveLength(3);
        expect([...src.matchAll(/into\.push\(/g)]).toHaveLength(1);
    });

    it('AND NO FIGURE IN getDashboardStats IS STILL SET TO 0 BY A BARE TERNARY', () => {
        /*
         *   The shape this replaced, stated as its absence:
         *
         *       x = snap.status === "fulfilled" ? snap.value.data().count : 0
         *
         *   Each one silently turned an outage into a measurement. Asserted
         *   over the whole METHOD rather than per site — there were seven, and
         *   a per-site check would pass with one left behind.
         */
        expect(method('getDashboardStats')).not.toMatch(/status === "fulfilled"\s*\?[^:]*:\s*0/);
    });

    it('AND THE EIGHT IN getFinancialOverview ARE CLOSED TOO — the ledger is at zero', () => {
        /*
         *   FOUND BY THIS FIX AND NOT FIXED BY IT — until #768.
         *
         *   #753 recorded eight more of the identical shape in
         *   `getFinancialOverview`, the MONEY figures: total escrow,
         *   outstanding loans, abandoned/failed/successful payment counts,
         *   revenue, and the cooperative and WAVE payout totals. Five of the
         *   eight had no name attached at all, so an outage on any of them
         *   reached the finance screen as a confident ₦0 — `totalRevenue`
         *   among them, which is the exact figure revenue-display.ts was
         *   written for.
         *
         *   THE LEDGER DID ITS JOB. It was pinned EXACTLY at 8 so that closing
         *   them would FAIL this test rather than pass quietly, and it did:
         *   "IMPROVED to 0, below the recorded 8. Lower the recorded count to
         *   0, or the difference becomes room for 8 new instances that no test
         *   would notice." That is #743's mechanism working in the direction it
         *   is hardest to get right.
         *
         *   Now recorded at 0 and asserted the same way getDashboardStats is:
         *   the shape must be ABSENT from the method, not merely rarer.
         */
        const n = [...method('getFinancialOverview')
            .matchAll(/status === "fulfilled"\s*\?[^:]*:\s*0/g)].length;

        expect(ledgerVerdict(n, 0)).toBe(LEDGER_HELD);
        expect(method('getFinancialOverview')).not.toMatch(/status === "fulfilled"\s*\?[^:]*:\s*0/);
    });

    it('AND EVERY ONE OF THOSE EIGHT NAMES ITSELF', () => {
        /*
         *   The vacuity guard on the line above: deleting the ternaries without
         *   routing them through the helper would satisfy it and report every
         *   outage as zero, silently — a worse state than the one being fixed.
         *
         *   Asserted as the NAMES, because that is what the screen reads. The
         *   two payout halves carry a dotted name each so whoever is diagnosing
         *   can tell which collection is down, and the combined
         *   `pendingPayoutAmount` is kept beside them because a sum with one
         *   half missing is unknown, not smaller — it is what an admin pays
         *   out against.
         */
        const body = method('getFinancialOverview');

        for (const name of [
            'totalEscrowVolume', 'totalLoansDisbursed',
            'totalAbandonedCount', 'totalFailedCount', 'totalSuccessfulCount',
            'totalRevenue',
            'pendingPayoutAmount.cooperative', 'pendingPayoutAmount.wave',
        ]) {
            expect({ name, named: body.includes(`settled("${name}"`) })
                .toEqual({ name, named: true });
        }
    });

    it('AND THE FINANCE SCREEN ACTS ON THE REVENUE NAME', () => {
        /*
         *   The other half, and the one that makes the service's work visible.
         *   The page has held `unavailable` since #516 and passed `undefined`
         *   for revenue's availability under a comment saying "This page never
         *   learns that the figure could not be read at all" — true only
         *   because the service never named it. Both halves, or neither works.
         */
        expect(code('src/app/admin/finance/page.tsx'))
            .toContain('revenueDisplay(!unavailable.includes("totalRevenue"), revenueIsPartial)');
    });

    it('and the contract carries the field, which is where revenueIsPartial died', () => {
        //   #665's lesson, in that file's own words: the field reached no
        //   screen because the interface had none, so "the compiler enforced
        //   its absence all the way to the screen".
        expect(code('packages/services/src/contracts.ts'))
            .toContain('unavailableFigures?: string[]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#753 — and the rest of the class is measured, not swept', () => {
    /**
     * Seven other admin screens render a figure out of a stats object and have
     * no availability concept at all. Each needs its own action to report which
     * read failed — per-screen work — so they are pinned here as a ledger under
     * #743's mechanism, which fails in BOTH directions: a new one added, or one
     * fixed without lowering the number.
     */
    const figures = () => {
        const files: string[] = [];
        (function walk(d: string) {
            for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
                const rel = `${d}/${e.name}`;
                if (e.isDirectory()) { if (e.name === '__tests__') continue; walk(rel); }
                else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) files.push(rel);
            }
        })('src/app/admin');

        let total = 0;
        const screens: string[] = [];
        for (const f of files) {
            const src = code(f);
            const n = [...src.matchAll(/numberOrZero\(\s*(?:data|stats|metrics|summary)[?.]/g)].length
                + [...src.matchAll(/(?:data|stats|metrics|summary)\?\.[A-Za-z.?]+\s*\?\?\s*0/g)].length;
            if (!n) continue;
            if (/unavailableFigures|revenueAvailable|Unavailable/.test(src)) continue;
            total += n; screens.push(f);
        }
        return { total, screens };
    };

    it('THE REMAINING POPULATION IS EIGHT FIGURES ON TWO SCREENS', () => {
        /*
         *   Sixteen, not the eighteen a first pass reported. That sweep ran
         *   over RAW source and counted two mentions inside COMMENTS — #601's
         *   `numberOrZero(stats.bySeverity.info)`, quoted in wave/compliance
         *   and wave/members as a reference to an earlier finding. Measured on
         *   stripped source, which is the instrument the rest of this audit
         *   uses for exactly that reason.
         *
         *   #768 SIXTEEN BECAME TEN, AND THE TEN ARE NOT DEFECTS.
         *
         *   #753 pinned these as "measured and pinned rather than swept: each
         *   needs its own action to report which read failed". Read one screen
         *   at a time, that turned out to be the wrong prediction for most of
         *   them — the population was three real instances and thirteen
         *   defensive uses of `numberOrZero`, which this sweep cannot tell
         *   apart because it matches the CALL and not what the screen does when
         *   the read fails.
         *
         *   THE THREE THAT WERE REAL, fixed here:
         *
         *     admin/export                 `useState({total:0,pending:0,…})`
         *                                  with `setStats` only on success and
         *                                  `statsLoading` cleared in a
         *                                  `.finally()` — four confident zeros
         *                                  on a screen that looks finished.
         *                                  "0 Pending Action" is the sentence
         *                                  an admin acts on by not acting.
         *     farm-nation/applications     `stats ? … : sellers.length` — the
         *                                  loaded PAGE printed as the total,
         *                                  captioned "Live". #516 removed the
         *                                  identical fallback from
         *                                  getFinancialOverview.
         *     admin/export/orders          a success toast that could read
         *                                  "₦0 returned to the buyer's wallet".
         *
         *   THE TEN THAT REMAIN, each opened and read:
         *
         *     audit-logs            (4)    the whole tile block is `{stats && …}`
         *     wave/compliance       (4)    the same, twice over
         *     system-health/…/diagnostics (2)  renders `'—'` when data is absent
         *
         *   None of the three renders a figure on a failed read, so none of
         *   them is this defect. They stay in the ledger because the SWEEP
         *   still finds them and a ledger that quietly stopped counting would
         *   lose the drift check — and because a guard removed tomorrow puts
         *   the screen straight back into the class. The test below is what
         *   makes that a check rather than a number.
         */
        /*
         *   #772 TEN BECAME EIGHT, and system-health/diagnostics left the
         *   population for the right reason rather than by being excused.
         *
         *   That screen's "Orphaned Apps" figure was a fifty-row sample of ONE
         *   application collection out of four, printed as a count. Fixing it
         *   gave both health screens a real availability concept — what was
         *   scanned, whether the number is a floor, and which collections could
         *   not be read at all — expressed in the platform's own word,
         *   "Unavailable". The sweep's exclusion asks exactly that question, so
         *   they drop out because they now answer it.
         */
        /*
         *   #835 EIGHT BECAME FOUR, and wave/compliance left the population the
         *   same way system-health did — by answering the question, not by being
         *   excused from it.
         *
         *   Its four figures were `numberOrZero(stats.totalApplications)` and the
         *   three status counts beside it. They now go through `statText`, which
         *   is the platform's own three-state decision — a figure, "—" for not
         *   yet, "Unavailable" for a read that failed — so a count that could not
         *   be taken no longer renders as a confident number.
         *
         *   That happened while fixing #835, where the owner found this screen
         *   reporting 716 applications for a programme of 15,000. Wiring the
         *   applicant register through the same nullable path is what took these
         *   four figures out of the class.
         *
         *   The ledger is lowered rather than left, exactly as its own note
         *   demands: the difference would otherwise be room for four new
         *   instances that no test would notice.
         */
        const { total, screens } = figures();

        expect(ledgerVerdict(total, 4)).toBe(LEDGER_HELD);
        expect(ledgerVerdict(screens.length, 1)).toBe(LEDGER_HELD);
    });

    it('AND THE TEN THAT REMAIN ARE EACH BEHIND A GUARD', () => {
        /*
         *   #768 The ledger above counts; this checks. Ten figures were left
         *   recorded on the grounds that their screens never render them on a
         *   failed read — so that reason is asserted, at each of the three, and
         *   removing a guard fails here instead of quietly rejoining the class.
         */
        expect(code('src/app/admin/audit-logs/page.tsx')).toContain('{stats && (');
        expect(code('src/app/admin/wave/compliance/page.tsx')).toContain('{stats && (');
        /*
         *   #772 system-health/diagnostics is no longer in the population — it
         *   gained a full availability concept — but its em-dash branch is
         *   still the thing that stops a missing read rendering as a figure, so
         *   the assertion stays. A guard is worth checking whether or not the
         *   sweep still counts the file.
         */
        expect(code('src/app/admin/system-health/diagnostics/page.tsx')).toContain("data ? numberOrZero(");
    });

    it('AND THE THREE THAT WERE REAL NOW SAY SO', () => {
        //   The other half of the same guard: the fixes, asserted by what they
        //   put on the screen rather than by their absence from the sweep.
        expect(code('src/app/admin/export/page.tsx')).toContain('statsFailed ? "Unavailable"');
        expect(code('src/app/admin/farm-nation/applications/page.tsx'))
            .toContain('Total applications — Unavailable');
        //   And the page-length fallback is gone, which is the defect itself.
        expect(code('src/app/admin/farm-nation/applications/page.tsx'))
            .not.toContain(': sellers.length} total applications');
    });

    it('AND THE DASHBOARD IS NO LONGER AMONG THEM', () => {
        //   Vacuity guard: the sweep must actually exclude what was fixed, or
        //   the ledger above is measuring nothing in particular.
        expect(figures().screens).not.toContain(CLIENT);
    });

    it('and the sweep finds real screens rather than nothing at all', () => {
        //   #835 wave/compliance is no longer among them — its four figures went
        //   through statText. audit-logs is what keeps this a live measurement
        //   rather than a sweep that has quietly stopped matching anything.
        expect(figures().screens).toContain('src/app/admin/audit-logs/page.tsx');
        expect(figures().screens.length).toBeGreaterThan(0);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the tile goes back to (totalUsers ?? 0)                        KILLED
 *     the unavailable test reads emptiness, not membership           KILLED
 *     the subtitle keeps its confident wording                       KILLED †
 *     the pie chart is drawn from the unreadable total               KILLED
 *     one settled() site goes back to a bare ternary                 KILLED
 *     the metrics branch stops naming its figures                    KILLED
 *     settled() records nothing                                      KILLED
 *     the contract field is removed                                  KILLED
 *     the remaining-population ledger is raised                      KILLED
 *     the finance ledger is raised                                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   † SURVIVED ON THE FIRST PASS, AND THE TEST WAS AT FAULT. The assertion had
 *     been loosened from getByText to getAllByText(/could not be read/i) to get
 *     past an unrelated multiple-match error — and the pie-chart placeholder,
 *     held back by the SAME unreadable figure, contains that phrase. Two
 *     elements said something similar and the matcher could not tell which it
 *     had found. Re-anchored on the subtitle's exact text plus the absence of
 *     the confident wording; killed.
 *
 *   AND THREE ASSERTIONS IN THIS FILE WERE WRONG BEFORE THEY WERE RIGHT, which
 *   is recorded rather than tidied away: the helper-site count was guessed at 6
 *   and is 8, the remaining population was measured at 18 over RAW source and
 *   is 16 over stripped source (two mentions were inside comments quoting an
 *   earlier finding), and the "Unavailable" count forgot the revenue tile this
 *   finding started from. Every number in this suite is now one the sweep
 *   produced rather than one I expected it to.
 */
