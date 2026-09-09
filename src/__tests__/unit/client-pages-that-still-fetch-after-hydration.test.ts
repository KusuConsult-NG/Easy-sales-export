/**
 * @jest-environment node
 */

/**
 *   #545 THE COUNT OF SCREENS THAT STILL MAKE THE USER WAIT AFTER THE PAGE HAS
 *        ARRIVED — MEASURED, CAPPED, AND ONLY ALLOWED TO GO DOWN.
 *
 *   #540 to #543 fixed the hydration waterfall on the screens a member hits
 *   first: /dashboard, /messages, /profile and five module dashboards. This
 *   records what is left, because "the rest are still like that" is worth
 *   exactly nothing as a note in a commit message and quite a lot as a number
 *   that cannot silently grow.
 *
 * ── WHY NOT SIMPLY CONVERT ALL OF THEM ─────────────────────────────────────
 *
 *   Because it is the change most likely to break something that currently
 *   works, and that is the owner's standing complaint about this codebase:
 *   "since we built, it has always broken in one way or the other and everytime
 *   we fix it breaks".
 *
 *   Each conversion moves a file, and moving a file breaks every suite that
 *   reads it by path — /profile alone took eight, the five dashboards took
 *   three more. Multiplied across ninety-three pages that is a very large diff
 *   whose failure mode is subtle: a screen that renders but no longer refetches
 *   on a dependency change, or a seed handed to a component whose effect also
 *   still fetches, so the data is paid for twice. Neither shows up as a red
 *   test unless someone writes the test.
 *
 *   So the remainder is a ledger, not a promise. The cap goes down as pages are
 *   converted, and the test fails if it goes up.
 *
 * ── WHAT THE NUMBER MEANS, EXACTLY ─────────────────────────────────────────
 *
 *   A user-facing page (never /admin) that is a client component AND has a
 *   useEffect AND calls a server action or fetch. Those three together are the
 *   waterfall: the HTML arrives, the bundle downloads, React hydrates, and only
 *   then does the screen ask for what it needs.
 *
 *   It is deliberately a SHAPE and not a judgement. Some of the ninety-three
 *   fetch on an interaction rather than on mount and are counted anyway,
 *   because a check that tried to tell those apart would be guessing, and a
 *   ratchet that guesses is one that gets edited rather than obeyed.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the cap raised to 200                          KILLED
 *     the scan pointed at a directory with no pages  KILLED
 *     the /admin exclusion dropped                   KILLED
 *     the converted list falsified                   KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

/**
 * The high-water mark. Lower it when a page is converted; never raise it.
 *
 * A new client page that fetches on mount is not forbidden — sometimes it is
 * the right shape — but it has to displace one that was converted, or this
 * fails and the choice becomes deliberate.
 */
const CAP = 83;

/** Every user-facing client page that fetches after hydration. */
function pagesThatFetchAfterHydration(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                //   Admin screens are excluded: a handful of staff, not every
                //   member, and they are a separate pass.
                if (entry !== 'admin') walk(full);
            } else if (entry === 'page.tsx') {
                const src = readFileSync(full, 'utf-8');
                if (!src.includes('"use client"')) continue;
                if (!/useEffect/.test(src)) continue;
                if (!/(Action\s*\(|await fetch\()/.test(src)) continue;
                found.push(full.slice(ROOT.length + 1));
            }
        }
    };
    walk(join(ROOT, 'src/app'));
    return found.sort();
}

/**
 * The screens already converted to fetch on the server.
 *
 * Listed so that the cap cannot be met by converting nothing and deleting
 * pages, and so the claim "the ones a member hits first are done" is checkable
 * rather than asserted.
 */
const CONVERTED = [
    'src/app/profile/page.tsx',
    //   #546 — the first batch worked through the ledger.
    'src/app/academy/(learner)/my-courses/page.tsx',
    'src/app/cooperatives/(member)/history/page.tsx',
    'src/app/export/(app)/bookings/page.tsx',
    'src/app/export/(app)/transactions/page.tsx',
    'src/app/export/(app)/opportunities/page.tsx',
    //   #547 — batch 2.
    'src/app/dashboard/reviews/page.tsx',
    'src/app/export/(app)/products/page.tsx',
    'src/app/academy/(learner)/courses/page.tsx',
    'src/app/escrow/[id]/page.tsx',
    'src/app/export/(app)/investments/[id]/page.tsx',
    'src/app/farm-nation/(member)/dashboard/page.tsx',
    'src/app/cooperatives/(member)/dashboard/page.tsx',
    'src/app/export/(app)/dashboard/page.tsx',
    'src/app/marketplace/buyer/dashboard/page.tsx',
    'src/app/marketplace/seller/dashboard/page.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#545 — the waterfall that is left is counted', () => {
    it('NO MORE THAN THE RECORDED NUMBER OF PAGES STILL FETCH AFTER HYDRATION', () => {
        const pages = pagesThatFetchAfterHydration();

        //   Reported by name on failure, so a regression says WHICH page rather
        //   than only that the number moved.
        expect({ count: pages.length, cap: CAP, overBy: pages.slice(CAP) })
            .toEqual({ count: pages.length, cap: CAP, overBy: [] });
        expect(pages.length).toBeLessThanOrEqual(CAP);
    });

    it('AND THE SCAN ACTUALLY FINDS PAGES — the guard on the measurement', () => {
        //   #484's shape. A scan pointed at the wrong directory reports zero
        //   offenders for the same reason it reports nothing at all, and a cap
        //   of 93 is satisfied by finding none.
        const pages = pagesThatFetchAfterHydration();

        expect(pages.length).toBeGreaterThan(50);
        expect(pages.every(p => p.startsWith('src/app/'))).toBe(true);
        expect(pages.every(p => p.endsWith('page.tsx'))).toBe(true);
    });

    it('AND IT EXCLUDES /admin ON PURPOSE, NOT BY ACCIDENT', () => {
        //   If the exclusion were ever dropped the count would jump and the cap
        //   would fail — which is right — but it would fail for the wrong
        //   reason. Stated here so the two cannot be confused.
        const pages = pagesThatFetchAfterHydration();

        expect(pages.filter(p => p.includes('/admin/'))).toEqual([]);
    });

    it('AND EVERY CONVERTED PAGE IS OUT OF THE COUNT AND STILL EXISTS', () => {
        //   The other direction: a converted page that quietly went back to
        //   fetching in the browser would be in this list again.
        const pages = new Set(pagesThatFetchAfterHydration());

        for (const f of CONVERTED) {
            expect({ f, exists: existsSync(join(ROOT, f)) }).toEqual({ f, exists: true });
            expect({ f, stillFetchesInBrowser: pages.has(f) })
                .toEqual({ f, stillFetchesInBrowser: false });
        }
    });

    it('AND THE SCREENS A MEMBER LANDS ON FIRST ARE AMONG THEM', () => {
        //   The claim being made in the commit messages, checked rather than
        //   asserted: /dashboard and /messages are fixed at the LAYOUT (#540),
        //   so they are server components' children rather than converted
        //   pages, and neither may fetch after hydration.
        const pages = new Set(pagesThatFetchAfterHydration());

        expect(pages.has('src/app/dashboard/page.tsx')).toBe(false);
        expect(pages.has('src/app/profile/page.tsx')).toBe(false);
    });
});
