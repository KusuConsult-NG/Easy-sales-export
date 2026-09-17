/**
 * @jest-environment node
 */

/**
 *   #856 THE SELLER'S OWN UPLOAD MARKED THE LAND VERIFIED.
 *
 *   THE OWNER: "when a user upload a product, the user has a 'This land is
 *   verified' badge even before land is approved by admin. Admin has to
 *   verify/approve before the badge can show the status."
 *
 *   Three screens draw that badge. Two of them read
 *
 *       (property.documents && property.documents.length > 0)
 *           ? "Verified Land" : "Unverified Land"
 *
 *   and that ONE EXPRESSION gave THREE DIFFERENT WRONG ANSWERS, depending
 *   entirely on which row and which viewer:
 *
 *     ARRAY-SHAPED ROWS — the live form. actions/land-listings stores
 *       `documents: data.documentUrls` and types the field `string[]`, so any
 *       upload at all makes this true. The land reads VERIFIED before an admin
 *       has opened it. That is the owner's report.
 *
 *     OBJECT-SHAPED ROWS — _fn_listings writes `documents: {}`, where `.length`
 *       is `undefined` and `undefined > 0` is false. Those listings read
 *       UNVERIFIED forever, including after an admin approved them.
 *
 *     A BUYER — land-visibility strips `documents` from every public payload,
 *       so it is `undefined` and EVERY listing read UNVERIFIED.
 *
 *   WHICH IS WHY THE OWNER SAW IT AND A BUYER DID NOT. land-actions hands the
 *   UNSTRIPPED listing to a `privileged` caller, and a seller looking at her own
 *   land is one. The badge told the person who uploaded the documents that they
 *   had been checked, and told everybody else the opposite.
 *
 * ── AND THE RULE WAS ALREADY WRITTEN DOWN, ONE SCREEN OVER ──────────────────
 *
 *   #340 fixed this same badge on the Farm Nation landing page and gave the
 *   reason that settles it:
 *
 *       "it was the wrong fact even when it worked: uploading a survey plan is
 *        not the same as an admin approving it. The status IS the verification
 *        decision."
 *
 *   It reached one of the three screens that carry the badge. This audit's most
 *   repeated finding, on the fact a buyer uses to decide whether land is real.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isPurchasable, PURCHASABLE_STATUSES } from '@/lib/land-listing-status';
import { INTERNAL_LAND_FIELDS } from '@/lib/land-visibility';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

/** Every screen that draws the verified/unverified badge. */
const BADGE_SCREENS = [
    'src/app/farm-nation/FarmNationLandingClient.tsx',
    'src/app/farm-nation/properties/PropertiesClient.tsx',
    'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#856 — the badge states the admin decision, not the upload', () => {
    it('NO SCREEN DECIDES IT FROM `documents` ANY MORE', () => {
        const offenders = BADGE_SCREENS.filter((f) => {
            const src = code(f);
            const at = src.indexOf('Verified Land');
            if (at === -1) return false;
            //   The badge and the expression that feeds it sit within a few
            //   hundred characters of each other in all three files.
            return src.slice(Math.max(0, at - 600), at + 100).includes('documents');
        });

        expect(offenders).toEqual([]);
    });

    it('AND ALL THREE READ THE SHARED DECISION', () => {
        const missing = BADGE_SCREENS.filter((f) => !code(f).includes('isPurchasable(property.status)'));
        expect(missing).toEqual([]);
    });

    it('AND THE SCREENS REALLY DRAW THAT BADGE — the vacuity guard', () => {
        /*
         *   Both cases above pass for a file that no longer has the badge at
         *   all, which would be a worse outcome than the defect. Asserted so a
         *   deletion cannot read as a fix.
         */
        for (const f of BADGE_SCREENS) {
            const src = code(f);
            expect({ f, badge: src.includes('Verified Land') && src.includes('Unverified Land') })
                .toEqual({ f, badge: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#856 — and the decision itself is the admin\'s', () => {
    it('A FRESHLY SUBMITTED LISTING IS NOT VERIFIED', () => {
        /*
         *   The owner's case, executed on the rule rather than asserted about
         *   it. `pending_verification` is what the live action writes on submit
         *   and what the admin review queue reads; `draft` is what it writes
         *   before that.
         */
        expect(isPurchasable('pending_verification')).toBe(false);
        expect(isPurchasable('draft')).toBe(false);
        expect(isPurchasable('pending')).toBe(false);
        expect(isPurchasable('rejected')).toBe(false);
    });

    it('AND AN APPROVED ONE IS — under every spelling the platform writes', () => {
        /*
         *   The half that must not regress: a badge that never says "Verified"
         *   is the OTHER defect this expression produced, on the object-shaped
         *   rows, and it is just as wrong.
         */
        for (const s of PURCHASABLE_STATUSES) {
            expect({ s, purchasable: isPurchasable(s) }).toEqual({ s, purchasable: true });
        }
        expect([...PURCHASABLE_STATUSES]).toContain('verified');
    });

    it('AND AN UNKNOWN OR MISSING STATUS IS NOT VERIFIED', () => {
        //   The safe direction: a row whose status nobody recognises must not be
        //   presented to a buyer as checked land.
        for (const s of [undefined, null, '', 'something_new', 42, {}]) {
            expect({ s: String(s), purchasable: isPurchasable(s) })
                .toEqual({ s: String(s), purchasable: false });
        }
    });

    it('AND `documents` IS STILL WITHHELD FROM PUBLIC PAYLOADS', () => {
        /*
         *   Why a buyer saw "Unverified" on approved land, and a thing that must
         *   stay true for a better reason than the badge: those URLs are the
         *   certificate of occupancy and the survey plan.
         */
        expect([...INTERNAL_LAND_FIELDS]).toContain('documents');
    });
});
