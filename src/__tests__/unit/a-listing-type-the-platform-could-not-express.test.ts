/**
 * @jest-environment node
 */

/**
 *   #861 THE FORM OFFERED A COMBINATION THE REST OF THE PLATFORM COULD NOT
 *   EXPRESS — AND A RENTAL WITH NO TERM.
 *
 *   THE OWNER: "listing should not be multiple selection under land category"
 *   and "There should be duration for leasing or renting."
 *
 * ── 1. ONE LISTING TYPE ─────────────────────────────────────────────────────
 *
 *   Both land forms carried `listingTypes: ("sale"|"rent"|"lease")[]` behind a
 *   togglable multi-select, and the submit then collapsed the set back into one
 *   value with a hidden precedence nobody chose:
 *
 *       type: listingTypes.includes("sale") ? "sale"
 *           : (listingTypes.includes("rent") ? "rent" : "lease")
 *
 *   So a seller who ticked Rent AND Lease got a listing typed "rent". The
 *   buyer-facing filter — `searchLandListingsAction`'s `type` — is
 *   single-valued, so the lease half was not merely deprioritised, it was
 *   UNFINDABLE. The form collected an answer the platform has no way to show.
 *
 *   The three `availableFor*` booleans are still written, because the property
 *   page and the checkout read them; they are derived from one answer now
 *   rather than from a set with a tiebreak.
 *
 * ── 2. AND A TERM, WHICH IS PART OF THE PRICE ───────────────────────────────
 *
 *   "₦2,000,000" for a season and "₦2,000,000" for ten years are different
 *   offers, and a buyer had to message the seller to learn which she was
 *   looking at. The form asks now — only for a rent or a lease, because a
 *   duration on a permanent purchase is meaningless — the action stores it, and
 *   the property page shows it beside the price.
 *
 *   ALL THREE, or it is worth nothing. A field the form collects and the action
 *   drops is this audit's most common false positive; a field the action stores
 *   and no screen shows is the same defect from the other end, which is exactly
 *   what #624 measured at fifteen sites.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

const CREATE = 'src/app/farm-nation/(member)/list-land/page.tsx';
const EDIT = 'src/app/farm-nation/(member)/edit-property/[id]/EditPropertyClient.tsx';
const ACTION = 'src/app/actions/land-listings.ts';
const DETAILS = 'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx';

/** Both forms, because an edit screen that disagrees undoes the create screen. */
const FORMS = [CREATE, EDIT];

// ─────────────────────────────────────────────────────────────────────────────
describe('#861 — the listing type is one answer', () => {
    it('NEITHER FORM KEEPS A SET OF TYPES', () => {
        const offenders = FORMS.filter((f) => code(f).includes('listingTypes'));
        expect(offenders).toEqual([]);
    });

    it('AND BOTH HOLD A SINGLE VALUE', () => {
        const missing = FORMS.filter((f) => !code(f).includes('listingType:'));
        expect(missing).toEqual([]);
    });

    it('AND THE HIDDEN PRECEDENCE IS GONE FROM BOTH SUBMITS', () => {
        /*
         *   The expression that decided, without anybody choosing it, that Rent
         *   beats Lease.
         */
        for (const f of FORMS) {
            expect({ f, collapses: /includes\("sale"\) \? "sale"/.test(code(f)) })
                .toEqual({ f, collapses: false });
        }
    });

    it('AND THE THREE BOOLEANS ARE STILL WRITTEN — readers depend on them', () => {
        /*
         *   The half that must not regress. PropertyDetailsClient labels the
         *   price "Lease/Rental price" off `availableForRent`, and the checkout
         *   branches on it. Dropping them while tidying the form would break the
         *   screens this finding is meant to make honest.
         */
        for (const f of FORMS) {
            const src = code(f);
            for (const flag of ['availableForSale', 'availableForRent', 'availableForLease']) {
                expect({ f, flag, written: src.includes(flag) })
                    .toEqual({ f, flag, written: true });
            }
        }
    });

    it('AND AN EXISTING MULTI-TYPE ROW READS BACK DETERMINISTICALLY', () => {
        /*
         *   Rows already in the database were written by the multi-select and
         *   may carry more than one flag. The edit form has to pick one, and
         *   WHICH it picks is the decision: `type` is what the buyer-facing
         *   filter uses, so it wins, with the flags as the fallback for rows
         *   written before it was set.
         */
        const src = code(EDIT);
        const at = src.indexOf('const listingType');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 300);
        expect(block).toContain('prop.type');
        expect(block.indexOf('prop.type')).toBeLessThan(block.indexOf('availableForLease'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#861 — and a rent or lease carries its term, end to end', () => {
    it('THE FORM ASKS FOR IT', () => {
        const src = code(CREATE);

        expect(src).toContain('durationValue');
        expect(src).toContain('durationUnit');
    });

    it('AND ONLY FOR A RENT OR A LEASE', () => {
        //   A duration on a permanent purchase is meaningless, and a field that
        //   appears where it cannot apply teaches people to ignore it.
        const src = code(CREATE);
        expect(src).toContain('formData.listingType !== "sale" && (');
    });

    it('AND IT IS CLEARED WHEN THE TYPE BECOMES A SALE', () => {
        /*
         *   Otherwise a seller who fills in "3 years", then changes her mind and
         *   picks For Sale, submits a permanent purchase carrying a term. Same
         *   rule as #857's LGA clearing with its state.
         */
        const src = code(CREATE);
        const at = src.indexOf('const selectListingType');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 300)).toContain('durationValue: ""');
    });

    it('AND THE ACTION ACCEPTS AND STORES IT', () => {
        /*
         *   THE HALF THAT MAKES IT REAL. The form sent these fields before the
         *   action declared them, and an undeclared field is silently dropped —
         *   a form that collects an answer nobody keeps. Caught by checking
         *   rather than by assuming the server end existed.
         */
        const src = code(ACTION);

        expect(src).toContain('durationValue?: number');
        expect(src).toContain('durationUnit?: "months" | "years"');
        expect(src).toContain('durationValue: data.durationValue');
    });

    it('AND STORES NOTHING AT ALL FOR A SALE', () => {
        //   Spread, not defaulted: a `durationValue: 0` on every sale is a field
        //   every reader has to learn to disregard.
        const src = code(ACTION);
        const at = src.indexOf('typeof data.durationValue === "number"');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 200)).toContain('> 0');
    });

    it('AND THE BUYER SEES IT BESIDE THE PRICE', () => {
        /*
         *   A stored field no screen shows is #624's defect — "a declared rule
         *   that nothing consulted" — and the reason to check all three ends of
         *   this rather than two.
         */
        const src = code(DETAILS);

        expect(src).toContain('property.durationValue');
        expect(src).toContain('Term:');
    });

    it('AND A LISTING WITHOUT A TERM SHOWS NOTHING, not "Term: undefined"', () => {
        const src = code(DETAILS);
        const at = src.indexOf('property.durationValue');

        expect(src.slice(at - 120, at + 200)).toContain('typeof property.durationValue === "number"');
    });
});
