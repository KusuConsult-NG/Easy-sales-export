/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "how can member's measure there ROI on export window"
 *
 * ── THEY COULD NOT, BECAUSE FOUR SCREENS GAVE FOUR ANSWERS ──────────────────
 *
 *   `expectedReturn` is written by both investment paths as
 *   `amount * exportWindowReturnMultiplier(window)`, so it is the GROSS coming
 *   back — capital and profit together. ₦100,000 at the platform's 20% stores
 *   120,000. One number, read four ways:
 *
 *     the portfolio TILE      (returns - invested) / invested = 20%. Correct,
 *                             and the only one that was.
 *
 *     the portfolio ROW       expectedReturn / amount = 120%, under a column
 *                             headed "ROI" — six times the tile directly above
 *                             it, on the same page, about the same money.
 *
 *     the money labels        "+₦120,000" in green beside "Expected Return" on
 *                             a ₦100,000 investment. The plus and the colour
 *                             both say GAIN; the figure was the gross.
 *
 *     "Total Payout"          amount + expectedReturn = ₦220,000. The capital
 *                             counted twice — a member told they would be paid
 *                             2.2x on a platform that pays 1.2x.
 *
 *   None of these is rounding. A member comparing two screens had no way to
 *   know which to believe, which is the whole of the owner's question.
 *
 * ── AND THE RATE THEY WERE QUOTED WAS NOT THE RATE THEY WOULD BE PAID ───────
 *
 *   Two fields, never connected. `roi` is a display string; `returnMultiplier`
 *   is what every payout multiplies by. lib/export-window-status records,
 *   deliberately, that the money paths ignore the string. The consequence was
 *   live: the admin edit screen wrote only the string, so an admin could set
 *   25%, the window page would advertise 25%, and the escrow-release cron would
 *   transfer 20% — and on a window nobody had edited, `projectedROI` was
 *   `undefined`, so the investment card showed a blank beside the words
 *   "Projected ROI" while the invest button quietly used the default.
 *
 * ── WHAT IS NOT CHANGED, ON PURPOSE ─────────────────────────────────────────
 *
 *   Nothing stored moves and no payout changes. `expectedReturn` still holds
 *   the gross, written by the same two paths; the cron still pays
 *   `amount * exportWindowReturnMultiplier(window)`; a window with no
 *   multiplier still pays the platform default. What changed is that the
 *   screens now agree about what those numbers mean, and that an admin setting
 *   a rate sets the one that is paid.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { investmentReturn, investmentProfit, roiPercent } from '@/lib/export-returns';
import {
    exportWindowReturnMultiplier, exportWindowRoiPercent, DEFAULT_EXPORT_ROI_PERCENT,
} from '@/lib/export-window-status';

const ROOT = process.cwd();
const code = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const source = (rel: string) => stripComments(code(rel), { label: rel });

const PORTFOLIO = 'src/app/export/(app)/portfolio/ExportPortfolioClient.tsx';
const DETAIL = 'src/app/export/(app)/investments/[id]/InvestmentDetailClient.tsx';
const WINDOW = 'src/app/export/windows/[id]/ExportWindowDetailClient.tsx';
const MAPPERS = 'src/app/actions/export-investments.ts';
const ADMIN_EDIT = 'src/app/admin/export/edit/[id]/page.tsx';

/** ₦100,000 in, ₦120,000 back, at the platform's own rate. */
const CAPITAL = 100_000;
const GROSS = CAPITAL * (1 + DEFAULT_EXPORT_ROI_PERCENT / 100);

// ─────────────────────────────────────────────────────────────────────────────
describe('the three quantities, named once', () => {
    it('THE RETURN IS THE GROSS — capital and profit together', () => {
        expect(investmentReturn(GROSS)).toBe(120_000);
    });

    it('AND THE PROFIT IS WHAT A "+" AND A GREEN NUMBER CLAIM', () => {
        //   The label said Expected Return, printed the gross, and coloured it
        //   as a gain. ₦20,000 is the gain.
        expect(investmentProfit(CAPITAL, GROSS)).toBe(20_000);
    });

    it('AND ROI IS PROFIT OVER CAPITAL — 20, not 120', () => {
        //   THE test. The row computed `expectedReturn / amount`, which is the
        //   return MULTIPLE, under a column headed ROI.
        expect(roiPercent(CAPITAL, GROSS)).toBe(20);
        expect(roiPercent(CAPITAL, GROSS)).not.toBe(120);
    });

    it('AND ONE INVESTMENT AND A WHOLE PORTFOLIO USE THE SAME ARITHMETIC', () => {
        //   Three investments of the same size sum to the same percentage, so
        //   the tile and the rows cannot drift apart again.
        expect(roiPercent(CAPITAL * 3, GROSS * 3)).toBe(roiPercent(CAPITAL, GROSS));
    });

    it('AND A MALFORMED ROW PRINTS 0%, not NaN or Infinity', () => {
        expect(roiPercent(0, 50_000)).toBe(0);
        expect(roiPercent(undefined, undefined)).toBe(0);
        expect(roiPercent('not a number', GROSS)).toBe(0);
        expect(investmentProfit(CAPITAL, undefined)).toBe(0);
    });

    it('AND A RETURN BELOW THE CAPITAL IS NOT REPORTED AS A LOSS', () => {
        //   Both writers compute the gross as `amount * multiplier` with the
        //   multiplier guaranteed positive, so this is a bad row rather than a
        //   loss the platform is announcing.
        expect(investmentProfit(CAPITAL, 40_000)).toBe(0);
        expect(roiPercent(CAPITAL, 40_000)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and every screen reads it', () => {
    it('THE PORTFOLIO ROW AND ITS TILE SHARE ONE FUNCTION', () => {
        const src = source(PORTFOLIO);

        expect(src).toContain('roiPercent(inv.amount, inv.expectedReturn)');
        expect(src).toContain('roiPercent(totalVal, totalRet)');
        //   The expression that produced 120.
        expect(src).not.toContain('(inv.expectedReturn / inv.amount)');
    });

    it('AND THE MONEY LABELS PRINT THE GAIN THEIR "+" CLAIMS', () => {
        const src = source(PORTFOLIO);

        expect(src).toContain('investmentProfit(totalVal, totalRet)');
        expect(src).toContain('investmentProfit(inv.amount, inv.expectedReturn)');
        //   Header and value agree now, rather than "Returns" over a gain.
        expect(code(PORTFOLIO)).toContain('Expected Profit');
    });

    it('AND "TOTAL PAYOUT" NO LONGER COUNTS THE CAPITAL TWICE', () => {
        /*
         *   `investment.amount + investment.expectedReturn` — ₦220,000 on a
         *   ₦100,000 investment, against the ₦120,000 the cron transfers.
         */
        const src = source(DETAIL);

        expect(src).toContain('investmentReturn(investment.expectedReturn)');
        expect(src).not.toMatch(/investment\.amount\s*\+\s*\(?investment\.expectedReturn/);
    });

    it('AND THE DETAIL PAGE DERIVES ITS ROI rather than printing a stored label', () => {
        //   `investment.roi` is the window's label copied at purchase time, and
        //   "15-20%" on anything nobody set.
        const src = source(DETAIL);

        expect(src).toContain('roiPercent(investment.amount, investment.expectedReturn)');
        expect(src).not.toContain('ROI: {investment.roi}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the rate quoted is the rate paid', () => {
    it('THE WINDOW MAPPERS QUOTE THE MULTIPLIER, not the display string', () => {
        const src = source(MAPPERS);

        expect(src).toContain('exportWindowReturnMultiplier');
        //   BOTH mappers — the list and the single window — or the card and
        //   the page it opens disagree. Counted on the derivation rather than
        //   on `projectedROI:`, which also appears once as a type declaration.
        expect(src.match(/exportWindowReturnMultiplier\(data as any\)/g)?.length).toBe(2);
        expect(src).not.toContain('projectedROI: data.roi');
    });

    it('AND A WINDOW NOBODY SET SHOWS THE DEFAULT rather than a blank', () => {
        //   `data.roi` was undefined on every window until the admin edit screen
        //   started writing one, so the card rendered nothing beside the words
        //   "Projected ROI" while the invest button used 20%.
        const quoted = Math.round((exportWindowReturnMultiplier({}) - 1) * 100);

        expect(quoted).toBe(DEFAULT_EXPORT_ROI_PERCENT);
        expect(String(quoted)).not.toBe('NaN');
    });

    it('AND THE ADMIN BOX WRITES THE MULTIPLIER BESIDE THE LABEL', () => {
        const src = source(ADMIN_EDIT);

        expect(src).toContain('returnMultiplier: 1 + roiPercent / 100');
        expect(src).toContain('exportWindowRoiPercent(windowData.roi)');
    });

    it('AND A RANGE TYPED THERE SAVES AS THE RATE THAT IS PAID', () => {
        /*
         *   exportWindowRoiPercent refuses "15-20" rather than taking its low
         *   end — parseFloat would have returned 15 while the payout used 20.
         *   The consequence is now visible on the screen instead of silent: the
         *   box normalises to the figure it saved.
         */
        expect(exportWindowRoiPercent('15-20%')).toBe(DEFAULT_EXPORT_ROI_PERCENT);
        expect(exportWindowRoiPercent('25%')).toBe(25);
        expect(1 + exportWindowRoiPercent('25%') / 100).toBe(1.25);
        //   And the screen says so, so an admin is not surprised by the save.
        expect(code(ADMIN_EDIT)).toContain('One figure, not a range');
    });

    it('AND NOTHING BACK-FILLS AN EXISTING WINDOW', () => {
        //   A window edited before this keeps what it had, and one with no
        //   multiplier goes on paying the platform default — no stored value
        //   moves and no payout changes.
        expect(exportWindowReturnMultiplier({ roi: '25%' }))
            .toBe(1 + DEFAULT_EXPORT_ROI_PERCENT / 100);
        expect(exportWindowReturnMultiplier({ returnMultiplier: 1.25 })).toBe(1.25);
    });

    it('AND THE INVEST HANDLER STILL READS THE QUOTED FIGURE', () => {
        //   Vacuity guard: the quote is only worth fixing if the button beside
        //   it uses it.
        expect(source(WINDOW)).toContain('exportWindowRoiPercent(windowData.projectedROI)');
    });
});

/*
 *   #903 AND THE FIFTH ANSWER, WHICH WAS THE ONE GOOGLE SHOWED.
 *
 *   Found auditing the files no test had named — app/export/layout.tsx was on
 *   that list. The four answers above are the ones a member sees after
 *   investing. This is the one a stranger sees BEFORE:
 *
 *       app/export/layout.tsx   "Fund verified Nigerian agricultural export
 *                               contracts and earn 18–22% ROI in 4–6 months"
 *                               — the meta description AND the Open Graph card
 *       components/features/HeroSlider   "with 18-22% returns", on the hub's
 *                               own front page
 *
 *   Nothing on this platform pays 18% or 22%. DEFAULT_EXPORT_ROI_PERCENT is 20,
 *   and the note above it says why that number and no other: it is what the two
 *   fulfilment paths pay when a window records no multiplier, and using anything
 *   else "would have the page advertise one figure and the payout compute
 *   another."
 *
 *   And a RANGE is the exact shape exportWindowRoiPercent was written to reject.
 *   Its own comment: a window carrying "15-20%" made the investor page quote 15
 *   while the payout paid 1.20. The lesson reached the window label and not the
 *   platform's public claim about itself.
 */
describe('#903 — what the platform tells a stranger it pays', () => {
    const EXPORT_LAYOUT = 'src/app/export/layout.tsx';
    const HERO = 'src/components/features/HeroSlider.tsx';

    it('THE RATE IT ACTUALLY PAYS IS A SINGLE FIGURE (control)', () => {
        //   THE control: "the claim should be this number" is worth nothing
        //   unless the number is what the payout uses.
        expect(DEFAULT_EXPORT_ROI_PERCENT).toBe(20);
        expect(exportWindowReturnMultiplier({})).toBe(1 + DEFAULT_EXPORT_ROI_PERCENT / 100);
    });

    it('NEITHER PUBLIC CLAIM STATES A RANGE ANY MORE', () => {
        for (const rel of [EXPORT_LAYOUT, HERO]) {
            const src = stripComments(code(rel), { label: rel });
            expect({ rel, range: /1[0-9]\s*[–-]\s*2[0-9]\s*%/.test(src) })
                .toEqual({ rel, range: false });
        }
    });

    it('AND BOTH ARE DERIVED FROM THE RATE, so they cannot drift from the payout', () => {
        //   The vacuity guard on the assertion above: deleting the sentences
        //   would also remove the range.
        for (const rel of [EXPORT_LAYOUT, HERO]) {
            const src = stripComments(code(rel), { label: rel });
            expect({ rel, derived: src.includes('${DEFAULT_EXPORT_ROI_PERCENT}%') })
                .toEqual({ rel, derived: true });
            expect({ rel, imported: src.includes('DEFAULT_EXPORT_ROI_PERCENT } from "@/lib/export-window-status"') })
                .toEqual({ rel, imported: true });
        }
    });

    it('AND THE CLAIM STILL SAYS WHAT IT IS ABOUT', () => {
        //   Not a silent deletion of the number: a page that stopped naming a
        //   return would pass every assertion above.
        const layout = stripComments(code(EXPORT_LAYOUT), { label: EXPORT_LAYOUT });
        expect(layout).toContain('ROI');
        expect(layout).toContain('escrow');
    });
});
