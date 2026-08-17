/**
 * The "Verified" shield that had nothing to do with verification.
 *
 * marketplace/buyer/products/page.tsx renders a verified-seller shield from
 * `product.sellerVerified`. That value reached it three ways, and none of them
 * was the seller's badge at the time of display.
 *
 * 1. A SNAPSHOT THAT NEVER REFRESHED
 *    _createProductAction copies SELLER_VERIFICATIONS.isVerifiedBadge onto the
 *    product when the product is created. _toggleVerifiedBadgeAction writes the
 *    badge to the verification record and to the user document, and touches no
 *    products.
 *
 *    Granting the badge therefore did not add it to listings the seller already
 *    had — while the grant email says, verbatim, "The badge will now appear on
 *    your storefront and product listings". And revoking it did not remove it
 *    from any product created while they held it. Revocation did not revoke.
 *
 * 2. AN ARBITRARY VERIFICATION ROW
 *    The copy read `verificationSnap.docs[0]` from an unordered query, so a
 *    seller with several verification records got whichever row came back first.
 *
 * 3. A LITERAL `true`
 *    Both flash-sale mappers — _mp_catalog.ts and the buyer products page —
 *    hardcoded `sellerVerified: true`, so every Village Market listing claimed a
 *    verified seller. They also hardcoded `rating: 5` alongside
 *    `reviewCount: 0`; the card renders a rating only when `rating > 0`, so each
 *    showed a perfect score with nothing behind it, and "Highest Rated" sorting
 *    put all of them above real products rated below 5.
 *
 * AND ONE MORE, IN THE PUBLIC API
 * -------------------------------
 * api/marketplace/products returned `verified: data.verified !== false`.
 * `verified` is a LAND-listing field; no writer of the products collection sets
 * it. So the expression was `undefined !== false` and the endpoint reported
 * every product it has ever served as verified. A missing field became an
 * assertion.
 *
 * ProductSchema already defaulted all three of these correctly (rating 0,
 * sellerVerified false, sellerName "Easy Sales Seller"). Every defect above is a
 * mapper overriding a safe default with a claim.
 *
 * THE NAME, SEPARATELY
 * --------------------
 * The fallback for a seller with no name was the string "Verified Seller" in six
 * places, so an unnamed seller was labelled verified in the name field itself,
 * independently of any badge. There were four spellings of that fallback in all
 * — "Verified Seller", "Unknown Seller", "Easy Sales Seller" and the schema
 * default. One now, and it claims nothing.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    resolveSellerTrust,
    newestVerification,
    hydrateSellerTrust,
    SELLER_NAME_FALLBACK,
} from '@/lib/seller-trust';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the rule', () => {
    it('reads the badge from the user document', () => {
        expect(resolveSellerTrust({ isVerifiedBadge: true, businessName: 'Kusu Farms' })).toEqual({
            sellerName: 'Kusu Farms',
            sellerVerified: true,
        });
    });

    it('treats an absent seller as UNVERIFIED, not as unknown-so-allow', () => {
        // The direction that matters. A deleted or unreadable account must not
        // inherit a trust marker — which is exactly what `data.verified !== false`
        // did in the public API.
        for (const absent of [null, undefined, {}]) {
            expect(resolveSellerTrust(absent as any).sellerVerified).toBe(false);
        }
    });

    it('requires the badge to be strictly true', () => {
        // A truthy string or 1 in that column is a data problem, not a badge.
        for (const truthy of ['true', 1, 'yes', {}]) {
            expect(resolveSellerTrust({ isVerifiedBadge: truthy } as any).sellerVerified).toBe(false);
        }
        expect(resolveSellerTrust({ isVerifiedBadge: false }).sellerVerified).toBe(false);
    });

    it('falls back to a name that claims nothing', () => {
        expect(resolveSellerTrust({}).sellerName).toBe(SELLER_NAME_FALLBACK);
        expect(SELLER_NAME_FALLBACK).not.toMatch(/verified/i);
    });

    it('prefers businessName, then displayName, then name', () => {
        expect(resolveSellerTrust({ businessName: 'B', displayName: 'D', name: 'N' }).sellerName).toBe('B');
        expect(resolveSellerTrust({ displayName: 'D', name: 'N' }).sellerName).toBe('D');
        expect(resolveSellerTrust({ name: 'N' }).sellerName).toBe('N');
    });
});

describe('picking the verification that decides', () => {
    it('takes the newest, not the first row returned', () => {
        // THE defect: `docs[0]` from a query with no orderBy.
        const rows = [
            { createdAt: new Date('2026-01-01'), isVerifiedBadge: true, tag: 'old' },
            { createdAt: new Date('2026-08-01'), isVerifiedBadge: false, tag: 'new' },
        ];

        expect(newestVerification(rows)?.tag).toBe('new');
    });

    it('handles the three createdAt shapes this codebase writes', () => {
        const toMillis = { createdAt: { toMillis: () => Date.parse('2026-08-01') }, tag: 'firestore' };
        const seconds = { createdAt: { seconds: Date.parse('2026-01-01') / 1000 }, tag: 'raw' };
        const iso = { createdAt: '2026-04-01T00:00:00.000Z', tag: 'string' };

        expect(newestVerification([seconds, toMillis, iso])?.tag).toBe('firestore');
        expect(newestVerification([seconds, iso])?.tag).toBe('string');
    });

    it('returns null for no rows rather than throwing', () => {
        expect(newestVerification([])).toBeNull();
    });

    it('does not mutate the caller\'s array', () => {
        const rows = [{ createdAt: '2026-01-01', tag: 'a' }, { createdAt: '2026-08-01', tag: 'b' }];
        newestVerification(rows);
        expect(rows[0].tag).toBe('a');
    });
});

describe('hydrating a list', () => {
    it('overwrites the stale per-product copy with the live badge', async () => {
        // THE test for defect 1. The product says true because that is what the
        // seller's badge was when it was listed; the badge has since been revoked.
        const products = [{ id: 'p1', sellerId: 's1', sellerName: 'Old Name', sellerVerified: true }];

        const out = await hydrateSellerTrust(products, async () => ({
            isVerifiedBadge: false,
            businessName: 'Kusu Farms',
        }));

        expect(out[0].sellerVerified).toBe(false);
        expect(out[0].sellerName).toBe('Kusu Farms');
    });

    it('grants it too, so a new badge reaches existing listings', async () => {
        // The other direction, which the grant email promises.
        const products = [{ id: 'p1', sellerId: 's1', sellerVerified: false }];

        const out = await hydrateSellerTrust(products, async () => ({ isVerifiedBadge: true }));

        expect(out[0].sellerVerified).toBe(true);
    });

    it('reads once per unique seller, not once per product', async () => {
        // The search path did one read per product with no denormalised name and
        // its own comment asked for this. Four products, two sellers, two reads.
        const seen: string[] = [];
        const products = [
            { id: 'p1', sellerId: 's1' },
            { id: 'p2', sellerId: 's1' },
            { id: 'p3', sellerId: 's2' },
            { id: 'p4', sellerId: 's2' },
        ];

        await hydrateSellerTrust(products, async (id) => {
            seen.push(id);
            return { isVerifiedBadge: true };
        });

        expect(seen.sort()).toEqual(['s1', 's2']);
    });

    it('drops the badge when the seller read throws', async () => {
        // A failed read is not a verified seller. Without this the catch could
        // just as easily leave the stale `true` in place.
        const products = [{ id: 'p1', sellerId: 's1', sellerVerified: true }];

        const out = await hydrateSellerTrust(products, async () => {
            throw new Error('network');
        });

        expect(out[0].sellerVerified).toBe(false);
    });

    it('drops the badge on a product with no sellerId at all', async () => {
        const out = await hydrateSellerTrust(
            [{ id: 'p1', sellerVerified: true } as any],
            async () => ({ isVerifiedBadge: true }),
        );

        expect(out[0].sellerVerified).toBe(false);
    });

    it('keeps the product\'s own name when the seller account has none', async () => {
        // Vacuity guard on the name half: replacing a real denormalised name with
        // the generic fallback would be a regression dressed as a fix.
        const out = await hydrateSellerTrust(
            [{ id: 'p1', sellerId: 's1', sellerName: 'Kusu Farms' }],
            async () => ({ isVerifiedBadge: false }),
        );

        expect(out[0].sellerName).toBe('Kusu Farms');
    });
});

/**
 * EVERY product reader, found rather than listed.
 *
 * WHY THIS IS A SCAN AND NOT A LIST
 * ---------------------------------
 * The first version of this suite named three files — _mp_catalog.ts,
 * village-market.ts and the products API — and asserted each hydrated. All three
 * did. It still missed:
 *
 *   _buyer.ts::getProductsAction        the action /marketplace/buyer/products
 *                                       actually calls. That page renders the
 *                                       verified shield, so the reader feeding
 *                                       the page the defect was reported against
 *                                       was the one reader not fixed.
 *   _buyer.ts::getFeaturedProductsAction
 *   _buyer.ts::getProductsByCategoryAction
 *   _mp_catalog.ts::getProductByIdAction — the NON-flash branch. The flash branch
 *                                       was fixed; the ordinary one, which is the
 *                                       product detail page, was not.
 *   _mp_catalog.ts::getRecommendedProductsAction
 *   _mp_catalog.ts::getRelatedProductsAction
 *
 * Six readers, in the two files that had already been "fixed". A hand-written
 * list of call sites is exactly as reliable as the person writing it, which is
 * the lesson every scanner in this repository exists for.
 *
 * So: find every function that queries the products collection for display, and
 * require each to resolve the badge. A new reader fails until it does.
 */
describe('every product reader resolves the badge', () => {
    const READER_FILES = [
        'src/app/actions/marketplace/_buyer.ts',
        'src/app/actions/marketplace/_mp_catalog.ts',
        'src/app/actions/village-market.ts',
        'src/app/api/marketplace/products/route.ts',
    ];

    /**
     * Function bodies in a file that query PRODUCTS or FLASH_SALE_PRODUCTS for
     * display, keyed by name.
     *
     * A `.count()` aggregation is not a display read — it returns a number, and
     * there is nothing to attach a badge to.
     */
    function readersIn(rel: string): Array<{ name: string; body: string }> {
        const src = code(rel);
        const out: Array<{ name: string; body: string }> = [];

        const fnPattern = /(?:async function|export async function)\s+(\w+)/g;
        const starts: Array<{ name: string; at: number }> = [];
        for (const m of src.matchAll(fnPattern)) {
            starts.push({ name: m[1], at: m.index ?? 0 });
        }

        starts.forEach((s, i) => {
            const body = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
            const queriesProducts =
                /COLLECTIONS\.(PRODUCTS|FLASH_SALE_PRODUCTS)/.test(body) &&
                !/\.count\(\)/.test(body);
            // Writers and stock adjusters are not display reads.
            const isWrite = /\.(set|add)\(|\.update\(\s*\{/.test(body);

            // Must return something Product-SHAPED.
            //
            // `\bProduct\b` does not match "FlashSaleProduct" — there is no word
            // boundary before "Product" in it — and that distinction is the
            // point. getVillageMarketEventAction returns raw FlashSaleProduct
            // rows, which carry no sellerName or sellerVerified for anything to
            // resolve, and its page renders no seller at all. Requiring it to
            // hydrate would be N reads for a field nobody displays.
            //
            // If such a row is ever mapped into Product shape, that happens in
            // the CALLER — which is where `sellerVerified: true` was hardcoded,
            // and those mappers now read the value through instead.
            // A fixed prefix, not "up to the first brace": these signatures are
            // `Promise<ActionResponse<{ products: Product[] }>>`, so the first
            // `{` lands INSIDE the return type and cutting there hid the word
            // `Product` from the test — which reported one reader instead of
            // seven and would have passed the real assertion vacuously.
            const signature = body.slice(0, 400);
            const returnsProducts = /\bProduct\b/.test(signature);

            if (queriesProducts && !isWrite && returnsProducts) out.push({ name: s.name, body });
        });

        return out;
    }

    it('finds readers to check (sanity)', () => {
        const total = READER_FILES.flatMap(readersIn).length;
        // If the parser stops finding functions, every assertion below passes
        // vacuously — which is exactly how the hand-written list failed.
        expect(total).toBeGreaterThanOrEqual(6);
    });

    it('and every one of them resolves the seller badge', () => {
        const offenders: string[] = [];

        for (const rel of READER_FILES) {
            for (const { name, body } of readersIn(rel)) {
                const resolves =
                    body.includes('hydrateSellerTrust(') || body.includes('resolveSellerTrust(');
                if (!resolves) offenders.push(`${rel} :: ${name}`);
            }
        }

        if (offenders.length > 0) {
            throw new Error(
                `\n\n⚠️  ${offenders.length} product reader(s) serve the product document's own\n` +
                `sellerVerified, which is a snapshot taken when the product was created:\n\n` +
                offenders.map((o) => `  ${o}`).join('\n') +
                `\n\nGranting the badge does not reach these, and revoking it does not\n` +
                `remove it. Call hydrateSellerTrust (lists) or resolveSellerTrust (one\n` +
                `product) before returning. See lib/seller-trust.ts.\n`
            );
        }

        expect(offenders).toEqual([]);
    });
});

describe('every read path uses it', () => {
    const CATALOG = 'src/app/actions/marketplace/_mp_catalog.ts';
    const VILLAGE = 'src/app/actions/village-market.ts';
    const API = 'src/app/api/marketplace/products/route.ts';
    const BUYER = 'src/app/actions/marketplace/_buyer.ts';
    const BUYER_PAGE = 'src/app/marketplace/buyer/products/page.tsx';

    it.each([CATALOG, VILLAGE, API, BUYER])('%s hydrates the badge', (rel: string) => {
        expect(code(rel)).toContain('hydrateSellerTrust(');
    });

    it('no mapper hardcodes sellerVerified: true any more', () => {
        // THE test for defect 3, on both mappers.
        for (const rel of [CATALOG, BUYER_PAGE]) {
            expect(code(rel)).not.toMatch(/sellerVerified:\s*true/);
        }
    });

    it('and no mapper hardcodes a five-star rating', () => {
        for (const rel of [CATALOG, BUYER_PAGE]) {
            expect(code(rel)).not.toMatch(/rating:\s*5(\.0)?\s*,/);
        }
    });

    it('the buyer page takes both values from the server', () => {
        // It has no seller data of its own, so inventing one was the only way it
        // could have had a value. Checking the specific expressions, because
        // `sellerVerified: false` would also satisfy the assertion above while
        // hiding every real badge.
        const src = code(BUYER_PAGE);

        expect(src).toContain('sellerVerified: fp.sellerVerified === true');
        expect(src).toContain('sellerName: fp.sellerName || SELLER_NAME_FALLBACK');
    });

    it('the public API no longer defaults its verified flag to true', () => {
        const src = code(API);

        expect(src).not.toContain('data.verified !== false');
        expect(src).toContain('verified: p.sellerVerified === true');
    });

    it('the product create path picks the newest verification', () => {
        const src = code('src/app/actions/marketplace/_mp_products.ts');

        expect(src).toContain('newestVerification(');
        expect(src).not.toContain('verificationSnap.docs[0].data()');
    });
});

describe('the name fallback has one spelling', () => {
    it('"Verified Seller" is gone from every product path', () => {
        // Six sites used it as a missing-name fallback. The one surviving use is
        // a title attribute on the shield itself, which is a label for a badge
        // that is now actually resolved — not a name.
        const paths = [
            'src/app/actions/marketplace/_mp_catalog.ts',
            'src/app/actions/marketplace/_mp_products.ts',
            'src/app/actions/village-market.ts',
            'src/app/api/marketplace/products/route.ts',
            'src/hooks/useMarketplaceSearch.ts',
            'src/app/marketplace/page.tsx',
        ];

        for (const rel of paths) {
            expect(code(rel)).not.toContain('"Verified Seller"');
        }
    });

    it('and "Unknown Seller" too — it was a fourth spelling', () => {
        expect(code('src/app/actions/marketplace/_mp_catalog.ts')).not.toContain('Unknown Seller');
    });

    it('the shield still has its title, so this did not strip the label', () => {
        // Vacuity guard: a blanket delete of the string would pass the two above
        // and remove the badge's accessible name.
        expect(source('src/app/marketplace/buyer/products/page.tsx')).toContain('title="Verified Seller"');
    });

    it('the schema default agrees with the constant', () => {
        // Two sources for one fallback is how there came to be four.
        expect(code('src/lib/validations/marketplace.ts')).toContain(`default("${SELLER_NAME_FALLBACK}")`);
    });
});
