/**
 * @jest-environment node
 */

/**
 *   #777 SIX APPLICATION FORMS, AND NO WAY HOME FROM ANY OF THEM.
 *
 *   The owner: "On each of the forms, add a button to submit another
 *   application when one is completed and also add a home button to return
 *   back to home at the top left corner."
 *
 *   Measured before the fix: not one of the six multi-step forms — WAVE,
 *   Academy, Export, Farm Nation, Marketplace, Cooperative onboarding — linked
 *   to `/`. What they had instead was a "Back" link one level up into the
 *   module, and on two of them a "Hub" link to `/dashboard`, which is the
 *   signed-in member area and not home — and an applicant part-way through
 *   onboarding may not have a populated one yet.
 *
 *   The cost is not cosmetic. WaveApplicationClient installs a `beforeunload`
 *   handler from step two onward, so an applicant who changed her mind and
 *   reached for the browser's Back button was asked to confirm she wanted to
 *   discard her answers. The form had no deliberate exit at all.
 *
 * ── WHY THIS IS A SOURCE SCAN ───────────────────────────────────────────────
 *
 *   Because the defect is ABSENCE, spread across six files, and absence is what
 *   a render test of any ONE of them cannot see. This is the same shape as the
 *   finding class this audit keeps meeting — "a correct rule applied to some of
 *   the places it names" — so what is ratcheted is the SET, not a specimen. A
 *   seventh form added without the control fails here.
 *
 *   The two shared layouts count for the forms that use them: Export and
 *   Marketplace render inside OnboardingLayout, and the button lives there, so
 *   the scan follows the import rather than demanding a duplicate.
 *
 * ── THE JUDGEMENT CALL ON THE SECOND BUTTON ─────────────────────────────────
 *
 *   "Submit another application" is built as "Apply to another programme". A
 *   second application to the SAME programme is refused by the server by name
 *   — "Your previous application is still being processed" — and that refusal
 *   is correct, so a button that produced it every time would be worse than
 *   none. FormNavButtons states this in full; if the owner meant the other
 *   reading, the label is the only thing that changes.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the home button removed from WaveApplicationClient           KILLED
 *     removed from the shared OnboardingLayout                     KILLED
 *     removed from the onboarding/ OnboardingLayout                KILLED
 *     FormHomeButton pointed at /dashboard instead of /            KILLED
 *     the WAVE header's sixth acronym expansion restored           KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every multi-step application form a member can be sitting inside. */
const FORMS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'WAVE', file: 'src/app/wave/application/WaveApplicationClient.tsx' },
    { name: 'Academy', file: 'src/app/academy/application/AcademyApplicationClient.tsx' },
    { name: 'Export', file: 'src/app/export/onboarding/ExportOnboardingClient.tsx' },
    { name: 'Farm Nation', file: 'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx' },
    { name: 'Marketplace', file: 'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx' },
    { name: 'Cooperative', file: 'src/app/cooperatives/onboarding/OnboardingClient.tsx' },
];

/** Layouts that supply the control on a form's behalf. */
const LAYOUTS = [
    'src/components/onboarding/OnboardingLayout.tsx',
    'src/components/shared/OnboardingLayout.tsx',
];

/** True when this file renders the home control itself, or inherits it. */
function hasHomeControl(file: string): boolean {
    const src = read(file);
    if (/<FormHomeButton\b/.test(src)) return true;
    //   inherited from a layout that has it
    return LAYOUTS.some(l =>
        /<FormHomeButton\b/.test(read(l))
        && new RegExp(`from ["']@/components/${l.includes('/shared/') ? 'shared' : 'onboarding'}/OnboardingLayout["']`).test(src));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#777 — every application form has a way home', () => {
    it('the list of forms is the real one, and none of them has moved', () => {
        //   Vacuity guard. Every assertion below is trivially true of a form
        //   whose file has been renamed, and this suite's whole job is to be
        //   the thing that notices a form.
        expect(FORMS.length).toBe(6);
        for (const { name, file } of FORMS) {
            expect(existsSync(join(process.cwd(), file))).toBe(true);
        }
        expect(FORMS.map(f => f.name)).toEqual([
            'WAVE', 'Academy', 'Export', 'Farm Nation', 'Marketplace', 'Cooperative',
        ]);
    });

    it.each(FORMS)('$name offers a home control', ({ file }) => {
        expect(hasHomeControl(file)).toBe(true);
    });

    it('AND THE CONTROL ACTUALLY GOES HOME', () => {
        //   The button existing is not the property — where it points is. Two
        //   of these screens already had a "Hub" link that looked like this one
        //   and went to /dashboard, which is why the destination is asserted
        //   rather than assumed.
        const src = read('src/components/forms/FormNavButtons.tsx');
        const home = src.split('export function FormHomeButton')[1].split('export function')[0];

        expect(home).toMatch(/href="\/"/);
        expect(home).not.toMatch(/href="\/dashboard"/);
    });

    it('and the completed-application control offers another programme', () => {
        const src = read('src/components/forms/FormNavButtons.tsx');
        const apply = src.split('export function ApplyToAnotherProgrammeButton')[1];

        expect(apply).toMatch(/href="\/auth\/get-started"/);
    });

    it('the completion screens carry it', () => {
        //   The screens a member actually lands on when an application is done.
        //   The academy and cooperative "success" routes are retired redirects
        //   (see their own headers), so they are not on this list — a redirect
        //   with a button on it would be a screen nobody reaches, which is the
        //   defect #384 retired them for.
        const DONE = [
            'src/app/wave/application/success/page.tsx',
            'src/app/export/onboarding/pending/page.tsx',
            'src/app/farm-nation/onboarding/pending/page.tsx',
            'src/app/marketplace/onboarding/pending/page.tsx',
            'src/app/academy/application/pending/page.tsx',
        ];
        expect(DONE.length).toBe(5);
        for (const p of DONE) {
            expect(read(p)).toMatch(/<ApplyToAnotherProgrammeButton\b/);
        }
    });

    it('AND EVERY WAITING SCREEN HAS A WAY HOME', () => {
        /*
         *   #781 The owner, on the second pass: "for the forms without
         *   auto-approval, they should be redirected to a pending page with a
         *   home button on the page."
         *
         *   Not one of them had one. What they carried was a link back into the
         *   MODULE — "Back to WAVE Home" goes to /wave, not to / — so an
         *   applicant waiting on somebody else's decision, with nothing to do
         *   on the screen, could not leave the module from it.
         *
         *   The cooperative's pending-payment route is deliberately absent from
         *   this list: it is a retired redirect (#384), and a button on a
         *   screen nobody reaches is the defect that retired it.
         */
        const WAITING = [
            'src/app/export/onboarding/pending/page.tsx',
            'src/app/farm-nation/onboarding/pending/page.tsx',
            'src/app/marketplace/onboarding/pending/page.tsx',
            'src/app/academy/application/pending/page.tsx',
            'src/app/wave/application/review-pending/page.tsx',
        ];

        expect(WAITING.length).toBe(5);
        for (const p of WAITING) {
            expect(read(p)).toMatch(/<FormHomeButton\b/);
        }
    });

    it('and an approved applicant is taken to their dashboard rather than left waiting', () => {
        //   The other half of the owner's sentence: "once approved, they should
        //   have a direct access to their dashboard." WAVE's waiting screen
        //   watches the status and moves the applicant itself.
        const src = stripComments(read('src/app/wave/application/review-pending/page.tsx'));

        expect(src).toMatch(/applicationStatus === "approved"/);
        expect(src).toMatch(/router\.push\("\/wave\/dashboard"\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#777 — the acronym, on the form itself', () => {
    it('THE WAVE FORM NO LONGER INVENTS A SIXTH EXPANSION', () => {
        /*
         *   #774 found five expansions of WAVE and corrected four. This one —
         *   "Women's Agribusiness Venture Empowerment" — sat on the application
         *   form, which is the single screen every WAVE applicant reads, and
         *   was missed because #774 swept for the four it had already found.
         */
        /*
         *   COMMENTS STRIPPED FIRST, and the first draft of this test did not
         *   do that — so it failed on the comment that DOCUMENTS the fix,
         *   which quotes the wrong wording in order to explain it. That is the
         *   #741 shape: an assertion that pins the spelling in the file rather
         *   than the property on the screen. What the applicant reads is the
         *   JSX, so the JSX is what is asserted.
         */
        const src = stripComments(read('src/app/wave/application/WaveApplicationClient.tsx'));

        expect(src).not.toMatch(/Agribusiness Venture Empowerment/);
        expect(src).toMatch(/\{WAVE_FULL_NAME\}/);
    });

    it('and no screen spells it out by hand', () => {
        //   The constant exists so prose cannot drift. A file that writes the
        //   words itself has opted out of that, which is how there came to be
        //   six.
        const src = stripComments(read('src/app/wave/application/WaveApplicationClient.tsx'));
        expect(src).not.toMatch(/Women['’]?s? (in )?Agr[a-z-]*[^\n]*Expansion/);
    });
});
