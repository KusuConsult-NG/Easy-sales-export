/**
 * @jest-environment node
 */

/**
 *   #843 THE LAST ZERO OF A REVENUE FIGURE DROPPED ONTO ITS OWN LINE.
 *
 *   The owner: "the last zero broke and drop making the UI to look
 *   unprofessional … the cards should be fix to accomodate any number", against
 *
 *       Total Revenue
 *       ₦12,996,000
 *       Based on transaction volume
 *
 *   The tile carried `break-words`, added by #758 so that long PROSE values —
 *   "at least ₦1,234,567,890", the "Unavailable" #753 put on six more tiles —
 *   could wrap instead of running into the label beneath them. That finding was
 *   right about prose and wrong about digits: `overflow-wrap: break-word` cannot
 *   tell a sentence from a number, and a formatted amount is ONE unbroken token,
 *   so it snapped mid-figure.
 *
 *   IT IS NOT A COSMETIC PROBLEM. ₦12,996,00 with a stray 0 beneath it can be
 *   read as the wrong number, on the tile an administrator uses to see what the
 *   platform has taken. The two cases needed separating rather than trading one
 *   against the other.
 *
 * ── WHY A RULE AND NOT A SMALLER FIXED SIZE ─────────────────────────────────
 *
 *   "Make it smaller" fixes today's longest figure and breaks on the next one.
 *   This platform's revenue grows; ₦123,456,789,012 is two characters away from
 *   the same defect, and nobody would be watching for it. The owner asked for a
 *   card that accommodates ANY number, so the size follows the value.
 */

import { describe, it, expect } from '@jest/globals';
import { statValueClass } from '@/lib/admin-stat-display';

describe('#843 — a number is never broken across lines', () => {
    it('THE REPORTED VALUE: ₦12,996,000 stays on one line', () => {
        const cls = statValueClass('₦12,996,000');

        expect(cls).toContain('whitespace-nowrap');
        expect(cls).not.toContain('break-words');
    });

    it('AND SO DOES A FIGURE TEN TIMES LARGER, at a smaller size', () => {
        /*
         *   The point of the rule. Both stay whole; the longer one is simply set
         *   smaller, so the tile accommodates it without anybody revisiting the
         *   class list when revenue grows.
         */
        const small = statValueClass('₦12,996,000');
        const large = statValueClass('₦123,456,789,012');

        expect(large).toContain('whitespace-nowrap');
        expect(large).not.toEqual(small);
    });

    it('AND THE SIZE DECREASES AS THE VALUE LENGTHENS, monotonically', () => {
        //   Executed across a growing figure rather than asserted at two points,
        //   so a rule that stepped the wrong way at one boundary fails here.
        const rank = (c: string) =>
            ['text-base', 'text-lg', 'text-xl', 'text-2xl'].findIndex((t) => c.startsWith(t + ' '));

        const values = [
            '₦1,000',
            '₦12,996,000',
            '₦1,234,567,890',
            '₦123,456,789,012',
            '₦1,234,567,890,123,456',
        ];

        const ranks = values.map((v) => rank(statValueClass(v)));
        for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
        }
    });

    it('BUT PROSE KEEPS ITS WRAPPING, which is what #758 fixed', () => {
        /*
         *   The half that must not regress. These have somewhere sensible to
         *   break — a space — and without wrapping they overflowed the card and
         *   ran into the label beneath.
         */
        for (const prose of ['at least ₦1,234,567,890', 'Based on transaction volume']) {
            const cls = statValueClass(prose);
            expect({ prose, cls: cls.includes('break-words') })
                .toEqual({ prose, cls: true });
        }
    });

    it('AND A SINGLE LONG WORD IS NOT BROKEN EITHER', () => {
        //   "Unavailable" is #753's value for a read that failed. It has no
        //   space, so breaking it would produce "Unavailab / le".
        const cls = statValueClass('Unavailable');
        expect(cls).toContain('whitespace-nowrap');
    });

    it('AND AN EMPTY OR MISSING VALUE DOES NOT THROW', () => {
        //   These tiles render "—" before the first read answers.
        for (const v of [undefined, null, '', '—']) {
            expect(() => statValueClass(v)).not.toThrow();
            expect(statValueClass(v)).toContain('text-');
        }
    });
});

describe('#843 — the tiles use the rule rather than a fixed size', () => {
    const read = (rel: string) => {
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments') as
            typeof import('@/lib/testing/strip-comments');
        return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
    };

    it('THE DASHBOARD TILE NO LONGER CARRIES break-words', () => {
        const src = read('src/app/admin/DashboardClient.tsx');

        expect(src).toContain('statValueClass(stat.value)');
        //   The specific class that broke the figure.
        expect(src).not.toMatch(/tracking-tight break-words/);
    });

    it('AND THE COOPERATIVE MONEY TILES USE IT TOO', () => {
        /*
         *   Swept by shape rather than fixed only where it was reported: a
         *   cooperative's contributions and savings totals are the figures most
         *   likely to outgrow a tile next, and they were at a fixed text-3xl.
         */
        const src = read('src/app/admin/cooperatives/dashboard/page.tsx');

        expect(src).toContain('statValueClass(money(stats?.totalContributions))');
        expect(src).toContain('statValueClass(money(stats?.totalSavings))');
    });
});
