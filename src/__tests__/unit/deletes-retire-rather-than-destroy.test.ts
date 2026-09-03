/**
 * @jest-environment node
 */

/**
 *   #301 FOUR DELETE DOORS DESTROYED ROWS THEIR OWN MODULE ALREADY KNEW HOW TO
 *        RETIRE.
 *
 *        Owner decision: nothing is deleted, the code gets fixed and the data
 *        stays recoverable. #300 applied that to the erasure path. This is the
 *        catalogues, and in three of the four cases the retirement convention
 *        was ALREADY THERE and the destructive door ignored it:
 *
 *          EXPORT_CATALOG  deleteExportCatalogAction (admin) writes
 *                          { isActive: false, deletedAt, deletedBy }, and both
 *                          the public catalogue route and the catalogue stats
 *                          query isActive == true. deleteExportProductAction —
 *                          the SELLER's door on the same collection — called
 *                          .delete().
 *
 *          LAND_LISTINGS   land-listing-status.ts declares "deleted" in the
 *                          vocabulary and its own header says "delete sets
 *                          `deleted`". No reader admits that status.
 *                          _deleteLandListingAction called .delete() anyway, so
 *                          the vocabulary described a soft delete the code had
 *                          stopped performing.
 *
 *          PRODUCTS        every buyer-facing query filters status == "active".
 *                          Both doors — the action and
 *                          api/marketplace/delete-product — called .delete().
 *
 *        WHY IT IS NOT JUST A PRINCIPLE. These rows are pointed AT. Orders store
 *        productIds; export payments read EXPORT_CATALOG.doc(item.productId);
 *        farm-nation settlement reads LAND_LISTINGS.doc(propertyId). This
 *        adapter does not raise on a dangling reference — update() on a missing
 *        document is a documented SILENT NO-OP.
 *
 *        The sharp end is order-management.ts, which returns stock to
 *        PRODUCTS.doc(item.productId) when an order is cancelled or refunded.
 *        Delete the product first and that write does nothing, raises nothing,
 *        and the cancellation reports success: the buyer is refunded and the
 *        stock is never restored.
 *
 * HOW THIS IS TESTED
 * ------------------
 * The marketplace door is EXECUTED against the fake database, because that is
 * the claim that matters: after calling it, the row is still there. The source
 * assertions below cover the other three doors and the readers, and exist so
 * that a fifth door added later cannot quietly call .delete() again.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { retirementPatch, isRetired } from '@/lib/record-retirement';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
    updateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const PRODUCT = 'product-1';

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#301 — the marketplace delete, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: SELLER, email: 's@e.com', roles: ['seller'] } },
        });
        store.seed(COLLECTIONS.PRODUCTS, PRODUCT, {
            sellerId: SELLER,
            title: 'Dried Hibiscus, 50kg',
            status: 'active',
            availableQuantity: 40,
        });
    });

    it('THE ROW SURVIVES — this is the whole point', async () => {
        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');

        const res: any = await deleteProductAction(PRODUCT);

        expect(res.success).toBe(true);
        // Destroyed, this is undefined and every order pointing here dangles.
        expect(store.get(COLLECTIONS.PRODUCTS, PRODUCT)).toBeDefined();
    });

    it('and it leaves the buyer catalogue, because that filters status == active', async () => {
        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');

        await deleteProductAction(PRODUCT);

        expect(store.get(COLLECTIONS.PRODUCTS, PRODUCT)?.status).toBe('archived');
    });

    it('THE QUANTITY IS UNTOUCHED, so a cancellation can still restore stock', async () => {
        // order-management.ts returns stock with an update() on this row. That
        // is the write that silently did nothing when the row was destroyed.
        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');

        await deleteProductAction(PRODUCT);

        expect(store.get(COLLECTIONS.PRODUCTS, PRODUCT)?.availableQuantity).toBe(40);
        expect(store.get(COLLECTIONS.PRODUCTS, PRODUCT)?.title).toBe('Dried Hibiscus, 50kg');
    });

    it('and it records who retired it, and what it used to say', async () => {
        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');

        await deleteProductAction(PRODUCT);
        const row = store.get(COLLECTIONS.PRODUCTS, PRODUCT)!;

        expect(row.retired).toBe(true);
        expect(row.retiredBy).toBe(SELLER);
        // Without this, an accidental retirement can only be undone by guessing.
        expect(row.statusBeforeRetirement).toBe('active');
    });

    it('a seller still cannot retire somebody else’s product', async () => {
        // The ownership check has to survive the change — retiring another
        // seller's listing is as bad as deleting it.
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'someone-else', email: 'x@e.com', roles: ['seller'] } },
        });
        store.seed(COLLECTIONS.USERS, 'someone-else', { roles: ['seller'] });

        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');
        const res: any = await deleteProductAction(PRODUCT);

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.PRODUCTS, PRODUCT)?.status).toBe('active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#301 — no door destroys a row', () => {
    const DOORS: Array<[string, string]> = [
        ['the marketplace action', 'src/app/actions/marketplace/_mp_products.ts'],
        ['the marketplace API route', 'src/app/api/marketplace/delete-product/route.ts'],
        ['the export seller door', 'src/app/actions/export-products.ts'],
        ['the land listing door', 'src/app/actions/land-listings.ts'],
    ];

    it.each(DOORS)('%s calls no .delete()', (_name, path) => {
        expect(code(path)).not.toMatch(/\.delete\(\)/);
    });

    it('THE EXPORT DOOR USES THE CONVENTION ITS OWN ADMIN DOOR ALREADY HAD', () => {
        // isActive is what api/export/catalog and the catalogue stats query.
        // Anything else would hide the product from neither.
        const src = code('src/app/actions/export-products.ts');
        const admin = code('src/app/actions/export-admin.ts');

        expect(admin).toMatch(/isActive: false/);
        expect(src).toMatch(/isActive: false/);
    });

    it('THE LAND DOOR USES THE STATUS THE VOCABULARY ALREADY DECLARED', () => {
        const src = code('src/app/actions/land-listings.ts');
        const vocabulary = code('src/lib/land-listing-status.ts');

        expect(src).toMatch(/status: "deleted"/);
        // And that status must remain one no buyer-facing list admits.
        expect(vocabulary).toMatch(/\|\s*"deleted"/);
        const purchasable = vocabulary.slice(
            vocabulary.indexOf('PURCHASABLE_STATUSES'),
            vocabulary.indexOf('BROWSABLE_STATUSES'),
        );
        expect(purchasable).not.toMatch(/"deleted"/);
    });

    it('and every door records the shared bookkeeping', () => {
        for (const [, path] of DOORS) {
            expect({ path, uses: code(path).includes('retirementPatch(') })
                .toEqual({ path, uses: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#301 — the lists that query by owner hide what was retired', () => {
    /**
     * The readers that filter on a status need no change. These three query by
     * owner and nothing else, so without a filter the owner would press delete
     * and watch the row stay — which is a worse outcome than the destruction it
     * replaced, because it looks like the button is broken.
     */
    it('the seller product list filters retired rows', () => {
        expect(code('src/app/actions/marketplace/_mp_seller_dashboard.ts'))
            .toMatch(/isRetired\(/);
    });

    it('the seller export list filters retired rows', () => {
        expect(code('src/app/actions/export-products.ts'))
            .toMatch(/\.filter\(doc => !isRetired\(doc\.data\(\)\)\)/);
    });

    it('the farm-nation owner dashboard filters deleted listings', () => {
        expect(code('src/app/actions/farm-nation/_fn_dashboard.ts'))
            .toMatch(/status !== 'deleted'/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#301 — the shared bookkeeping', () => {
    it('names who, when, and what the row said before', () => {
        const patch = retirementPatch('admin-9', 'active');

        expect(patch.retired).toBe(true);
        expect(patch.retiredBy).toBe('admin-9');
        expect(patch.retiredAt).toEqual(expect.any(String));
        expect(patch.statusBeforeRetirement).toBe('active');
    });

    it('copes with a row that had no status at all', () => {
        expect(retirementPatch('admin-9').statusBeforeRetirement).toBeNull();
        expect(retirementPatch('admin-9', undefined).statusBeforeRetirement).toBeNull();
    });

    it('carries nothing else, so it cannot overwrite the row it marks', () => {
        expect(Object.keys(retirementPatch('a', 'b')).sort())
            .toEqual(['retired', 'retiredAt', 'retiredBy', 'statusBeforeRetirement']);
    });

    it('isRetired is true only for a row actually retired', () => {
        expect(isRetired({ retired: true })).toBe(true);
        expect(isRetired({ retired: false })).toBe(false);
        expect(isRetired({})).toBe(false);
        expect(isRetired(undefined)).toBe(false);
        expect(isRetired(null)).toBe(false);
        // Not a truthiness check: a string would be a shape nothing writes.
        expect(isRetired({ retired: 'yes' } as any)).toBe(false);
    });
});
