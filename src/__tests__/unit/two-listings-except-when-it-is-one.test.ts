/**
 * @jest-environment node
 */

/**
 *   #869 TWO PROPERTY TYPES ARE TWO LISTINGS. ONE PARCEL OFFERED TWO WAYS IS
 *   ONE.
 *
 *   THE OWNER, asked directly whether selecting two property types means two
 *   listings or one listing with parts: "it means 2 listings except if the land
 *   can be for either sell or rent etc."
 *
 *   Two rules, and they pull in opposite directions, which is why the question
 *   was worth asking rather than guessing:
 *
 *     THE CATEGORY IS SINGLE.  Farmland and an orchard are two parcels. That
 *                              also matches what the platform can express — a
 *                              listing carries one price, one size, one location
 *                              and one status, and the purchase, the escrow and
 *                              the map all operate on the whole of it.
 *
 *     THE LISTING TYPE IS A SET. The same parcel may be for sale AND for rent.
 *
 * ── AND THIS CORRECTS #861, WHICH I GOT HALF RIGHT ──────────────────────────
 *
 *   #861 removed the listing-type multi-select. The DEFECT it found was real:
 *   the form collected a set and the submit folded it with a hidden precedence
 *   (`includes("sale") ? "sale" : …`), so a seller who offered Rent AND Lease
 *   got a listing typed "rent" and the lease half was unfindable — the
 *   buyer-facing filter asked `l.type === filters.type`, and `type` holds one
 *   string.
 *
 *   The conclusion was wrong. Removing the set removed the symptom and also
 *   removed something the owner wants. The set is back and the FOLD is what
 *   stays gone: the three `availableFor*` booleans are the answer, the filter
 *   matches on them, and `type` survives only as a label for rows written
 *   before the flags.
 *
 * ── THE PART THAT TOUCHES MONEY ─────────────────────────────────────────────
 *
 *   A parcel worth ₦5,000,000 to buy might be ₦200,000 a year to rent, and a
 *   listing has always carried ONE `price`. Offering both without a second
 *   figure means charging one of the two buyers the wrong amount — worse than
 *   not offering it at all.
 *
 *   The server decides, and it was ALREADY right to: a previous finding made
 *   `amount` a caller-supplied value that is ignored in favour of the listed
 *   price, because "anyone could buy any verified property for ₦10,000". The
 *   mode is handled the same way — a hint, checked against the listing's own
 *   flags, so a buyer cannot ask for the cheaper of two figures by naming an
 *   offer the seller never made.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';
const ACTION = 'src/app/actions/land-listings.ts';
const PAYMENT = 'src/app/actions/farm-nation-payment.ts';
const DETAILS = 'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx';
const CHECKOUT = 'src/app/farm-nation/checkout/[propertyId]/CheckoutClient.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#869 — two property types are two listings', () => {
    it('THE CATEGORY IS A SINGLE VALUE', () => {
        const src = code(FORM);

        expect(src).toContain('category: "" as LandCategory | ""');
        expect(src).not.toContain('category: [] as LandCategory[]');
    });

    it('AND PICKING ONE REPLACES IT rather than adding to it', () => {
        //   The toggle is gone. A second tap chooses a different category; it
        //   does not accumulate a second one.
        const src = code(FORM);

        expect(src).toContain('const selectCategory');
        expect(src).not.toContain('const toggleCategory');
    });

    it('AND THE SELLER IS TOLD WHAT TO DO WITH HER OTHER LAND', () => {
        /*
         *   Removing a multi-select without saying why leaves a seller who has
         *   two kinds of land unable to work out what happened. The rule is on
         *   the screen: list it separately.
         */
        const src = code(FORM);

        expect(src).toContain('One category per listing');
    });

    it('AND THE READERS THAT HANDLE LEGACY ARRAYS ARE KEPT', () => {
        /*
         *   Rows already written by the multi-select hold an array, and the
         *   action, the search filter and the results page all cope with both
         *   shapes. The FORM stops making new ones; nothing retroactively breaks
         *   what exists.
         */
        expect(code(ACTION)).toContain('category?: string | string[]');
        expect(code('src/app/farm-nation/properties/PropertiesClient.tsx'))
            .toContain('Array.isArray(property.category)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#869 — except that one parcel may be offered more than one way', () => {
    it('THE LISTING TYPE IS A SET AGAIN', () => {
        const src = code(FORM);

        expect(src).toContain('listingTypes: ["sale"]');
        expect(src).toContain('const toggleListingType');
    });

    it('AND THE HIDDEN PRECEDENCE #861 FOUND IS STILL GONE', () => {
        /*
         *   THE WHOLE POINT OF THE CORRECTION. The set is restored; the fold
         *   that made a seller's second choice disappear is not. Each flag is
         *   set from the set directly.
         */
        const src = code(FORM);

        expect(src).toContain('availableForSale: formData.listingTypes.includes("sale")');
        expect(src).toContain('availableForRent: formData.listingTypes.includes("rent")');
        expect(src).toContain('availableForLease: formData.listingTypes.includes("lease")');
    });

    it('AND THE LAST OPTION CANNOT BE UNTICKED', () => {
        /*
         *   A listing offered no way at all is findable by no filter and refused
         *   by the checkout, with nothing on screen to explain why.
         */
        const src = code(FORM);
        const at = src.indexOf('const toggleListingType');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 600)).toContain('if (next.length === 0) return prev;');
    });

    it('AND THE TERM AND THE RENT CLEAR WHEN NO RENTAL IS OFFERED', () => {
        //   #861's rule, generalised: a stale "3 years" on a pure sale is the
        //   thing that finding was right about.
        const src = code(FORM);
        const at = src.indexOf('const toggleListingType');

        expect(src.slice(at, at + 700)).toContain('durationValue: "", rentPrice: ""');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#869 — and a parcel offered two ways is found under both', () => {
    it('THE SEARCH FILTER MATCHES THE FLAGS, not the single label', () => {
        /*
         *   This asked `l.type === filters.type`. `type` holds ONE string, so a
         *   listing offered for sale AND rent showed under whichever the string
         *   happened to be and was invisible under the other. #861 identified
         *   exactly this and concluded the set had to go.
         */
        const src = code(ACTION);
        const at = src.indexOf('if (filters.type)');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 900);
        expect(block).toContain('flags.availableForSale === true');
        expect(block).toContain('flags.availableForRent === true');
        expect(block).toContain('flags.availableForLease === true');
    });

    it('AND A ROW WITH NO FLAGS AT ALL STILL FALLS BACK TO ITS LABEL', () => {
        /*
         *   Listings written before the flags existed carry only `type`. Judging
         *   them by absent booleans would drop every one of them out of every
         *   filter — the migration hazard this kind of change usually ships
         *   with.
         */
        const src = code(ACTION);
        const at = src.indexOf('if (filters.type)');
        const block = src.slice(at, at + 900);

        expect(block).toContain('if (!hasFlags) return l.type === wanted;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#869 — and the buyer is charged for the offer she took', () => {
    it('THE RENT IS ITS OWN FIGURE, stored separately from the sale price', () => {
        const src = code(ACTION);

        expect(src).toContain('rentPrice?: number');
        expect(src).toContain('typeof data.rentPrice === "number" && data.rentPrice > 0');
    });

    it('AND THE PROPERTY PAGE OFFERS THE CHOICE', () => {
        const src = code(DETAILS);

        expect(src).toContain('bothOffered');
        expect(src).toContain('effectiveMode');
    });

    it('AND A SINGLE-OFFER LISTING NEEDS NO CHOOSING', () => {
        /*
         *   A rent-only parcel must not read as a purchase just because the
         *   toggle's initial value is "buy" — the toggle is not shown for it, so
         *   nothing would ever move it. Derived, so there is no render where the
         *   label and the price disagree.
         */
        const src = code(DETAILS);
        const at = src.indexOf('const effectiveMode');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 200)).toContain('offersRental && !offersSale');
    });

    it('AND THE CHECKOUT CHARGES THAT OFFER, not whichever number the row carries', () => {
        const src = code(CHECKOUT);

        expect(src).toContain('const chargedPrice');
        expect(src).toContain('chargedPrice,');
    });

    it('AND THE SERVER DECIDES THE PRICE — the URL never does', () => {
        /*
         *   THE ONE THAT MATTERS. A previous finding in this same file made
         *   `amount` a caller-supplied value that is IGNORED, because trusting
         *   it meant "anyone could buy any verified property for ₦10,000". The
         *   mode gets the same treatment: it is read, then checked against the
         *   listing's own flags, so asking for `?mode=rent` on a sale-only
         *   parcel cannot produce a rental price.
         */
        const src = code(PAYMENT);
        const at = src.indexOf('const resolvedMode');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 400);
        expect(block).toContain('mode === "rent" && offersRental ? "rent"');
        expect(src).toContain('const listedPrice = resolvedMode === "rent" && rentPrice > 0');
    });

    it('AND A RENTAL LISTING WITH NO rentPrice FALLS BACK TO price', () => {
        /*
         *   Every rental listing written before today carries no rentPrice, and
         *   `price` is what that field has always meant on those rows. Without
         *   the fallback they would all charge zero.
         */
        const src = code(PAYMENT);
        const at = src.indexOf('const listedPrice = resolvedMode');

        expect(src.slice(at, at + 200)).toContain('Number(propertyData.price || 0)');
    });

    it('AND THE PURCHASE RECORD SAYS WHICH OFFER IT WAS', () => {
        /*
         *   Without it the row says only what was paid, and for a parcel offered
         *   both ways nobody can tell afterwards whether ₦200,000 was a cheap
         *   sale or a year's rent. The finance queue, the seller's notice and
         *   any dispute all read this row.
         */
        expect(code(PAYMENT)).toContain('offerMode: resolvedMode');
    });
});
