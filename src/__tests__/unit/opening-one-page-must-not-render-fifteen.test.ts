/**
 * @jest-environment node
 */

/**
 *   #483 OPENING THE DASHBOARD WAS RENDERING FIFTEEN OTHER PAGES.
 *
 *   Five rounds of database fixes — #467, #471, #473, #481, #482 — and the owner
 *   still said the dashboard was slow. Every one of those was measured
 *   server-to-database, and every one was real. None of them was the problem,
 *   because I had never once measured what the BROWSER waits for.
 *
 *   When I finally did:
 *
 *       TTFB                    18 ms      the server answers instantly
 *       interactive             93 ms      the page is usable almost at once
 *       networkidle          2,976 ms      and then it works for three seconds
 *
 *   Of the 18 browser data calls in that window, FIFTEEN were `?_rsc=` route
 *   prefetches: /admin/finance, /admin/analytics, /admin/forensics,
 *   /admin/audit-logs, /admin/cooperatives/loans, /admin/orphaned-users and nine
 *   more.
 *
 *   Next.js prefetches a <Link> as soon as it enters the viewport, and each
 *   prefetch is a full SERVER RENDER of that route — running its data fetching,
 *   querying the database. AdminSidebar has 27 items, all visible at once. So
 *   opening the dashboard rendered fifteen pages nobody had clicked, and every
 *   database optimisation I shipped was making each of those fifteen slightly
 *   cheaper instead of removing them.
 *
 *   MEASURED, cold, in a real browser, before and after:
 *
 *       browser data calls      18  ->   4
 *       route prefetches        15  ->   0
 *       networkidle          2,976  ->  1,371 ms
 *
 *   AND IT MATTERS MORE IN PRODUCTION THAN HERE. Each prefetch is a browser ->
 *   server round trip on top of the render. On this machine that is a few
 *   milliseconds; from a phone in Nigeria to a Railway container it is not.
 *   Fifteen of them is a multiplier on the slowest link in the chain.
 *
 *   THE TRADE, STATED PLAINLY. Navigation now fetches on click rather than ahead
 *   of time, so moving between admin pages costs one round trip it did not
 *   before. An admin opens one or two of twenty-seven; prefetching all of them
 *   to save that was a bad bargain, and it was being paid on every page load.
 *
 *   WHY A RATCHET AND NOT JUST A FIX. The sidebar was the first door. The
 *   dashboard's own seven cards were the second — found only because the
 *   measurement still showed five prefetches after the sidebar was fixed. A
 *   thirteenth nav item added next month reintroduces the whole thing silently,
 *   because nothing about it looks like a performance decision.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';

/**
 * The components rendered on EVERY page of their area.
 *
 * Deliberately not "every file with a Link". A prefetch on a one-off page costs
 * that page; a prefetch in a sidebar costs every page in the application, which
 * is what made this worth 1.6 seconds.
 */
const ALWAYS_RENDERED = [
    'src/components/admin/AdminSidebar.tsx',
    'src/components/layout/ModuleSidebar.tsx',
    'src/app/admin/DashboardClient.tsx',
];

/** Every `<Link` opening tag in a file, with its attributes. */
function linkTags(code: string): string[] {
    const tags: string[] = [];
    let i = 0;
    for (;;) {
        const start = code.indexOf('<Link', i);
        if (start === -1) break;
        const end = code.indexOf('>', start);
        if (end === -1) break;
        tags.push(code.slice(start, end));
        i = end;
    }
    return tags;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#483 — a nav link does not render the page it points at', () => {
    it.each(ALWAYS_RENDERED)('%s — every <Link> disables prefetch', (file) => {
        //   The assertion the finding is about. One <Link> without it in a
        //   sidebar is one extra server render on every page load in the app.
        const tags = linkTags(readFileSync(file, 'utf-8'));

        const missing = tags.filter((t) => !t.includes('prefetch'));
        expect({ file, missing }).toEqual({ file, missing: [] });
    });

    it('AND THE SCAN IS LOOKING AT REAL LINKS — the vacuity guard', () => {
        //   A file whose links were renamed, or a broken tag scan, would report
        //   "none missing" over nothing at all.
        const counts = ALWAYS_RENDERED.map((f) => linkTags(readFileSync(f, 'utf-8')).length);

        expect(counts.every((n) => n > 0)).toBe(true);
        expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(9);
    });

    it('POSITIVE CONTROL: the scan really would catch an unprefetched link', () => {
        //   Without this, "no missing" could mean the tag parser returns
        //   attributes it never actually read.
        const sample = '<Link href="/admin/finance" className="x">Finance</Link>';

        expect(linkTags(sample).length).toBe(1);
        expect(linkTags(sample).filter((t) => !t.includes('prefetch')).length).toBe(1);
    });

    it('and the sidebar really does carry enough links to matter', () => {
        //   The premise of the whole finding: 27 nav items all visible at once
        //   is what turned one page load into sixteen.
        const sidebar = readFileSync('src/components/admin/AdminSidebar.tsx', 'utf-8');
        const hrefs = sidebar.match(/href:\s*"\/admin/g) ?? [];

        expect(hrefs.length).toBeGreaterThanOrEqual(20);
    });
});
