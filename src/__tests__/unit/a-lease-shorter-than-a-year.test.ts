/**
 * @jest-environment node
 */

/**
 *   #895 A LEASE COULD BE THREE MONTHS LONG, AND THE FORM SUGGESTED IT.
 *
 *   THE OWNER: "lease can be within a range from 1year and above."
 *
 *   I was told this once, replied that it implied a validation rule I should
 *   check, and then did not check it. Asked later which items were still
 *   outstanding, I measured it properly. There was no minimum anywhere:
 *
 *       list-land/page.tsx    <input type="number" min="1" …
 *                             placeholder="e.g., 3"     unit: Months | Years
 *       land-listings.ts      `durationValue > 0` — written when positive,
 *                             and otherwise unexamined
 *
 *   So the form's own worked example was a THREE-MONTH term, on a field whose
 *   label reads "Lease Duration", and both the client and the server took it.
 *
 * ── LEASE, AND DELIBERATELY NOT RENT ────────────────────────────────────────
 *
 *   The form asks one duration question for both, so the obvious change bounds
 *   both. The owner said LEASE, and on this platform they are different things:
 *   #876 settled that a lease is a TENANCY — which is why finalising one must
 *   not transfer the title — while a season is an ordinary farmland RENTAL, and
 *   "e.g., 3" months is what that field was written for.
 *
 *   Bounding rent as well would refuse, tomorrow, listings that are legitimate
 *   today, on the strength of a word the owner did not use. Stated here so it
 *   can be widened deliberately rather than discovered.
 *
 * ── AND IT IS ASKED OF THE OFFER, NOT THE LABEL ─────────────────────────────
 *
 *   #869 made one listing able to be sale AND rent AND lease at once, while the
 *   term stayed a single shared field. `type` is only the first option that
 *   matched — "a label now, not the decision", as the form says — so a parcel
 *   offered for sale AND lease is typed "sale". Reading `type` would let every
 *   such listing carry a one-month lease.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { leaseTermRefusal, termInMonths, MINIMUM_LEASE_MONTHS } from '@/lib/lease-term';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const lease = (durationValue: unknown, durationUnit: unknown) =>
    leaseTermRefusal({ offersLease: true, durationValue, durationUnit });

// ─────────────────────────────────────────────────────────────────────────────
describe('#895 — a lease runs for a year or more', () => {
    it('THE REPORTED RULE: one year is the minimum', () => {
        expect(MINIMUM_LEASE_MONTHS).toBe(12);
        expect(lease(1, 'years')).toBeNull();
        expect(lease(12, 'months')).toBeNull();
    });

    it('AND THE FORM\'S OWN WORKED EXAMPLE IS NOW REFUSED', () => {
        //   "e.g., 3" with Months selected — what the field suggested.
        const refusal = lease(3, 'months');

        expect(refusal).not.toBeNull();
        expect(refusal).toContain('at least 1 year');
    });

    it('AND EVERY TERM BELOW A YEAR IS REFUSED', () => {
        for (const months of [1, 2, 6, 11]) {
            expect({ months, refused: lease(months, 'months') !== null })
                .toEqual({ months, refused: true });
        }
    });

    it('AND EVERY TERM OF A YEAR OR MORE IS ACCEPTED — the control', () => {
        /*
         *   "never throws" is also satisfied by refusing everything, which would
         *   stop leases being listed at all.
         */
        for (const [value, unit] of [[1, 'years'], [2, 'years'], [25, 'years'], [12, 'months'], [18, 'months']] as const) {
            expect({ value, unit, refused: lease(value, unit) !== null })
                .toEqual({ value, unit, refused: false });
        }
    });

    it('AND THE UNIT DEFAULTS TO YEARS, matching what the writer stores', () => {
        //   land-listings.ts writes `data.durationUnit ?? "years"`. Two defaults
        //   that disagree is the drift this codebase keeps finding — so "3" with
        //   no unit is three YEARS here too, and accepted.
        expect(termInMonths(3, undefined)).toBe(36);
        expect(lease(3, undefined)).toBeNull();
    });

    it('AND A RENTAL IS UNTOUCHED — the deliberate limit of this rule', () => {
        /*
         *   The owner said lease. A three-month rental is an ordinary farmland
         *   listing and must keep working. If this ever fails, the rule widened
         *   into a refusal nobody asked for.
         */
        expect(leaseTermRefusal({ offersLease: false, durationValue: 3, durationUnit: 'months' }))
            .toBeNull();
        expect(leaseTermRefusal({ offersLease: false, durationValue: 1, durationUnit: 'months' }))
            .toBeNull();
    });

    it('AND AN ABSENT OR UNREADABLE TERM IS NOT THIS RULE\'S REFUSAL', () => {
        /*
         *   #861 omits the field entirely when there is no term ("a sale carries
         *   no term at all rather than a zero somebody has to interpret"), and
         *   the form already marks it required. Refusing here too would make
         *   every listing written before #861 un-editable, for a rule about how
         *   SHORT a term may be.
         */
        for (const bad of [undefined, null, '', 0, -5, 'abc', NaN]) {
            expect({ bad, refusal: lease(bad, 'years') })
                .toEqual({ bad, refusal: null });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#895 — and both doors ask it', () => {
    it('THE SERVER REFUSES IT — the door that actually writes', () => {
        const src = code('src/app/actions/land-listings.ts');

        expect(src).toContain('leaseTermRefusal({');
        //   Asked of the OFFER, not the label — see the header.
        expect(src).toContain('data.availableForLease === true || data.type === "lease"');
    });

    it('AND THE FORM REFUSES IT BEFORE UPLOADING ANYTHING', () => {
        /*
         *   The reason the client half exists. Everything after this point in
         *   handleSubmit uploads images and documents and calls the action LAST,
         *   so a server-only refusal would arrive after she had waited through
         *   every upload — #855's finding, that a submit failing late reads as
         *   the platform breaking rather than as a form telling her something.
         */
        const src = code('src/app/farm-nation/(member)/list-land/page.tsx');
        const at = src.indexOf('leaseTermRefusal({');
        const uploadsAt = src.indexOf('const imageUploadPromises');

        expect(at).toBeGreaterThan(-1);
        expect(uploadsAt).toBeGreaterThan(-1);
        expect(at).toBeLessThan(uploadsAt);
    });

    it('AND THE FIELD STATES THE RULE WHERE SHE IS TYPING', () => {
        //   A refusal after the fact is worse than a note before it.
        const src = code('src/app/farm-nation/(member)/list-land/page.tsx');

        expect(src).toContain('A lease must run for at least 1 year.');
        //   And it no longer suggests a term a lease may not have.
        expect(src).not.toContain('placeholder="e.g., 3"');
    });

    it('AND ONE RULE, NOT TWO COPIES', () => {
        /*
         *   Both doors import it rather than restating it. Two statements of one
         *   rule is what #885, #458 and #488 are each about.
         */
        for (const rel of [
            'src/app/actions/land-listings.ts',
            'src/app/farm-nation/(member)/list-land/page.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, shared: src.includes('@/lib/lease-term') })
                .toEqual({ rel, shared: true });
            //   No hand-written threshold beside the shared one.
            expect({ rel, handWritten: /durationValue[^\n]*<\s*12|<\s*12\s*\)/.test(src) })
                .toEqual({ rel, handWritten: false });
        }
    });
});
