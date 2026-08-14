/**
 * @jest-environment node
 */

/**
 * The marketplace action surface, pinned across the split of _actions.ts.
 *
 * WHAT HAPPENED
 * -------------
 * src/app/actions/marketplace/_actions.ts was 2,434 lines, second-largest in
 * the repository after admin.ts. It is now six files by domain, behind the
 * barrel that was already there:
 *
 *     _mp_seller_verification.ts   588
 *     _mp_catalog.ts               538
 *     _mp_onboarding.ts            444
 *     _mp_products.ts              444
 *     _mp_seller_dashboard.ts      386
 *     _mp_buyer_dashboard.ts       122
 *
 * Like admin.ts, it split because none of the 23 private implementations called
 * any other — the only references between declarations were wrapper-to-body
 * pairs, one alias (getProductAction → getProductByIdAction) and one lookup
 * table used by search. Every function body is what it was.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The barrel re-exports with `export *`, which is convenient and silent: a name
 * that stops being exported from a domain file simply stops being exported from
 * the barrel, with nothing to fail until a page imports it. The list below is
 * the export surface at the commit before the split, taken from the file.
 *
 * WHAT THE SPLIT REVEALED
 * -----------------------
 * The five public catalog actions now sit alone in _mp_catalog.ts, and
 * action-security-audit.test.ts immediately flagged the file as having no
 * session guard. It was right, and it had been unable to say so before: the
 * file-level check had been passing on the *guarded neighbours* those five
 * shared a file with. action-auth-baseline.json has always recorded them
 * per-function as public. They are now one file and one documented exemption.
 */

import { describe, it, expect } from '@jest/globals';

/** _actions.ts's exports at a17dd50c, the commit before the split. */
const EXPECTED_ACTIONS = [
    'checkMarketplaceAccessAction',
    'checkMarketplaceStatusAction',
    'createProductAction',
    'deleteProductAction',
    'getBuyerOrdersAction',
    'getBuyerStatsAction',
    'getMarketplaceProductsAction',
    'getProductAction',
    'getProductByIdAction',
    'getRecommendedProductsAction',
    'getRelatedProductsAction',
    'getSellerAnalyticsAction',
    'getSellerOrdersAction',
    'getSellerProductsAction',
    'getSellerVerificationAction',
    'grantSellerVerifiedBadgeAction',
    'resubmitSellerVerificationAction',
    'revokeSellerVerifiedBadgeAction',
    'searchProductsAction',
    'submitMarketplaceOnboardingAction',
    'submitSellerVerificationAction',
    'updateProductAction',
    'updateSellerCategoryAction',
].sort();

/** Types are erased at runtime; tsc is what pins these. Listed for the record. */
const EXPECTED_TYPES = [
    'ProductActionState',
    'ProductFormData',
    'SellerVerificationFormData',
    'SellerVerificationState',
];

describe('the marketplace barrel exports what _actions.ts exported', () => {
    it('every action is still reachable at @/app/actions/marketplace', async () => {
        // THE test. `export *` loses a name silently.
        const mod: Record<string, unknown> = await import('@/app/actions/marketplace');

        const missing = EXPECTED_ACTIONS.filter((name) => !(name in mod));

        expect(missing).toEqual([]);
    });

    it('and each one is callable', async () => {
        // Vacuity guard: `name in mod` passes for a name exported as undefined.
        const mod: Record<string, unknown> = await import('@/app/actions/marketplace');

        const notFunctions = EXPECTED_ACTIONS.filter((name) => typeof mod[name] !== 'function');

        expect(notFunctions).toEqual([]);
    });

    it('the count is the 23 the old file had', () => {
        expect(EXPECTED_ACTIONS).toHaveLength(23);
        expect(EXPECTED_TYPES).toHaveLength(4);
    });
});

describe('the domain files keep the shape the audits expect', () => {
    const DOMAIN_FILES = [
        '_mp_onboarding.ts',
        '_mp_seller_verification.ts',
        '_mp_products.ts',
        '_mp_catalog.ts',
        '_mp_seller_dashboard.ts',
        '_mp_buyer_dashboard.ts',
    ];

    function read(name: string): string {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        return readFileSync(join(process.cwd(), 'src/app/actions/marketplace', name), 'utf-8');
    }

    it('"use server" is the first line of each', () => {
        // Not merely present. A directive that is not the first statement is
        // not a directive, and the file quietly stops being a server module —
        // which tsc and jest both pass over.
        for (const file of DOMAIN_FILES) {
            const first = read(file).split('\n')[0].trim();
            expect(`${file}: ${first}`).toBe(`${file}: "use server";`);
        }
    });

    it('every file except the public catalog guards its actions', () => {
        for (const file of DOMAIN_FILES) {
            if (file === '_mp_catalog.ts') continue; // Public storefront, exempted by name.
            const src = read(file);
            const guarded =
                src.includes('requireSession') || src.includes('requireAdmin') || src.includes('auth()');
            expect(`${file}: ${guarded}`).toBe(`${file}: true`);
        }
    });

    it('the catalog is public on purpose, and says so somewhere', () => {
        // If this file ever gains a guard, the exemption should go with it.
        const audit = (() => {
            const { readFileSync } = require('fs');
            const { join } = require('path');
            return readFileSync(
                join(process.cwd(), 'src/__tests__/unit/action-security-audit.test.ts'),
                'utf-8'
            );
        })();

        expect(audit).toContain('app/actions/marketplace/_mp_catalog.ts');
        expect(audit).toContain('Public product browsing');
    });

    it('the old file is gone', () => {
        const { existsSync } = require('fs');
        const { join } = require('path');

        expect(existsSync(join(process.cwd(), 'src/app/actions/marketplace/_actions.ts'))).toBe(false);
    });
});
