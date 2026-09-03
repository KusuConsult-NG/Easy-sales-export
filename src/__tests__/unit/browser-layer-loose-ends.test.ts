/**
 * @jest-environment node
 */

/**
 *   #351 THREE LOOSE ENDS IN THE BROWSER LAYER, CLOSED TOGETHER.
 *
 *        (a) A SIDEBAR LINK THAT 404'd. ModuleSidebar's academy nav pointed
 *            "Certificates" at /academy/certificate, which has only a
 *            `[certificateId]/page.tsx` beneath it and no index page. There is
 *            no certificate LIST screen in the product at all. Same shape as
 *            #51 and #52; it now points at My Courses, which is where a learner
 *            actually reaches a certificate ("View Certificate" →
 *            /academy/certificate/{courseId} per completed course).
 *
 *        (b) ADMIN DATE PRESETS THAT MEANT A DIFFERENT DAY. Every preset built
 *            its bounds as:
 *
 *                new Date().toISOString().slice(0, 10)
 *
 *            which is the UTC calendar date. Nigeria is UTC+1, so between 00:00
 *            and 01:00 WAT the UTC date is still YESTERDAY: an admin clicking
 *            "Today" at 00:30 on the 4th got the 3rd's data under a button
 *            labelled Today, and "Last 7 days" covered the seven days ending
 *            yesterday. "This year" was internally inconsistent — its year came
 *            from getFullYear() (LOCAL) and its end date from toISOString
 *            (UTC), so the two halves of one range disagreed at the boundary.
 *
 *            #33 fixed this confusion in the QUERY these strings feed. This is
 *            the other end of it.
 *
 *        (c) THE NAIRA SIGN DROPPED OUT OF THE PDF INVOICE. jsPDF's built-in
 *            helvetica is a WinAnsi (cp1252) font and "₦" is U+20A6, which
 *            WinAnsi has no code point for — so jsPDF emitted nothing.
 *            "₦45,000" printed as "45,000" and the column header "Unit Price
 *            (₦)" printed as "Unit Price ()". A money document that does not
 *            name its currency, which is #266's defect one layer up.
 *
 *            REACHABILITY CHECKED FIRST, as it should have been in three
 *            earlier findings. Four files use jsPDF; only this one puts a ₦
 *            through `doc.text`. The wallet receipt also produces a PDF but
 *            goes through html2canvas, which rasterises the rendered DOM — the
 *            glyph is pixels there, and that path is clean.
 *
 *            AND NOTHING IMPORTS InvoiceGenerator. The currency is corrected
 *            because it is two lines and would otherwise wait for whoever wires
 *            it up. The pagination gap in the same file is left alone and
 *            recorded: fixed Y offsets with no addPage() guard, so an invoice
 *            with enough line items runs off page one. That is building the
 *            feature, not repairing it.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const SIDEBAR = 'src/components/layout/ModuleSidebar.tsx';
const FILTER = 'src/components/admin/DateRangeFilter.tsx';
const INVOICE = 'src/components/InvoiceGenerator.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#351 — the Certificates link goes somewhere', () => {
    it('IT NO LONGER POINTS AT A ROUTE THAT DOES NOT EXIST', () => {
        const code = source(SIDEBAR);
        const academyNav = code.slice(code.indexOf('const ACADEMY_NAV'), code.indexOf('const WAVE_NAV'));

        expect(academyNav).not.toContain('href: "/academy/certificate"');
        expect(academyNav).toMatch(/name: "Certificates",\s*href: "\/academy\/my-courses"/);
    });

    it('and /academy/certificate really has no index page', () => {
        // The claim, measured. If someone builds one, this fails and the link
        // can go back.
        expect(existsSync(join(process.cwd(), 'src/app/academy/certificate/[certificateId]/page.tsx'))).toBe(true);
        expect(existsSync(join(process.cwd(), 'src/app/academy/certificate/page.tsx'))).toBe(false);
    });

    it('while My Courses really does lead to certificates', () => {
        expect(source('src/app/academy/(learner)/my-courses/page.tsx'))
            .toContain('/academy/certificate/${course.courseId}');
    });

    it('EVERY academy nav href resolves to a page', () => {
        // The ratchet. A dead nav link is the shape, and one was enough to
        // suggest checking the rest.
        const code = source(SIDEBAR);
        const academyNav = code.slice(code.indexOf('const ACADEMY_NAV'), code.indexOf('const WAVE_NAV'));
        const hrefs = [...academyNav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);

        expect(hrefs.length).toBeGreaterThan(4);   // vacuity guard

        const dead = hrefs.filter((href) => {
            const rel = href.replace(/^\//, '');
            // A route may live under a plain path or inside a route group.
            return !['', '(learner)/', '(app)/', '(member)/'].some((group) => {
                const parts = rel.split('/');
                const withGroup = [parts[0], group + parts.slice(1).join('/')].join('/');
                return existsSync(join(process.cwd(), 'src/app', rel, 'page.tsx'))
                    || existsSync(join(process.cwd(), 'src/app', withGroup, 'page.tsx'));
            });
        });

        expect(dead).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#351 — a date preset names the day the admin is having', () => {
    const code = source(FILTER);

    it('NO PRESET BUILDS ITS BOUNDS FROM toISOString', () => {
        // THE test. That is the UTC calendar date, and the labels are local.
        expect(code).not.toContain('toISOString().slice(0, 10)');
        expect(code.match(/localCalendarDate\(/g) ?? []).toHaveLength(8);
    });

    it('and "This year" no longer mixes a local year with a UTC end date', () => {
        expect(code).toMatch(/const year = new Date\(\)\.getFullYear\(\)/);
        expect(code).toMatch(/from: `\$\{year\}-01-01`, to: localCalendarDate\(\)/);
    });

    it('THE HELPER READS THE LOCAL COMPONENTS, NOT THE ISO STRING', async () => {
        // THE test, and it has to be shaped this way. The defect only exists
        // where the local day and the UTC day DISAGREE — and this container
        // runs in UTC, where they never do. An earlier version of this test
        // built dates from local parts and asserted the local day back, which
        // is a tautology under UTC: a mutant reverting localCalendarDate to
        // `toISOString().slice(0, 10)` survived it. Setting process.env.TZ in
        // this file does not help either; Node resolves the zone before the
        // file is loaded.
        //
        // So the two readings are separated explicitly. This stand-in is
        // 23:30 UTC on 3 September, which is 00:30 on the 4th in Lagos — the
        // exact hour an admin clicking "Today" used to get yesterday's data.
        const { localCalendarDate } = await import('@/lib/date-utils');

        const lagosJustAfterMidnight = {
            getFullYear: () => 2026,
            getMonth: () => 8,
            getDate: () => 4,
            toISOString: () => '2026-09-03T23:30:00.000Z',
        } as unknown as Date;

        expect(localCalendarDate(lagosJustAfterMidnight)).toBe('2026-09-04');

        // Across a year boundary, where "This year" was wrong in both halves.
        const lagosNewYear = {
            getFullYear: () => 2026,
            getMonth: () => 0,
            getDate: () => 1,
            toISOString: () => '2025-12-31T23:05:00.000Z',
        } as unknown as Date;

        expect(localCalendarDate(lagosNewYear)).toBe('2026-01-01');
    });

    it('and it agrees with the platform on a real Date', async () => {
        // Vacuity guard on the stand-ins above: the helper must also be right
        // for an ordinary Date, whatever zone this runs in. toLocaleDateString
        // with en-CA yields YYYY-MM-DD in the local zone, independently.
        const { localCalendarDate } = await import('@/lib/date-utils');

        for (const d of [new Date(), new Date(2026, 8, 4, 0, 30), new Date(2026, 0, 5)]) {
            expect(localCalendarDate(d)).toBe(d.toLocaleDateString('en-CA'));
        }
    });

    it('and it zero-pads, so the string is always sortable', async () => {
        const { localCalendarDate } = await import('@/lib/date-utils');

        expect(localCalendarDate(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(localCalendarDate(new Date(2026, 10, 30))).toBe('2026-11-30');
    });

    it('the range the strings feed still reads them as UTC bounds', async () => {
        // Vacuity guard on the convention: dateRangeStart/End are unchanged,
        // and the preset's job is to pick the right DAY for them.
        const { dateRangeStart, dateRangeEnd } = await import('@/lib/date-utils');

        expect(dateRangeStart('2026-09-04').toISOString()).toBe('2026-09-04T00:00:00.000Z');
        expect(dateRangeEnd('2026-09-04').toISOString()).toBe('2026-09-04T23:59:59.999Z');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#351 — the PDF invoice names its currency', () => {
    const code = source(INVOICE);

    it('NO ₦ REACHES doc.text OR THE TABLE HEAD', () => {
        // THE test. jsPDF's built-in helvetica is WinAnsi; U+20A6 is not in it,
        // and the glyph was emitted as nothing at all.
        expect(code).not.toContain('₦');
        expect(code).toContain("head: [['Description', 'Qty', 'Unit Price (NGN)', 'Total (NGN)']]");
        expect(code.match(/NGN \$\{invoice\./g) ?? []).toHaveLength(4);
    });

    it('and the tombstone still quotes the old output, so the record survives', () => {
        expect(readFileSync(INVOICE, 'utf-8')).toMatch(/U\+20A6, which WinAnsi has no code point for/);
    });

    it('THE ONLY OTHER PDF PATH RASTERISES, so it is unaffected', () => {
        // Reachability, checked rather than assumed. The wallet receipt draws
        // the DOM through html2canvas — the sign is pixels there.
        const wallet = source('src/app/dashboard/wallet/page.tsx');

        expect(wallet).toContain('html2canvas');
        expect(wallet).toContain('pdf.addImage(imgData');
        expect(wallet).not.toMatch(/\.text\(`₦/);
    });

    it('RECORDED: nothing imports InvoiceGenerator, and it cannot paginate', () => {
        // Both facts stated so the next reader does not rediscover them. The
        // pagination gap is a feature to build, not a repair.
        const { execSync } = require('child_process');
        const importers: string = execSync(
            "grep -rl 'InvoiceGenerator' --include=*.tsx --include=*.ts src/app src/components src/lib || true",
            { encoding: 'utf-8' },
        );
        const outside = importers.split('\n').filter((f) => f && !f.endsWith('InvoiceGenerator.tsx'));

        expect(outside).toEqual([]);
        expect(code).not.toContain('addPage(');
    });
});
