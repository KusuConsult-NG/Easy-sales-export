/**
 * @jest-environment node
 */

/**
 *   #859 THE TOTAL PRICE WAS ARITHMETIC THE SELLER COULD NOT ARGUE WITH.
 *
 *   THE OWNER: "Total price should include dynamic pricing field and not
 *   automatic when setting up product/land."
 *
 *   The listing form asked for a size and a price per unit and then submitted
 *
 *       price: parseCurrencyStringToFloat(String(formData.size))
 *              * parseCurrencyStringToFloat(String(formData.pricePerUnit))
 *
 *   with the product shown above it as a read-only line. Land is not sold that
 *   way. A seller rounds, discounts for a quick sale, prices a corner plot above
 *   the per-acre rate because it fronts the road, or prices below it because
 *   access is poor. The form gave her no way to say any of that, and the figure
 *   a buyer decides on was whatever fell out of the multiplication.
 *
 *   The product is still computed and still offered — it is a good default and
 *   most listings will keep it — but it is a STARTING POINT in a field now,
 *   not a verdict. Once she types her own figure the size and unit-price inputs
 *   stop overwriting it, and the suggestion becomes an offer she can take back.
 *
 * ── AND THE SIZE WAS ALREADY FREE TEXT, WHICH IS WORTH RECORDING ────────────
 *
 *   The same request asked for size to be "dynamic not a range, users should
 *   type the size". It already is: `<input type="number">`, no options, no
 *   bands. Checked rather than assumed, and asserted below so a later change to
 *   a dropdown of ranges fails instead of passing quietly.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';
const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#859 — the seller sets the asking price', () => {
    it('THE REPORTED CASE: the submitted price is not the product', () => {
        const src = code(FORM);

        //   The expression that was there.
        expect(src).not.toMatch(/price:\s*parseCurrencyStringToFloat\(String\(formData\.size\)\)\s*\*/);
        expect(src).toContain('price: effectiveTotal');
    });

    it('AND THERE IS A FIELD SHE CAN TYPE IN', () => {
        const src = code(FORM);
        const at = src.indexOf('Total Price (₦)');

        expect(at).toBeGreaterThan(-1);
        //   An input, not a rendered figure — the previous version printed the
        //   product inside a <p>. The window reaches past the input's own
        //   attributes to its onChange, which is where the override is set;
        //   600 characters stopped short of it and failed against correct code.
        const field = src.slice(at, at + 1400);
        expect(field).toContain('<input');
        expect(field).toContain('totalPriceEdited: true');
    });

    it('AND THE PRODUCT IS STILL OFFERED AS THE DEFAULT', () => {
        /*
         *   The half that must not regress. Making the field editable and empty
         *   would hand every seller an extra sum to do, on the form this finding
         *   is meant to make easier.
         */
        const src = code(FORM);

        expect(src).toContain('const suggestedTotal');
        expect(src).toContain('Number(formData.size) * Number(formData.pricePerUnit)');
    });

    it('AND ONCE SHE HAS TYPED ONE, SIZE AND UNIT PRICE STOP OVERWRITING IT', () => {
        /*
         *   The behaviour that makes the field real. Without the flag, editing
         *   the size after setting a total silently discards what she asked for
         *   — an editable field that quietly reverts is worse than a read-only
         *   one, because it looks like it worked.
         */
        const src = code(FORM);

        expect(src).toContain('formData.totalPriceEdited');
        expect(src).toContain('totalPriceEdited\n        ? Number(formData.totalPrice) || 0\n        : suggestedTotal');
    });

    it('AND SHE CAN TAKE THE SUGGESTION BACK', () => {
        //   A one-way override is a trap: a seller who edits by accident has no
        //   way back to the computed figure except to work it out herself.
        const src = code(FORM);

        expect(src).toContain('Use that instead');
        expect(src).toContain('totalPriceEdited: false');
    });

    it('AND THE SIZE IS STILL TYPED, not chosen from a band', () => {
        const src = code(FORM);
        const at = src.indexOf('Land Size *');

        expect(at).toBeGreaterThan(-1);
        const field = src.slice(at, at + 500);
        expect(field).toContain('type="number"');
        expect(field).not.toContain('<select');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#859 — the value is derived, not synced', () => {
    it('NO MOUNT EFFECT WAS ADDED TO THIS PAGE', () => {
        /*
         *   The first version kept the total in step with an effect, and
         *   client-pages-that-still-fetch-after-hydration caught it: that
         *   ratchet counts a client page carrying one which also calls a server
         *   action, and this page submits through one. Its header is explicit
         *   that silently raising the cap is the thing not to do, so the effect
         *   went instead. A displayed value that is a function of what has been
         *   typed does not need state to hold it.
         *
         *   Asserted here as well as there, because the ratchet is a ceiling
         *   over the whole app and would go green again if some other page
         *   dropped below it.
         */
        const src = code(FORM);

        expect(src).not.toContain('useEffect');
        expect(src).toContain('const effectiveTotal');
        expect(src).toContain('const totalPriceValue');
    });

    it('AND AN EMPTY OR NONSENSE FIGURE IS ZERO, not NaN', () => {
        /*
         *   `Number("") || 0` and `Number("abc") || 0`. A NaN reaching the
         *   action is a listing whose price renders as "₦NaN" on the public
         *   catalogue — and the submitted value is the one a buyer pays.
         */
        const src = code(FORM);
        expect(src).toContain('Number(formData.totalPrice) || 0');
    });
});
