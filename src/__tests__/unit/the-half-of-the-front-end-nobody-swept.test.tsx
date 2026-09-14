/**
 * @jest-environment jsdom
 */

/**
 *   #741 THREE RATCHETS EACH SAID "THE COUNT IS ZERO, EXACTLY", AND EACH
 *        COUNTED ONLY THE HALF OF THE FRONT END UNDER src/app.
 *
 *   #597 (hand-written date formatters), #598 (`.toLocaleString()` on a stored
 *   field) and #599 (hand-written humanisers) are three of this audit's better
 *   instruments. Each states a CLASS rather than a list, sweeps the tree for
 *   it, and asserts the count is EXACTLY zero rather than under a cap.
 *
 *   All three walked `src/app`. React components live in `src/components` —
 *   109 `.tsx` files — and that directory was outside every one of the three
 *   walks. Between them they found 22 live sites there:
 *
 *       #597 date formatters      2   ExportDetailsModal, DateRangePicker
 *       #598 .toLocaleString()   18   across 8 files
 *       #599 humanisers           2   LandMap, ExportDetailsModal
 *
 * ── THE TWO THAT MAKE THE POINT ─────────────────────────────────────────────
 *
 *   modals/BookingModal and modals/BookingWizard both rendered
 *
 *       ₦{exportWindow.slotPrice.toLocaleString()}
 *
 *   — the exact expression, on the exact field, that #597 fixed on
 *   /export/opportunities. That page is the screen which OPENS these two
 *   modals, and lib/numbers.ts's own header is about this line. The fix reached
 *   the page and stopped at its import statement.
 *
 *   land/LandMap is the same story for #599: /land/map was repaired, and the
 *   map component it mounts kept `listing.status.replace('_', ' ')`.
 *
 * ── AND IN THE MODALS IT IS NOT A RENDERING BUG ─────────────────────────────
 *
 *   Both compute, from the same unguarded window:
 *
 *       const availableVolume = exportWindow.targetVolume - exportWindow.currentVolume;
 *       const totalPrice      = quantity * exportWindow.slotPrice;
 *
 *   A window missing any of the three makes both NaN — and `quantity > NaN` is
 *   FALSE. So the check that exists to stop an over-booking
 *
 *       if (quantity <= 0 || quantity > availableVolume) { refuse }
 *
 *   PASSED, and the booking went to the server against a window with no
 *   recorded volume at all. A guard that fails open, reached by arithmetic
 *   rather than by a missing branch, which is why reading the guard does not
 *   show it.
 *
 * ── WHY THE VACUITY GUARDS DID NOT CATCH THE NARROW WALK ────────────────────
 *
 *   Each scan already carried the right instinct. #597's says it outright:
 *
 *       "At zero, a scan pointed at the wrong directory is indistinguishable
 *        from a fixed codebase, so the walk has to have read something."
 *
 *   — and then checks `lastSeen > 100`. `src/app` alone holds 426 `.tsx` files,
 *   so the guard was satisfied with `src/components` entirely unread. A guard
 *   against reading NOTHING is not a guard against reading only SOME, and a
 *   count is precisely the wrong instrument: one large root drowns out a
 *   missing one. The roots are named now, and asserted by name.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away. On the first pass ONE MUTANT SURVIVED — making
 *   `walkedRoots` return the list unconditionally left every by-name assertion
 *   passing while reporting roots nothing had read, which is this finding's own
 *   defect reproduced in the helper written to fix it. A test binding it to its
 *   argument was added and the sweep re-run; the table is that second run.
 */

import React from 'react';
import { describe, it, expect, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { FRONT_END_ROOTS, frontEndFiles, walkedRoots } from '@/lib/testing/front-end-roots';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/app/actions/export-booking', () => ({ createBookingAction: jest.fn() }));

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const BookingModal = require('@/components/modals/BookingModal').default;

/** A window that lost the three numeric fields a partial write leaves out. */
const WINDOW_WITHOUT_NUMBERS: any = {
    id: 'w1',
    commodity: 'Cocoa',
    status: 'open',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#741 — the booking modal on a window with no numbers', () => {
    it('RENDERS WITHOUT THROWING, AND SHOWS NO NaN', () => {
        /*
         *   Two failures in one render before this: `slotPrice.toLocaleString()`
         *   is a TypeError on an absent field, and the derived `totalPrice`
         *   printed the string "NaN" into a price the member is about to agree
         *   to.
         */
        const { container } = render(
            <BookingModal isOpen onClose={() => {}} exportWindow={WINDOW_WITHOUT_NUMBERS} />,
        );

        expect(container).toBeTruthy();
        expect(container.textContent ?? '').not.toContain('NaN');
    });

    it('AND THE SAME WINDOW WITH REAL NUMBERS STILL SHOWS THEM', () => {
        //   Vacuity guard: a component that rendered nothing, or that zeroed
        //   every figure, would satisfy the assertion above.
        const { container } = render(
            <BookingModal
                isOpen
                onClose={() => {}}
                exportWindow={{ ...WINDOW_WITHOUT_NUMBERS, slotPrice: 2500, targetVolume: 9000, currentVolume: 1000 }}
            />,
        );
        const text = container.textContent ?? '';

        expect(text).toContain('2,500');
        expect(text).toContain('8,000');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#741 — why the volume guard failed open', () => {
    it('A COMPARISON AGAINST NaN IS FALSE, IN BOTH DIRECTIONS', () => {
        /*
         *   The whole mechanism, exercised rather than described. `>` and `<`
         *   are both false against NaN, so a bound check written either way
         *   ADMITS the value it exists to reject. This is why reading
         *   `if (quantity > availableVolume) refuse` shows nothing wrong.
         */
        const availableVolume = (undefined as any) - (undefined as any);

        expect(Number.isNaN(availableVolume)).toBe(true);
        expect(5000 > availableVolume).toBe(false);
        expect(5000 < availableVolume).toBe(false);
        //   …so the refusal never fires.
        expect(5000 <= 0 || 5000 > availableVolume).toBe(false);
    });

    it('AND BOTH MODALS NOW DERIVE THOSE TWO FROM GUARDED READS', () => {
        /*
         *   Asserted at the SOURCE of each value, not at the places they are
         *   printed. Guarding only the render would leave the comparison — the
         *   half that lets a booking through — reading NaN.
         */
        for (const f of ['src/components/modals/BookingModal.tsx', 'src/components/modals/BookingWizard.tsx']) {
            const src = code(f);

            expect(src).toContain('numberOrZero(exportWindow.targetVolume) - numberOrZero(exportWindow.currentVolume)');
            expect(src).toContain('const slotPrice = numberOrZero(exportWindow.slotPrice);');
            //   And the raw field is not read anywhere else in the file.
            expect(src).not.toContain('exportWindow.slotPrice.toLocaleString()');
            expect(src).not.toContain('* exportWindow.slotPrice');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#741 — and the three sweeps now walk the whole front end', () => {
    const SWEEPS = [
        'src/__tests__/unit/a-date-that-is-not-one.test.tsx',
        'src/__tests__/unit/a-number-nobody-wrote.test.tsx',
        'src/__tests__/unit/a-row-with-nothing-on-it.test.tsx',
    ];

    it('EACH ONE TAKES ITS FILES FROM THE SHARED WALK', () => {
        /*
         *   One walk, not three widened in parallel. Three copies of a root
         *   list is how one of them came to be a root short, and a fourth sweep
         *   written next quarter inherits the correct roots by construction.
         */
        for (const f of SWEEPS) {
            const src = code(f);
            expect(src).toContain('frontEndFiles(ROOT)');
            //   And the old private walk is gone, not merely supplemented.
            expect(src).not.toContain("walk(join(ROOT, 'src/app'))");
        }
    });

    it('AND EACH ASSERTS THE ROOTS BY NAME, NOT BY COUNT', () => {
        for (const f of SWEEPS) {
            expect(code(f)).toContain('expect(lastRoots).toEqual([...FRONT_END_ROOTS].sort())');
        }
    });

    it('AND walkedRoots REPORTS WHAT IT WAS GIVEN, NOT THE LIST', () => {
        /*
         *   A MUTANT SURVIVED HERE AND THIS TEST IS WHY IT NOW DOES NOT. Making
         *   walkedRoots return FRONT_END_ROOTS unconditionally left every
         *   by-name assertion above passing while reporting roots nothing had
         *   read — a guard that cannot fail, which is the exact defect this
         *   whole finding is about, reproduced in the helper written to fix it.
         *
         *   So it is bound to its argument in both directions: nothing in,
         *   nothing out; one root in, one root out.
         */
        expect(walkedRoots([])).toEqual([]);

        const appOnly = frontEndFiles(ROOT).filter((f) => f.root === 'src/app');
        expect(appOnly.length).toBeGreaterThan(0);
        expect(walkedRoots(appOnly)).toEqual(['src/app']);
    });

    it('AND THE SHARED WALK REACHES BOTH ROOTS, WITH FILES IN EACH', () => {
        /*
         *   The assertion the old `lastSeen > 100` could not make. Each root has
         *   to contribute files of its own — a walk that silently resolved both
         *   roots to the same directory would still report two names.
         */
        const files = frontEndFiles(ROOT);

        expect(walkedRoots(files)).toEqual([...FRONT_END_ROOTS].sort());
        for (const root of FRONT_END_ROOTS) {
            expect({ root, count: files.filter((f) => f.root === root).length > 50 })
                .toEqual({ root, count: true });
        }
        //   And it finds the specific files this finding repaired, so a walk
        //   that reached src/components but skipped its subdirectories fails.
        const rels = files.map((f) => f.rel);
        expect(rels).toContain('src/components/modals/BookingWizard.tsx');
        expect(rels).toContain('src/components/land/LandMap.tsx');
        expect(rels).toContain('src/app/land/LandMapClient.tsx');
    });

    it('AND src/components IS NAMED IN THE SHARED LIST', () => {
        //   Stated directly: the one-line fact this whole finding turns on.
        expect([...FRONT_END_ROOTS]).toContain('src/components');
        expect([...FRONT_END_ROOTS]).toContain('src/app');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run AFTER
 *   this table was written — see the note in the header, including the one that
 *   survived the first pass.
 *
 *     MUTANT                                                        RESULT
 *     BookingModal reads slotPrice raw again                         KILLED
 *     BookingModal derives availableVolume raw again                 KILLED
 *     BookingWizard reads slotPrice raw again                        KILLED
 *     numberOrZero passes NaN through                                KILLED
 *     FRONT_END_ROOTS drops src/components                           KILLED
 *     frontEndFiles skips subdirectories                             KILLED
 *     walkedRoots reports every root regardless of files             KILLED
 *     one sweep goes back to its private src/app walk                KILLED
 *     one sweep drops its by-name root assertion                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
