/**
 * @jest-environment node
 */

/**
 *   #857 THE STATE WAS A DROPDOWN AND THE LGA WAS WHATEVER SOMEBODY TYPED.
 *
 *   THE OWNER: "LGA drop-down not included — when users select a state there
 *   should be an LGA dropdown."
 *
 *   Both Farm Nation land forms paired a `<select>` of thirty-seven states with
 *
 *       <input type="text" placeholder="Enter LGA" />
 *
 *   So the half of the address the platform can validate was constrained, and
 *   the half a buyer searches on was free text. "Jos North", "jos north",
 *   "Jos-North" and a misspelling are four different local governments to a
 *   filter, and the listing form feeds `location.lga` straight into the record
 *   that PropertiesClient filters and searches.
 *
 * ── THE DATA WAS ALREADY THERE, AND ALREADY USED ELSEWHERE ──────────────────
 *
 *   lib/locations.ts exports NIGERIAN_LOCATIONS — every state with its LGAs —
 *   plus isValidLGA, getWards and hasVerifiedWards. The cooperative onboarding
 *   has driven dependent state → LGA → ward dropdowns from it since #789, whose
 *   own finding was a ward dropdown that would not repopulate.
 *
 *   So the rule and the dataset both existed, on another module's form. This is
 *   the same shape as every other finding in this audit, on the field that
 *   decides whether a buyer in Plateau can find land in Plateau.
 *
 *   AND BOTH FORMS ARE DONE TOGETHER. An edit screen still taking free text
 *   would let the second save undo what the first constrained — #838's "one of
 *   two screens", which is how this audit's findings usually arrive.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { NIGERIAN_LOCATIONS, STATES, isValidLGA } from '@/lib/locations';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

/** Both screens that collect a land location. */
const LAND_FORMS = [
    'src/app/farm-nation/(member)/list-land/page.tsx',
    'src/app/farm-nation/(member)/edit-property/[id]/EditPropertyClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#857 — the LGA is chosen, not typed', () => {
    it('NEITHER FORM TAKES FREE TEXT FOR THE LGA', () => {
        const offenders = LAND_FORMS.filter((f) => {
            const src = code(f);
            const at = src.indexOf('formData.lga');
            if (at === -1) return true;   // the field vanished — also a failure
            //   The control that renders it sits just before the value binding.
            return src.slice(Math.max(0, at - 300), at).includes('<input');
        });

        expect(offenders).toEqual([]);
    });

    it('AND BOTH DRIVE THE OPTIONS FROM THE SHARED DATASET', () => {
        const missing = LAND_FORMS.filter((f) => !code(f).includes('NIGERIAN_LOCATIONS[formData.state]'));
        expect(missing).toEqual([]);
    });

    it('AND CHANGING THE STATE CLEARS THE LGA', () => {
        /*
         *   #789's rule, from the cooperative form. A dependent dropdown that
         *   keeps its previous value is worse than an empty one: "Plateau /
         *   Ikeja" is a well-formed address and a false one, and it passes every
         *   required-field check on the way to the database.
         */
        const missing = LAND_FORMS.filter((f) => {
            const src = code(f);
            const at = src.indexOf('state: e.target.value');
            if (at === -1) return true;
            return !src.slice(at, at + 120).includes('lga: ""');
        });

        expect(missing).toEqual([]);
    });

    it('AND THE LGA CONTROL IS DISABLED UNTIL A STATE IS CHOSEN', () => {
        //   An enabled but empty dropdown reads as "this state has no LGAs".
        const missing = LAND_FORMS.filter((f) => !code(f).includes('disabled={!formData.state}'));
        expect(missing).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#857 — and the dataset behind it answers for every state', () => {
    it('EVERY STATE THE FORM OFFERS HAS LGAs, so no choice is a dead end', () => {
        /*
         *   The half that makes the dropdown usable rather than merely present.
         *   A state whose entry is missing or empty would disable the LGA field
         *   forever and block the form — a worse defect than free text.
         */
        const empty = STATES.filter((s) => (NIGERIAN_LOCATIONS[s] ?? []).length === 0);
        expect(empty).toEqual([]);
    });

    it('AND THE STATES COME FROM THE SAME PLACE AS THE LGAs', () => {
        //   A second hand-written state list could offer a state the LGA map has
        //   never heard of, which is exactly the dead end above.
        expect(STATES.length).toBe(Object.keys(NIGERIAN_LOCATIONS).length);
        expect(STATES.length).toBeGreaterThanOrEqual(36);
    });

    it('AND THE LISTING FORM NO LONGER CARRIES ITS OWN COPY OF THE STATES', () => {
        /*
         *   It declared thirty-seven strings inline. Nine files in src/app still
         *   do; this is one fewer, and the rest are a sweep of their own rather
         *   than a passenger on a Farm Nation fix.
         */
        const src = code('src/app/farm-nation/(member)/list-land/page.tsx');

        expect(src).toContain('const nigerianStates = STATES');
        expect(src).not.toContain('"Cross River", "Delta"');
    });

    it('AND A REAL STATE/LGA PAIR VALIDATES — the vacuity guard', () => {
        //   Executed, so the cases above cannot pass against an empty dataset.
        expect(isValidLGA('Plateau', 'Jos North')).toBe(true);
        expect(isValidLGA('Plateau', 'Ikeja')).toBe(false);
    });
});
