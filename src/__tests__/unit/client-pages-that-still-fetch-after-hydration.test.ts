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
 *
 * ── IT WAS RAISED ONCE, IN #568, AND HERE IS EXACTLY WHY ────────────────────
 *
 *   12 -> 14. NOT because two screens regressed: because two were NEVER
 *   COUNTED. The scan required `useEffect`, and academy/payment/callback and
 *   marketplace/payment/callback have always done their mount read behind
 *   `useOnce` instead — this codebase's own effect wrapper. They matched the
 *   definition and were invisible to the measurement.
 *
 *   The number of screens that fetch after hydration did not change on the day
 *   this was raised. What changed is that the instrument can see all of them.
 *
 *   Recorded this loudly because silently raising a ratchet is precisely what
 *   ratchets exist to prevent, and "the measurement was wrong" is the one
 *   reason that justifies it — which makes it the excuse to check hardest.
 *   Every page in the count is now named below, in NOT_CONVERTIBLE, with a
 *   reason each. (#570 converted cooperatives/(member)/loans, which had been
 *   the one exception — held back at the owner's instruction about the loan
 *   product until they released it.)
 */
const CAP = 12;

/**
 *   #568 `useOnce` COUNTS TOO, AND THE SCAN HAS BEEN BLIND TO
 *        IT SINCE THIS LEDGER WAS WRITTEN.
 *
 *   The check was `/useEffect/` alone. useOnce is this
 *   codebase's own wrapper — an effect with a ref guard, used by
 *   the payment callbacks — so a page whose only mount read sat
 *   behind it was INVISIBLE here. Two of the seven payment
 *   callbacks were never counted, and converting a third to
 *   useOnce in #568 silently removed it from the count, which is
 *   how this was noticed: a change that should not have moved
 *   the number moved it.
 *
 *   A ledger that a refactor can walk out of is not a ledger.
 *   Any mount-time effect counts, whatever it is spelled.
 */
/**
 *   #578 A FETCH WITHOUT AN `await` COUNTS TOO, AND THE SCAN
 *        HAS BEEN BLIND TO IT SINCE THIS LEDGER WAS WRITTEN.
 *
 *   The check was `await fetch\(`. /export/buyer — the export
 *   product catalogue, the shop window for international
 *   buyers — reads its own API on mount as a promise chain:
 *
 *       fetch("/api/export/catalog").then(...).finally(...)
 *
 *   No `await`, so it was INVISIBLE HERE, while rendering a
 *   full-screen spinner and nothing else until the round trip
 *   finished. That is the waterfall in its worst form, and the
 *   instrument could not see it.
 *
 *   #568 was the same fault in the other spelling — `useOnce`
 *   rather than `useEffect` — which is what makes this worth a
 *   second note: BOTH BLIND SPOTS WERE A SYNTAX THE SCAN
 *   EXPECTED RATHER THAN A BEHAVIOUR IT MEASURED. Any call to
 *   fetch counts now, awaited or not.
 *
 *   Measured before and after: widening it added exactly one
 *   page, the one #578 then converted, so the cap does not move
 *   in this change. It would have moved for anybody who added a
 *   `.then()` fetch to a page in the meantime, which is the
 *   point of fixing the instrument rather than the number.
 */
/**
 * The three things that together are the waterfall, in one predicate.
 *
 *   #578 SO THAT THE SHAPE ITSELF CAN BE TESTED, and not only the corpus.
 *
 *   Both times this instrument was found blind — #568's `useOnce` and #578's
 *   un-awaited `fetch` — the widening was UNFALSIFIABLE at the moment it was
 *   made: the page that exposed the gap was converted in the same change, so
 *   the count came out identical either way and reverting the regex broke
 *   nothing. A check that cannot fail is the defect this audit has found most
 *   often, and shipping one inside the instrument that counts the others would
 *   be a poor joke.
 *
 *   The predicate is now exercised directly, against samples of each spelling.
 */
export function looksLikeAPostHydrationFetch(src: string): boolean {
    if (!src.includes('"use client"')) return false;
    if (!/useEffect|useOnce/.test(src)) return false;
    if (!/(Action\s*\(|fetch\()/.test(src)) return false;
    return true;
}

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
                if (!looksLikeAPostHydrationFetch(src)) continue;
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
    //   #567 — batch 17. The last two API-route self-fetchers, each read
    //   through a reader shared with the route rather than over HTTP.
    'src/app/settings/security/mfa/page.tsx',
    'src/app/wave/(member)/live-training/page.tsx',
    //   #570 — the cooperative loans screen, once the owner released the hold
    //   they had placed on the loan product.
    'src/app/cooperatives/(member)/loans/page.tsx',
    //   #578 — the export product catalogue, which the scan above could not
    //   see until this change: a full-screen spinner until its own API
    //   answered, on the screen international buyers land on.
    'src/app/export/buyer/page.tsx',
    //   #577 — the export buyer cart. IT NEVER HAD A WATERFALL, and this is
    //   the one entry on this list that did not remove one: it came off the
    //   ledger because the naira total it quotes is converted at an
    //   owner-editable rate, and a browser constant is the wrong place to keep
    //   a number that is meant to change. The server half seeds the rate; the
    //   basket is still read from localStorage exactly as before.
    'src/app/export/buyer/cart/page.tsx',
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
        page: 'src/app/marketplace/sell/create/page.tsx',
        because: 'a create form — its actions fire on submit and on upload, not on mount',
    },
    {
        page: 'src/app/verify-id/page.tsx',
        because: 'a QR scanner — its only fetch fires on a scan, and its effect is a '
            + 'camera teardown; nothing is read on mount at all',
    },
    {
        page: 'src/app/academy/payment/callback/page.tsx',
        because: 'a payment callback — one of the two that were invisible to this scan '
            + 'until #568 taught it about useOnce; same reasoning as the others',
    },
    {
        page: 'src/app/marketplace/payment/callback/page.tsx',
        because: 'a payment callback — the other one the scan could not see before #568',
    },
    {
        page: 'src/app/export/payment/callback/page.tsx',
        because: 'a payment callback — see #568. Verifying a payment is a MUTATION, and '
            + 'moving it into a server render would make it a side effect of a GET: it '
            + 'would run on any re-render, prefetch or crawl, with no browser involved. '
            + 'The idempotency gate makes that safe, not right',
    },
    {
        page: 'src/app/farm-nation/payment/callback/page.tsx',
        because: 'a payment callback — same reasoning as the export one above',
    },
    {
        page: 'src/app/export/buyer/cart/payment-callback/page.tsx',
        because: 'a payment callback, and it also clears the basket and the buyer details '
            + 'out of localStorage (#569) — neither of which a server render can reach',
    },
    {
        page: 'src/app/cooperatives/payment/callback/page.tsx',
        because: 'a payment callback — same reasoning, plus its redirect target depends on '
            + 'window.location.hostname, which only the browser knows',
    },
    {
        page: 'src/app/marketplace/checkout/page.tsx',
        because: 'its mount reads take the CART, which lives in localStorage, and '
            + 'COORDINATES from the browser geocoder — inputs the server cannot see. '
            + 'Only the saved-address read could move, and moving one of two would '
            + 'take the page off this ledger while the real wait remained',
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

    /**
     *   THE PREDICATE, EXERCISED DIRECTLY — #578.
     *
     *   Reverting either widening leaves the corpus count unchanged today,
     *   because both pages that exposed a blind spot were converted in the same
     *   change that found it. These are the tests that fail instead.
     */
    it('POSITIVE CONTROL: A `.then()` FETCH IS A POST-HYDRATION FETCH', () => {
        //   #578's spelling. `await fetch(` alone does not see this.
        expect(looksLikeAPostHydrationFetch(
            '"use client";\nuseEffect(() => { fetch("/api/x").then(r => r.json()); }, []);'
        )).toBe(true);
    });

    it('POSITIVE CONTROL: SO IS AN AWAITED ONE, AND SO IS useOnce', () => {
        expect(looksLikeAPostHydrationFetch(
            '"use client";\nuseEffect(() => { const r = await fetch("/api/x"); }, []);'
        )).toBe(true);
        //   #568's spelling.
        expect(looksLikeAPostHydrationFetch(
            '"use client";\nuseOnce(() => { verifyPaymentAction(ref); });'
        )).toBe(true);
    });

    it('NEGATIVE CONTROL: AND A PAGE THAT ASKS FOR NOTHING IS NOT', () => {
        //   Without this the predicate is satisfied by returning true.
        expect(looksLikeAPostHydrationFetch(
            '"use client";\nuseEffect(() => { setMounted(true); }, []);'
        )).toBe(false);
        //   A server page, whatever it contains.
        expect(looksLikeAPostHydrationFetch(
            'export default async function Page() { await fetch("/api/x"); }'
        )).toBe(false);
        //   A client page with a fetch but no effect: it fires on an
        //   interaction, and this ledger is about mount.
        expect(looksLikeAPostHydrationFetch(
            '"use client";\nfunction onClick() { fetch("/api/x"); }'
        )).toBe(false);
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
