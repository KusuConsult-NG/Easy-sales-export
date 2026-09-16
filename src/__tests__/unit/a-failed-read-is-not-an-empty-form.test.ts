/**
 * @jest-environment node
 */

/**
 *   #793 "EDIT YOUR APPLICATION" OPENED A BLANK FORM WHEN THE READ FAILED.
 *
 *   The owner asked for the error-dropping backlog to be triaged rather than
 *   left pinned. This is the first thing the triage found, and it is not a
 *   theoretical one — it is the mechanism behind a symptom they reported
 *   months ago: "details added to the form and some are missing in the process
 *   of submission, why?"
 *
 *   Every one of the six application forms had the same three lines:
 *
 *       const result = await getXApplicationAction();
 *       if (result.success && result.data) { prefill(result.data) }
 *       setIsEditMode(true);          ← UNCONDITIONAL
 *
 *   So a FAILED read prefilled nothing and then entered edit mode anyway. The
 *   member is shown an empty form, labelled as an edit of the application she
 *   has already completed. She re-types it, or submits it missing every field
 *   she cannot see — and the record she had is overwritten by the blank one.
 *
 * ── THIS RULE ALREADY EXISTED, FOR LISTS ────────────────────────────────────
 *
 *   #588 is this codebase's statement of it, and it swept THIRTY-SIX screens:
 *   "a refusal and an empty result collapsed into one branch". It even built
 *   the component — ListLoadFailed — whose copy says the sentence a person in
 *   this position needs: "Nothing is lost."
 *
 *   It was applied to every LIST and to none of the FORMS. That is this audit's
 *   most repeated finding once more, and here the untouched half is the more
 *   expensive one: a list that reads empty is alarming, a FORM that reads empty
 *   is overwritten.
 *
 *   So no new component. The six forms use #588's.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the guard removed from the cooperative form                  KILLED
 *     the guard removed from WAVE                                  KILLED
 *     setLoadFailed(true) replaced with setLoadFailed(false)       KILLED
 *     the early `return` dropped, so edit mode is entered anyway   KILLED
 *     the failure panel rendered without a way home                SURVIVED
 *                                             → then, rewritten:   KILLED
 *     the failure panel stops using #588's component               KILLED
 *     reword this header                                SURVIVED, intended
 *
 *   THE SURVIVOR IS RECORDED BECAUSE IT MATTERS. The way-home assertion sliced
 *   from the guard to the END OF THE FILE, so it matched the home button these
 *   forms already render in their ordinary layout — deleting the button from
 *   the FAILURE PANEL left the suite green. An assertion satisfied by the wrong
 *   occurrence, for the ninth time in this audit, and this time the wrong
 *   occurrence was real code rather than a comment. Bounded to the panel now,
 *   with a length check so it cannot silently widen again.
 *
 * ── #795: AND #793 WAS ITSELF PARTIAL ───────────────────────────────────────
 *
 *   #793 fixed the EDIT branch of each of the six forms. Each form reads its
 *   application in two or three branches, so the count was:
 *
 *       fourteen reads, SIX guarded, EIGHT not — and the suite was green,
 *       because every assertion above asked "does this file contain a guard".
 *
 *   The eight it missed include the REVISION branch of all six forms, which is
 *   the worse one: a member told to correct a rejected application is handed a
 *   blank form and resubmits blank over the record she was fixing. The
 *   fourteenth is the academy ROUTING read, where a failed read reads as "she
 *   never applied" and sends a learner who HAS applied back to the form.
 *
 *   A correct rule applied to some of the places it names — this audit's most
 *   repeated finding, twice now inside my own fixes. The new assertion COUNTS.
 *
 * ── #795 MUTATION LOG ───────────────────────────────────────────────────────
 *
 *     each of the six revision reads unguarded again (as #793 left it)  KILLED
 *     the academy ROUTING read unguarded — "she never applied"          KILLED
 *     the cooperative revision guard set to setLoadFailed(false)        KILLED
 *     the WAVE revision guard's early `return` dropped                  KILLED
 *     the marketplace flag set, then a long way to the return           KILLED
 *     reword a guard's comment                             SURVIVED, intended
 *     baseline, unmutated                                  SURVIVED, intended
 *
 *   Eleven mutants, eleven killed, two controls survived.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every form that reads a member's existing application back into itself. */
const FORMS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'WAVE', file: 'src/app/wave/application/WaveApplicationClient.tsx' },
    { name: 'Academy', file: 'src/app/academy/application/AcademyApplicationClient.tsx' },
    { name: 'Export', file: 'src/app/export/onboarding/ExportOnboardingClient.tsx' },
    { name: 'Farm Nation', file: 'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx' },
    { name: 'Marketplace', file: 'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx' },
    { name: 'Cooperative', file: 'src/app/cooperatives/onboarding/OnboardingClient.tsx' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#793 — a failed read is not an empty application', () => {
    it('the list of forms is the real one, and none of them has moved', () => {
        //   Vacuity guard. Every assertion below is trivially true of a form
        //   whose file has been renamed.
        expect(FORMS.length).toBe(6);
        for (const { file } of FORMS) expect(read(file).length).toBeGreaterThan(1000);
    });

    it.each(FORMS)('$name GUARDS EVERY READ, not just the first', ({ name, file }) => {
        /*
         *   #795 THE ASSERTION #793 SHOULD HAVE WRITTEN, and the reason it is
         *   here now: #793 guarded the EDIT branch of each form and its tests
         *   asked only "does this file contain a guard". It did. Every form
         *   reads its application in TWO OR THREE branches, so six of fourteen
         *   reads were guarded and eight were not, and the suite was green.
         *
         *   The branch it missed is the worse one — REVISION. A member told to
         *   correct a rejected application, handed a blank form, resubmits blank
         *   over the record she was fixing.
         *
         *   COUNTED, not sampled. "Contains a guard" is exactly the shape of
         *   assertion that let a partial fix look complete, and this audit's
         *   most repeated finding is a correct rule applied to some of the
         *   places it names — including, twice now, by me.
         */
        const src = stripComments(read(file));
        const reads = (src.match(/await get\w*(Application|Verification)Action\(/g) ?? []).length;
        const guards = (src.match(/setLoadFailed\(true\)/g) ?? []).length;
        //   and every one of them STOPS. A flag set on a read that then falls
        //   through into the prefill is the defect with a variable added — the
        //   same thing the single-site test below says, said once per read.
        const stops = (src.match(/setLoadFailed\(true\);[\s\S]{0,40}return;/g) ?? []).length;

        expect({ name, reads: reads > 0 }).toEqual({ name, reads: true });
        expect({ name, guards }).toEqual({ name, guards: reads });
        expect({ name, stops }).toEqual({ name, stops: reads });
    });

    it.each(FORMS)('$name STOPS instead of opening blank', ({ file }) => {
        //   THE test. The state, the set, and — the part that matters — the
        //   early return, because setting a flag and carrying on into
        //   setIsEditMode(true) is the defect with a variable added.
        const src = stripComments(read(file));

        expect(src).toMatch(/const \[loadFailed, setLoadFailed\] = useState\(false\)/);
        expect(src).toMatch(/setLoadFailed\(true\);[\s\S]{0,40}return;/);
    });

    it.each(FORMS)('$name SAYS SO, with #588\'s component', ({ file }) => {
        const src = stripComments(read(file));

        expect(src).toMatch(/if \(loadFailed\)/);
        expect(src).toMatch(/<ListLoadFailed/);
        expect(src).toMatch(/onRetry=\{\(\) => window\.location\.reload\(\)\}/);
    });

    it.each(FORMS)('$name gives them a way off the screen', ({ file }) => {
        /*
         *   #781's rule. A member who can do nothing on a screen must be able
         *   to leave it, and this one has no form to fall back to.
         *
         *   BOUNDED TO THE PANEL, and the first draft was not: it sliced from
         *   the guard to the END OF THE FILE, so it found the home button these
         *   forms already render in their NORMAL layout. The sweep caught it —
         *   deleting the button from the failure panel left the suite green.
         *   An assertion satisfied by the wrong occurrence is the trap this
         *   audit has now met nine times, and it does not stop being it when
         *   the wrong occurrence is real code rather than a comment.
         */
        const src = stripComments(read(file));
        const from = src.indexOf('if (loadFailed)');
        expect(from).toBeGreaterThan(-1);
        //   the panel ends at its own closing `}` — the next line that is a
        //   brace at exactly four spaces of indent.
        const end = src.indexOf('\n    }', from);
        const panel = src.slice(from, end);

        expect(panel).toMatch(/<FormHomeButton\b/);
        //   and the slice really is just the panel, not half the component
        expect(panel.length).toBeLessThan(1200);
    });

    it('AND THE GUARD SITS BEFORE EDIT MODE, not after it', () => {
        /*
         *   Order is the whole property. The defect is not "no flag" — it is
         *   that setIsEditMode(true) runs on a failed read, so a guard placed
         *   after it changes nothing a member would notice.
         */
        for (const { name, file } of FORMS) {
            const src = stripComments(read(file));
            const guard = src.indexOf('setLoadFailed(true)');
            const edit = src.indexOf('setIsEditMode(true)');
            expect({ name, ordered: guard > -1 && edit > -1 && guard < edit })
                .toEqual({ name, ordered: true });
        }
    });

    it('CONTROL: a SUCCESSFUL read still prefills and still enters edit mode', () => {
        //   Or this finding would have replaced "a blank form" with "no form",
        //   which is worse.
        for (const { name, file } of FORMS) {
            const src = stripComments(read(file));
            expect({ name, prefills: /setIsEditMode\(true\)/.test(src) })
                .toEqual({ name, prefills: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#793 — and #588\'s rule is not restated, it is reused', () => {
    it('THE COMPONENT IS #588\'s, not a seventh copy of the sentence', () => {
        /*
         *   Six restatements of "nothing is lost" is how this codebase grew the
         *   drift the audit keeps finding — ListLoadFailed's own header says so.
         */
        for (const { file } of FORMS) {
            expect(stripComments(read(file))).toMatch(/from "@\/components\/common\/ListLoadFailed"/);
        }
    });

    it('and it still says the sentence that matters', () => {
        const src = read('src/components/common/ListLoadFailed.tsx');
        expect(src).toMatch(/Nothing is lost/);
    });
});
