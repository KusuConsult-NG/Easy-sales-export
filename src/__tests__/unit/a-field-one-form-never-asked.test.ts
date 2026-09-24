/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "/marketplace/sell/create never asks for a nearest market, but
 *   the edit screen requires one — so those products can't be re-saved."
 *
 * ── ONE FIELD, TWO FORMS, AND ONLY ONE OF THEM ASKED ────────────────────────
 *
 *   The create form's "Location & Delivery" section collected State, LGA and
 *   Delivery Method. Both creators wrote the field regardless:
 *
 *       nearestMarket: formData.get("nearestMarket") as string || "Unknown"
 *
 *   The edit screen asked for it, labelled it "Nearest Market *", and marked
 *   the input `required`.
 *
 *   So a seller who listed through the primary path — the one six links point
 *   at — opened the edit screen to a field they had never been shown, already
 *   filled in with the word "Unknown", carrying an asterisk. The asterisk is
 *   the part that stings: it says the seller must confirm an answer they did
 *   not give, to a question nobody asked them.
 *
 * ── THE RESOLUTION, AND WHY IT IS NOT "MAKE BOTH REQUIRED" ──────────────────
 *
 *   A listing without a nearest market has been legal since the first one was
 *   written, and thousands exist. Requiring the field on the create form as
 *   well would fix the asymmetry and still leave every existing listing
 *   demanding an answer before it could be saved again. Asked on both,
 *   demanded on neither, is the only shape that strands nobody.
 *
 *   AND NOTHING STORED IS TOUCHED. A row that says "Unknown" still says
 *   "Unknown". What changed is that the form stops presenting that word to the
 *   seller as their own answer.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    storedNearestMarket, NEAREST_MARKET_PLACEHOLDER, NEAREST_MARKET_LABEL, NEAREST_MARKET_HINT,
} from '@/lib/product-location';

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const CREATE = 'src/app/marketplace/sell/create/page.tsx';
const EDIT = 'src/app/marketplace/seller/products/[id]/edit/EditProductClient.tsx';

describe('the placeholder is not an answer', () => {
    it('THE MANUFACTURED VALUE READS BACK AS NOTHING', () => {
        expect(storedNearestMarket(NEAREST_MARKET_PLACEHOLDER)).toBe('');
        //   Three writers produce this word; one of them could easily lowercase it.
        expect(storedNearestMarket('unknown')).toBe('');
        expect(storedNearestMarket('  Unknown  ')).toBe('');
    });

    it('AND A REAL MARKET SURVIVES INTACT', () => {
        //   The positive control. A rule that blanked everything would satisfy
        //   the test above and erase every seller's answer.
        expect(storedNearestMarket('Mile 12 Market')).toBe('Mile 12 Market');
        expect(storedNearestMarket('  Bodija Market ')).toBe('Bodija Market');
        //   A market whose name merely contains the word is still a market.
        expect(storedNearestMarket('Unknown Junction Market')).toBe('Unknown Junction Market');
    });

    it('AND A MISSING OR NON-STRING VALUE IS NOTHING', () => {
        expect(storedNearestMarket(undefined)).toBe('');
        expect(storedNearestMarket(null)).toBe('');
        expect(storedNearestMarket(42)).toBe('');
        expect(storedNearestMarket('   ')).toBe('');
    });
});

describe('and both forms now ask the same question', () => {
    it('THE CREATE FORM ASKS FOR IT AT ALL', () => {
        const src = code(CREATE);

        expect(src).toContain('name="nearestMarket"');
        expect(src).toContain('NEAREST_MARKET_LABEL');
    });

    it('AND THE EDIT SCREEN NO LONGER DEMANDS IT', () => {
        /*
         *   The precise line. `required` on this input is what the owner ran
         *   into, and it sits between the label and the value binding.
         */
        const src = code(EDIT);
        const at = src.indexOf('setNearestMarket(e.target.value)');
        expect(at).toBeGreaterThan(-1);

        const input = src.slice(src.lastIndexOf('<input', at), at);
        expect(input).not.toMatch(/\brequired\b/);
    });

    it('AND THE CREATE FORM DOES NOT DEMAND IT EITHER', () => {
        //   Making both required would fix the asymmetry and strand every
        //   listing that already has none.
        const src = code(CREATE);
        const at = src.indexOf('name="nearestMarket"');
        const input = src.slice(src.lastIndexOf('<input', at), src.indexOf('/>', at));

        expect(input).not.toMatch(/\brequired\b/);
    });

    it('AND THE EDIT SCREEN BLANKS THE MANUFACTURED VALUE', () => {
        const src = code(EDIT);

        expect(src).toContain('storedNearestMarket(prod.location?.nearestMarket)');
        expect(src).not.toContain("setNearestMarket(prod.location?.nearestMarket || \"\")");
    });

    it('AND THEY DESCRIBE IT IN THE SAME WORDS', () => {
        //   Two forms that word one field differently is how a seller comes to
        //   believe they are two fields.
        for (const rel of [CREATE, EDIT]) {
            const src = code(rel);
            expect({ rel, label: src.includes('NEAREST_MARKET_LABEL') }).toEqual({ rel, label: true });
            expect({ rel, hint: src.includes('NEAREST_MARKET_HINT') }).toEqual({ rel, hint: true });
        }
        expect(NEAREST_MARKET_LABEL).toBe('Nearest Market');
        expect(NEAREST_MARKET_HINT).toContain('Market');
    });
});
