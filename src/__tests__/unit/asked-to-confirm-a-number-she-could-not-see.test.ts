/**
 * @jest-environment node
 */

/**
 *   #806 THE REVIEW STEP ASKED HER TO CONFIRM A NUMBER IT NEVER SHOWED HER.
 *
 *   /wave/application collects an applicant's details across six steps and then
 *   presents a REVIEW: the screen whose entire job is "check this is right
 *   before you submit". It displayed every field but one.
 *
 *       PersonalDetailsStep collects  alternativePhone
 *       ReviewStep displays           — nothing
 *
 *   So a member vouched for an application containing a phone number she could
 *   not see on the page she was vouching on. If it was wrong, or captured from
 *   a stale draft, the review could not tell her.
 *
 * ── COUNTED, NOT SAMPLED ────────────────────────────────────────────────────
 *
 *   The first pass on this said "10 of 11 sampled fields shown", which is a
 *   sample and cannot tell you whether the gap is one field or a class. Counted
 *   across all six steps:
 *
 *       AgriInterestStep        6 collected   6 shown
 *       CivicStatusStep         6 collected   6 shown
 *       FinancialStep           6 collected   6 shown
 *       PersonalDetailsStep    16 collected  15 shown   ← alternativePhone
 *       SocioEconomicStep       5 collected   5 shown
 *       TrainingStep            4 collected   4 shown
 *
 *       43 collected, 42 shown.
 *
 *   One field, genuinely — not the partial-fix pattern #795 and #799 turned out
 *   to be. Worth measuring before assuming either way, since this audit has
 *   been wrong in both directions.
 *
 * ── AND THE ASSERTION IS THE COUNT ──────────────────────────────────────────
 *
 *   The durable half. A test that checked for `alternativePhone` would pass
 *   forever and say nothing about the FORTY-FOURTH field somebody adds to a
 *   step next year. This one derives both sides from the source, so a new field
 *   that never reaches the review fails here by name.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     alternativePhone removed from the review again (the defect)      KILLED
 *     email removed from the review                                    KILLED
 *     nextOfKinPhone removed from the review                           KILLED
 *     a step's field renamed so the review no longer matches it        KILLED
 *     the empty-state "Not provided" dropped, leaving a blank          KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

const STEPS_DIR = 'src/app/wave/application/steps';
const REVIEW = 'src/app/wave/application/ReviewStep.tsx';

/** Every field a step writes back into the application. */
function collectedBy(file: string): string[] {
    const src = read(file);
    const direct = [...src.matchAll(/updateData\(\{\s*(\w+)\s*:/g)].map(m => m[1]);
    const spread = [...src.matchAll(/updateData\(\{\s*\.\.\.\w+,\s*(\w+)\s*:/g)].map(m => m[1]);
    return [...new Set([...direct, ...spread])];
}

/** Every field the review reads out. */
function shownByReview(): Set<string> {
    return new Set([...read(REVIEW).matchAll(/data\.(\w+)/g)].map(m => m[1]));
}

const STEP_FILES = readdirSync(join(ROOT, STEPS_DIR))
    .filter(f => f.endsWith('.tsx'))
    .map(f => `${STEPS_DIR}/${f}`);

// ─────────────────────────────────────────────────────────────────────────────
describe('#806 — the review shows everything the form asked for', () => {
    it('the six steps are there and they collect something', () => {
        //   Vacuity guard: the assertion below is trivially true of a step list
        //   that is empty or a regex that has stopped matching.
        expect(STEP_FILES.length).toBe(6);
        const all = STEP_FILES.flatMap(collectedBy);
        expect(all.length).toBeGreaterThanOrEqual(40);
    });

    it.each(STEP_FILES)('%s — EVERY FIELD IT COLLECTS REACHES THE REVIEW', (file) => {
        /*
         *   THE test, and it is derived rather than listed. Naming
         *   alternativePhone here would pass forever and say nothing about the
         *   next field somebody adds to a step.
         */
        const shown = shownByReview();
        const missing = collectedBy(file).filter(f => !shown.has(f));

        expect({ file, missing }).toEqual({ file, missing: [] });
    });

    it('AND alternativePhone SPECIFICALLY, which is the one that was missing', () => {
        //   The regression case, stated plainly beside the general rule so a
        //   reader can see what this finding was actually about.
        expect(shownByReview().has('alternativePhone')).toBe(true);
    });

    it('AND IT SAYS "Not provided" RATHER THAN RENDERING A BLANK', () => {
        /*
         *   It is optional, so most applications will have it empty. A bare
         *   blank leaves her unable to tell "I left this out" from "the screen
         *   lost it" — which is the collapse this whole audit keeps finding,
         *   at the smallest possible scale.
         */
        const src = read(REVIEW);
        const at = src.indexOf('data.alternativePhone');
        expect(at).toBeGreaterThan(-1);

        //   Bounded to the field's own expression, not to the rest of the file:
        //   "Not provided" appears elsewhere, and an assertion satisfied by the
        //   wrong occurrence is the trap this audit has met ten times.
        const expression = src.slice(at, at + 60);
        expect(expression).toContain('Not provided');
    });

    it('CONTROL: the review still shows the fields it always did', () => {
        //   Or a change here could "pass" by dropping the comparison instead of
        //   closing the gap.
        const shown = shownByReview();
        for (const field of ['phone', 'email', 'surname', 'dateOfBirth', 'nextOfKinPhone']) {
            expect({ field, shown: shown.has(field) }).toEqual({ field, shown: true });
        }
    });
});
