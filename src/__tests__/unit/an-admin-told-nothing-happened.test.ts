/**
 * @jest-environment node
 */

/**
 *   #804 AN ADMINISTRATOR WAS TOLD NOTHING HAPPENED, BY A SCREEN THAT COULD NOT
 *        READ.
 *
 *   #797 found this on the dispute screen and #801 showed the failed read there
 *   was not occasional but permanent. This is the same sweep across the rest of
 *   the admin surface: screens where somebody draws a CONCLUSION from numbers.
 *
 *   TWENTY-FOUR admin sites carry the D1 shape. Most are fine. Three were not,
 *   and the value of saying which is that TWO OF THE FOUR I FIRST SUSPECTED
 *   TURNED OUT TO BE CORRECT CODE:
 *
 *     admin/finance          already right — an explicit else whose comment
 *                            reads "A refusal is not zero revenue". The sweep
 *                            flags it only because it cannot see
 *                            `(res as any).error`.
 *     admin/DashboardClient  already right — failures throw into a catch that
 *                            sets a visible error; the module-stats read is
 *                            deliberately marked non-fatal.
 *     admin/analytics        already right, and I SAID OTHERWISE BEFORE READING
 *                            THE RENDER. It has an `if (!analytics)` panel:
 *                            "Failed to load analytics", with a retry. I
 *                            claimed it showed zeros silently. It does not.
 *
 *   The instrument flags a shape. Only reading the screen says whether the
 *   shape costs anything, and this audit has now been wrong in both directions.
 *
 * ── THE THREE THAT WERE REAL ────────────────────────────────────────────────
 *
 *   contributions   `if (success && data?.reports) { setReports }` and no else.
 *                   A failed read left reports null and rendered the empty
 *                   state: an administrator asking whether members have been
 *                   paying was shown nothing.
 *
 *   settings/logs   `catch { // No logs yet }` — and the render then states
 *                   "No logs recorded yet — Logs will appear as users interact
 *                   with the platform". A confident claim about an empty
 *                   platform, on the strength of a read that threw. The COMMENT
 *                   asserted the thing it had not established, one line above
 *                   the screen doing the same.
 *
 *   audit-logs      `{stats && (…)}` with no else, so the four counters —
 *                   total, info, warning, CRITICAL — vanished silently.
 *                   MILDER, and recorded as such: no wrong number is shown.
 *                   But this is the screen somebody opens to ask "did anything
 *                   unusual happen", and a page with no critical-event count
 *                   reads as reassurance.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the contributions else removed (the defect)                      KILLED
 *     the settings/logs catch emptied again                            KILLED
 *     the audit-logs else removed                                      KILLED
 *     the contributions failure panel never rendered                   KILLED
 *     the settings/logs failure panel never rendered                   KILLED
 *     the audit-logs notice never rendered                             KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/**
 * The admin screens this finding repaired, and the flag each uses.
 *
 * Kept per-screen rather than swept, because the sweep is what produced three
 * false positives — a list I have actually read is the honest instrument here.
 */
const REPAIRED: ReadonlyArray<{ name: string; file: string; flag: string }> = [
    {
        name: 'contribution reports',
        file: 'src/app/admin/cooperatives/contributions/page.tsx',
        flag: 'loadFailed',
    },
    {
        name: 'system logs',
        file: 'src/app/admin/settings/logs/page.tsx',
        flag: 'loadFailed',
    },
    {
        name: 'audit statistics',
        file: 'src/app/admin/audit-logs/page.tsx',
        flag: 'statsFailed',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#804 — an admin screen tells a refusal apart from an absence', () => {
    it('the three screens are real files', () => {
        //   Vacuity guard.
        for (const { name, file } of REPAIRED) {
            expect({ name, big: read(file).length > 500 }).toEqual({ name, big: true });
        }
    });

    it.each(REPAIRED)('$name SETS ITS FLAG when the read does not answer', ({ name, file, flag }) => {
        const src = read(file);
        //   Both roads to a non-answer: a refusal, and a throw.
        const sets = (src.match(new RegExp(`set${flag[0].toUpperCase()}${flag.slice(1)}\\(true\\)`, 'g')) ?? []).length;

        expect({ name, setsAtLeastTwice: sets >= 2 }).toEqual({ name, setsAtLeastTwice: true });
    });

    it.each(REPAIRED)('$name SAYS SO ON SCREEN, rather than rendering an absence', ({ name, file, flag }) => {
        /*
         *   Setting a flag nothing renders is the defect with a variable added
         *   — the point #793 had to make about setLoadFailed, and #797 about
         *   contextFailed. The flag must reach the render.
         */
        const src = read(file);
        const rendered = new RegExp(`\\{\\s*${flag}\\s*(\\?|&&)`).test(src)
            || new RegExp(`if \\(${flag}\\)`).test(src);

        expect({ name, rendered }).toEqual({ name, rendered: true });
    });

    it.each(REPAIRED)('$name OFFERS A RETRY, because the read may well succeed', ({ name, file }) => {
        const src = read(file);
        const retries = /onRetry=|Try again|window\.location\.reload\(\)/.test(src);

        expect({ name, retries }).toEqual({ name, retries: true });
    });

    it('THE TWO LIST SCREENS REUSE #588\'s COMPONENT, not a fourth copy of its sentence', () => {
        /*
         *   ListLoadFailed's own header: thirty-six restatements of "nothing is
         *   lost" is how this codebase grew the drift the audit keeps finding.
         *
         *   audit-logs is deliberately NOT on this list — it needed a notice
         *   beside a panel, not a whole-page failure, because its log table has
         *   its own read and loads fine.
         */
        for (const file of [
            'src/app/admin/cooperatives/contributions/page.tsx',
            'src/app/admin/settings/logs/page.tsx',
        ]) {
            expect({ file, shared: read(file).includes('ListLoadFailed') })
                .toEqual({ file, shared: true });
        }
    });

    it('AND THE AUDIT NOTICE DOES NOT CLAIM THERE WAS NO ACTIVITY', () => {
        //   The whole point of the milder treatment: the counters are missing,
        //   and the screen must not let that read as "all quiet".
        const src = read('src/app/admin/audit-logs/page.tsx');
        const notice = src.slice(src.indexOf('statsFailed && !stats'));

        expect(notice).toMatch(/does not mean there was no activity/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#804 — and the screens that were already right are left alone', () => {
    it('admin/finance still refuses to call a refusal zero revenue', () => {
        /*
         *   A CONTROL AGAINST MY OWN SWEEP. This screen is flagged by the
         *   detector and is correct; a future pass reading the flag rather than
         *   the code would "fix" it into something worse.
         */
        const src = read('src/app/admin/finance/page.tsx');
        expect(src).toMatch(/setLoadError\(/);
    });

    it('admin/analytics still shows its own failure panel', () => {
        //   The one I claimed was broken before reading the render.
        const src = read('src/app/admin/analytics/page.tsx');
        expect(src).toMatch(/if \(!analytics\)/);
        expect(src).toMatch(/Failed to load analytics/);
    });

    it('admin/DashboardClient still surfaces its error', () => {
        const src = read('src/app/admin/DashboardClient.tsx');
        expect(src).toMatch(/setError\("Failed to load dashboard data"\)/);
    });
});
