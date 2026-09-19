/**
 * @jest-environment node
 */

/**
 *   #898 A SALE COULD BE EDITED INTO A LEASE WITH NO TERM AND NO RENT.
 *
 *   The third door onto this rule, and the only other LIVE one. #895 put the
 *   minimum term on the create door the form uses and stopped there; #897 found
 *   the second creator; this is the edit.
 *
 *   FOUR DOORS ONTO ONE COLLECTION, and what each carried before this:
 *
 *       land-listings.ts   submitLandListingAction   LIVE (the form)   #895
 *       _fn_listings.ts    listPropertyAction        retired (#432)    #897
 *       land-actions.ts    createLandListing         no callers        —
 *       land-actions.ts    updateLandListing         LIVE (the edit)   —
 *
 *   THE EDIT FORM HAD NO TERM FIELD AT ALL. It does let a seller change
 *   `listingTypes` — #869 made that a set — so a SALE could be switched to a
 *   LEASE here, and the result had no term and no rent price. The buyer then
 *   sees the SALE price labelled "Lease/Rental price", because offerPrice falls
 *   back to `price`, and no term at all.
 *
 *   That is both #861's defect ("a listing offered for rent with no term tells
 *   a buyer nothing") and the one #869's own note warns about: "Offering both
 *   without a second figure would have meant charging one of the two buyers the
 *   wrong number — which is worse than not offering it."
 *
 *   AND THE SCHEMA COULD NOT HAVE CARRIED ONE. `landListingUpdateSchema` is
 *   `landListingSchema.partial()`, and that schema never declared
 *   `durationValue`, `durationUnit` or `rentPrice` — so even a form that sent
 *   them would have had them stripped at the door.
 *
 * ── THE MERGE IS THE PART THAT IS EASY TO GET WRONG ─────────────────────────
 *
 *   An update is PARTIAL. An edit that changes only the title sends no term and
 *   no type, so judging the patch alone asks the rule about an empty object.
 *   The question is what the listing will BE after the write, so the stored row
 *   and the patch are merged first.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { landListingUpdateSchema } from '@/lib/validations/land';

const EDIT_CLIENT = 'src/app/farm-nation/(member)/edit-property/[id]/EditPropertyClient.tsx';
const LAND_ACTIONS = 'src/app/actions/land-actions.ts';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#898 — the edit door can carry a term at all', () => {
    it('THE REPORTED GAP: the update schema accepts the term and the rent', () => {
        /*
         *   Parsed, not read: the schema is what actually strips a field, and
         *   asserting on its source would not prove it survives.
         */
        const parsed = landListingUpdateSchema.parse({
            listingId: 'l-1',
            type: 'lease',
            durationValue: 2,
            durationUnit: 'years',
            rentPrice: 200_000,
        });

        expect(parsed.durationValue).toBe(2);
        expect(parsed.durationUnit).toBe('years');
        expect(parsed.rentPrice).toBe(200_000);
    });

    it('AND AN EDIT THAT TOUCHES NEITHER IS STILL VALID — the control', () => {
        //   Optional, so every existing caller is unchanged. If this fails, the
        //   change broke ordinary edits to fix an unusual one.
        expect(() => landListingUpdateSchema.parse({
            listingId: 'l-1',
            //   Long enough for the schema's own minimum — the first draft of
            //   this line used nine characters and failed for that reason,
            //   which would have read as the change breaking ordinary edits.
            title: 'Two acres of cleared farmland',
        })).not.toThrow();
    });

    it('AND A NONSENSE TERM IS REFUSED BY THE SCHEMA', () => {
        for (const bad of [0, -3]) {
            expect(() => landListingUpdateSchema.parse({ listingId: 'l-1', durationValue: bad }))
                .toThrow();
        }
        expect(() => landListingUpdateSchema.parse({ listingId: 'l-1', durationUnit: 'weeks' }))
            .toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#898 — and all four doors now ask the same rule', () => {
    it('BOTH ACTIONS IN land-actions REFUSE A SHORT LEASE', () => {
        const src = code(LAND_ACTIONS);
        const calls = src.match(/leaseTermRefusal\(\{/g) ?? [];

        expect(calls).toHaveLength(2);
    });

    it('THE EDIT JUDGES THE MERGED RESULT, not the patch', () => {
        /*
         *   The part that is easy to get wrong. A partial update that changes
         *   only the title carries no type and no term.
         */
        const src = code(LAND_ACTIONS);
        const at = src.indexOf('const merged = {');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 120)).toContain('...listingData');
        expect(src.slice(at, at + 120)).toContain('...validated');

        const useAt = src.indexOf('leaseTermRefusal({', at);
        expect(src.slice(useAt, useAt + 260)).toContain('merged.durationValue');
    });

    it('AND THE MERGE COMES AFTER THE OWNERSHIP AND STATUS GATES', () => {
        /*
         *   A listing mid-purchase must be refused for THAT reason, not told
         *   about its lease term. isOwnerMutable is the check #867's note
         *   describes, and it has to run first.
         */
        const src = code(LAND_ACTIONS);

        expect(src.indexOf('isOwnerMutable(listingData.status)'))
            .toBeLessThan(src.indexOf('const merged = {'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#898 — and the seller can actually set it', () => {
    it('THE EDIT FORM COLLECTS THE TERM AND THE RENT', () => {
        const src = code(EDIT_CLIENT);

        expect(src).toContain('durationValue');
        expect(src).toContain('durationUnit');
        expect(src).toContain('rentPrice');
        //   Only where they mean something — a sale has no term.
        expect(src).toContain('{offersRental && (');
    });

    it('AND IT PREFILLS FROM THE STORED ROW, whichever door wrote it', () => {
        /*
         *   Opening blank would read as "no term", and the next save would
         *   silently clear one that exists — #869's lost second offer, which
         *   this same file records a few lines above the prefill.
         */
        const src = code(EDIT_CLIENT);

        expect(src).toContain('readLeaseTerm(');
        expect(src).toContain('durationValue: storedTerm?.value ?? ""');
        expect(src).toContain('rentPrice: (prop as any).rentPrice ?? ""');
    });

    it('AND IT REFUSES A SHORT LEASE BEFORE SAVING', () => {
        const src = code(EDIT_CLIENT);

        expect(src).toContain('leaseTermRefusal({');
        expect(src).toContain('A lease must run for at least 1 year.');
    });

    it('AND A SALE-ONLY EDIT SENDS NEITHER FIELD', () => {
        /*
         *   #861's rule, matched to the create form: a permanent purchase
         *   carries no term and no rent figure at all rather than zeroes every
         *   reader has to learn to disregard.
         */
        const src = code(EDIT_CLIENT);
        const at = src.indexOf('...(offersRental && Number(formData.durationValue) > 0');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain('durationUnit: formData.durationUnit');
    });
});
