/**
 * @jest-environment node
 */

/**
 *   #665 THE SCREEN WARNED YOU THE CHART WAS TRUNCATED AND NOT THAT THE TOTAL
 *   WAS.
 *
 *   Found by following the Paystack fallbacks the captured server log named —
 *   four independent paths logging a fallback for one upstream failure. Three of
 *   them turned out to be well built, each carrying an honesty signal on its
 *   payload. The question that mattered was whether anything READS them.
 *
 *     SIGNAL                    COMPUTED IN           RENDERED?
 *     revenueAvailable          getPlatformMetrics    YES — "Unavailable", not ₦0
 *     unavailableMonths         getDashboardStats     YES — names the months
 *     monthlyRevenueIsPartial   getDashboardStats     YES — "under-reported"
 *     unavailable[]             getFinancialOverview  YES — an amber banner
 *     revenueIsPartial          BOTH of the above     NO. NOTHING AT ALL.
 *
 *   `revenueIsPartial` is computed twice, in two different functions, and
 *   returned on both payloads under comments that say exactly why:
 *
 *       "Reported rather than swallowed: an admin reading this figure needs to
 *        know it is a floor, not a total. Surfaced on the payload below, not
 *        only logged."
 *
 *       "Surfaced instead of logged only, because an admin reading the figure
 *        is the person who needs to know it is incomplete."
 *
 *   Both true of the payload. Neither true of any screen — and there are
 *   THREE screens showing this figure: /admin, /admin/finance and
 *   /admin/analytics.
 *
 *   TWO MECHANISMS, ONE OUTCOME, and the second is the sharper:
 *
 *     AnalyticsData     had no such field. getDashboardStats copied
 *                       `revenueAvailable` out of getPlatformMetrics' payload
 *                       and dropped this one two lines away, because the
 *                       interface had nowhere to put it — so the compiler
 *                       enforced the silence all the way to the screen.
 *
 *     FinancialOverview HAD the field, declared, optional, and documented:
 *                       "the admin surface should show it when set." The admin
 *                       surface did not. A declared rule nothing consults, in
 *                       the purest form this audit has found.
 *
 * ── AND THE TWO FLAGS SIT ON THE SAME SCREEN ────────────────────────────────
 *
 *   This is the sharpest form of it this audit has found. `/admin` renders
 *   `monthlyRevenueIsPartial` as a warning under the revenue CHART — and the
 *   Total Revenue CARD directly above it reads `revenueAvailable` and ignores
 *   `revenueIsPartial`. So the same page tells you the chart is incomplete
 *   while presenting an incomplete total as a total.
 *
 * ── WHAT IT COSTS, AND WHEN ─────────────────────────────────────────────────
 *
 *   `MAX_REVENUE_PAGES` is 100 and a page is 100 transactions, so the sweep
 *   stops at TEN THOUSAND successful Paystack transactions and reports what it
 *   has. Past that the admin dashboard and the finance page both show a figure
 *   that is a floor, labelled "Total Revenue", with the subtitle "Based on
 *   transaction volume".
 *
 *   Not hypothetical at this platform's size — the PII incident this repository
 *   records involved 41,105 user records.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import { revenueDisplay, revenuePrefix, revenueNote } from '@/lib/revenue-display';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const DASHBOARD = 'src/app/admin/DashboardClient.tsx';
const FINANCE = 'src/app/admin/finance/page.tsx';
const SERVICE = 'src/services/analytics.service.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#665 — the flag is still computed, on both paths', () => {
    it('THE SERVICE SETS IT FROM THE SWEEP, IN BOTH FUNCTIONS', () => {
        /*
         *   The positive control for everything below. "The screen reads
         *   revenueIsPartial" means nothing if the service stopped setting it —
         *   and a fix that deleted the flag instead of rendering it would
         *   satisfy a careless version of this test.
         */
        const service = code(SERVICE);
        const assignments = service.match(/revenueIsPartial = sweep\.truncated/g) ?? [];

        expect(assignments).toHaveLength(2);
        //   And it is on the payloads a screen can read — the two functions'
        //   own returns, plus platformOverview, which is where getDashboardStats
        //   used to drop it while copying revenueAvailable out of the same
        //   object two lines away.
        expect((service.match(/^\s+revenueIsPartial,$/gm) ?? []).length).toBe(3);
    });

    it('AND THE SWEEP STILL REPORTS TRUNCATION RATHER THAN SWALLOWING IT', () => {
        const sweep = code('src/lib/paystack-sweep.ts');
        expect(sweep).toContain('truncated');
        expect(sweep).toContain('export const MAX_REVENUE_PAGES');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#665 — the decision, RUN rather than read', () => {
    /*
     *   THE FIRST FIX WROTE THIS BRANCH INTO ALL THREE SCREENS AND ASSERTED IT
     *   BY LOOKING FOR THE IDENTIFIER. Five mutants survived: each screen
     *   mentions the flag twice, so removing one mention left the other for
     *   `toContain` to find. The same sentence #649, #651, #659 and #663 each
     *   produced — a check on the presence of a name is not a check on what the
     *   name does.
     *
     *   So the decision is a function now, which is also the fix for three
     *   screens deciding separately, and it is exercised here.
     */
    it('AN ORDINARY FIGURE IS SHOWN PLAIN', () => {
        expect(revenueDisplay(true, false)).toBe('exact');
        expect(revenuePrefix('exact')).toBe('');
        //   Null, so each screen keeps its own subtitle — one counts payments,
        //   another says "Based on transaction volume".
        expect(revenueNote('exact')).toBeNull();
    });

    it('A TRUNCATED FIGURE IS SHOWN, MARKED AS A FLOOR', () => {
        //   THE defect. It was rendered exactly like an exact one.
        expect(revenueDisplay(true, true)).toBe('partial');
        expect(revenuePrefix('partial')).toBe('at least ');
        expect(revenueNote('partial')).toContain('floor');
    });

    it('AND A FIGURE NOBODY COULD READ IS NOT CALLED A FLOOR', () => {
        /*
         *   Unavailable beats partial. A figure nobody could read is not a
         *   number that is too low — it is no number, and "at least ₦0" would
         *   be a worse lie than the one this fixes.
         */
        expect(revenueDisplay(false, true)).toBe('unavailable');
        expect(revenueDisplay(false, false)).toBe('unavailable');
        expect(revenuePrefix('unavailable')).toBe('');
        expect(revenueNote('unavailable')).toContain('Could not reach');
    });

    it('AND AN UNSTATED FLAG IS NOT A WARNING', () => {
        /*
         *   The contract declares both as optional, so a cached payload or an
         *   older caller carries neither. "Not stated" has to mean "no reason
         *   to doubt it" — a module that warned on every screen whose payload
         *   predates this change would be the noise #658 was about.
         */
        expect(revenueDisplay(undefined, undefined)).toBe('exact');
        expect(revenueDisplay(undefined, true)).toBe('partial');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#665 — and all three screens ask it', () => {
    /*
     *   The source half, kept deliberately narrow: what a file-level assertion
     *   CAN say honestly is which module a screen consults, not what it does
     *   with the answer. The answer is tested above.
     */
    it.each([
        ['the admin dashboard', DASHBOARD],
        ['the finance page', FINANCE],
        ['the analytics page', 'src/app/admin/analytics/page.tsx'],
    ])('%s takes its decision from the shared function', (_name, file) => {
        expect(code(file)).toContain('revenueDisplay(');
        expect(code(file)).toContain('revenuePrefix(revenueState)');
        expect(code(file)).toContain('revenueNote(revenueState)');
    });

    it('AND NONE OF THEM STILL DECIDES FOR ITSELF', () => {
        //   The other half. Calling the function AND keeping the hand-written
        //   branch is how a rule ends up stated twice in one file, and the
        //   second copy is the one that stops being corrected.
        for (const file of [DASHBOARD, FINANCE, 'src/app/admin/analytics/page.tsx']) {
            expect(`${file}: ${/revenueIsPartial \?/.test(code(file))}`).toBe(`${file}: false`);
        }
    });

    it('AND THE CONTRACT HAS A FIELD FOR IT, WHICH IS WHY IT WAS INVISIBLE', () => {
        /*
         *   THE root cause. AnalyticsData declared revenueAvailable and
         *   monthlyRevenueIsPartial — the same idea for the chart, complete with
         *   "the chart should say so when it is set" — and not this. So
         *   getDashboardStats had no field to copy it into and the screens' type
         *   did not have it: the compiler was enforcing its absence.
         */
        /*
         *   AND THIS ASSERTION PASSED FOR THE WRONG REASON FIRST. A mutant that
         *   deleted the field from AnalyticsData survived, because
         *   `FinancialOverview` — a DIFFERENT interface in the same file —
         *   already declared `revenueIsPartial?: boolean`, so the substring was
         *   still there.
         *
         *   Which is the better half of the finding. That declaration carries
         *   "the admin surface should show it when set", and the admin surface
         *   did not: on THAT path the field existed, was documented with an
         *   instruction, and was read by nothing. On the AnalyticsData path it
         *   did not exist at all, so the compiler enforced the silence. Two
         *   mechanisms, one outcome.
         *
         *   Scoped to the interface each one belongs to now.
         */
        const contract = code('packages/services/src/contracts.ts');

        const analytics = contract.slice(
            contract.indexOf('interface AnalyticsData'),
            contract.indexOf('interface', contract.indexOf('interface AnalyticsData') + 10),
        );
        expect(analytics).toContain('revenueIsPartial?: boolean;');
        expect(analytics).toContain('monthlyRevenueIsPartial');

        const financial = contract.slice(contract.indexOf('interface FinancialOverview'));
        expect(financial.slice(0, financial.indexOf('interface', 10)))
            .toContain('revenueIsPartial?: boolean;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#665 — and the warning it sits beside still says its piece', () => {
    it('THE MONTHLY CHART WARNING IS UNTOUCHED', () => {
        /*
         *   The flag whose presence made the missing one visible: it was
         *   rendered all along, three hundred lines below the card that was
         *   not, so the page already knew how to say this and said it about the
         *   smaller number.
         *
         *   ANCHORED ON THE WHOLE CONDITION. The first version looked for the
         *   identifier and a mutant that replaced the test with `false &&`
         *   survived — this file's fifth presence-check to be caught by its own
         *   mutation run.
         */
        const dashboard = code(DASHBOARD);
        expect(dashboard).toContain('stats.monthlyRevenueIsPartial && (stats.unavailableMonths?.length ?? 0) === 0');
        expect(dashboard).toContain('(stats.unavailableMonths?.length ?? 0) > 0');
    });

    it('AND THE FINANCE BANNER FOR FIGURES THAT COULD NOT BE READ AT ALL', () => {
        expect(code(FINANCE)).toContain('unavailable.length > 0');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a screen stops asking the shared function           KILLED
 *     FinancialOverview loses the field it always had                 KILLED
 *     a screen keeps its own hand-written branch as well              KILLED
 *     the contract loses the field again                              KILLED
 *     the service stops setting it on one of the two sweeps           KILLED
 *     platformOverview drops it again                                 KILLED
 *     a truncated figure stops being marked                           KILLED
 *     unavailable stops beating partial                               KILLED
 *     an unstated flag starts warning                                 KILLED
 *     the monthly-chart warning is removed                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   FIVE MUTANTS SURVIVED THE FIRST RUN AND ALL FIVE WERE MY ASSERTIONS.
 *   The first fix wrote the branch inline into all three screens and checked it
 *   with `toContain('revenueIsPartial')` — and each screen mentions the flag
 *   twice, so removing one mention left the other to be found. A sixth survived
 *   the second run because the contract assertion was matching a DIFFERENT
 *   interface's field of the same name.
 *
 *   The repair was the one middleware.ts already records for `adminSiloRedirect`:
 *   make the decision a function. Which is also the fix for three screens
 *   deciding separately — so the weak assertion and the duplicated contract had
 *   the same cure.
 *
 *   The four Paystack fallback paths were found in a captured server log from a
 *   real run — 362 Playwright tests against a production build — and then read
 *   one at a time. Three carried an honesty signal that reaches a screen; the
 *   fourth signal, computed on two of those same paths, reached none. The
 *   ceiling that makes the figure a floor is MAX_REVENUE_PAGES × 100 = 10,000
 *   transactions, read from lib/paystack-sweep rather than assumed.
 */
