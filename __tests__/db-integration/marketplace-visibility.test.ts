/**
 * A product a seller lists must be visible to a buyer.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * GET /api/marketplace/products filtered on `.where("inStock", "==", true)`.
 * Nothing writes `inStock`. Not /api/marketplace/create-product, not
 * createProductAction, not the seed — they write `stockQuantity` and
 * `availableQuantity`. The only other occurrence of the name in src/ is the
 * optional field on the Product type and the route's own response mapper,
 * which COMPUTES it as `data.inStock !== false && quantity > 0` — i.e. the same
 * file simultaneously required the field to be exactly `true` and documented
 * that absent means "in stock if there is stock".
 *
 * So the public storefront returned zero rows for every seller's products,
 * permanently. A seller listed a product, got "Product listed successfully",
 * and no buyer could ever see it.
 *
 * WHY IT SURVIVED EVERYTHING
 * --------------------------
 * The unit suite mocks @/lib/supabase-db, so a query filtering on a field that
 * does not exist returns whatever the mock was told to return — the filter is
 * never evaluated against real data. The route returns 200 with an empty list,
 * and /marketplace renders "No products found" rather than an error, so a smoke
 * test sees a healthy page. Every layer reported success.
 *
 * It took running the whole application against a real database with real
 * seeded products to see an empty shop. That is what this suite is for, and
 * this test is the one that would have caught it: a real row, written in the
 * shape the real creation path writes, read back through the real query.
 *
 * THE ASSERTION IS "MY PRODUCT COMES BACK", NOT "THE QUERY HAS N FILTERS".
 * Asserting on the query's shape would have passed against the broken version —
 * the filter was present and correct-looking. Only the data can tell.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { GET } from "@/app/api/marketplace/products/route";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-vis-";
const COLLECTION = "products";

/**
 * The document shape /api/marketplace/create-product actually writes.
 *
 * Copied from that route deliberately rather than simplified. A fixture that
 * does not match the real write shape is worse than no fixture — it makes a
 * broken reader look correct, and this defect is precisely a reader expecting a
 * field the writer never supplies.
 */
function productRow(id: string, overrides: Record<string, any> = {}) {
    const now = new Date().toISOString();
    return {
        id,
        collection_name: COLLECTION,
        raw_data: {
            id,
            sellerId: `${TEST_PREFIX}seller`,
            sellerName: "Visibility Test Seller",
            location: { state: "Plateau", lga: "Jos North", nearestMarket: "Jos Main" },
            name: "Visibility Test Sorghum",
            title: "Visibility Test Sorghum",
            category: "grains",
            description: "Written exactly as create-product writes it",
            unit: "bag",
            minOrder: 1,
            minimumOrderQuantity: 1,
            stockQuantity: 25,
            availableQuantity: 25,
            pricingTiers: [{ type: "retail", price: 25000, minQuantity: 1 }],
            images: [],
            rating: 0,
            reviewCount: 0,
            totalOrders: 0,
            views: 0,
            orders: 0,
            status: "active",
            createdAt: now,
            updatedAt: now,
            ...overrides,
        },
    };
}

async function insert(id: string, overrides: Record<string, any> = {}) {
    const { error } = await supabaseAdmin
        .from("document_collections")
        .upsert(productRow(id, overrides), { onConflict: "id,collection_name" });
    if (error) throw new Error(`seeding ${id}: ${error.message}`);
}

async function cleanup() {
    await supabaseAdmin
        .from("document_collections")
        .delete()
        .eq("collection_name", COLLECTION)
        .like("id", `${TEST_PREFIX}%`);
}

/** Call the real route handler and return the parsed products. */
async function listProducts(query = ""): Promise<any[]> {
    // Leading "?" supplied here so a caller passing "&limit=50" cannot silently
    // append to the PATH instead of the query string — which produced a
    // confusing "the category filter is broken" failure that was this helper's
    // fault, not the route's.
    const qs = query ? `?${query.replace(/^[?&]/, "")}` : "";
    const res = await GET({ url: `http://localhost:3000/api/marketplace/products${qs}` } as any);
    const body = await res.json();
    if (!body.success) throw new Error(`route failed: ${body.error}`);
    return body.data.products;
}

maybeDescribe("marketplace visibility, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("returns a product written the way create-product writes it", async () => {
        // THE test. Against the broken version this came back empty, because
        // the row has no `inStock` field — exactly like every real product.
        const id = `${TEST_PREFIX}basic`;
        await insert(id);

        const products = await listProducts("limit=50");
        expect(products.map(p => p.id)).toContain(id);
    });

    it("carries the price through from pricingTiers", async () => {
        // create-product stores price in pricingTiers, not in a `price` field.
        // A product that appears at ₦0 is barely better than one that does not
        // appear at all.
        const id = `${TEST_PREFIX}priced`;
        await insert(id);

        const product = (await listProducts("limit=50")).find(p => p.id === id);
        expect(product.price).toBe(25000);
        expect(product.quantity).toBe(25);
        expect(product.inStock).toBe(true);
    });

    it("hides a product with no stock left", async () => {
        // The rule the removed filter was trying to express, and the reason
        // this cannot simply drop availability filtering altogether.
        const id = `${TEST_PREFIX}soldout`;
        await insert(id, { availableQuantity: 0, stockQuantity: 0 });

        expect((await listProducts("limit=50")).map(p => p.id)).not.toContain(id);
    });

    it("hides a product that is not active", async () => {
        const id = `${TEST_PREFIX}inactive`;
        await insert(id, { status: "suspended" });

        expect((await listProducts("limit=50")).map(p => p.id)).not.toContain(id);
    });

    it("honours an explicit inStock: false on a product that has stock", async () => {
        // A seller pausing a listing without zeroing their stock. The mapper's
        // rule is `inStock !== false && quantity > 0`, so an explicit false
        // still hides it — the field is respected where it exists, it is simply
        // no longer REQUIRED to exist.
        const id = `${TEST_PREFIX}paused`;
        await insert(id, { inStock: false });

        expect((await listProducts("limit=50")).map(p => p.id)).not.toContain(id);
    });

    it("still filters by category", async () => {
        const grains = `${TEST_PREFIX}grains`;
        const tubers = `${TEST_PREFIX}tubers`;
        await insert(grains, { category: "grains" });
        await insert(tubers, { category: "tubers" });

        const ids = (await listProducts("limit=50&category=tubers")).map(p => p.id);
        expect(ids).toContain(tubers);
        expect(ids).not.toContain(grains);
    });
});
