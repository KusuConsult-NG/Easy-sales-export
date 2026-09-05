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
 *     reword the header prose                         SURVIVED, as intended
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

    it('and all three name the SAME helper, so a rate change lands once', () => {
        for (const f of [INITIATOR, SIBLING, RELEASE]) {
            expect({ f, uses: code(f).includes('exportWindowReturnMultiplier') })
                .toEqual({ f, uses: true });
        }
    });

    it('and the helper refuses a window that would pay nothing or claw back', () => {
        // The floor that makes deriving safe: a zero or negative stored
        // multiplier falls back rather than being honoured.
        expect(exportWindowReturnMultiplier({ returnMultiplier: 0 })).toBeGreaterThan(1);
        expect(exportWindowReturnMultiplier({ returnMultiplier: -5 })).toBeGreaterThan(1);
        expect(exportWindowReturnMultiplier(null)).toBeGreaterThan(1);
    });
});
