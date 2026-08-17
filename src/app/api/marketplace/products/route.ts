export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hydrateSellerTrust, SELLER_NAME_FALLBACK } from "@/lib/seller-trust";

/**
 * GET /api/marketplace/products
 * Returns approved marketplace products with cursor-based pagination.
 *
 * Query params:
 *   category  — filter by product category
 *   search    — in-memory text search on name/description/seller
 *   minPrice  — minimum price filter
 *   maxPrice  — maximum price filter
 *   cursor    — ISO timestamp of the last item's createdAt (for pagination)
 *   limit     — number of items per page (default 20, max 50)
 *
 * Response: { success, data: { products }, meta: { cursor, hasMore } }
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get("category");
        const search = searchParams.get("search");
        const minPrice = searchParams.get("minPrice");
        const maxPrice = searchParams.get("maxPrice");
        const cursorParam = searchParams.get("cursor");
        const rawLimit = parseInt(searchParams.get("limit") || "20");
        const limit = Math.min(Math.max(rawLimit, 1), 50);

        // Base query — active products. Availability is applied after mapping;
        // see the filter below the mapper.
        //
        // THIS CARRIED `.where("inStock", "==", true)` AND MATCHED NOTHING.
        //
        // No creation path writes `inStock`. Not /api/marketplace/create-product,
        // not createProductAction, not the seed — they write `stockQuantity` and
        // `availableQuantity`. The only occurrence of the name anywhere else in
        // src/ is the optional field on the Product type and the mapper below,
        // which COMPUTES it for the response.
        //
        // So the public storefront filtered on a stored field that never
        // existed, and returned zero rows for every seller's products,
        // permanently. A seller listed a product, got "Product listed
        // successfully", and no buyer could ever see it.
        //
        // Nothing caught it: the unit suite mocks the database, and the page
        // renders "No products found" rather than an error, so a smoke test
        // sees a healthy 200. It took running the app against a real database
        // with real seeded products to see an empty shop.
        //
        // The mapper on line ~92 already states the intended rule and states it
        // correctly — `data.inStock !== false && quantity > 0`, i.e. absent
        // means "in stock if there is stock". It reads `quantity` OR
        // `availableQuantity`, which is what writers actually set. Applying
        // that same expression is the fix; re-adding a stored `inStock` would
        // mean a derived field to keep in step with every stock movement, which
        // is the kind of duplication that drifts back apart.
        let baseQuery: import("@/lib/supabase-db").SupabaseQuery = db
            .collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active");

        // Apply category filter at DB level (replaces the compound query)
        if (category && category !== "all") {
            baseQuery = baseQuery.where("category", "==", category);
        }

        let orderedQuery = baseQuery.orderBy("createdAt", "desc").limit(limit + 1);

        // Apply cursor (startAfter the last createdAt timestamp)
        if (cursorParam) {
            const cursorDate = new Date(cursorParam);
            if (!isNaN(cursorDate.getTime())) {
                orderedQuery = orderedQuery.startAfter(cursorDate);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await orderedQuery.get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Marketplace API products search failed due to missing index. Falling back.", { error: e.message });
                indexError = true;

                let fallbackQuery = baseQuery.limit(limit + 1);
                if (cursorParam) {
                    const cursorDate = new Date(cursorParam);
                    if (!isNaN(cursorDate.getTime())) {
                        fallbackQuery = fallbackQuery.startAfter(cursorDate);
                    }
                }
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }

        const hasMore = snapshot.docs.length > limit;
        const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

        let products = docs.map(doc => {
            const data = doc.data();
            const retailPrice = data.price || data.pricingTiers?.find((t: any) => t.type === "retail")?.price || data.pricingTiers?.[0]?.price || 0;
            const quantity = typeof data.quantity === "number" ? data.quantity : (data.availableQuantity || 0);
            const locationString = data.sellerLocation || (data.location ? `${data.location.lga || ""}, ${data.location.state || ""}`.trim().replace(/^,\s*/, "") : "") || "Nigeria";
            
            return {
                id: doc.id,
                name: data.name || data.title || "",
                description: data.description || "",
                category: data.category || "other",
                price: retailPrice,
                unit: data.unit || "kg",
                inStock: data.inStock !== false && quantity > 0,
                quantity: quantity,
                images: data.images || [],
                sellerId: data.sellerId || "",
                sellerName: data.sellerName || data.storeName || SELLER_NAME_FALLBACK,
                sellerLocation: locationString,
                rating: data.rating || 0,
                reviews: data.reviewCount || 0,
                // `verified: data.verified !== false` — a field NO writer of this
                // collection sets, so the expression was `undefined !== false`
                // and this endpoint reported every product it has ever served as
                // verified. `verified` is a land-listing field; products carry
                // `sellerVerified`, and even that is a create-time snapshot.
                //
                // Hydrated from the seller's live badge below, like every other
                // read path. Defaulting a trust claim to true is the shape worth
                // naming here: a missing field became an assertion.
                verified: false,
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            };
        });

        if (indexError) {
            products.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (typeof aVal === 'string') aVal = new Date(aVal).getTime();
                if (typeof bVal === 'string') bVal = new Date(bVal).getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        // Availability, applied where the field spellings are already resolved.
        //
        // This is the rule the removed `.where("inStock", "==", true)` was
        // trying to express. It has to run here rather than in the query
        // because the mapper is what reconciles `quantity` against
        // `availableQuantity` and treats an absent `inStock` as "in stock if
        // there is stock" — a DB-level filter on either spelling alone would
        // silently drop products written with the other.
        products = products.filter(p => p.inStock);

        // In-memory filters for search and price (compound Firestore queries
        // require index creation for every combination — kept as in-memory)
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(
                p =>
                    p.name.toLowerCase().includes(searchLower) ||
                    p.description.toLowerCase().includes(searchLower) ||
                    p.sellerName.toLowerCase().includes(searchLower) ||
                    p.sellerLocation.toLowerCase().includes(searchLower)
            );
        }
        if (minPrice) products = products.filter(p => p.price >= parseInt(minPrice));
        if (maxPrice) products = products.filter(p => p.price <= parseInt(maxPrice));

        // The `verified` flag, resolved from the seller's live badge.
        //
        // Placed after every filter so the reads are only spent on rows that are
        // actually being returned, and batched by unique seller by
        // hydrateSellerTrust. It writes sellerName/sellerVerified, so `verified`
        // is copied across from the latter to keep this endpoint's field name.
        const hydrated = await hydrateSellerTrust(products as any[], async (id) => {
            const snap = await db.collection(COLLECTIONS.USERS).doc(id).get();
            return snap.exists ? (snap.data() ?? null) : null;
        });
        products = hydrated.map((p: any) => ({ ...p, verified: p.sellerVerified === true }));

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return NextResponse.json({
            success: true,
            data: { products },
            meta: { cursor: nextCursor, hasMore },
        });
    } catch (error: any) {
        logger.error("GET /api/marketplace/products error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load products", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
