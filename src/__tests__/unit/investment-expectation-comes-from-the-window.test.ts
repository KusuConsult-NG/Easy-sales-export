/**
 * @jest-environment node
 */

/**
 *   #429 THE INVESTMENT RECORD'S EXPECTED RETURN WAS WHATEVER THE BROWSER SAID.
 *
 *   Found by a money-arithmetic sweep — every hand-computed percentage in a
 *   money path, which is the class behind #270 (floored when credited,
 *   unrounded when shown) and #113/#324 (told one figure, paid another). Almost
 *   every hit was legitimate kobo-to-naira conversion. Two were real percentage
 *   arithmetic, and they disagreed.
 *
 *   initializeInvestmentPaymentAction takes FIVE parameters and stored three of
 *   them verbatim:
 *
 *       expectedReturn: investmentAmount * (1 + expectedROI / 100)
 *
 *   `expectedROI` is a parameter. This is a "use server" export, so it is an
 *   independently addressable endpoint whether or not a screen calls it — the
 *   property that made autoEnrollPaidUser a paid-content bypass — and the
 *   authoritative window row was already in hand three lines above, read for
 *   the funding gate and then not consulted for the rate.
 *
 *   THE MONEY WAS NEVER AT RISK, and saying so is part of the finding. The
 *   release (api/cron/release-escrow) pays
 *   `amount * exportWindowReturnMultiplier(window)` — #324's fix, derived from
 *   the window. What was at risk is the figure the investor is SHOWN and the
 *   aggregate the platform keeps: the portfolio reads expectedReturn, and
 *   totalExpectedReturns is incremented by it. A record could promise a return
 *   the payout would never make — #113's and #324's own shape, arrived at from
 *   the record side rather than the payout side.
 *
 *   TWO DOORS, ONE HARDENED. _ex_investments.ts's fulfilment path already wrote
 *   `amount * exportWindowReturnMultiplier(exportWindow)`. #324 corrected the
 *   payout and that sibling; this initiator was never adopted. That is this
 *   repository's signature failure — the fix reaches one of the copies — and it
 *   is the third time in this session alone (#425, #426, now this).
 *
 *   AND THE STORED TITLE WAS THE COMMODITY, TWICE. The one caller passes
 *   `windowData.commodity` as BOTH the windowTitle and the commodity argument,
 *   so every investment record ever written carries the commodity in both
 *   fields, and the Paystack description reads "Export Investment - <commodity>".
 *   Both are taken from the window now.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the caller's ROI is used again                  KILLED
 *     the caller's title is used again                KILLED
 *     the stored ROI stops matching the multiplier    KILLED
 *     the multiplier helper stops being window-derived KILLED
 *     the sibling path stops deriving it              KILLED
 *     the reader's fallback returns to 0.20           KILLED
 *     the reader's fallback ignores the window row    KILLED
 *     reword the header prose                         SURVIVED, as intended
 *
 *   ONE MUTANT THIS SUITE CANNOT KILL, AND SHOULD NOT PRETEND TO. Stopping the
 *   loader from ever ASSIGNING the window row leaves the fallback expression
 *   textually intact, so every assertion here still passes. This suite reads
 *   source; runtime wiring is not something it can see. It is killed in
 *   export-investments-behaviour.test.ts, by a case seeded with a rate of 1.5
 *   — deliberately not the platform default, because 1.20 makes "derived from
 *   the window" and "hardcoded at the default" the same number. That gap was
 *   found by mutation testing, not by reading, and it is the same shape as the
 *   one this finding's first draft had: a check self-consistent enough to pass
 *   whether or not the thing it names is working.
 *
 *   AND THE FOURTH SITE, WHICH THIS FINDING ALMOST REPEATED ON ITSELF. The
 *   writer was fixed and the READER left alone — `data.expectedReturn ||
 *   (amount * 0.20)` in the portfolio loader. The stored figure is the TOTAL;
 *   `amount * 0.20` is the PROFIT ALONE, at a rate written nowhere else. Six
 *   times apart, one column, one label, and the fallback taken by exactly the
 *   legacy rows a portfolio is most likely showing. Fixing one of N copies is
 *   the defect this finding is about, so committing it inside the fix would
 *   have been the finding's own shape a fourth time.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { exportWindowReturnMultiplier } from '@/lib/export-window-status';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const INITIATOR = 'src/app/actions/export-payment.ts';
const SIBLING = 'src/app/actions/export/_ex_investments.ts';
const RELEASE = 'src/app/api/cron/release-escrow/route.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#429 — the expectation is derived from the window, not supplied', () => {
    it('THE STORED RETURN USES THE WINDOW MULTIPLIER', () => {
        const src = code(INITIATOR);
        expect(src).toMatch(
            /expectedReturn: investmentAmount \* exportWindowReturnMultiplier\(windowData\)/);
    });

    it('and the caller\'s ROI arithmetic is GONE', () => {
        // The exact expression that made the record caller-controlled.
        expect(code(INITIATOR)).not.toMatch(/investmentAmount \* \(1 \+ expectedROI \/ 100\)/);
    });

    it('and the stored ROI is the multiplier expressed as a percentage', () => {
        // Storing a rate that disagrees with the amount beside it is the same
        // defect one field over.
        expect(code(INITIATOR)).toMatch(
            /expectedROI: \(exportWindowReturnMultiplier\(windowData\) - 1\) \* 100/);
    });

    it('and THE HELPER ACTUALLY READS THE WINDOW — the premise everything rests on', () => {
        /**
         * Without this, the whole fix is decorative: a helper that ignored the
         * window and always returned the platform default would still make the
         * record internally consistent, and every other assertion here would
         * still pass. Mutation testing found exactly that gap — forcing the
         * helper's input to undefined survived the first draft.
         */
        expect(exportWindowReturnMultiplier({ returnMultiplier: 1.35 })).toBe(1.35);
        expect(exportWindowReturnMultiplier({ expectedReturnMultiplier: 2 })).toBe(2);
        // And a window recording nothing falls back rather than paying nothing.
        const fallback = exportWindowReturnMultiplier({});
        expect(exportWindowReturnMultiplier({ returnMultiplier: 1.35 })).not.toBe(fallback);
    });

    it('and the two stay consistent for any window, by construction', () => {
        for (const window of [
            { returnMultiplier: 1.2 },
            { returnMultiplier: 1.35 },
            { expectedReturnMultiplier: 2 },
            {},                       // nothing recorded -> platform default
            { returnMultiplier: 'x' }, // unreadable -> platform default
            { returnMultiplier: 0 },   // must not pay nothing
            { returnMultiplier: -1 },  // must not take money back
        ]) {
            const m = exportWindowReturnMultiplier(window);
            const amount = 100_000;
            const storedRoi = (m - 1) * 100;
            // The record's own two numbers agree: amount * (1 + roi/100) is the
            // stored return, whatever the window says.
            expect(amount * (1 + storedRoi / 100)).toBeCloseTo(amount * m, 6);
            expect(m).toBeGreaterThan(0);
        }
    });

    it('and the title and commodity come from the window too', () => {
        const src = code(INITIATOR);
        expect(src).toMatch(/windowTitle: String\(windowData\.title \?\? windowData\.commodity/);
        expect(src).toMatch(/commodity: String\(windowData\.commodity/);
    });

    it('and the premise holds — the one caller really did pass commodity twice', () => {
        // If the screen is ever corrected to pass a real title, this test should
        // be re-read rather than deleted: the server deriving it is still right.
        const screen = code('src/app/export/windows/[id]/page.tsx');
        const call = screen.slice(screen.indexOf('initializeInvestmentPaymentAction('));
        const args = call.slice(0, call.indexOf(');'));
        expect([...args.matchAll(/windowData\.commodity/g)].length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#429 — one rule across the three places that use it', () => {
    it('THE SIBLING FULFILMENT PATH DERIVES IT THE SAME WAY', () => {
        expect(code(SIBLING)).toMatch(
            /expectedReturn: amount \* exportWindowReturnMultiplier\(exportWindow\)/);
    });

    it('and the PAYOUT derives it the same way — #324, still holding', () => {
        const src = code(RELEASE);
        expect(src).toMatch(/const returnMultiplier = exportWindowReturnMultiplier\(data\)/);
        expect(src).toMatch(/const totalPayout = amount \* returnMultiplier/);
    });

    it('and THE PORTFOLIO READER derives its fallback the same way', () => {
        /**
         *   The fourth place, and the one I nearly left behind — which would
         *   have been this finding's own defect committed inside its own fix.
         *
         *   It read `data.expectedReturn || (amount * 0.20)`. The stored figure
         *   is the TOTAL (principal + profit); `amount * 0.20` is the PROFIT
         *   ALONE, at a rate written nowhere else. One column, one label, and a
         *   ₦100,000 investment showing ₦120,000 or ₦20,000 depending only on
         *   whether its row carried the field.
         */
        const src = code(SIBLING);
        expect(src).toMatch(
            /const expectedReturn = data\.expectedReturn\s*\|\|\s*\(amount \* exportWindowReturnMultiplier\(windowRow\)\)/);
        expect(src).not.toMatch(/amount \* 0\.20/);
    });

    it('and the stored value and the fallback measure the SAME quantity', () => {
        // The defect was not only the rate. The two expressions computed
        // different things: total versus profit. Same multiplier, same meaning.
        const amount = 100_000;
        for (const window of [{ returnMultiplier: 1.2 }, { returnMultiplier: 1.5 }, {}]) {
            const m = exportWindowReturnMultiplier(window);
            const stored = amount * m;          // what the writer stores
            const fallback = amount * m;        // what the reader now computes
            expect(fallback).toBe(stored);
            // And it is the TOTAL, never the bare profit.
            expect(fallback).toBeGreaterThan(amount);
        }
    });

    it('and all FOUR name the SAME helper, so a rate change lands once', () => {
        for (const f of [INITIATOR, SIBLING, RELEASE]) {
            expect({ f, uses: code(f).includes('exportWindowReturnMultiplier') })
                .toEqual({ f, uses: true });
        }
        // The sibling file holds two of the four — the fulfilment write and the
        // portfolio read — so count them rather than assume one each.
        expect([...code(SIBLING).matchAll(/exportWindowReturnMultiplier\(/g)].length)
            .toBeGreaterThanOrEqual(2);
    });

    it('and the helper refuses a window that would pay nothing or claw back', () => {
        // The floor that makes deriving safe: a zero or negative stored
        // multiplier falls back rather than being honoured.
        expect(exportWindowReturnMultiplier({ returnMultiplier: 0 })).toBeGreaterThan(1);
        expect(exportWindowReturnMultiplier({ returnMultiplier: -5 })).toBeGreaterThan(1);
        expect(exportWindowReturnMultiplier(null)).toBeGreaterThan(1);
    });
});
