/**
 * @jest-environment node
 */

/**
 *   THE OWNER'S PRODUCTION LOG, in bursts:
 *
 *       ⨯ Error: The destination stream closed early.
 *           at ignore-listed frames { digest: '2398141500' }
 *
 *   on `/dashboard?_rsc=`.
 *
 * ── WHAT AN ABORTED RSC STREAM ON THAT PATH MEANS ───────────────────────────
 *
 *   `?_rsc=` is Next asking the server to render a route so a navigation to it
 *   can be instant. The stream closing early means the browser stopped
 *   listening before the render finished — a prefetch cancelled, usually
 *   because it was speculative and something with a real user behind it needed
 *   the connection more.
 *
 *   lib/request-abort already classifies these so they do not drown Sentry, and
 *   my-data.ts already cached the platform-wide reads behind them. Neither
 *   addressed WHY there were so many, and the answer is this nav.
 *
 * ── A PERSISTENT SIDEBAR PREFETCHES EVERYTHING, ALWAYS ──────────────────────
 *
 *   Next prefetches a `<Link>` when it enters the viewport. DashboardNav is
 *   persistent: every link in it is in the viewport from the moment any
 *   dashboard page opens. So the whole sidebar — up to six module dashboards
 *   and seven dashboard rows — is rendered on the server the instant somebody
 *   arrives, and the viewport has told us nothing about where they are going,
 *   because everything is always in it.
 *
 *   Each of those renders goes through `dashboard/layout.tsx`, which awaits the
 *   hub guard and getMyDashboard() before it can answer. Thirteen of those,
 *   most of them cancelled, is the burst.
 *
 * ── AND THE CONVENTION ALREADY EXISTED ──────────────────────────────────────
 *
 *   ModuleSidebar and AdminSidebar — the application's other two persistent
 *   navs — were given `prefetch={false}` for exactly this reason. DashboardNav
 *   was missed, and it is the one whose links point at the route the log names.
 *
 *   What it costs: a navigation renders when it is clicked rather than arriving
 *   warm. One render when somebody acts, against thirteen whenever anybody
 *   looks.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const code = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every persistent navigation in the application. */
const SIDEBARS = [
    'src/components/dashboard/DashboardNav.tsx',
    'src/components/layout/ModuleSidebar.tsx',
    'src/components/admin/AdminSidebar.tsx',
];

/**
 * Each `<Link` and the props that follow it, up to the end of the opening tag.
 *
 * By SHAPE rather than by an enumerated list of hrefs, which is #824's lesson:
 * a named list cannot catch the link somebody adds next.
 */
function linkTags(src: string): string[] {
    const tags: string[] = [];
    for (const match of src.matchAll(/<Link\b/g)) {
        const from = match.index ?? 0;
        //   The opening tag ends at the first `>` that is not inside a brace
        //   expression; className templates contain none, so the first `>`
        //   after the props is the tag's.
        const end = src.indexOf('>', from);
        tags.push(src.slice(from, end === -1 ? src.length : end));
    }
    return tags;
}

describe('a persistent sidebar does not prefetch its whole application', () => {
    it('EVERY LINK IN THE DASHBOARD NAV OPTS OUT', () => {
        //   THE fix. Thirteen speculative RSC renders of a dynamic route, each
        //   running the hub guard and the dashboard read, on every arrival.
        const tags = linkTags(code(SIDEBARS[0]));

        expect(tags.length).toBeGreaterThan(0);
        const eager = tags.filter((t) => !t.includes('prefetch={false}'));
        expect(eager).toEqual([]);
    });

    it('AND SO DOES EVERY LINK IN THE OTHER TWO', () => {
        //   Stated as one rule over all three, so the next persistent nav is
        //   measured against the same line rather than against whichever of
        //   the three somebody happens to copy.
        for (const rel of SIDEBARS) {
            const eager = linkTags(code(rel)).filter((t) => !t.includes('prefetch={false}'));
            expect({ rel, eager }).toEqual({ rel, eager: [] });
        }
    });

    it('CONTROL: THE SWEEP WOULD CATCH ONE', () => {
        /*
         *   Vacuity guard. Both assertions above are "the list is empty", and
         *   they would pass just as happily against a parser that found no
         *   links at all.
         */
        const planted = `
            <Link href="/dashboard/wallet" className="row">Wallet</Link>
            <Link prefetch={false} href="/dashboard">Overview</Link>
        `;
        const eager = linkTags(planted).filter((t) => !t.includes('prefetch={false}'));

        expect(eager).toHaveLength(1);
        expect(eager[0]).toContain('/dashboard/wallet');
    });

    it('AND THE PARSER SEES EVERY LINK IN EACH FILE', () => {
        //   The other half of the guard: the count it found must match the
        //   count in the file, or an unparsed link is an unchecked one.
        for (const rel of SIDEBARS) {
            const src = code(rel);
            const occurrences = (src.match(/<Link\b/g) ?? []).length;
            expect({ rel, parsed: linkTags(src).length }).toEqual({ rel, parsed: occurrences });
            expect({ rel, any: occurrences > 0 }).toEqual({ rel, any: true });
        }
    });
});

describe('and the layout those prefetches were paying for', () => {
    it('IT STILL DOES ITS WORK ON THE SERVER for a real visit', () => {
        /*
         *   #540's gain is not given up. The point is not to stop the layout
         *   fetching; it is to stop thirteen copies of it running for a person
         *   who opened one page. A visitor who arrives still gets the dashboard
         *   in the HTML rather than after hydration.
         */
        const src = code('src/app/dashboard/layout.tsx');

        expect(src).toContain('await getMyDashboard()');
        expect(src).toContain('initialDashboard={initialDashboard}');
    });
});
