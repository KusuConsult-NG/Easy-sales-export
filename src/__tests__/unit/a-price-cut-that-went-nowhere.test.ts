/**
 * @jest-environment node
 */

/**
 *   #867 A PRICE CUT WENT NOWHERE.
 *
 *   THE OWNER: "Promotion to slash sales for all listed product — products that
 *   get price reduction should automatically go to flash sales / hot deals, and
 *   you need to create that for Farm Nation, and ensure the section on
 *   marketplace is properly wired."
 *
 *   MEASURED. The marketplace has a Flash Sales tab and everything in it came
 *   from ONE source: `getActiveFlashSaleProductsAction`, reading
 *   FLASH_SALE_PRODUCTS — rows created by a Village Market EVENT. A seller who
 *   dropped the price of an ordinary product produced nothing at all: no record
 *   that the price had moved, and no way for any screen to know it had. Farm
 *   Nation had no such section in any form.
 *
 *   THE FIELDS EXISTED AND WERE REFUSED, which is the sharp part.
 *   api/marketplace/update-product lists `isFlashSale`, `originalPrice` and
 *   `flashPrice` among the fields it blocks, with the reason written down: a
 *   client could otherwise "present an invented discount against an invented
 *   original price". That refusal is correct and stays — which is exactly why
 *   the reduction is derived from the STORED price on the server, where the
 *   previous value is a fact rather than a claim.
 *
 * ── TWO SILENT DROPS THIS WOULD HAVE HIT, BOTH FOUND BY MEASURING ───────────
 *
 *   Writing the fields is not the same as anybody seeing them, and both
 *   collections have something in the way:
 *
 *     PRODUCTS   every product reaching a buyer goes through serializeProduct →
 *                ProductSchema, and `z.object` STRIPS unknown keys. The action
 *                could have written the two fields perfectly and no screen would
 *                ever have received them.
 *
 *     LISTINGS   stripInternalLandFields stands in front of the public land
 *                payload. It is a DENYLIST, so these pass — checked rather than
 *                assumed, because if it had been an allowlist the Farm Nation
 *                half would have been dead on arrival in the same way.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    priceReductionPatch, isOnOffer, discountPercent, retailPriceOf,
    MIN_DISCOUNT_PERCENT, OFFER_WINDOW_DAYS,
} from '@/lib/price-reduction';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const NOW = new Date('2026-09-17T12:00:00.000Z');
const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
describe('#867 — what counts as a reduction', () => {
    it('A REAL CUT IS RECORDED', () => {
        expect(priceReductionPatch(10_000, 8_000, NOW))
            .toEqual({ previousPrice: 10_000, priceReducedAt: NOW.toISOString() });
    });

    it('AND A TRIVIAL ONE IS NOT', () => {
        //   A naira off a million is not a deal, and rounding noise from a
        //   currency field should not light up a banner.
        const patch = priceReductionPatch(1_000_000, 999_999, NOW);
        expect(patch).toEqual({ previousPrice: null, priceReducedAt: null });
    });

    it('AND THE THRESHOLD IS THE MODULE\'S, not a number written here', () => {
        //   Derived, so this test cannot drift from the rule it is pinning.
        const justUnder = 100 - (MIN_DISCOUNT_PERCENT - 1);
        const justOver = 100 - (MIN_DISCOUNT_PERCENT + 1);

        expect(priceReductionPatch(100, justUnder, NOW)?.previousPrice).toBeNull();
        expect(priceReductionPatch(100, justOver, NOW)?.previousPrice).toBe(100);
    });

    it('AND A PRICE THAT GOES BACK UP CLEARS THE OFFER', () => {
        /*
         *   The half that stops a stale badge sitting over a higher number. A
         *   seller who cuts a price and restores it has no promotion, and
         *   `previousPrice` left behind would render as a negative discount.
         *
         *   THE GUARD THAT PRODUCES THIS IS REDUNDANT, AND THAT IS RECORDED
         *   RATHER THAN HIDDEN. Mutating `if (next >= previous)` to `if (false)`
         *   failed NOTHING: a rise gives the percentage check a negative value
         *   and an unchanged price gives zero, both under MIN_DISCOUNT_PERCENT,
         *   so both already return the cleared record. The branch is kept as the
         *   rule a reader looks for first — see the module — and this note is
         *   here so nobody deletes the percentage check believing the branch
         *   covers it. The BEHAVIOUR below is load-bearing either way.
         */
        expect(priceReductionPatch(8_000, 12_000, NOW))
            .toEqual({ previousPrice: null, priceReducedAt: null });
    });

    it('AND RE-SAVING AN UNCHANGED PRICE DOES NOT RENEW THE WINDOW', () => {
        //   Otherwise every edit extends the offer and the section fills up
        //   permanently — the failure mode of every "deals" page.
        expect(priceReductionPatch(8_000, 8_000, NOW))
            .toEqual({ previousPrice: null, priceReducedAt: null });
    });

    it('AND A FIRST LISTING IS NOT A CUT', () => {
        expect(priceReductionPatch(undefined, 5_000, NOW)).toBeNull();
        expect(priceReductionPatch(0, 5_000, NOW)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#867 — and how long it stays an offer', () => {
    const cut = (days: number) => ({ previousPrice: 10_000, priceReducedAt: daysAgo(days) });

    it('A RECENT CUT IS A HOT DEAL', () => {
        expect(isOnOffer(cut(1), 8_000, NOW)).toBe(true);
    });

    it('AND AN OLD ONE IS NOT', () => {
        /*
         *   A cut made in March is not a flash sale in September. THE VERDICT IS
         *   COMPUTED, not stored, so it expires by itself — no sweep, no cron,
         *   and nothing to forget to run. A stored `isFlashSale: true` would be
         *   a flag nothing ever clears, which is #624's shape.
         */
        expect(isOnOffer(cut(OFFER_WINDOW_DAYS + 1), 8_000, NOW)).toBe(false);
    });

    it('AND THE BOUNDARY BELONGS TO THE OFFER', () => {
        expect(isOnOffer(cut(OFFER_WINDOW_DAYS), 8_000, NOW)).toBe(true);
    });

    it('AND A RECORD WHOSE CURRENT PRICE HAS RISEN IS NOT AN OFFER', () => {
        //   Belt to the patch's braces: even if a clear were ever missed, a row
        //   whose price now exceeds its "previous" cannot read as a discount.
        expect(isOnOffer(cut(1), 12_000, NOW)).toBe(false);
    });

    it('AND A FUTURE OR UNREADABLE TIMESTAMP IS REFUSED', () => {
        //   A future date would outlast every window; an unparseable one would
        //   sit in the section forever. Both fail closed.
        expect(isOnOffer({ previousPrice: 10_000, priceReducedAt: daysAgo(-5) }, 8_000, NOW)).toBe(false);
        expect(isOnOffer({ previousPrice: 10_000, priceReducedAt: 'soon' }, 8_000, NOW)).toBe(false);
    });

    it('AND THE DISCOUNT IS REPORTED AS A WHOLE PERCENTAGE', () => {
        expect(discountPercent(cut(1), 8_000)).toBe(20);
        expect(discountPercent(null, 8_000)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#867 — the two collections keep their price differently', () => {
    it('A PRODUCT\'S RETAIL PRICE IS READ BY NAME, not by position', () => {
        /*
         *   `pricingTiers` is built conditionally — bulk and export are pushed
         *   only when the seller offers them — so `[0]` is retail today by
         *   construction and by nothing that would survive a reorder.
         */
        const tiers = [
            { type: 'bulk', price: 500, minQuantity: 50 },
            { type: 'retail', price: 900, minQuantity: 1 },
        ];
        expect(retailPriceOf(tiers)).toBe(900);
    });

    it('AND A MISSING OR MALFORMED TIER LIST IS NOT A PRICE', () => {
        expect(retailPriceOf(undefined)).toBeNull();
        expect(retailPriceOf([{ type: 'bulk', price: 500 }])).toBeNull();
        expect(retailPriceOf([{ type: 'retail', price: 0 }])).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#867 — and every end of it is wired', () => {
    it('THE MARKETPLACE EDIT RECORDS THE CUT, comparing against the stored row', () => {
        /*
         *   `productData` is the row as stored, read for the ownership check.
         *   Comparing against anything the REQUEST carried is exactly what the
         *   sibling route blocks `originalPrice` to prevent.
         */
        const src = code('src/app/actions/marketplace/_mp_products.ts');
        const at = src.indexOf('priceReductionPatch(');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 160)).toContain('productData?.pricingTiers');
    });

    it('AND IT IS ON THE UPDATE PATH, not the create path', () => {
        //   A create has no previous price, so the call belongs after
        //   _updateProductAction begins. It landed in the create action first,
        //   where it could only ever be a no-op.
        const src = code('src/app/actions/marketplace/_mp_products.ts');

        expect(src.indexOf('priceReductionPatch('))
            .toBeGreaterThan(src.indexOf('async function _updateProductAction'));
    });

    it('AND THE PRODUCT SCHEMA DECLARES THE FIELDS — z.object strips the rest', () => {
        /*
         *   THE SILENT DROP. Every product reaching a buyer goes through
         *   serializeProduct → ProductSchema. Without these two lines the write
         *   above is perfect and no screen ever receives it.
         */
        const src = code('src/lib/validations/marketplace.ts');

        expect(src).toContain('previousPrice: z.number().nullable().optional()');
        expect(src).toContain('priceReducedAt: z.string().nullable().optional()');
    });

    it('AND THE LAND EDIT RECORDS IT TOO, against the stored listing', () => {
        const src = code('src/app/actions/land-actions.ts');
        const at = src.indexOf('priceReductionPatch(');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 120)).toContain('listingData.price');
    });

    it('AND THE PUBLIC LAND PAYLOAD DOES NOT STRIP THEM', () => {
        /*
         *   Checked rather than assumed. stripInternalLandFields is a DENYLIST,
         *   so anything it does not name survives — but if it had been an
         *   allowlist the Farm Nation half would have been dead on arrival, in
         *   exactly the way ProductSchema nearly was.
         */
        const visibility = code('src/lib/land-visibility.ts');

        expect(visibility).not.toContain('previousPrice');
        expect(visibility).not.toContain('priceReducedAt');
    });

    it('AND THE MARKETPLACE TAB SHOWS BOTH SOURCES', () => {
        /*
         *   "ensure the section on marketplace is properly wired". The tab held
         *   only Village Market rows; it holds reduced products now as well.
         */
        const src = code('src/app/marketplace/buyer/products/BuyerProductsClient.tsx');

        expect(src).toContain('isHotDeal');
        expect(src).toMatch(/isFlashSale === true \|\| \(p as any\)\.isHotDeal === true/);
    });

    it('AND A HOT DEAL KEEPS ITS OWN CATEGORY, unlike a Village Market item', () => {
        /*
         *   The reason it is `isHotDeal` and not `isFlashSale`. The filters use
         *   isFlashSale to mean "belongs ONLY in that tab", so reusing it would
         *   have pulled a discounted bag of tomatoes out of Vegetables.
         */
        const src = code('src/app/marketplace/buyer/products/BuyerProductsClient.tsx');
        const at = src.indexOf('const displayedProducts');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 500);
        //   The exclusion below the flash-sales branch names isFlashSale alone.
        expect(block).toContain('if ((p as any).isFlashSale) return false;');
        expect(block).not.toContain('if ((p as any).isHotDeal) return false;');
    });

    it('AND FARM NATION HAS THE SECTION IT NEVER HAD', () => {
        const src = code('src/app/farm-nation/properties/PropertiesClient.tsx');

        expect(src).toContain('hotDealsOnly');
        expect(src).toContain('isOnOffer(');
    });

    it('AND BOTH SCREENS SHOW THE OLD PRICE AND THE PERCENTAGE', () => {
        //   A reduction nobody can see is the same as no reduction. Asserted on
        //   both, because one of two is the shape this audit keeps finding.
        for (const rel of [
            'src/app/marketplace/buyer/products/BuyerProductsClient.tsx',
            'src/app/farm-nation/properties/PropertiesClient.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, struck: src.includes('line-through') }).toEqual({ rel, struck: true });
            expect({ rel, pct: /% OFF/.test(src) }).toEqual({ rel, pct: true });
        }
    });

    it('AND NOBODY WRITES A STORED isFlashSale FLAG ON AN ORDINARY PRODUCT', () => {
        /*
         *   The rule that keeps this from rotting. A boolean written at
         *   reduction time is a badge nothing ever clears: the window passes and
         *   the flag remains. The facts are stored; the verdict is computed.
         */
        const src = code('src/app/actions/marketplace/_mp_products.ts');

        expect(src).not.toMatch(/isFlashSale:\s*true/);
        expect(src).not.toMatch(/isHotDeal:\s*true/);
    });
});
