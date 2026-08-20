/**
 * @jest-environment node
 */

/**
 * Seller product CRUD and the buyer dashboard, EXECUTED.
 *
 * _mp_products.ts was at 18.3% statements and 3.0% branches;
 * _mp_buyer_dashboard.ts at 21.0% / 0%. One finding came out of running them:
 *
 *   #106 _updateProductAction writes `certifications` unconditionally, from a
 *        form field that defaults to "[]" when absent — and the seller edit
 *        page never appends it. So every edit wrote an empty array over
 *        whatever the create path had saved, and the certifications section on
 *        the product page went blank. The same shape threatened `images`: any
 *        caller omitting the image fields wiped every photo. That half was
 *        latent, because the edit form does re-send the URLs.
 *
 * The rest executes rules earlier findings only asserted structurally: one
 * initial status for both creators (#46), the newest verification rather than
 * an arbitrary one, certifications written at all, an edit that cannot
 * republish a suspended listing, and the buyer stats counting only orders that
 * were actually paid for.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { PRODUCT_INITIAL_STATUS } from '@/lib/product-status';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

const uploadFileToStorage = jest.fn(async (_f: unknown, dest: string, _p?: boolean) => `https://cdn.test/${dest}`);
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (f: unknown, d: string, p: boolean) => uploadFileToStorage(f, d, p),
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const PRODUCTS = COLLECTIONS.PRODUCTS;
const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;

function actAs(id: string | null, roles: string[] = ['seller'], name = 'Bola Ade'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: 'bola@example.com', name } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(SELLER);
});

async function actions() {
    return import('@/app/actions/marketplace/_mp_products');
}

const seedSeller = (extra: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.USERS, SELLER, {
        roles: ['seller'], sellerVerificationStatus: 'approved',
        email: 'bola@example.com', ...extra,
    });

/** The fields the create form sends, as a FormData. */
function productForm(over: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const base: Record<string, string> = {
        title: 'Premium Cocoa',
        description: 'Sun-dried cocoa beans from Ondo, graded and bagged for export.',
        category: 'grains',
        unit: 'kg',
        retailPrice: '5000',
        availableQuantity: '100',
        minimumOrderQuantity: '10',
        state: 'Ondo',
        lga: 'Akure',
        nearestMarket: 'Akure Main',
        deliveryMethod: 'pickup',
        bulkAvailable: 'false',
        exportReady: 'false',
        videoUrl: '',
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) fd.append(k, v);
    return fd;
}

const create = async (fd: FormData) =>
    (await (await actions()).createProductAction(null, fd)) as any;
const update = async (fd: FormData) =>
    (await (await actions()).updateProductAction(null, fd)) as any;
const remove = async (id: string) =>
    (await (await actions()).deleteProductAction(id)) as any;

const onlyProduct = () => store.all(PRODUCTS)[0];

// ─────────────────────────────────────────────────────────────────────────────
describe('createProductAction', () => {
    beforeEach(() => { seedSeller(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await create(productForm())).toMatchObject({ success: false });
        expect(store.size(PRODUCTS)).toBe(0);
    });

    it('refuses somebody without the seller role', async () => {
        seedSeller({ roles: ['general_user'] });
        expect(await create(productForm())).toMatchObject({
            success: false, error: 'You must have seller role to create products',
        });
    });

    it('refuses a seller whose verification is not approved', async () => {
        seedSeller({ sellerVerificationStatus: 'pending' });
        expect(await create(productForm())).toMatchObject({
            success: false, error: 'Your seller account must be approved first',
        });
        expect(store.size(PRODUCTS)).toBe(0);
    });

    it('refuses a listing that fails validation, naming the field', async () => {
        const res = await create(productForm({ category: 'not-a-category' }));
        expect(res.success).toBe(false);
        expect(res.error).toContain('category');
        expect(store.size(PRODUCTS)).toBe(0);
    });

    it('names an untitled listing rather than storing an empty string', async () => {
        // The action coerces "" to undefined before validating, so
        // ProductSchema's default applies. Worth pinning: dropping the `||
        // undefined` would store a blank title, and every listing card renders
        // it.
        expect(await create(productForm({ title: '' }))).toMatchObject({ success: true });
        expect(onlyProduct()[1].title).toBe('Untitled Product');
    });

    it('writes ONE initial status, the shared one', async () => {
        // This wrote "pending" while /api/marketplace/create-product wrote
        // "active" and ProductSchema defaults to "draft". Every buyer-facing
        // reader filters on "active", and nothing released a pending product —
        // so this action produced listings no buyer could see.
        expect(await create(productForm())).toMatchObject({ success: true });

        expect(onlyProduct()[1].status).toBe(PRODUCT_INITIAL_STATUS);
    });

    it('records the listing against the SELLER from the session', async () => {
        await create(productForm());

        expect(onlyProduct()[1]).toMatchObject({
            sellerId: SELLER, title: 'Premium Cocoa', unit: 'kg',
            availableQuantity: 100, minimumOrderQuantity: 10,
            views: 0, orders: 0, rating: 0, reviewCount: 0,
        });
    });

    it('SAVES certifications rather than parsing and discarding them', async () => {
        // The write object never mentioned `certifications`, so a seller's
        // certifications were validated and dropped, while the product page has
        // a whole section that renders them.
        const fd = productForm();
        fd.append('certifications', JSON.stringify(['Organic', 'Fair Trade']));

        await create(fd);
        expect(onlyProduct()[1].certifications).toEqual(['Organic', 'Fair Trade']);
    });

    it('survives malformed certifications JSON rather than failing the listing', async () => {
        const fd = productForm();
        fd.append('certifications', 'not json at all');

        expect(await create(fd)).toMatchObject({ success: true });
        expect(onlyProduct()[1].certifications).toEqual([]);
    });

    it('builds the pricing tiers only for the tiers that are enabled', async () => {
        await create(productForm({
            bulkAvailable: 'true', bulkPrice: '4000', bulkMinQuantity: '80',
            exportReady: 'false', exportPrice: '3500',
        }));

        expect(onlyProduct()[1].pricingTiers).toEqual([
            { type: 'retail', price: 5000, minQuantity: 1 },
            { type: 'bulk', price: 4000, minQuantity: 80 },
        ]);
    });

    it('keeps pre-uploaded image URLs and uploads real files', async () => {
        const fd = productForm();
        fd.append('productImages_0', 'https://cdn.test/existing.png');
        fd.append('productImages_1', new File(['x'], 'new.png', { type: 'image/png' }));

        await create(fd);

        expect(onlyProduct()[1].images).toEqual([
            'https://cdn.test/existing.png',
            expect.stringContaining('https://cdn.test/products/'),
        ]);
        expect(uploadFileToStorage).toHaveBeenCalledTimes(1);
    });

    it('takes the NEWEST verification, not whichever row came back first', async () => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            old: { userId: SELLER, isVerifiedBadge: false, sellerCategory: 'retail', createdAt: '2026-01-01T00:00:00.000Z' },
            current: { userId: SELLER, isVerifiedBadge: true, sellerCategory: 'export', createdAt: '2026-03-01T00:00:00.000Z' },
        });

        await create(productForm());

        expect(onlyProduct()[1]).toMatchObject({
            sellerVerified: true, sellerCategory: 'export',
        });
    });

    it('falls back to the session name when there is no store name', async () => {
        await create(productForm());
        expect(onlyProduct()[1].sellerName).toBe('Bola Ade');

        store.seed(COLLECTIONS.VENDOR_PROFILES, SELLER, { storeInfo: { name: 'Ade Farms' } });
        store.seed(PRODUCTS, 'wipe', {});
        await create(productForm());
        expect(store.all(PRODUCTS).some(([, p]) => p.sellerName === 'Ade Farms')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateProductAction', () => {
    const EXISTING = 'product-1';

    const seedProduct = (extra: Record<string, unknown> = {}) =>
        store.seed(PRODUCTS, EXISTING, {
            id: EXISTING, sellerId: SELLER, title: 'Premium Cocoa',
            status: 'active',
            images: ['https://cdn.test/a.png', 'https://cdn.test/b.png'],
            certifications: ['Organic', 'Fair Trade'],
            createdAt: '2026-01-01T00:00:00.000Z',
            ...extra,
        });

    const editForm = (over: Record<string, string> = {}) => {
        const fd = productForm(over);
        fd.append('productId', EXISTING);
        return fd;
    };

    beforeEach(() => { seedSeller(); seedProduct(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await update(editForm())).toMatchObject({ success: false });
    });

    it('refuses without a product id', async () => {
        const fd = productForm();
        expect(await update(fd)).toMatchObject({ success: false, error: 'Product ID is required' });
    });

    it('refuses a product that does not exist', async () => {
        const fd = productForm();
        fd.append('productId', 'nope');
        expect(await update(fd)).toMatchObject({ success: false, error: 'Product not found' });
    });

    it('refuses somebody else\'s product', async () => {
        seedProduct({ sellerId: 'another-seller' });
        expect(await update(editForm())).toMatchObject({
            success: false, error: 'You are not authorized to edit this product',
        });
        expect(store.get(PRODUCTS, EXISTING)?.title).toBe('Premium Cocoa');
    });

    it('KEEPS THE CERTIFICATIONS the edit form does not send', async () => {
        // #106. The seller edit page never appends a certifications field, and
        // this wrote `JSON.parse(formData.get("certifications") ?? "[]")` — an
        // empty array — over whatever the create path had saved. Every edit
        // blanked the certifications section on the product page.
        expect(await update(editForm({ retailPrice: '5500' }))).toMatchObject({ success: true });

        expect(store.get(PRODUCTS, EXISTING)).toMatchObject({
            certifications: ['Organic', 'Fair Trade'],
            pricingTiers: [{ type: 'retail', price: 5500, minQuantity: 1 }],
        });
    });

    it('and REPLACES them when the form does send them', async () => {
        const fd = editForm();
        fd.append('certifications', JSON.stringify(['Rainforest Alliance']));

        await update(fd);
        expect(store.get(PRODUCTS, EXISTING)?.certifications).toEqual(['Rainforest Alliance']);
    });

    it('and CLEARS them when the form sends an empty list on purpose', async () => {
        const fd = editForm();
        fd.append('certifications', JSON.stringify([]));

        await update(fd);
        expect(store.get(PRODUCTS, EXISTING)?.certifications).toEqual([]);
    });

    it('KEEPS THE IMAGES when the form carries no image fields', async () => {
        await update(editForm());

        expect(store.get(PRODUCTS, EXISTING)?.images)
            .toEqual(['https://cdn.test/a.png', 'https://cdn.test/b.png']);
    });

    it('and replaces them with exactly what the form sent', async () => {
        const fd = editForm();
        fd.append('productImages_0', 'https://cdn.test/only-this-one.png');

        await update(fd);
        expect(store.get(PRODUCTS, EXISTING)?.images).toEqual(['https://cdn.test/only-this-one.png']);
    });

    it('does NOT republish a suspended listing', async () => {
        // An edit must not change whether a listing is published — that is the
        // admin's call, and a suspended seller would otherwise republish by
        // saving the edit form.
        seedProduct({ status: 'suspended' });

        expect(await update(editForm())).toMatchObject({ success: true });
        expect(store.get(PRODUCTS, EXISTING)?.status).toBe('suspended');
    });

    it('preserves createdAt across the edit', async () => {
        await update(editForm());
        expect(String(store.get(PRODUCTS, EXISTING)?.createdAt)).toContain('2026-01-01');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteProductAction', () => {
    const EXISTING = 'product-1';

    beforeEach(() => {
        seedSeller();
        store.seed(PRODUCTS, EXISTING, { id: EXISTING, sellerId: SELLER, title: 'Cocoa' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await remove(EXISTING)).toMatchObject({ success: false });
        expect(store.get(PRODUCTS, EXISTING)).toBeDefined();
    });

    it('refuses a product that does not exist', async () => {
        expect(await remove('nope')).toMatchObject({ success: false, error: 'Product not found' });
    });

    it('lets the owner delete', async () => {
        expect(await remove(EXISTING)).toMatchObject({ success: true });
        expect(store.get(PRODUCTS, EXISTING)).toBeUndefined();
    });

    it('refuses another seller', async () => {
        actAs('other-seller', ['seller']);
        store.seed(COLLECTIONS.USERS, 'other-seller', { roles: ['seller'] });

        expect(await remove(EXISTING)).toMatchObject({
            success: false, error: 'Unauthorized: You do not own this product',
        });
        expect(store.get(PRODUCTS, EXISTING)).toBeDefined();
    });

    it.each([['admin'], ['super_admin'], ['marketplace_admin']])(
        'lets a %s take a listing down', async (role) => {
            actAs('admin-1', [role]);
            store.seed(COLLECTIONS.USERS, 'admin-1', { roles: [role] });

            expect(await remove(EXISTING)).toMatchObject({ success: true });
            expect(store.get(PRODUCTS, EXISTING)).toBeUndefined();
        });

    it('refuses an admin of another module', async () => {
        actAs('ac-admin', ['academy_admin']);
        store.seed(COLLECTIONS.USERS, 'ac-admin', { roles: ['academy_admin'] });

        expect(await remove(EXISTING)).toMatchObject({ success: false });
        expect(store.get(PRODUCTS, EXISTING)).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the buyer dashboard', () => {
    async function dashboard() {
        return import('@/app/actions/marketplace/_mp_buyer_dashboard');
    }

    const orders = async (options: Record<string, unknown> = {}) =>
        (await (await dashboard()).getBuyerOrdersAction(options as never)) as any;
    const stats = async () => (await (await dashboard()).getBuyerStatsAction()) as any;

    beforeEach(() => { actAs(BUYER, ['general_user']); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await orders()).toMatchObject({ success: false });
        expect(await stats()).toMatchObject({ success: false });
    });

    it('returns the buyer\'s own orders, newest first', async () => {
        store.seedAll(ORDERS, {
            older: { buyerId: BUYER, status: 'processing', totalAmount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
            newer: { buyerId: BUYER, status: 'processing', totalAmount: 1, createdAt: '2026-03-01T00:00:00.000Z' },
            theirs: { buyerId: 'somebody', status: 'processing', totalAmount: 1, createdAt: '2026-04-01T00:00:00.000Z' },
        });

        expect((await orders()).data.orders.map((o: any) => o.id)).toEqual(['newer', 'older']);
    });

    it('filters by status when asked, and not when told "all"', async () => {
        store.seedAll(ORDERS, {
            live: { buyerId: BUYER, status: 'shipped', totalAmount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
            done: { buyerId: BUYER, status: 'completed', totalAmount: 1, createdAt: '2026-02-01T00:00:00.000Z' },
        });

        expect((await orders({ status: 'shipped' })).data.orders.map((o: any) => o.id)).toEqual(['live']);
        expect((await orders({ status: 'all' })).data.orders).toHaveLength(2);
    });

    it('COUNTS AS SPENT only the orders the buyer actually paid for', async () => {
        // This summed every order with no status filter, so "Total Spent"
        // included baskets still at pending_payment — the status an order is
        // created in — and orders the buyer had cancelled.
        store.seedAll(ORDERS, {
            unpaid: { buyerId: BUYER, status: 'pending_payment', totalAmount: 99_000 },
            cancelled: { buyerId: BUYER, status: 'cancelled', totalAmount: 88_000 },
            paid: { buyerId: BUYER, status: 'processing', totalAmount: 30_000 },
            delivered: { buyerId: BUYER, status: 'delivered', totalAmount: 20_000 },
        });

        expect((await stats()).data.stats).toMatchObject({ totalSpent: 50_000 });
    });

    it('and survives an order with no amount rather than reporting nothing spent', async () => {
        // An uncoerced reduce over a missing field makes the whole total NaN,
        // and formatCurrency(NaN) renders "₦0" — the figure did not look
        // broken, it looked like nothing had been spent.
        store.seedAll(ORDERS, {
            broken: { buyerId: BUYER, status: 'processing' },
            fine: { buyerId: BUYER, status: 'processing', totalAmount: 25_000 },
        });

        expect((await stats()).data.stats.totalSpent).toBe(25_000);
    });

    it('counts active and completed orders by the shared vocabulary', async () => {
        store.seedAll(ORDERS, {
            a: { buyerId: BUYER, status: 'pending_payment', totalAmount: 1 },
            b: { buyerId: BUYER, status: 'shipped', totalAmount: 1 },
            c: { buyerId: BUYER, status: 'delivered', totalAmount: 1 },
            d: { buyerId: BUYER, status: 'completed', totalAmount: 1 },
            e: { buyerId: BUYER, status: 'cancelled', totalAmount: 1 },
        });

        expect((await stats()).data.stats).toMatchObject({
            activeOrders: 2, completedOrders: 2,
        });
    });

    it('never counts another buyer\'s orders', async () => {
        store.seed(ORDERS, 'theirs', { buyerId: 'somebody', status: 'processing', totalAmount: 500_000 });

        expect((await stats()).data.stats).toMatchObject({
            activeOrders: 0, completedOrders: 0, totalSpent: 0,
        });
    });
});
