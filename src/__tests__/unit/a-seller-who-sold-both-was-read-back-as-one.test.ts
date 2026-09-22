/**
 * @jest-environment node
 */

/**
 * A seller who sold both was read back as selling one.
 *
 *   THE OWNER'S PRODUCTION LOG, three times for a single product:
 *
 *       [serializeProduct] document did not satisfy its schema; healing
 *       {"id":"product_5ce9c3b4-…","issues":["sellerCategory: invalid_value"]}
 *
 *   ProductSchema declared `z.enum(["wholesale", "retail"])`. The vocabulary
 *   has THREE values: lib/seller-category declares SELLER_CATEGORIES as
 *   ["wholesale", "retail", "both"], the marketplace application asks for all
 *   three, and `sellerCategoryMatches` exists precisely because "both" belongs
 *   to each of the other two.
 *
 *   So a seller who sells both had every product fail its own schema.
 *
 *   AND THE HEALING WAS NOT COSMETIC, which is why this is worth a test rather
 *   than a shrug at a warning. The lenient schema fills the field from its
 *   default, so the product came back as "retail" — dropping that seller out of
 *   the wholesale queries seller-category itself names:
 *
 *       sms-broadcast.ts      q.where("sellerCategory", "==", "wholesale")
 *
 *   A wholesale-and-retail seller silently stopped being wholesale on read, and
 *   the only symptom was a log line that said "healing".
 *
 *   THE THIRD "both" DEFECT IN ONE DAY. Marketplace roles granted `seller` to
 *   an applicant who asked for both-and-buyer; Farm Nation's approval granted
 *   `farmer` whatever was asked; and this. Each was a two-value answer to a
 *   three-value question.
 *
 *   Verified by mutation: restoring the two-value enum fails the first test.
 */

import { describe, it, expect } from '@jest/globals';
import { ProductSchema } from '@/lib/validations/marketplace';
import {
    SELLER_CATEGORIES,
    sellerCategoryMatches,
    isSellerCategory,
} from '@/lib/seller-category';

/** The fields ProductSchema needs; the rest have defaults. */
const product = (sellerCategory: unknown) => ({
    id: 'p1',
    title: 'Yam Tubers',
    sellerId: 'seller-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(sellerCategory === undefined ? {} : { sellerCategory }),
});

describe('a seller who sold both was read back as one', () => {
    it('"both" SURVIVES THE SCHEMA — it no longer heals to "retail"', () => {
        const parsed = ProductSchema.parse(product('both'));
        expect(parsed.sellerCategory).toBe('both');
    });

    it('EVERY CANONICAL VALUE PARSES, so the two cannot drift apart again', () => {
        for (const value of SELLER_CATEGORIES) {
            expect(ProductSchema.parse(product(value)).sellerCategory).toBe(value);
        }
    });

    it('AND A VALUE OUTSIDE THE VOCABULARY IS STILL REFUSED', () => {
        //   The enum is widened to the real set, not opened.
        expect(() => ProductSchema.parse(product('wholesale_retail'))).toThrow();
        expect(() => ProductSchema.parse(product('BOTH'))).toThrow();
        expect(isSellerCategory('wholesale_retail')).toBe(false);
    });

    it('AN ABSENT VALUE STILL DEFAULTS TO retail, as before', () => {
        expect(ProductSchema.parse(product(undefined)).sellerCategory).toBe('retail');
    });

    it('AND THIS IS WHY IT MATTERED: "both" is a wholesale seller', () => {
        /*
         *   The consequence the log line hid. Healing "both" to "retail" took
         *   the seller out of this set, which is the one the broadcast queries
         *   use.
         */
        expect(sellerCategoryMatches('wholesale')).toContain('both');
        expect(sellerCategoryMatches('retail')).toContain('both');

        const healedAway = ProductSchema.parse(product('both')).sellerCategory;
        expect(sellerCategoryMatches('wholesale')).toContain(healedAway);
    });

    it('THE SCHEMA READS THE VOCABULARY RATHER THAN RESTATING IT', async () => {
        //   Two hand-maintained copies of one list is what produced this.
        const { readFileSync } = await import('fs');
        const src = readFileSync('src/lib/validations/marketplace.ts', 'utf8');

        expect(src).toContain('z.enum(SELLER_CATEGORIES)');
        expect(src).not.toContain('z.enum(["wholesale", "retail"])');
    });
});
