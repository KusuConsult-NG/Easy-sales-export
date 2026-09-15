/**
 * @jest-environment node
 */

/**
 *   #794 A SELLER COULD CREATE — AND EDIT INTO — A LISTING NOBODY COULD BUY.
 *
 *   Asked for by the owner as "what are the gaps on marketplace".
 *
 *   FOUR DOORS WRITE A PRODUCT'S PRICE. Exactly ONE of them checked the number:
 *
 *       /api/marketplace/create-product   checked            ✓
 *       createProductAction               NOTHING
 *       updateProductAction               NOTHING
 *       /api/marketplace/update-product   NOTHING
 *
 *   MEASURED by running ProductSchema rather than reading it — the action's only
 *   validation — with the tiers a form would send:
 *
 *       ACCEPTED  negative retail price  -> price -5000
 *       ACCEPTED  negative stock         -> qty -99
 *       rejected  Infinity price                (z.number() refuses non-finite)
 *
 * ── WHAT IT COSTS, AND WHAT IT DOES NOT ─────────────────────────────────────
 *
 *   NOT theft, and the first draft of this finding said it was. Three guards
 *   already close that: validateCartItems refuses a non-positive stored price
 *   AND a non-positive quantity, and checkOrderAmountBounds fails closed on a
 *   negative total (#112). village-market.ts guards its own writer and its
 *   comment names this exact residue.
 *
 *   What it costs is a LISTING NOBODY CAN BUY. The product is created, appears
 *   in the catalogue, and every checkout containing it throws "Invalid price for
 *   <product>" — at the buyer, who did nothing wrong, while nothing tells the
 *   seller their listing is broken. The edit doors make it worse: a WORKING
 *   listing could be turned into one.
 *
 * ── THE FIX THAT WOULD HAVE BEEN A REGRESSION ───────────────────────────────
 *
 *   The obvious move is to bound the price in PricingTierSchema. It would have
 *   been serious damage, and the test below is the measurement that stopped it.
 *
 *   ProductSchema is ALSO the read path: firestore-serialize derives
 *   LenientProductSchema from it with lenientObject, which wraps each field in
 *   `.catch(default)`. A tier the schema rejects does not lose one tier — the
 *   WHOLE pricingTiers array falls back to `[{ retail, price: 0 }]`.
 *
 *       a real product, retail 5,000 with a blank bulk tier at 0
 *         today       [{"retail",5000},{"bulk",0}]
 *         if bounded  [{"retail",0}]              ← the ₦5,000 is gone
 *
 *   Live products would have shown as FREE across the catalogue. The healing is
 *   deliberate and stays; the bound belongs at the doors that WRITE.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the guard removed from createProductAction                   KILLED
 *     the guard removed from updateProductAction                   KILLED
 *     the guard removed from the update route                      KILLED
 *     the guard removed from the create route                      KILLED
 *     `value < 0` relaxed to `!value`                              KILLED
 *     zeroMeansAbsent applied to the retail price                  KILLED
 *     the update route checking absent fields too                  KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { stripComments } from '@/lib/testing/strip-comments';
import { checkProductPricing } from '@/lib/product-pricing-guard';
import { lenientObject } from '@/lib/schema-heal';
import { ProductSchema } from '@/lib/validations/marketplace';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every door that writes what a product costs. */
const DOORS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'createProductAction', file: 'src/app/actions/marketplace/_mp_products.ts' },
    { name: 'updateProductAction', file: 'src/app/actions/marketplace/_mp_products.ts' },
    { name: 'POST /api/marketplace/create-product', file: 'src/app/api/marketplace/create-product/route.ts' },
    { name: 'POST /api/marketplace/update-product', file: 'src/app/api/marketplace/update-product/route.ts' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#794 — the rule itself', () => {
    it('REFUSES A NEGATIVE PRICE, which is the whole finding', () => {
        expect(checkProductPricing([{ label: 'retail price', value: -5000 }]))
            .toEqual({ ok: false, message: 'The retail price cannot be negative.' });
    });

    it('AND A ZERO RETAIL PRICE, because checkout refuses one', () => {
        //   A product listed at 0 is not free — it is unbuyable, because
        //   validateCartItems throws on a non-positive stored price.
        expect(checkProductPricing([{ label: 'retail price', value: 0 }]).ok).toBe(false);
    });

    it('BUT 0 IS "NOT OFFERED" FOR A BULK OR EXPORT TIER', () => {
        /*
         *   The creators push a bulk tier only when bulkAvailable is set, and
         *   read the field as 0 when it is absent. Refusing that would reject
         *   every ordinary product that does not do bulk — the finding's fix
         *   breaking the common case.
         */
        expect(checkProductPricing([
            { label: 'retail price', value: 1500 },
            { label: 'bulk price', value: 0, zeroMeansAbsent: true },
            { label: 'export price', value: 0, zeroMeansAbsent: true },
            { label: 'stock quantity', value: 0, zeroMeansAbsent: true },
        ]).ok).toBe(true);
    });

    it('and a non-finite number, which truthiness lets through', () => {
        //   parseCurrencyStringToFloat is parseFloat underneath, so "1e400" is
        //   Infinity — truthy, and JSON.stringify writes it as null.
        expect(checkProductPricing([{ label: 'retail price', value: Infinity }]).ok).toBe(false);
        expect(checkProductPricing([{ label: 'retail price', value: NaN }]).ok).toBe(false);
    });

    it('CONTROL: an ordinary product passes', () => {
        expect(checkProductPricing([
            { label: 'retail price', value: 5000 },
            { label: 'stock quantity', value: 40, zeroMeansAbsent: true },
            { label: 'minimum order quantity', value: 1 },
        ])).toEqual({ ok: true, message: '' });
    });

    it('names the FIRST failure only — a seller fixes one field at a time', () => {
        expect(checkProductPricing([
            { label: 'retail price', value: -1 },
            { label: 'stock quantity', value: -1 },
        ]).message).toMatch(/retail price/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#794 — every door applies it', () => {
    it.each(DOORS)('$name calls the shared rule', ({ file }) => {
        expect(stripComments(read(file))).toMatch(/checkProductPricing\(/);
    });

    it('AND THE ACTION FILE APPLIES IT TWICE — create AND update', () => {
        /*
         *   The half the first pass missed, and it was found by an anchor that
         *   matched TWICE rather than by reading: create and update build their
         *   pricing tiers with identical lines. A seller could not only list an
         *   unsellable product but turn a working listing into one.
         */
        const src = stripComments(read('src/app/actions/marketplace/_mp_products.ts'));
        expect((src.match(/checkProductPricing\(/g) ?? []).length).toBe(2);
    });

    it('AND NOBODY CARRIES THEIR OWN COPY OF IT', () => {
        /*
         *   ProductSchema's own comments record these creators drifting twice
         *   before — certifications dropped by one door, the initial status
         *   diverging between them. One rule, four callers.
         */
        for (const { file } of DOORS) {
            const src = stripComments(read(file));
            expect({ file, ownCopy: /must be a positive number/.test(src) })
                .toEqual({ file, ownCopy: false });
        }
    });

    it('and the update route checks only the fields the patch contains', () => {
        /*
         *   It is a PARTIAL update. A patch that does not mention the price must
         *   not be refused for a price the product already has, which may
         *   predate this rule — that would make every existing listing
         *   uneditable.
         */
        const src = stripComments(read('src/app/api/marketplace/update-product/route.ts'));
        expect(src).toMatch(/hasOwnProperty\.call\(patch, field\)/);
        expect(src).toMatch(/Array\.isArray\(patch\.pricingTiers\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#794 — the schema stays lenient, and here is why', () => {
    it('BOUNDING THE SHARED SCHEMA WOULD SHOW LIVE PRODUCTS AS FREE', () => {
        /*
         *   THE measurement that chose the fix. ProductSchema is the read path
         *   too, via lenientObject, which wraps each field in `.catch(default)`
         *   — so a rejected tier drops the WHOLE array to its default.
         */
        const Tier = z.object({
            type: z.enum(['retail', 'bulk', 'export']),
            price: z.number().default(0),
            minQuantity: z.number().default(1),
        });
        const Bounded = Tier.extend({ price: z.number().positive() });
        const shape = (T: z.ZodTypeAny) => lenientObject(z.object({
            id: z.string(),
            sellerId: z.string(),
            pricingTiers: z.array(T).default([{ type: 'retail', price: 0, minQuantity: 1 }]),
        }) as any);

        //   A real product: retail 5,000, with a bulk tier the seller left blank.
        const row = {
            id: 'p1', sellerId: 's1',
            pricingTiers: [
                { type: 'retail', price: 5000, minQuantity: 1 },
                { type: 'bulk', price: 0, minQuantity: 50 },
            ],
        };

        const today = shape(Tier).parse(row) as any;
        const tightened = shape(Bounded).parse(row) as any;

        expect(today.pricingTiers).toHaveLength(2);
        expect(today.pricingTiers[0].price).toBe(5000);

        //   The regression that was nearly shipped: the ₦5,000 is gone.
        expect(tightened.pricingTiers).toHaveLength(1);
        expect(tightened.pricingTiers[0].price).toBe(0);
    });

    it('SO THE SCHEMA IS STILL THE HEALING ONE', () => {
        //   If a later change bounds it after all, the test above explains what
        //   that costs. This one fails the moment it happens.
        const parsed = ProductSchema.safeParse({
            id: 'p1', sellerId: 's1', title: 'Yam', description: 'd',
            category: 'roots', unit: 'bag',
            pricingTiers: [{ type: 'retail', price: 0, minQuantity: 1 }],
            availableQuantity: 0,
        });
        expect(parsed.success).toBe(true);
    });

    it('CONTROL: the downstream guards that stop this being theft are still there', () => {
        /*
         *   The reason this finding is a broken listing and not a money hole.
         *   If these ever go, the severity changes and somebody should know.
         */
        const cart = stripComments(read('src/lib/marketplace-cart.ts'));
        expect(cart).toMatch(/!Number\.isFinite\(effectivePrice\) \|\| effectivePrice <= 0/);
        expect(cart).toMatch(/!Number\.isInteger\(quantity\) \|\| quantity <= 0/);

        const bounds = stripComments(read('src/lib/order-payment-amount.ts'));
        expect(bounds).toMatch(/!Number\.isFinite\(total\) \|\| total < 0/);
    });
});
