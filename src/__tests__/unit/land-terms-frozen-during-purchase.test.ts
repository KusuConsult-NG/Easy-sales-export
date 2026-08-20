/**
 * @jest-environment node
 */

/**
 * An owner cannot move the price out from under a buyer mid-purchase.
 *
 * THE DEFECT
 * ----------
 * updatePropertyAction let the owner change `price` at any time, with no regard
 * for the listing's status. verifyPropertyPaymentAction then compared what the
 * buyer had paid against the LIVE listing price:
 *
 *     if (amountInNaira + 1 < listedPrice) throw new Error("Payment ... does not cover ...")
 *
 * So this sequence took a buyer's money and refused them:
 *
 *   1. owner lists at ₦5,000,000; an admin verifies it
 *   2. buyer initialises — Paystack is asked for the listed ₦5,000,000, and the
 *      listing moves to pending_escrow
 *   3. buyer pays
 *   4. owner updates the price to ₦50,000,000
 *   5. the buyer returns; verification reads the NEW price and throws
 *
 * The payment is claimed by step 5, so the buyer has paid and received nothing.
 * It works as deliberate griefing, but malice is not required: an owner
 * legitimately repricing between a buyer's initialisation and their return from
 * Paystack breaks that purchase identically.
 *
 * TWO HALVES, BOTH NEEDED
 * -----------------------
 *   1. updatePropertyAction refuses to change the commercial terms while a
 *      purchase is in flight.
 *   2. verifyPropertyPaymentAction compares against the price recorded on the
 *      purchase record — the figure Paystack was actually asked for — not the
 *      live listing price.
 *
 * (1) alone leaves a window, because initializePropertyPaymentAction writes
 * `pending_escrow` at the END of its work. (2) alone would let an owner confuse
 * the public listing while a sale is pending. Descriptive fields stay editable
 * under both: correcting a typo mid-sale harms nobody.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const LISTINGS = readFileSync(
    join(process.cwd(), 'src/app/actions/farm-nation/_fn_listings.ts'),
    'utf-8'
);
const PAYMENT = readFileSync(
    join(process.cwd(), 'src/app/actions/farm-nation-payment.ts'),
    'utf-8'
);

describe('the commercial terms are frozen once money is committed', () => {
    it('updatePropertyAction refuses term changes in every money state', () => {
        // Not just pending_escrow. A listing at pending_payment,
        // payment_confirmed, pending_transfer, sold or completed has money
        // committed against it too, and repricing any of them has the same effect.
        for (const status of [
            'pending_escrow',
            'pending_payment',
            'payment_confirmed',
            'pending_transfer',
            'sold',
            'completed',
        ]) {
            expect(
                LISTINGS.includes(`"${status}"`)
                    ? 'ok'
                    : `TERMS_LOCKED_IN does not include ${status}, so the price can still be changed there`
            ).toBe('ok');
        }
    });

    it('the lock covers price, size, type, category and lease duration', () => {
        // Every field the buyer's decision and the charge depend on.
        for (const field of ['price', 'size', 'type', 'category', 'leaseDuration']) {
            expect(
                new RegExp(`updates\\.${field} !== undefined|updates\\.${field} !==`).test(LISTINGS) ||
                LISTINGS.includes(`updates.${field}`)
            ).toBe(true);
        }
        expect(LISTINGS).toMatch(/changesTerms/);
    });

    it('but descriptive fields stay editable', () => {
        // Deliberate. Blocking a typo correction during a sale would be a
        // different, smaller annoyance with no safety benefit — so `changesTerms`
        // must not include them.
        const guard = LISTINGS.slice(
            LISTINGS.indexOf('const changesTerms'),
            LISTINGS.indexOf('if (changesTerms')
        );
        for (const descriptive of ['name', 'description', 'location', 'features']) {
            expect(
                guard.includes(`updates.${descriptive}`)
                    ? `${descriptive} is in changesTerms, which would block editing it mid-sale`
                    : 'ok'
            ).toBe('ok');
        }
    });

    it('verification compares against the QUOTED price, not the live listing', () => {
        // The half that does not depend on winning a race with the status write.
        expect(PAYMENT).toMatch(/quotedPrice/);
        expect(PAYMENT).toMatch(/propertyPrice/);
        // The old comparison read freshData.price directly.
        expect(PAYMENT).not.toMatch(/const listedPrice = Number\(freshData\.price \|\| 0\);\s*\n\s*if \(Number\.isFinite\(listedPrice\)/);
    });

    it('and reads the quote from the purchase record by payment reference', () => {
        // FARM_NATION_TRANSACTIONS holds propertyPrice, written at initialisation,
        // keyed by paymentReference. That is the figure Paystack was asked for.
        const region = PAYMENT.slice(PAYMENT.indexOf('quotedSnap'), PAYMENT.indexOf('quotedPrice >'));
        expect(region).toMatch(/FARM_NATION_TRANSACTIONS/);
        expect(region).toMatch(/paymentReference/);
    });

    it('falls back to the listing price when there is no purchase record', () => {
        // A reference arriving from outside the normal flow — the case the
        // original underpayment check existed for. It must still be checked, not
        // waved through.
        expect(PAYMENT).toMatch(/quotedSnap\.empty\s*\n?\s*\?\s*Number\(freshData\.price/);
    });

    it('still refuses an underpayment, so the guard was not simply removed', () => {
        // Vacuity guard. Every assertion above would pass if the comparison had
        // been deleted rather than corrected.
        expect(PAYMENT).toMatch(/amountInNaira \+ 1 < quotedPrice/);
        expect(PAYMENT).toMatch(/does not cover the property price/);
    });
});
