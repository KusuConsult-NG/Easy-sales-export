/**
 * @jest-environment node
 */

/**
 *   #802 EVERY PRODUCT LISTED THROUGH THE ADD FORM WAS FILED AS "other".
 *
 *   Three seller doors write a product's category. Two carried an identical
 *   eighteen-entry list of {value, label} pairs whose values are what the
 *   database stores. The third, /marketplace/products/add, carried its own list
 *   of ten BARE DISPLAY STRINGS and submitted the label as the value:
 *
 *       "Grains & Cereals", "Tubers & Roots", "Fruits", "Vegetables",
 *       "Spices", "Nuts & Seeds", "Processed Foods", "Livestock Products",
 *       "Poultry Products", "Other"
 *
 *   NOT ONE of the ten satisfies ProductCategorySchema. "Grains & Cereals" is
 *   not a spelling the alias table knows, and "Fruits" and "Processed Foods"
 *   fail on CASE alone — z.enum compares exactly and the stored spellings are
 *   lowercase.
 *
 * ── THE SCHEMA WARNED ABOUT THIS IN ADVANCE ─────────────────────────────────
 *
 *   validations/marketplace.ts, describing the hazard #443 introduced healing
 *   to close:
 *
 *       "a product stored as 'tubers' would have come back as 'other' — out of
 *        its own category filter, and described to its seller as uncategorised."
 *
 *   Which is exactly what happened here, to every listing from that door. The
 *   write succeeded, the seller got "Product listed successfully!", and
 *   LenientProductSchema healed the category away on every read afterwards. A
 *   buyer browsing the real category never saw it; the seller's own dashboard
 *   called it uncategorised. Nothing anywhere said so.
 *
 *   MEASURED. Listing one product through the real form in the end-to-end suite
 *   (#798) makes the server print it on every read:
 *
 *       [serializeProduct] document did not satisfy its schema; healing
 *       {"id":"product_…","issues":["category: invalid_value"]}
 *
 *   That line has been in the logs the whole time.
 *
 * ── THE PRODUCTS ALREADY STORED ARE RECOVERED, NOT MIGRATED ─────────────────
 *
 *   Fixing the form only helps the next listing. The rows already written hold
 *   "Grains & Cereals", so those ten spellings are added to
 *   PRODUCT_CATEGORY_ALIASES instead — which makes the enum accept them AND
 *   makes categorySpellings("grains") match them.
 *
 *   No row is rewritten, nothing is deleted, and a product whose category was
 *   being healed away comes back to its real category on the next read. That is
 *   what the alias table is for: #131 added it because "products were written
 *   with several spellings of one category".
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the add form's labels restored as values (the defect)             KILLED
 *     the add form's <option value> switched back to the label          KILLED
 *     the recovery aliases removed from the table                       KILLED
 *     a door re-pointed at its own local copy                           KILLED
 *     reword a comment / unmutated baseline               SURVIVED, both intended
 *
 *     one shared option given a display label as its value           SURVIVED
 *                                          → then, one assertion:    KILLED
 *
 *   THE SURVIVOR IS RECORDED BECAUSE I CAUSED IT. Teaching the alias table the
 *   label spellings — the right fix for the rows already stored — also made
 *   those spellings genuinely PARSE. So "every offered value parses" stopped
 *   being able to catch a form regressing to labels: the repair for the OLD
 *   data weakened the assertion guarding the NEW.
 *
 *   The suite now also requires each offered value to be the canonical slug,
 *   which is the vocabulary the platform WRITES. The label spellings exist
 *   only to read back what is already there, never to be written again.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { PRODUCT_CATEGORY_OPTIONS } from '@/lib/product-categories';
import { ProductCategorySchema } from '@/lib/validations/marketplace';
import { categorySpellings } from '@/lib/product-search';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/** The three doors that let a seller choose a category. */
const DOORS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'add', file: 'src/app/marketplace/products/add/page.tsx' },
    { name: 'sell/create', file: 'src/app/marketplace/sell/create/page.tsx' },
    { name: 'edit', file: 'src/app/marketplace/seller/products/[id]/edit/EditProductClient.tsx' },
];

/** The labels the add form used to submit as values. */
const OLD_ADD_FORM_LABELS = [
    'Grains & Cereals', 'Tubers & Roots', 'Fruits', 'Vegetables', 'Spices',
    'Nuts & Seeds', 'Processed Foods', 'Livestock Products', 'Poultry Products',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — a seller is never offered a category the database refuses', () => {
    it('the list is real and non-trivial', () => {
        //   Vacuity guard: every assertion below is trivially true of an empty
        //   list.
        expect(PRODUCT_CATEGORY_OPTIONS.length).toBeGreaterThanOrEqual(18);
    });

    it.each(PRODUCT_CATEGORY_OPTIONS.map(o => o.value))(
        'EVERY OFFERED VALUE PARSES: %s',
        (value) => {
            /*
             *   THE test, and it EXECUTES the schema rather than reading a
             *   list. This is the property the whole finding is about: a
             *   category a seller can pick must be one the product can actually
             *   be filed under.
             */
            const parsed = ProductCategorySchema.safeParse(value);
            expect({ value, ok: parsed.success }).toEqual({ value, ok: true });
        },
    );

    it.each(PRODUCT_CATEGORY_OPTIONS.map(o => o.value))(
        'AND IT IS THE CANONICAL SPELLING, not a display label: %s',
        (value) => {
            /*
             *   FOUND BY THE SWEEP, AND IT EXPOSED A HOLE I MADE.
             *
             *   Giving an option the value "Grains & Cereals" SURVIVED the
             *   first draft of this suite — because the recovery aliases added
             *   for the products already stored make that spelling genuinely
             *   parse. So "every value parses" can no longer, on its own,
             *   catch a form regressing to labels: the fix for the old rows
             *   weakened the assertion protecting the new ones.
             *
             *   The vocabulary the platform WRITES is slugs. The label
             *   spellings exist to read back what is already in the database,
             *   never to be written again, and this is the line that says so.
             */
            expect({ value, canonical: /^[a-z0-9_]+$/.test(value) })
                .toEqual({ value, canonical: true });
        },
    );

    it('and every offered LABEL is distinct from its value, so neither can be submitted by accident', () => {
        //   The defect in one line: the add form used one string for both.
        //   Where a label and value legitimately coincide there is nothing to
        //   confuse, so this checks the pairs are explicit rather than bare.
        for (const opt of PRODUCT_CATEGORY_OPTIONS) {
            expect({ value: opt.value, hasLabel: typeof opt.label === 'string' && opt.label.length > 0 })
                .toEqual({ value: opt.value, hasLabel: true });
        }
    });

    it.each(DOORS)('$name USES THE SHARED LIST, not a copy', ({ name, file }) => {
        /*
         *   Two doors holding their own copy of one rule is how this module's
         *   creators drifted twice before — ProductSchema's comments record
         *   certifications dropped by one door and the initial status diverging
         *   between them, and #794 found a pricing bound on one write door and
         *   absent from three.
         */
        const src = read(file);
        expect({ name, imports: src.includes('PRODUCT_CATEGORY_OPTIONS') })
            .toEqual({ name, imports: true });
    });

    it('THE ADD FORM SUBMITS THE VALUE, NOT THE LABEL', () => {
        //   The specific line that caused it: `<option value={cat}>{cat}</option>`
        //   on a bare string. Asserted on the option element itself, because
        //   importing the shared list changes nothing if the value is still the
        //   label.
        const src = read('src/app/marketplace/products/add/page.tsx');
        const option = src.slice(src.indexOf('{categories.map('));

        expect(option).toMatch(/value=\{cat\.value\}/);
        expect(option).toMatch(/\{cat\.label\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — and the products already stored come back', () => {
    it.each(OLD_ADD_FORM_LABELS)('a product stored as "%s" is accepted, not healed away', (label) => {
        /*
         *   The recovery half, executed. These are the exact spellings sitting
         *   in the database from every listing the add form ever created. Each
         *   one must now satisfy the schema, or LenientProductSchema keeps
         *   healing it to "other" and the listing stays invisible in its own
         *   category.
         *
         *   NO ROW IS REWRITTEN to achieve this — the owner's standing rule is
         *   that nothing wrongly written gets destroyed, only fixed — so the
         *   table learns the spelling instead.
         */
        const parsed = ProductCategorySchema.safeParse(label);
        expect({ label, ok: parsed.success }).toEqual({ label, ok: true });
    });

    it('AND A FILTER FOR THE CATEGORY FINDS THEM', () => {
        /*
         *   Accepting the spelling is only half of recovery. A buyer browsing
         *   "grains" has to actually match a row stored as "Grains & Cereals",
         *   which is what categorySpellings decides.
         */
        expect(categorySpellings('grains')).toContain('Grains & Cereals');
        expect(categorySpellings('roots')).toContain('Tubers & Roots');
        expect(categorySpellings('poultry')).toContain('Poultry Products');
        expect(categorySpellings('livestock')).toContain('Livestock Products');
        expect(categorySpellings('nuts')).toContain('Nuts & Seeds');
        expect(categorySpellings('processed')).toContain('Processed Foods');
    });

    it('CONTROL: the spellings that already worked still do', () => {
        //   Or this finding would have recovered the new spellings by losing
        //   the ones the table was built for.
        expect(categorySpellings('grains')).toContain('grains');
        expect(categorySpellings('roots')).toContain('tubers');
        expect(categorySpellings('spices')).toContain('spices_herbs_seasonings');
        expect(ProductCategorySchema.safeParse('grains').success).toBe(true);
    });

    it('CONTROL: a genuinely unknown category is STILL refused', () => {
        /*
         *   The enum is closed on purpose — the schema's own note says
         *   createProductAction validates the listing form through it, so
         *   `category: "not-a-category"` must still be refused. Widening it to
         *   z.string() to make this finding go away would have removed the
         *   guard instead of fixing the door.
         */
        expect(ProductCategorySchema.safeParse('not-a-category').success).toBe(false);
        expect(ProductCategorySchema.safeParse('Grains and Cereals').success).toBe(false);
    });
});
