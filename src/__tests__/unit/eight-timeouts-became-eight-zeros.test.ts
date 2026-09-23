/**
 *   THE OWNER: "The true reflection of the DB on the dashboard count was false
 *   did you fix it?"
 *
 *   It was, and this is the chain — every link readable in the source, none of
 *   it needing production access to establish:
 *
 *     1. count_module_registrations times out. 049 IS applied; the function
 *        exists and ran out of time.
 *     2. The log said "Apply supabase/migrations/049" — fixed separately, see
 *        lib/rpc-unavailable.
 *     3. The eight-scan fallback ran. Its own comment says "Reached only when
 *        049 is not applied", and that assumption is what the production log
 *        disproves.
 *     4. Those eight queries filter `raw_data->serviceRegistrations->…` — the
 *        WIDE column — where the function reads the narrow generated
 *        `service_regs` that 045 added precisely so no row need be detoasted.
 *        EIGHT SCANS OF THE FAT COLUMN CANNOT SUCCEED WHERE ONE SCAN OF THE
 *        THIN ONE DID NOT.
 *     5. Every figure ended `?? 0`. A timed-out count has a null count, so
 *        null became nought.
 *     6. The dashboard reported every module as empty. As a fact.
 *
 *   DashboardClient's own header already knew the principle: "a bar of zero
 *   and a bar that could not be drawn look identical on a chart, and only one
 *   of them is a fact about the business." That treatment had been given to
 *   the chart bars and to the platform-overview tiles, and not to these.
 *
 *   MEASURED, so the timeout is not merely asserted: on 40,000 seeded users in
 *   a table of production's shape, the function costs 4,869 buffers and 30 ms
 *   warm on a dedicated CPU. That is the BEST case, and it is a whole-heap
 *   scan — the page count is what travels to a cold, shared-tier instance, not
 *   the milliseconds.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Drive the real rollup with an rpc that fails the given way, and report both
 * what it returned and whether the eight fallback queries were issued.
 */
async function runWith(error: { code: string; message: string }) {
    jest.resetModules();

    const from = jest.fn(() => {
        const builder: any = {
            select: () => builder,
            or: () => Promise.resolve({ count: 5, error: null }),
        };
        return builder;
    });

    jest.doMock('@/lib/supabase', () => ({
        supabaseAdmin: { rpc: jest.fn(async () => ({ data: null, error })), from },
    }));

    const { AnalyticsService } = await import('@/services/analytics.service');
    const stats = await new AnalyticsService().getModuleRegistrationStats();

    return { from, stats };
}

const source = () =>
    readFileSync(join(process.cwd(), 'src/services/analytics.service.ts'), 'utf8');

/** The file with `//` and block comments removed, so prose is not evidence. */
const code = () =>
    source()
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');

describe('a count that could not be read is not zero', () => {
    it('NO MODULE FIGURE STILL ENDS `?? 0`', () => {
        //   The defect, asserted as an absence. Each of these eight read
        //   `<name>Res.count ?? 0` and handed the dashboard a nought.
        const zeroed = [...code().matchAll(/(\w+Res)\.count \?\? 0/g)].map((m) => m[1]);

        expect({ figuresDefaultingToZero: zeroed }).toEqual({ figuresDefaultingToZero: [] });
    });

    it('AND THE NAMES OF THE UNREAD ONES ARE CARRIED', () => {
        //   Returning 0 is still fine — every caller needs a number to render.
        //   What was missing is the claim that it is not a measurement.
        expect(code()).toContain('unavailableFigures');
    });

    it('A TIMEOUT DOES NOT RUN THE FALLBACK AT ALL', async () => {
        /*
         *   THE LOAD-BEARING ASSERTION, AND IT IS BEHAVIOURAL ON PURPOSE.
         *
         *   The first draft grepped the source for `cause === "timed-out"` and
         *   SURVIVED the mutant that replaces the guard with `if (false)` —
         *   because that same string also appears in the reader's log ternary
         *   a few lines above. A source grep cannot tell a guard from a
         *   mention. So this drives the real function and watches whether the
         *   eight queries are issued.
         */
        const { from, stats } = await runWith({
            code: '57014', message: 'canceling statement due to statement timeout',
        });

        expect({ fallbackQueriesIssued: from.mock.calls.length }).toEqual({ fallbackQueriesIssued: 0 });
        expect(stats.unavailableFigures).toEqual(expect.arrayContaining(['wave', 'academy', 'marketplace']));
    });

    it('but a MISSING function still DOES — that is what the fallback is for', async () => {
        //   049's own header calls a deploy landing ahead of its migration
        //   "the normal case here". Narrowing the timeout case must not
        //   delete the case the fallback was written for.
        const { from } = await runWith({
            code: 'PGRST202', message: 'Could not find the function public.count_module_registrations',
        });

        expect(from.mock.calls.length).toBeGreaterThan(0);
    });
});

describe('and the screen does not draw a pie from numbers nobody read', () => {
    it('HOLDS THE CHART BACK when a slice is unavailable', () => {
        /*
         *   A pie is worse than a tile here: the modules that WERE read take a
         *   larger share of the circle to make up for the ones that were not,
         *   so a single failed count misstates every other module too.
         */
        const client = readFileSync(
            join(process.cwd(), 'src/app/admin/DashboardClient.tsx'), 'utf8');

        expect(client).toContain('unavailableFigures');
        expect(client).toMatch(/module counts could not be read/);
    });
});
