/**
 * @jest-environment node
 */

/**
 *   #543 THE MODULE DASHBOARDS FETCHED THEMSELVES AFTER THE PAGE HAD ALREADY
 *        ARRIVED.
 *
 *   Asked for by the owner after #540 and #541: "fix the profile and module
 *   dashboards too".
 *
 *   Every one of the seven was a "use client" page whose first act on mount was
 *   a server action. What the member experienced was:
 *
 *       HTML arrives (a spinner)  ->  download the JS bundle  ->  hydrate
 *         ->  NOW make the round trip  ->  repaint
 *
 *   Four steps before a number appeared, three of them after the page already
 *   looked loaded.
 *
 * ── FIVE ARE SERVER-FETCHED, AND TWO DELIBERATELY ARE NOT ───────────────────
 *
 *   Farm Nation, Cooperative, Export, Marketplace buyer and Marketplace seller
 *   are each split into a small server page that fetches and a client component
 *   that renders. The server page hands the result down; the client no longer
 *   makes the call.
 *
 *   WAVE and Academy are NOT. Both gate their load on state resolved in the
 *   browser — WAVE on `membershipStatus`, Academy on membership and payment —
 *   so fetching on the server would do the work for every visitor including the
 *   ones those screens are about to turn away. They got the other half of the
 *   fix instead: their loads were SEQUENTIAL and are now parallel. WAVE awaited
 *   three unrelated actions one after another and Academy two, so a member
 *   waited the sum of the round trips rather than the longest.
 *
 *   Recording why two are excluded matters more than the exclusion. "All seven
 *   converted" would have been a tidier claim and a false one.
 *
 * ── TWO WAYS TO SEED, AND THE HONEST DIFFERENCE BETWEEN THEM ────────────────
 *
 *   Where the effect only assigns what it received — Farm Nation, Cooperative,
 *   Export — the value is seeded into useState, so the SERVER-RENDERED HTML
 *   already holds the numbers. No spinner and no round trip.
 *
 *   Where the effect derives — the buyer and seller dashboards sort orders and
 *   reshape products — the raw action results are handed into the effect
 *   instead. That removes the round trip and NOT the spinner: the first paint
 *   still shows the loading state, and the data appears the moment the bundle
 *   hydrates rather than a network hop later.
 *
 *   The alternative was to run that derivation on the server as well, which is
 *   two copies of one contract — the defect class this audit keeps finding. The
 *   same reasoning governs /profile in #541, whose first paint is likewise
 *   still a spinner. That limit is stated rather than glossed.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a converted page.tsx made "use client" again      KILLED (1 test)
 *     a seeded client fetching anyway                   KILLED (1)
 *     WAVE's parallel load put back in series           KILLED (1)
 *     Academy's parallel load put back in series        KILLED (1)
 *     one excluded-page path falsified                  KILLED (3)
 *     reword this header                                SURVIVED, as intended
 *
 *   TWO INSTRUMENT FAULTS ON THE WAY, BOTH RECORDED RATHER THAN TIDIED AWAY.
 *
 *   The "awaits its data" check was `/await\s+\w+\(/`, which does not match
 *   `await Promise.all(`. It reported the export dashboard — a page that HAD
 *   been converted — as fetching nothing.
 *
 *   And the mutation run itself: my backup filenames were derived from the
 *   parent directory, so `farm-nation/(member)/dashboard/page.tsx` and
 *   `wave/(member)/dashboard/page.tsx` both saved as `dashboard_page.tsx`. The
 *   restore put farm-nation's content into the WAVE page. Caught by the next
 *   run, recovered from HEAD, and the parallelisation re-applied — the backup
 *   names are keyed on the full path now. Mutation testing is only safe if the
 *   restore is.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** dashboard directory -> the client component the server page renders. */
const CONVERTED: { dir: string; client: string }[] = [
    { dir: 'src/app/farm-nation/(member)/dashboard', client: 'FarmNationDashboardClient.tsx' },
    { dir: 'src/app/cooperatives/(member)/dashboard', client: 'CooperativeDashboardClient.tsx' },
    { dir: 'src/app/export/(app)/dashboard', client: 'ExportDashboardClient.tsx' },
    { dir: 'src/app/marketplace/buyer/dashboard', client: 'BuyerDashboardClient.tsx' },
    { dir: 'src/app/marketplace/seller/dashboard', client: 'SellerDashboardClient.tsx' },
];

/**
 * The two that stay client-fetched, and why. Named so that "converted" cannot
 * quietly come to mean "the ones that were easy".
 */
const DELIBERATELY_CLIENT_FETCHED: { page: string; because: string }[] = [
    {
        page: 'src/app/wave/(member)/dashboard/page.tsx',
        because: 'gated on membershipStatus, resolved in the browser',
    },
    {
        page: 'src/app/academy/dashboard/page.tsx',
        because: 'gated on membership and payment state, resolved in the browser',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#543 — five dashboards fetch on the server', () => {
    it('EVERY CONVERTED page.tsx IS A SERVER COMPONENT', () => {
        for (const { dir } of CONVERTED) {
            const page = code(`${dir}/page.tsx`);
            expect({ dir, isClient: page.includes('"use client"') })
                .toEqual({ dir, isClient: false });
        }
    });

    it('AND EACH ONE AWAITS ITS DATA AND PASSES IT DOWN', () => {
        //   A server page that renders the client without a seed would satisfy
        //   the test above and change nothing at all.
        for (const { dir } of CONVERTED) {
            const page = code(`${dir}/page.tsx`);
            //   `[\w.]` and not `\w`: the export page awaits `Promise.all(...)`,
            //   and a word-character-only pattern reported that server page as
            //   fetching nothing. The instrument said "not converted" about a
            //   page that was.
            expect({ dir, awaits: /await\s+[\w.]+\(/.test(page) })
                .toEqual({ dir, awaits: true });
            expect({ dir, seeds: /initial=\{/.test(page) })
                .toEqual({ dir, seeds: true });
        }
    });

    it('AND EACH CLIENT COMPONENT ACCEPTS THE SEED AND SKIPS ITS OWN FETCH', () => {
        //   The other half. A client that took the prop and fetched anyway would
        //   pay for the data twice.
        for (const { dir, client } of CONVERTED) {
            const src = code(`${dir}/${client}`);
            expect({ dir, accepts: /initial\s*=\s*null/.test(src) })
                .toEqual({ dir, accepts: true });
            //   Either it short-circuits the effect, or it consumes the seed
            //   through the shared take-once hook.
            const skips = /if \(initial !== null\) return;/.test(src)
                || /useServerSeed\(/.test(src);
            expect({ dir, skips }).toEqual({ dir, skips: true });
        }
    });

    it('AND THE CLIENT COMPONENTS ARE REAL FILES, NOT A LIST OF NAMES', () => {
        //   #484's shape: a list of paths that no longer exist reads as
        //   deliberate and asserts nothing.
        for (const { dir, client } of CONVERTED) {
            expect({ f: `${dir}/${client}`, exists: existsSync(join(ROOT, dir, client)) })
                .toEqual({ f: `${dir}/${client}`, exists: true });
        }
        expect(CONVERTED).toHaveLength(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#543 — the two that stay in the browser, and got the other fix', () => {
    it('ARE STILL CLIENT COMPONENTS, ON PURPOSE', () => {
        for (const { page } of DELIBERATELY_CLIENT_FETCHED) {
            expect({ page, isClient: readFileSync(join(ROOT, page), 'utf-8').includes('"use client"') })
                .toEqual({ page, isClient: true });
        }
        expect(DELIBERATELY_CLIENT_FETCHED).toHaveLength(2);
    });

    it('AND NEITHER AWAITS ITS READS ONE AFTER ANOTHER ANY MORE', () => {
        //   THE fix they did get. WAVE ran three unrelated actions in series and
        //   Academy two, so the member waited the SUM of the round trips.
        for (const { page } of DELIBERATELY_CLIENT_FETCHED) {
            const src = code(page);
            expect({ page, parallel: /Promise\.allSettled\(\[/.test(src) })
                .toEqual({ page, parallel: true });
        }
    });

    it('AND WAVE NO LONGER AWAITS ITS THREE ACTIONS SEPARATELY', () => {
        //   Named precisely, because "contains Promise.allSettled" would pass on
        //   a file that also still had the serial awaits beside it.
        const src = code('src/app/wave/(member)/dashboard/page.tsx');

        for (const action of ['getWaveMemberStatsAction', 'getWaveResourcesAction', 'getWaveTrainingEventsAction']) {
            expect({ action, awaitedAlone: new RegExp(`await ${action}\\(`).test(src) })
                .toEqual({ action, awaitedAlone: false });
        }
    });

    it('AND ACADEMY NO LONGER AWAITS ITS TWO SEPARATELY', () => {
        const src = code('src/app/academy/dashboard/page.tsx');

        expect(/await fetch\("\/api\/academy\/dashboard"\)/.test(src)).toBe(false);
        expect(/await getLiveSessionsAction\(\)/.test(src)).toBe(false);
    });

    it('AND A FAILING PANEL STILL COSTS ONLY ITSELF', () => {
        //   allSettled rather than all, for the reason getMyDashboard already
        //   documents: Promise.all discards every result on the first rejection,
        //   so one failing read would blank the whole screen. Parallelising with
        //   `all` would have made these screens more fragile, not less.
        for (const { page } of DELIBERATELY_CLIENT_FETCHED) {
            const src = code(page);
            expect({ page, usesAll: /await Promise\.all\(\[/.test(src) })
                .toEqual({ page, usesAll: false });
        }
    });
});
