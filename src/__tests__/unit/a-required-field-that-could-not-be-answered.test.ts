/**
 * @jest-environment node
 */

/**
 *   #789 THE COOPERATIVE SIGN-UP ASKED FOR SOMETHING IT WOULD NOT LET ANYBODY
 *        CHOOSE — AND #774 IS WHAT DID THAT.
 *
 *   The owner: "ward should be names of wards not ward 1 ward 2 etc." #774
 *   removed the numbered placeholder, gave the WAVE form a free-text fallback,
 *   and left two LGAs with real names. It did not give the COOPERATIVE form the
 *   same fallback.
 *
 *   PersonalInfoStep rendered Ward as a REQUIRED <select> whose options came
 *   from getWards, and OnboardingClient refuses to advance on
 *   `!personalInfo.address.ward`. getWards had answers for Ikeja and Abuja
 *   Municipal. So from #774 until this finding, cooperative onboarding could not
 *   be completed by an applicant anywhere else in Nigeria — 772 of 774 LGAs —
 *   because the only option in the box was "Select Ward".
 *
 *   A whole module's sign-up, dead, caused by the fix for the previous defect.
 *   That is this audit's most repeated finding — a correct rule applied to some
 *   of the places it names — and this time the missed place was load-bearing.
 *
 * ── AND THE DATA THE OWNER SAID WAS THERE ───────────────────────────────────
 *
 *   "do a deep search and find them. they are available and you know where to
 *    find these details. Its public information and accessible to everyone."
 *
 *   Correct. 772 of 774 LGAs and 8,778 wards now come from the published INEC
 *   register, cross-checked between two independent packagings before either
 *   was used. scripts/build-wards.ts holds the sources and the method; what is
 *   asserted here is the PROPERTIES the forms depend on.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the coop Ward returned to a <select>                         KILLED
 *     its `list=` binding dropped                                  KILLED
 *     getWards ignoring the state argument                         KILLED
 *     the ambiguous-name guard removed                             KILLED
 *     Ugwunagbo admitted to the register                           KILLED
 *     the WAVE ward field's datalist removed                       KILLED
 *     getWards returning the whole table for any LGA               KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { getWards, hasVerifiedWards, NIGERIAN_LOCATIONS } from '@/lib/locations';
import { WARDS_BY_STATE_AND_LGA } from '@/lib/nigeria-wards.generated';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const COOP_STEP = 'src/app/cooperatives/onboarding/steps/PersonalInfoStep.tsx';
const WAVE_STEP = 'src/app/wave/application/steps/CivicStatusStep.tsx';
const COOP_CLIENT = 'src/app/cooperatives/onboarding/OnboardingClient.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#789 — the required field can be answered', () => {
    it('THE GATE THAT MADE THIS FATAL IS STILL THERE', () => {
        /*
         *   Vacuity guard, and the reason this was a blocker rather than an
         *   inconvenience. If the client stopped requiring a ward, every
         *   assertion below would still pass and would be about nothing.
         */
        const src = stripComments(read(COOP_CLIENT));
        expect(src).toMatch(/!personalInfo\.address\.ward/);
    });

    it('AND THE WARD FIELD ACCEPTS A TYPED ANSWER', () => {
        /*
         *   THE test. A <select> here is the defect, whatever it is populated
         *   with: its options are the only answers, and for 772 LGAs there
         *   were none.
         *
         *   #823 THE CONTROL CHANGED AND THE PROPERTY DID NOT. This asserted
         *   `list="coop-ward-options"` — the datalist MECHANISM — which drew
         *   nothing at all on iOS Safari and went blank whenever the field
         *   already held a value. It is a ComboBox now, which keeps a typed
         *   answer that matches no option.
         *
         *   The assertion follows the property rather than the spelling: a
         *   control that TAKES A TYPED ANSWER. ComboBox's own suite proves it
         *   does, by typing one.
         */
        const src = stripComments(read(COOP_STEP));

        expect(src).toMatch(/label="Ward"|ariaLabel="Ward"/);
        expect(src).toContain('<ComboBox');
        //   and it is not a dropdown again — a select is the original defect
        expect(src).not.toMatch(/<FormSelect[^>]*\n?[^>]*label="Ward"/);
        expect(src).not.toMatch(/<select/);
    });

    it('AND IT STILL OFFERS THE REAL NAMES', () => {
        //   Accepting anything is only half the answer — an applicant who is
        //   handed an empty box has to spell her own ward the way the register
        //   does, and she cannot know how.
        const src = stripComments(read(COOP_STEP));

        //   #823 The options reach a ComboBox now rather than a <datalist>.
        //   What matters is unchanged: the real ward names are OFFERED, from
        //   the register, for the LGA and state she has already given.
        expect(src).toMatch(/options=\{getWards\(/);
        expect(src).toMatch(/getWards\(data\?\.address\?\.lga \|\| "", data\?\.address\?\.state \|\| ""\)/);
    });

    it('and the WAVE form does both too', () => {
        const src = stripComments(read(WAVE_STEP));

        expect(src).toContain('<ComboBox');
        expect(src).toMatch(/options=\{getWards\(/);
        expect(src).toMatch(/getWards\(data\?\.lgaOfResidence \|\| "", data\?\.stateOfResidence \|\| ""\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#789 — the register answers for the whole country', () => {
    it('772 OF 774 LGAs, AND THE TWO MISSING ONES ARE MISSING ON PURPOSE', () => {
        const total = Object.values(NIGERIAN_LOCATIONS).reduce((n, v) => n + v.length, 0);
        expect(total).toBe(774);
        expect(Object.keys(WARDS_BY_STATE_AND_LGA).length).toBe(772);

        /*
         *   The two are Abia's Ugwunagbo ("Ward One … Ward Ten") and Cross
         *   River's Calabar Municipality ("One … Ten"). Both sources agree that
         *   is how those wards are written, so there is nothing to find — and
         *   a form that offers "Ward Three" tells an applicant nothing she did
         *   not already know, which is the owner's complaint exactly. They fall
         *   back to the typed answer, which is what they have today.
         */
        expect(getWards('Ugwunagbo', 'Abia')).toEqual([]);
        expect(getWards('Calabar Municipal', 'Cross River')).toEqual([]);
        expect(hasVerifiedWards('Ugwunagbo', 'Abia')).toBe(false);
    });

    it('AND THE LGA THE OWNER WOULD HAVE CHECKED NOW NAMES ITS WARDS', () => {
        //   #774's header used Gwagwalada as its example of the defect: "An
        //   applicant in Gwagwalada picked 'Ward 3', and 'Ward 3' is not the
        //   name of anywhere."
        const wards = getWards('Gwagwalada', 'FCT');

        expect(wards).toContain('Gwagwalada Centre');
        expect(wards).toContain('Dobi');
        expect(wards.some(w => /^ward\s/i.test(w))).toBe(false);
    });

    it('EVERY LGA IN THE REGISTER HAS BETWEEN 10 AND 20 WARDS', () => {
        /*
         *   Nigeria's constitutional range, and the cheapest test that a row
         *   has not been truncated or doubled. A list of 3 or of 40 is a
         *   packaging error, not a ward register.
         */
        const bad = Object.entries(WARDS_BY_STATE_AND_LGA)
            .filter(([, w]) => w.length < 10 || w.length > 20)
            .map(([k, w]) => `${k} (${w.length})`);
        expect(bad).toEqual([]);
    });

    it('AND NO LGA LISTS THE SAME WARD TWICE', () => {
        //   The source has eleven duplicate rows across ten LGAs — 'Okumagba I'
        //   twice in Warri South, 'Omoku Town V' twice in ONELGA. A duplicate
        //   in a datalist is a duplicate suggestion.
        const bad = Object.entries(WARDS_BY_STATE_AND_LGA)
            .filter(([, w]) => new Set(w.map(x => x.toLowerCase())).size !== w.length)
            .map(([k]) => k);
        expect(bad).toEqual([]);
    });

    it('and no name arrives with the source\'s stray whitespace', () => {
        //   422 names in the source carry a double space — "Ataba  I",
        //   "Omoku  Town I" — which an applicant would never type.
        const bad = Object.values(WARDS_BY_STATE_AND_LGA)
            .flatMap(w => w.filter(x => x !== x.trim() || /\s{2,}/.test(x)));
        expect(bad).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#789 — six LGA names belong to two states each', () => {
    it('AND EACH STATE GETS ITS OWN WARDS', () => {
        /*
         *   THE test for the key change. Surulere is in Lagos AND in Oyo;
         *   Bassa in Kogi and Plateau; Ifelodun and Irepodun in Kwara and Osun;
         *   Nasarawa in Kano and Nasarawa; Obi in Benue and Nasarawa.
         *
         *   Keyed on the LGA alone — which is how this lookup worked when it
         *   held two rows — six of them would hand a woman the other state's
         *   wards. She would pick one, and it would read as an answer for the
         *   rest of that record's life.
         */
        const lagos = getWards('Surulere', 'Lagos');
        const oyo = getWards('Surulere', 'Oyo');

        expect(lagos.length).toBeGreaterThan(0);
        expect(oyo.length).toBeGreaterThan(0);
        expect(lagos).not.toEqual(oyo);
        //   not merely different — neither list leaks into the other
        expect(lagos.filter(w => oyo.includes(w))).toEqual([]);

        expect(getWards('Bassa', 'Kogi')).not.toEqual(getWards('Bassa', 'Plateau'));
        expect(getWards('Obi', 'Benue')).not.toEqual(getWards('Obi', 'Nasarawa'));
    });

    it('AND ASKED WITHOUT A STATE, AN AMBIGUOUS NAME GETS NOTHING', () => {
        /*
         *   Rather than one of the two. A wrong ward list under the right LGA
         *   is a real-looking wrong answer, and it survives review precisely
         *   because it reads as data — which is worse than the numbered
         *   placeholder this replaced. Empty means she types, which is always
         *   true.
         */
        expect(getWards('Surulere')).toEqual([]);
        expect(getWards('Bassa')).toEqual([]);
        expect(hasVerifiedWards('Surulere')).toBe(false);
    });

    it('CONTROL: an UNambiguous name still answers without a state', () => {
        //   Or the rule above would just be getWards switched off for
        //   one-argument callers.
        expect(getWards('Gwagwalada').length).toBeGreaterThan(0);
        expect(getWards('Ikeja').length).toBeGreaterThan(0);
    });

    it('CONTROL: an LGA that does not exist is still empty', () => {
        expect(getWards('AN LGA THAT DOES NOT EXIST', 'Lagos')).toEqual([]);
        expect(getWards('Ikeja', 'Kano')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#789 — the register is generated, and says where it came from', () => {
    it('THE GENERATED FILE IS NOT HAND-EDITED', () => {
        //   8,778 names nobody can review by eye. What makes them checkable is
        //   that they are reproducible from a named source.
        const src = read('src/lib/nigeria-wards.generated.ts');
        expect(src).toMatch(/GENERATED — DO NOT EDIT BY HAND/);
        expect(src).toMatch(/scripts\/build-wards\.ts/);
    });

    it('AND THE GENERATOR NAMES BOTH SOURCES AND REFUSES TO GUESS', () => {
        /*
         *   The part that matters most and is easiest to lose. A later edit
         *   that added fuzzy matching would silently attach one LGA's wards to
         *   another, and nothing on the screen would look wrong.
         */
        const src = read('scripts/build-wards.ts');

        expect(src).toMatch(/temikeezy\/nigeria-geojson-data/);
        expect(src).toMatch(/9jaDevo\/nigeria-lga-ward/);
        //   the refusal, and the bound that enforces it
        expect(stripComments(src)).toMatch(/REFUSING: only/);
        expect(stripComments(src)).toMatch(/report\.unmatched\.push/);
    });

    it('and the spelling aliases are an explicit list, not a similarity score', () => {
        const code = stripComments(read('scripts/build-wards.ts'));

        expect(code).toMatch(/const ALIASES: Record<string, string> = \{/);
        //   no fuzzy matcher anywhere in it
        expect(code).not.toMatch(/levenshtein|get_close_matches|similarity|fuzzy/i);
    });
});
