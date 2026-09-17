/**
 * @jest-environment node
 */

/**
 *   #845 A FAILED READ FELL BACK TO THE PAGE LENGTH, AND CALLED IT A TOTAL.
 *
 *   Found in the marketplace pass of docs/module-audit-checklist.md, under A2.1.
 *
 *   /admin/marketplace/sellers fetched its figures with
 *
 *       if (res.success && res.data) setServerStats(res.data);
 *
 *   — no else — and the tiles read
 *
 *       total: serverStats?.total ?? verifications.length
 *
 *   So when the stats query failed, "Total Requests" showed the number of rows
 *   THIS PAGE HAD FETCHED, presented as every seller application on the
 *   platform. The export button printed the same number: "Export CSV (50+)".
 *
 *   THE CODEBASE ALREADY HAS A TEST NAMED AFTER THIS DEFECT —
 *   `a-page-count-was-the-fallback-for-a-total` — and this screen was not in its
 *   sweep. A named finding recurring in an unswept place is the shape this audit
 *   has filed more than any other, and it is why the checklist walks every
 *   module rather than trusting that a fix generalised.
 *
 * ── WHAT IS KEPT ────────────────────────────────────────────────────────────
 *
 *   The page-length fallback still applies WHILE THE READ IS IN FLIGHT, where it
 *   is a fair approximation of what is on screen and settles a moment later.
 *   What is removed is using it after the read has FAILED, when it is a number
 *   nobody measured. #822's three states apply: a figure, "—" for not yet,
 *   "Unavailable" for a read that failed.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { statText } from '@/lib/admin-stat-display';

const PAGE = 'src/app/admin/marketplace/sellers/page.tsx';
const src = () => stripComments(
    readFileSync(join(process.cwd(), PAGE), 'utf-8'), { label: PAGE },
);

describe('#845 — a failed read is not a page count', () => {
    it('THE FAILURE IS RECORDED, not dropped by an if with no else', () => {
        const s = src();
        expect(s).toContain('setStatsFailed(true)');
        expect(s).toMatch(/\.catch\(\(\) => setStatsFailed\(true\)\)/);
    });

    it('AND THE TILES RENDER null RATHER THAN THE FALLBACK WHEN IT FAILED', () => {
        const s = src();
        expect(s).toContain('statsFailed ? null : serverStats?.total');
    });

    it('AND THE VALUE GOES THROUGH statText', () => {
        //   Which turns that null into "Unavailable" rather than a blank tile.
        const s = src();
        expect(s).toContain('statText(value, statsFailed)');
    });

    it('AND THE EXPORT BUTTON NO LONGER ADVERTISES THE FALLBACK', () => {
        /*
         *   "Export CSV (50+)" on a failed read told an administrator the
         *   platform held fifty seller applications — the same untruth as the
         *   tile, in a place nobody would think to check.
         */
        const s = src();
        expect(s).toContain('statText(stats.total, statsFailed)');
        expect(s).toContain('exportLabel');
        //   And the "+" is dropped when the figure could not be read:
        //   "Unavailable+" is nonsense.
        expect(s).toContain('statsFailed');
    });

    it('AND THE SOURCE IS ACTUALLY VISIBLE TO THIS TEST', () => {
        /*
         *   THE VACUITY GUARD THAT CAUGHT A REAL PROBLEM, and the reason it is
         *   now a permanent case.
         *
         *   The first version of this fix put `//` comments carrying quotes
         *   inside a JSX expression, and built the export label as a template
         *   literal with quotes inside `${}`. Both desync
         *   lib/testing/strip-comments — the known JSX hazard — and SIX
         *   KILOBYTES of this file silently vanished from the stripped output.
         *
         *   Every assertion above would then have been checking a string that
         *   did not contain the code at all: a suite that cannot see its subject
         *   passes by accident on the day the code is right, and passes just the
         *   same on the day it is wrong.
         */
        const s = src();

        //   Landmarks from the top, middle and end of the file.
        expect(s).toContain('getAdminSellerStatsAction');
        expect(s).toContain('const stats = {');
        expect(s).toContain('exportLabel');
        //   And a size floor: the stripped file lost ~12% when it desynced.
        expect(s.length).toBeGreaterThan(45000);
    });

    it('CONTROL: statText really does say Unavailable for a failed read', () => {
        //   Vacuity guard — the assertions above are about wiring; this is the
        //   behaviour they are wiring to.
        expect(statText(null, true)).toBe('Unavailable');
        expect(statText(null, false)).toBe('—');
        expect(statText(42, false)).toBe('42');
    });
});
