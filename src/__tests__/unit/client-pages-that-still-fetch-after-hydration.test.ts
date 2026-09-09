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
const CAP = 14;

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
    //   #548 — batch 3.
    'src/app/export/page.tsx',
    'src/app/export/windows/[id]/page.tsx',
    'src/app/farm-nation/(member)/inquiries/[id]/page.tsx',
    'src/app/academy/live/page.tsx',
    'src/app/dashboard/disputes/page.tsx',
    //   #549 — batch 4.
    'src/app/farm-nation/(member)/inquiries/page.tsx',
    'src/app/cooperatives/(member)/directory/page.tsx',
    'src/app/academy/live/[courseId]/page.tsx',
    'src/app/farm-nation/(member)/edit-property/[id]/page.tsx',
    'src/app/academy/certificate/[certificateId]/page.tsx',
    //   #550 — batch 5.
    'src/app/farm-nation/(member)/my-purchases/page.tsx',
    'src/app/dashboard/disputes/new/page.tsx',
    'src/app/farm-nation/checkout/[propertyId]/page.tsx',
    'src/app/academy/(learner)/progress/page.tsx',
    'src/app/export/(app)/portfolio/page.tsx',
    //   #551 — batch 6.
    'src/app/marketplace/buyer/saved/page.tsx',
    'src/app/farm-nation/saved/page.tsx',
    'src/app/marketplace/buyer/quotes/page.tsx',
    'src/app/marketplace/seller/quotes/page.tsx',
    'src/app/wave/(member)/certificates/page.tsx',
    //   #552 — batch 7.
    'src/app/marketplace/village-market/page.tsx',
    'src/app/marketplace/seller/analytics/page.tsx',
    'src/app/marketplace/seller/orders/page.tsx',
    'src/app/wave/(member)/shipments/page.tsx',
    'src/app/marketplace/orders/[id]/page.tsx',
    //   #553 — batch 8.
    'src/app/escrow/[id]/dispute/page.tsx',
    'src/app/academy/[courseId]/page.tsx',
    'src/app/farm-nation/property/[id]/page.tsx',
    'src/app/farm-nation/page.tsx',
    'src/app/farm-nation/properties/page.tsx',
    //   #554 — batch 9.
    'src/app/marketplace/products/[id]/page.tsx',
    'src/app/marketplace/products/page.tsx',
    'src/app/marketplace/buyer/orders/page.tsx',
    'src/app/marketplace/buyer/orders/[id]/page.tsx',
    'src/app/marketplace/buyer/products/page.tsx',
    //   #555 — batch 10.
    'src/app/marketplace/sell/page.tsx',
    'src/app/academy/[courseId]/lesson/[lessonId]/page.tsx',
    'src/app/cooperatives/(member)/my-loans/page.tsx',
    'src/app/marketplace/onboarding/page.tsx',
    'src/app/farm-nation/onboarding/page.tsx',
    //   #564 — batch 16, the cooperative member screens and the public
    //   certificate verifier.
    'src/app/cooperatives/(member)/fixed-savings/page.tsx',
    'src/app/cooperatives/(member)/my-savings/page.tsx',
    'src/app/cooperatives/(member)/withdrawals/page.tsx',
    'src/app/academy/verify/[certificateId]/page.tsx',
    //   #562 — batch 15. The first four API-route self-fetchers, each read
    //   through a reader shared with the route rather than over HTTP.
    'src/app/land/page.tsx',
    'src/app/farm-nation/map/page.tsx',
    'src/app/dashboard/certificates/page.tsx',
    'src/app/academy/[courseId]/quiz/[moduleId]/page.tsx',
    'src/app/academy/application/page.tsx',
    //   #560 — batch 14.
    'src/app/cooperatives/payment/page.tsx',
    'src/app/marketplace/seller/products/[id]/edit/page.tsx',
    'src/app/wave/application/page.tsx',
    'src/app/escrow/[id]/chat/page.tsx',
    'src/app/messages/page.tsx',
    //   #559 — batch 13.
    'src/app/cooperatives/(member)/id-card/page.tsx',
    'src/app/marketplace/village-market/[id]/page.tsx',
    'src/app/marketplace/seller/orders/[id]/page.tsx',
    'src/app/marketplace/verify/page.tsx',
    'src/app/marketplace/village-market/seller/page.tsx',
    //   #558 — batch 12.
    'src/app/dashboard/wallet/page.tsx',
    'src/app/dashboard/notifications/page.tsx',
    'src/app/marketplace/seller/products/page.tsx',
    'src/app/academy/setup/page.tsx',
    'src/app/export/onboarding/page.tsx',
    //   #556 — batch 11, the WAVE member area and the payout account.
    'src/app/profile/bank-account/page.tsx',
    'src/app/wave/(member)/earnings/page.tsx',
    'src/app/wave/(member)/profile/page.tsx',
    'src/app/wave/(member)/training/page.tsx',
    'src/app/wave/(member)/resources/page.tsx',
    'src/app/farm-nation/(member)/dashboard/page.tsx',
    'src/app/cooperatives/(member)/dashboard/page.tsx',
    'src/app/export/(app)/dashboard/page.tsx',
    'src/app/marketplace/buyer/dashboard/page.tsx',
    'src/app/marketplace/seller/dashboard/page.tsx',
];

/**
 * Converted server pages that still unwrap their action result inline, rather
 * than through lib/server-seed.
 *
 *   #552 A SECOND LEDGER, FOR THE SAME REASON AS THE FIRST.
 *
 *   #551 found that every one of these drops the action's `error` — a failed
 *   server seed leaves no log line anywhere — and introduced seedOrNull to fix
 *   it. Five pages use it. These do not, and a blanket regex across them was
 *   considered and REJECTED: their shapes genuinely differ (a Promise.all of
 *   two results, a single result, a picked sub-field, a comment between the
 *   two statements), and #535 already recorded what a regex over heterogeneous
 *   sites costs on code that is working.
 *
 *   So they are counted instead. The number may only go down.
 */
const UNWRAP_INLINE_CAP = 16;

/**
 * Pages that match the SHAPE and will never come off this ledger by conversion.
 *
 *   The count is deliberately a shape and not a judgement — see the header —
 *   which means some of what it counts has nothing for a server to fetch. Left
 *   unrecorded, each of these gets picked up as a candidate, read, and put back
 *   down again; #558 spent a candidate slot on wave/briefing that way.
 *
 *   Named rather than described, and asserted to still be IN the count, so a
 *   list that goes stale fails instead of quietly reading as deliberate (#484).
 */
const NOT_CONVERTIBLE: { page: string; because: string }[] = [
    {
        page: 'src/app/wave/(member)/dashboard/page.tsx',
        because: 'gated on membershipStatus resolved in the browser — #543 kept it '
            + 'client-fetched on purpose and parallelised its reads instead',
    },
    {
        page: 'src/app/academy/dashboard/page.tsx',
        because: 'gated on membership and payment state resolved in the browser — same '
            + 'deliberate exclusion as WAVE, recorded in #543',
    },
    {
        page: 'src/app/wave/briefing/page.tsx',
        because: 'no read on mount at all — the action call is an offline-sync WRITE '
            + 'replaying a registration out of localStorage, which the server cannot see',
    },
    {
        page: 'src/app/export/buyer/cart/page.tsx',
        because: 'the cart lives in the browser; the actions fire on checkout, not on mount',
    },
    {
        page: 'src/app/marketplace/sell/create/page.tsx',
        because: 'a create form — its actions fire on submit and on upload, not on mount',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#553 — a seed reaches the component that actually holds the state', () => {
    /**
     * THE TRAP I FELL INTO TWICE.
     *
     * Some of these client files hold TWO components: a thin default export
     * that wraps a Suspense boundary, and the real component below or above it.
     * Declaring `initial` on the default export while the state lives in the
     * other one leaves the prop dangling — it compiled to "Cannot find name
     * 'initial'" in dashboard/disputes/new (#550) and again in
     * farm-nation/properties (#553), because I recognised the shape and still
     * did not check for it first.
     *
     * tsc caught both, which is the only reason this is an anecdote rather than
     * a defect. This makes it mechanical: wherever a converted client renders
     * an inner component inside Suspense, the seed must be passed to it.
     */
    it('EVERY CONVERTED CLIENT WITH AN INNER COMPONENT PASSES THE SEED DOWN', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'admin') walk(full);
                } else if (/Client\.tsx$/.test(entry)) {
                    const src = readFileSync(full, 'utf-8');
                    if (!/initial\s*[=?]/.test(src)) continue;

                    //   An inner component rendered by the default export.
                    const inner = src.match(/<(\w+Content)\s*([^>]*)\/>/);
                    if (!inner) continue;

                    //   It must be handed the seed.
                    if (!/initial=\{/.test(inner[2] ?? '')) {
                        offenders.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        expect(offenders).toEqual([]);
    });

    it('AND THE CHECK CAN ACTUALLY FIRE — a known wrapper is found', () => {
        //   The guard on the measurement: if the pattern matched nothing, the
        //   assertion above would pass for the wrong reason.
        const wrappers: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (/Client\.tsx$/.test(entry)
                    && /<\w+Content\s*[^>]*\/>/.test(readFileSync(full, 'utf-8'))) {
                    wrappers.push(full);
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        expect(wrappers.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#552 — the converted pages converge on one unwrapper', () => {
    function serverPagesUnwrappingInline(): string[] {
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'admin') walk(full);
                } else if (entry === 'page.tsx') {
                    const src = readFileSync(full, 'utf-8');
                    //   Only the pages this ledger converted.
                    if (!src.includes('EXPLICITLY DYNAMIC')) continue;
                    //   #555 `rawSeed` counts too. This check predates it — it
                    //   was written when seedOrNull was the only shared
                    //   unwrapper — so thirteen pages that HAD converged still
                    //   read as inline and the cap failed for a change that
                    //   improved things. The instrument was stale, not the code.
                    if (src.includes('seedOrNull') || src.includes('rawSeed')) continue;
                    if (!/\?\.success/.test(src)) continue;
                    found.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        return found.sort();
    }

    it('NO MORE PAGES UNWRAP INLINE THAN ARE RECORDED', () => {
        const pages = serverPagesUnwrappingInline();

        expect({ count: pages.length, cap: UNWRAP_INLINE_CAP })
            .toEqual({ count: pages.length, cap: UNWRAP_INLINE_CAP });
        expect(pages.length).toBeLessThanOrEqual(UNWRAP_INLINE_CAP);
    });

    it('AND THE SHARED UNWRAPPER IS ACTUALLY USED SOMEWHERE', () => {
        //   The guard on the measurement: a cap of 16 is also satisfied by
        //   nobody using seedOrNull at all, which would mean the fix in #551
        //   reached nothing.
        const users: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (entry === 'page.tsx' && readFileSync(full, 'utf-8').includes('seedOrNull')) {
                    users.push(full);
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        expect(users.length).toBeGreaterThan(3);
    });
});

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

        /**
         *   THE FLOOR IS DERIVED NOW, NOT GUESSED.
         *
         *   This was a literal — 50, then 20 — and it went stale TWICE as the
         *   ledger was worked down, failing for a change that improved things.
         *   A guard that has to be edited every few batches is a guard people
         *   learn to edit rather than obey.
         *
         *   So it is tied to something that cannot shrink: the pages recorded
         *   below as never coming off this ledger. Every one of them matches
         *   the scan by construction, so a scan pointed at nothing fails here,
         *   and the number moves only when that list does.
         */
        expect(pages.length).toBeGreaterThanOrEqual(NOT_CONVERTIBLE.length);
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

    it('AND THE PAGES THAT CANNOT BE CONVERTED ARE NAMED, NOT REDISCOVERED', () => {
        //   Each must still exist and still be counted. If one is ever
        //   converted the list has to be edited, which is the point: the note
        //   cannot rot into a list of paths that mean nothing.
        const pages = new Set(pagesThatFetchAfterHydration());

        for (const { page } of NOT_CONVERTIBLE) {
            expect({ page, exists: existsSync(join(ROOT, page)) })
                .toEqual({ page, exists: true });
            expect({ page, counted: pages.has(page) }).toEqual({ page, counted: true });
        }
        expect(NOT_CONVERTIBLE.every(e => e.because.length > 20)).toBe(true);
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
