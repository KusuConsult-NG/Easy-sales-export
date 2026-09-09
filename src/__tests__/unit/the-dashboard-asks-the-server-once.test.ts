/**
 * @jest-environment node
 */

/**
 *   #453 THE DASHBOARD ASKED THE SERVER EIGHT TIMES, AND CHECKED THE SAME
 *   SESSION EIGHT TIMES, TO DRAW ONE PAGE.
 *
 *   /dashboard opened with eight server actions in a Promise.allSettled.
 *   Parallel in the BROWSER, and still eight separate HTTP round trips to the
 *   container — each paying full latency, each re-checking the session.
 *
 *   AND THE SESSION CHECK IS NOT FREE. Every one of the eight begins with
 *   currentUserId() -> requireSession(), which tries Redis and falls through to
 *   a DATABASE READ of the user document on a miss. This platform is deployed
 *   with UPSTASH_REDIS_REST_URL unset — its own startup log says so:
 *
 *       [Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.
 *       Caching is disabled and every rate limiter is using its per-instance
 *       in-memory fallback...
 *
 *   So one dashboard load performed EIGHT IDENTICAL READS of the same user row
 *   before doing any of the work it was asked for.
 *
 *   TWO FIXES, AND THEY ARE INDEPENDENT
 *
 *     Setting Redis removes seven of the eight profile READS. That is
 *     configuration, and it is the owner's to do.
 *
 *     Collapsing the call removes seven of the eight ROUND TRIPS and seven of
 *     the eight SESSION CHECKS, whether Redis is configured or not. That is
 *     this commit.
 *
 *   The eight functions stay exported and unchanged — other screens call
 *   several of them individually, and speeding up the dashboard is not a reason
 *   to disturb those.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the page calls the eight actions again      KILLED
 *     getMyDashboard drops a field                KILLED
 *     allSettled weakened to all                  KILLED
 *     the nav's fallback poll left unguarded      KILLED  (#539)
 *     the page fetching for itself again          KILLED  (#539)
 *     reword this header                          SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const PAGE = 'src/app/dashboard/page.tsx';
const ACTIONS = 'src/app/actions/my-data.ts';
/**
 *   #539 THE SINGLE CALL MOVED UP A LEVEL, AND THE PROPERTY IS UNCHANGED.
 *
 *   #453's claim was "this screen makes one round trip, not eight". It still
 *   is — but the page is no longer where the trip is made. DashboardNav, in the
 *   LAYOUT above this page, was separately polling three of the values
 *   getMyDashboard already returns, so on /dashboard each of those three was
 *   fetched twice about every eight seconds. A page cannot hand anything to its
 *   own parent layout, so the call had to move ABOVE both of them.
 *
 *   The assertions below therefore follow it to the provider rather than being
 *   deleted. The page must now call NOTHING, which is a stronger statement than
 *   the one it replaces.
 */
const PROVIDER = 'src/contexts/NavSummaryContext.tsx';

/** The eight the page used to call one at a time. */
const THE_EIGHT = [
    'getMyServiceRegistrations',
    'getMyUnreadNotificationCount',
    'getMyUnreadMessageCount',
    'getMyNotifications',
    'getMyWalletBalance',
    'getMyActiveOrderCount',
    'getUpcomingEvents',
    'getRecentResources',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#453 — one round trip, not eight', () => {
    it('THE SCREEN CALLS ONE ACTION — from the provider above the page', () => {
        expect(source(PROVIDER)).toContain('await getMyDashboard()');
    });

    it('AND THE PAGE ITSELF NOW CALLS NOTHING AT ALL', () => {
        //   Stronger than #453's original claim. The page used to make the one
        //   call; it now reads the result and makes none.
        const page = source(PAGE);

        expect(/\bgetMyDashboard\s*\(/.test(page)).toBe(false);
        expect(page).toContain('useNavSummary()');
    });

    it('AND THE NAV DOES NOT POLL WHEN THE SHARED POLL IS PRESENT', () => {
        //   The finding itself: three pollers in the nav, every one of them
        //   reading a value the dashboard payload already carried.
        const nav = source('src/components/dashboard/DashboardNav.tsx');

        expect(nav).toContain('useNavSummary()');
        const guarded = nav.match(/enabled: !!userId && !usingSharedPoll/g) ?? [];
        expect(guarded).toHaveLength(2);
    });

    it('AND CALLS NONE OF THE EIGHT DIRECTLY', () => {
        // The measurement that matters. Eight names, none of them invoked from
        // the page any more.
        const page = source(PAGE);

        const stillCalled = THE_EIGHT.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(page));
        expect({ stillCalled }).toEqual({ stillCalled: [] });
    });

    it('POSITIVE CONTROL: that scan really would catch a direct call', () => {
        // Without this, "none are called" could pass because the regex is wrong.
        const sample = 'const x = await getMyWalletBalance();';
        const caught = THE_EIGHT.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(sample));

        expect(caught).toEqual(['getMyWalletBalance']);
    });

    it('and the collapsed action covers ALL EIGHT — nothing was dropped', () => {
        // A faster page that quietly stopped showing the wallet balance would
        // be a worse page. Each name appears inside getMyDashboard.
        const actions = source(ACTIONS);
        const start = actions.indexOf('export async function getMyDashboard');
        expect(start).toBeGreaterThan(-1);

        const body = actions.slice(start, start + 3000);
        const missing = THE_EIGHT.filter((name) => !body.includes(`${name}(`));

        expect({ missing }).toEqual({ missing: [] });
    });

    it('and the eight stay exported, because other screens call them', () => {
        // Collapsing the dashboard is not a reason to break every other caller.
        const actions = source(ACTIONS);

        for (const name of THE_EIGHT) {
            expect({ name, exported: actions.includes(`export async function ${name}`) })
                .toEqual({ name, exported: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#453 — a failing tile still costs only itself', () => {
    it('getMyDashboard USES allSettled, NOT all', () => {
        //   The page's own comment explains why, and that reasoning survives the
        //   collapse: Promise.all rejects on the first rejection and discards
        //   every other result, which left the whole page on its initial zeros.
        //
        //   Moving the work server-side would have quietly undone that if the
        //   combined action used `all`.
        const actions = source(ACTIONS);
        const start = actions.indexOf('export async function getMyDashboard');
        const body = actions.slice(start, start + 3000);

        expect(body).toContain('Promise.allSettled');
        expect(body).not.toMatch(/Promise\.all\(/);
    });

    it('and names the failure rather than swallowing it', () => {
        // A blank tile with nothing in the log is the kind of thing that gets
        // diagnosed twice.
        const actions = source(ACTIONS);
        const start = actions.indexOf('export async function getMyDashboard');
        const body = actions.slice(start, start + 3000);

        expect(body).toMatch(/logger\.error/);
        expect(body).toContain('failed');
    });

    it('and returns the empty shape when the caller is signed out', () => {
        // Every one of the eight opens with `if (!userId) return <default>`.
        // The collapsed action has to keep that, or a signed-out request runs
        // eight queries to produce nothing.
        const actions = source(ACTIONS);
        const start = actions.indexOf('export async function getMyDashboard');
        const body = actions.slice(start, start + 3000);

        expect(body).toMatch(/if \(!\(await currentUserId\(\)\)\) return empty;/);
    });
});
