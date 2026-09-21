/**
 * @jest-environment node
 */

/**
 *   EVERY OWNER EDIT TOOK THE LISTING OFF THE MARKET.
 *
 *   The Farm Nation edit door wrote, unconditionally:
 *
 *       await ...doc(listingId).update({
 *           ...updateData,
 *           ...(priceReductionPatch(listingData.price, updateData.price) ?? {}),
 *           updatedAt: FieldValue.serverTimestamp(),
 *           status: 'pending_verification',
 *       });
 *
 *   `pending_verification` is not in PUBLIC_LAND_STATUSES — which IS
 *   PURCHASABLE_STATUSES, `["approved", "available", "verified"]` — so the
 *   listing left the properties list, the map, the detail page and Hot Deals
 *   the moment its owner touched it. Correcting a typo pulled a verified parcel
 *   off the market until an admin re-approved it, and nothing on the edit
 *   screen said so.
 *
 * ── THE TWO ADJACENT LINES CONTRADICTED EACH OTHER ──────────────────────────
 *
 *   `priceReductionPatch` is #867: a price cut on a Farm Nation parcel raises a
 *   Hot Deal, which the owner asked to have built. The very next line set the
 *   status that removes the listing from Hot Deals — so the feature could not
 *   fire once. The code already contained a case the reset broke.
 *
 * ── COMPARED BY VALUE, WHICH IS THE WHOLE FIX ───────────────────────────────
 *
 *   The edit screen is a form: it posts every field on every save. A rule
 *   written as "did the patch mention size?" answers yes every time and
 *   re-verifies exactly as often as the unconditional line did — a fix that
 *   changes nothing while looking like one. That mutant is in the table below
 *   and it is caught.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import {
    requiresReverification,
    reverificationTriggers,
    VERIFIABLE_FIELDS,
} from '@/lib/land-reverification';
import { PUBLIC_LAND_STATUSES } from '@/lib/land-visibility';

/** A verified parcel as stored. */
const STORED = {
    title: 'Ten hectares near Abeokuta',
    description: 'Arable land with a borehole.',
    price: 5_000_000,
    rentPrice: 250_000,
    size: 10,
    category: 'arable',
    soilQuality: 'loam',
    waterSource: 'borehole',
    images: ['https://res.cloudinary.com/a.jpg', 'https://res.cloudinary.com/b.jpg'],
    location: { lat: 7.15, lng: 3.35, address: '1 Farm Road', city: 'Abeokuta', state: 'Ogun' },
    features: ['fenced'],
    type: 'sale',
    status: 'verified',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('the premise: pending_verification is invisible', () => {
    it('IT IS NOT A PUBLIC STATUS — which is why this mattered at all', () => {
        //   Stated rather than assumed. If this ever became public the whole
        //   defect would evaporate, and so should this file.
        expect(PUBLIC_LAND_STATUSES).not.toContain('pending_verification');
        expect(PUBLIC_LAND_STATUSES).toContain('verified');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an edit that changes nothing about the parcel stays on the market', () => {
    it('A PRICE CUT DOES NOT GO BACK FOR REVIEW — the defect, and #867’s case', () => {
        //   THE test. This is the edit that raises a Hot Deal, and it was the
        //   edit that hid the listing from Hot Deals.
        expect(requiresReverification(STORED, { price: 4_000_000 })).toBe(false);
    });

    it('AND NEITHER DOES A TYPO IN THE DESCRIPTION', () => {
        expect(requiresReverification(STORED, {
            description: 'Arable land with a borehole and a gate.',
        })).toBe(false);
    });

    it('AND NEITHER DO THE COMMERCIAL TERMS', () => {
        //   None of these is a claim about the land. They have their own guard:
        //   isOwnerMutable refuses the whole edit once a purchase is running.
        expect(requiresReverification(STORED, {
            title: 'Ten hectares, Abeokuta',
            rentPrice: 300_000,
            type: 'lease',
            availableForLease: true,
            durationValue: 2,
            durationUnit: 'years',
            escrowAvailable: true,
            features: ['fenced', 'gated'],
        })).toBe(false);
    });

    it('RESAVING THE FORM UNCHANGED CHANGES NOTHING — the form posts every field', () => {
        //   The assertion that decides whether the fix works in the product at
        //   all. A presence-based rule passes every test above and fails this
        //   one, because the edit screen sends the whole object on every save.
        expect(requiresReverification(STORED, { ...STORED })).toBe(false);
    });

    it('and a re-ordered location object is not a move', () => {
        //   The form rebuilds the object each render. Key order is not a fact
        //   about the land.
        expect(requiresReverification(STORED, {
            location: { state: 'Ogun', city: 'Abeokuta', address: '1 Farm Road', lng: 3.35, lat: 7.15 },
        })).toBe(false);
    });

    it('and a size resubmitted as a string is the same size', () => {
        expect(requiresReverification(STORED, { size: '10' as any })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('but changing the parcel itself does', () => {
    it('SIZE — what an admin measured', () => {
        expect(requiresReverification(STORED, { size: 40 })).toBe(true);
    });

    it('LOCATION — where they went to look', () => {
        expect(requiresReverification(STORED, {
            location: { ...STORED.location, lat: 9.1 },
        })).toBe(true);
    });

    it('IMAGES — the evidence itself', () => {
        expect(requiresReverification(STORED, {
            images: ['https://res.cloudinary.com/somewhere-else.jpg'],
        })).toBe(true);
    });

    it('and re-ordering the images, because images[0] is the one buyers see', () => {
        expect(requiresReverification(STORED, {
            images: [STORED.images[1], STORED.images[0]],
        })).toBe(true);
    });

    it('and the claims about the land — soil, water, category', () => {
        expect(requiresReverification(STORED, { soilQuality: 'clay' })).toBe(true);
        expect(requiresReverification(STORED, { waterSource: 'river' })).toBe(true);
        expect(requiresReverification(STORED, { category: 'poultry' })).toBe(true);
    });

    it('and clearing a field is a change, not an absence', () => {
        //   `undefined` means the patch did not mention it. `null` means the
        //   seller emptied it, and an emptied claim is still a changed claim.
        expect(requiresReverification(STORED, { waterSource: null })).toBe(true);
        expect(requiresReverification(STORED, { waterSource: undefined })).toBe(false);
    });

    it('IT SAYS WHICH CLAIM, so a caller can explain itself', () => {
        expect(reverificationTriggers(STORED, { size: 40, price: 1 })).toEqual(['size']);
        expect(reverificationTriggers(STORED, { size: 40, soilQuality: 'clay' }).sort())
            .toEqual(['size', 'soilQuality']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the rule is not vacuous in either direction', () => {
    it('POSITIVE CONTROL: THE VERIFIABLE SET IS NOT EMPTY', () => {
        //   A rule that re-verified nothing would pass every "stays public"
        //   assertion above and let a seller swap the land after approval.
        expect(VERIFIABLE_FIELDS.length).toBeGreaterThan(0);
        expect([...VERIFIABLE_FIELDS]).toContain('size');
        expect([...VERIFIABLE_FIELDS]).toContain('location');
        expect([...VERIFIABLE_FIELDS]).toContain('images');
    });

    it('POSITIVE CONTROL: and it does not contain the commercial terms', () => {
        //   A rule that re-verified everything would pass every "goes back"
        //   assertion and restore the defect exactly.
        for (const commercial of ['price', 'rentPrice', 'title', 'description', 'features', 'type']) {
            expect([...VERIFIABLE_FIELDS]).not.toContain(commercial);
        }
    });

    it('an empty patch changes nothing', () => {
        expect(requiresReverification(STORED, {})).toBe(false);
        expect(requiresReverification(STORED, null)).toBe(false);
    });

    it('and a row with nothing stored still notices a new claim', () => {
        //   A legacy listing missing these fields. Setting one for the first
        //   time is a claim nobody has checked.
        expect(requiresReverification({}, { size: 10 })).toBe(true);
        expect(requiresReverification(null, { size: 10 })).toBe(true);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/land-reverification.ts, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   requiresReverification returns true          6  "A PRICE CUT DOES NOT GO
 *   always — the defect restored                    BACK FOR REVIEW"
 *
 *   it returns false always                      8  "SIZE — what an admin
 *                                                   measured"
 *
 *   presence instead of value: drop the          2  "RESAVING THE FORM
 *   sameValue() call and trigger on any             UNCHANGED CHANGES NOTHING"
 *   field the patch mentions
 *
 *   sameValue compares with === only             3  "and a re-ordered location
 *   (objects/arrays never equal)                    object is not a move"
 *
 *   arrays compared order-insensitively          1  "and re-ordering the
 *                                                   images"
 *
 *   `undefined` treated as a cleared value       1  "and clearing a field is a
 *   rather than an absence                          change, not an absence"
 *
 *   price added to VERIFIABLE_FIELDS             3  "A PRICE CUT DOES NOT GO
 *                                                   BACK FOR REVIEW"
 *
 *   size removed from VERIFIABLE_FIELDS          3  "SIZE — what an admin
 *                                                   measured"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the module header                     0  SURVIVED ✓
 */
