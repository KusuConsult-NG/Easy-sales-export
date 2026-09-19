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
 * ── SUPERSEDED IN PART BY #869, AND THE CORRECTION IS RECORDED HERE ─────────
 *
 *   The owner was later asked directly whether selecting two property types
 *   means two listings or one listing with parts, and answered: "it means 2
 *   listings EXCEPT IF THE LAND CAN BE FOR EITHER SELL OR RENT etc."
 *
 *   So this finding was right about the DEFECT and wrong about the remedy. The
 *   defect — a set folded into one value by a hidden precedence, leaving the
 *   second offer unfindable — was real, and everything below that pins the fold
 *   being gone still holds. What did not hold is the conclusion that the set had
 *   to go with it: the platform could not express two offers, so this removed
 *   the offer rather than teaching the platform.
 *
 *   #869 restores the set and makes the rest of the platform able to carry it —
 *   the search filter matches the flags instead of the single label, and the
 *   rent has its own price. The assertions here are rewritten to the corrected
 *   rule rather than deleted, so the reasoning survives with it.
 *
 * ── 1. ONE ANSWER PER OFFER, AND NO HIDDEN PRECEDENCE ───────────────────────
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
describe('#861 — the listing type carries every offer, with no hidden precedence', () => {
    it('BOTH FORMS KEEP THE SET — #869 corrected this', () => {
        //   Was: "NEITHER FORM KEEPS A SET OF TYPES". See the header.
        const missing = FORMS.filter((f) => !code(f).includes('listingTypes'));
        expect(missing).toEqual([]);
    });

    it('AND NEITHER FOLDS IT INTO ONE FLAG-SETTING DECISION', () => {
        /*
         *   THE HALF THIS FINDING WAS RIGHT ABOUT, and it still holds. The
         *   expression that decided, without anybody choosing it, that Rent
         *   beats Lease:
         *
         *       type: listingTypes.includes("sale") ? "sale"
         *           : (listingTypes.includes("rent") ? "rent" : "lease")
         *
         *   `type` is still DERIVED that way as a label for legacy readers, so
         *   the string is present — what must not come back is the three
         *   availableFor* FLAGS being set from a collapsed single value. Each is
         *   set from the set directly.
         */
        for (const f of FORMS) {
            const src = code(f);
            for (const [flag, member] of [
                ['availableForSale', 'includes("sale")'],
                ['availableForRent', 'includes("rent")'],
                ['availableForLease', 'includes("lease")'],
            ] as const) {
                const at = src.indexOf(`${flag}: formData.listingTypes`);
                expect({ f, flag, direct: at > -1 && src.slice(at, at + 90).includes(member) })
                    .toEqual({ f, flag, direct: true });
            }
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

    it('AND AN EXISTING MULTI-TYPE ROW READS BACK WHOLE', () => {
        /*
         *   #869 CORRECTED THIS TOO, and this is the sharper half. Under the old
         *   rule the edit form read ONE type back and then wrote it — so a
         *   seller who opened a listing offered two ways and saved anything at
         *   all silently lost the second offer.
         *
         *   Every flag is read now, with `type` as the fallback for rows written
         *   before the flags existed.
         */
        const src = code(EDIT);
        const at = src.indexOf('const listingTypes');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 420);
        expect(block).toContain('prop.availableForSale');
        expect(block).toContain('prop.availableForRent');
        expect(block).toContain('prop.availableForLease');
        expect(block).toContain('prop.type');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#861 — and a rent or lease carries its term, end to end', () => {
    it('THE FORM ASKS FOR IT', () => {
        const src = code(CREATE);

        expect(src).toContain('durationValue');
        expect(src).toContain('durationUnit');
    });

    it('AND ONLY WHEN A RENTAL IS ACTUALLY OFFERED', () => {
        //   A duration on a permanent purchase is meaningless, and a field that
        //   appears where it cannot apply teaches people to ignore it. #869: the
        //   condition is now "offers a rental", not "is not a sale", because a
        //   parcel can be both.
        const src = code(CREATE);
        expect(src).toContain('{offersRental && (');
    });

    it('AND IT IS CLEARED WHEN NO RENTAL IS OFFERED ANY MORE', () => {
        /*
         *   Otherwise a seller who fills in "3 years", then unticks Rent,
         *   submits a pure sale carrying a term. Same rule as #857's LGA
         *   clearing with its state — #869 widened it to the rent price too,
         *   which has exactly the same problem.
         */
        const src = code(CREATE);
        const at = src.indexOf('const toggleListingType');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 700)).toContain('durationValue: "", rentPrice: ""');
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

        /*
         *   #897 SPELLED AS A PROPERTY. This pinned the literal
         *   `property.durationValue`, and went red when the term started being
         *   read through lib/lease-term's readLeaseTerm — a change that shows
         *   MORE listings their term, not fewer: a second creator writes it as
         *   `leaseDuration`, and rows from that door had been showing none.
         *
         *   What this test is for is that the screen SHOWS the stored term.
         *   Deleting the block still fails here; reading it from one place
         *   instead of two does not.
         */
        expect(src).toMatch(/readLeaseTerm\(|property\.durationValue/);
        expect(src).toContain('Term:');
    });

    it('AND A LISTING WITHOUT A TERM SHOWS NOTHING, not "Term: undefined"', () => {
        const src = code(DETAILS);
        const at = src.indexOf('Term:');

        //   #897 The guard is now the reader's own null return — readLeaseTerm
        //   answers null for an absent, zero or unreadable term (asserted
        //   directly in a-term-stored-where-nothing-read-it) — so the render is
        //   gated on that rather than on a typeof beside it.
        expect(src.slice(at - 200, at + 120)).toMatch(/leaseTerm &&|typeof property\.durationValue === "number"/);
    });
});
