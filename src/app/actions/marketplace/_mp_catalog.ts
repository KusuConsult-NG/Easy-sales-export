"use server";

import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product } from "@/lib/types/marketplace";
import { serializeDocs } from "@/lib/firestore-serialize";
import { ProductSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { hydrateSellerTrust, resolveSellerTrust, SELLER_NAME_FALLBACK } from "@/lib/seller-trust";
import {
    PRODUCT_SEARCH_SCAN_LIMIT,
    filterProductsByQuery,
    pageFilteredProducts,
    categorySpellings,
} from "@/lib/product-search";

/** Reads a seller's user document, for hydrateSellerTrust. */
async function readSeller(sellerId: string): Promise<Record<string, any> | null> {
    const snap = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
    return snap.exists ? (snap.data() ?? null) : null;
}

/**
 * Get Marketplace Products
 */
async function _getMarketplaceProductsAction(params: { 
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    sortBy?: string;
    limit?: number; 
    lastId?: string;
} = {}): Promise<ActionResponse<{ products: Product[]; lastId?: string; hasMore: boolean }>> { 
    try {
        const { category, search, location, sortBy, limit: limitCount = 20, lastId } = params;

        let query = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active") as import("@/lib/supabase-db").SupabaseQuery;

        /**
         * Every stored spelling of the category, not just the one asked for.
         *
         * This matched the raw string while _buyer.ts and _searchProductsAction
         * both expanded it through the alias table — so selecting "roots" here
         * missed every product stored as "tubers", "yam" or "cassava", and the
         * same choice returned different catalogues depending on which action
         * the page happened to call. Four category filters, three behaviours.
         */
        if (category && category !== "all") {
            const mapped = categorySpellings(category);
            query = mapped.length > 1
                ? query.where("category", "in", mapped)
                : query.where("category", "==", mapped[0]);
        }

        if (location) { 
            query = query.where("location.state", "==", location);
        }

        let orderedQuery = query;
        // Apply sorting
        switch (sortBy) { 
            case "newest":
                orderedQuery = query.orderBy("createdAt", "desc");
                break;
            case "popular":
                orderedQuery = query.orderBy("views", "desc");
                break;
            default:
                orderedQuery = query.orderBy("createdAt", "desc");
        }

        /**
         * A text search pages the MATCHES, not the newest twelve rows.
         *
         * The filter below used to run after this page had already been taken,
         * so the search only ever saw `limitCount` rows — see lib/product-search.ts
         * for what that did to a buyer looking for a product by name. When a
         * query is present the database read becomes a bounded scan and the
         * paging happens after the match.
         */
        const searching = typeof search === "string" && search.trim() !== "";
        const readSize = searching ? PRODUCT_SEARCH_SCAN_LIMIT : limitCount;

        if (lastId && !searching) {
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
            if (lastDoc.exists) {
                orderedQuery = orderedQuery.startAfter(lastDoc);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await orderedQuery.limit(readSize).get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Marketplace products search failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");
                if (category && category !== "all") {
                    const mapped = categorySpellings(category);
                    fallbackQuery = mapped.length > 1
                        ? fallbackQuery.where("category", "in", mapped)
                        : fallbackQuery.where("category", "==", mapped[0]);
                }
                if (location) fallbackQuery = fallbackQuery.where("location.state", "==", location);
                
                if (lastId && !searching) {
                    const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }

                snapshot = await fallbackQuery.limit(readSize).get();
            } else {
                throw e;
            }
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        let products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            try {
                const parsed = ProductSchema.parse({ id: doc.id, ...data });
                return serializeValue(parsed);
            } catch {
                return serializeValue({ id: doc.id, ...data });
            }
        });

        if (indexError) {
            products.sort((a: any, b: any) => {
                if (sortBy === "popular") {
                    const aViews = a.views || 0;
                    const bViews = b.views || 0;
                    return bViews - aViews;
                } else {
                    let aVal = a.createdAt || 0;
                    let bVal = b.createdAt || 0;
                    if (aVal instanceof Date) aVal = aVal.getTime();
                    if (bVal instanceof Date) bVal = bVal.getTime();
                    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
                }
            });
        }

        let newLastId: string | undefined = undefined;
        let hasMore = false;

        if (searching) {
            if (snapshot.docs.length === PRODUCT_SEARCH_SCAN_LIMIT) {
                logger.warn(
                    `[getMarketplaceProducts] search scanned the ${PRODUCT_SEARCH_SCAN_LIMIT}-row cap; ` +
                    `matches beyond it are not shown.`,
                    { search, category, location },
                );
            }

            const matched = filterProductsByQuery(products, search);
            const paged = pageFilteredProducts(matched as { id?: string }[], lastId, limitCount);

            products = paged.page as typeof products;
            hasMore = paged.hasMore;
            newLastId = paged.lastId;
        } else if (snapshot.docs.length === limitCount) {
            // No query: the database did the paging, so the page being full is
            // the signal that another one exists.
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        // The badge is read live, not served from the product document.
        //
        // `sellerVerified` is copied onto a product when it is created and never
        // updated, so this list showed the badge a seller had at the time of each
        // listing. Granting the badge did not add it to existing products, and
        // revoking it did not remove it from any. See lib/seller-trust.ts.
        //
        // One read per unique seller, after pagination — so at most `limitCount`
        // extra reads, and normally far fewer.
        const withTrust = await hydrateSellerTrust(products as any[], readSeller);

        return { error: null, success: true as const, data: { products: withTrust, lastId: newLastId, hasMore } };
    } catch (error) { 
        logger.error("Get products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

export const getMarketplaceProductsAction = withSafeAction("getMarketplaceProductsAction", _getMarketplaceProductsAction);


/**
 * Get single product by ID
 */
async function _getProductByIdAction(productId: string): Promise<ActionResponse<Product>> { 
    try {
        let doc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
        let data;
        let isFlashSale = false;

        if (doc.exists) {
            data = doc.data();
        } else {
            // Fallback to flash_sale_products
            doc = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS).doc(productId).get();
            if (doc.exists) {
                data = doc.data();
                isFlashSale = true;
            } else {
                return { success: false as const, error: "Product not found", data: null };
            }
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        let product: Product;

        if (isFlashSale && data) {
            // Map to standard product structure.
            //
            // The fallback name was "Verified Seller", so a flash-sale seller
            // with no name recorded was LABELLED verified in the name field —
            // and `sellerVerified` below was the literal `true`, so the shield
            // was shown too. Neither had anything to do with the seller's badge.
            // One rule now, in lib/seller-trust.ts, reading the live user doc.
            let sellerName = SELLER_NAME_FALLBACK;
            let sellerVerified = false;
            try {
                if (data.sellerId) {
                    const trust = resolveSellerTrust(await readSeller(data.sellerId));
                    sellerName = trust.sellerName;
                    sellerVerified = trust.sellerVerified;
                }
            } catch (err) {
                logger.error("Failed to read seller for flash sale product:", err);
            }

            const mappedData = {
                id: doc.id,
                sellerId: data.sellerId || "unknown",
                title: data.title || "Flash Sale Product",
                description: data.description || "",
                category: "other",
                images: data.images && data.images.length > 0 ? data.images : (data.imageUrl ? [data.imageUrl] : []),
                pricingTiers: [{ type: "retail", price: data.flashPrice || data.price, minQuantity: 1 }],
                availableQuantity: data.availableQuantity ?? 0,
                minimumOrderQuantity: 1,
                unit: data.unit || "unit",
                location: {
                    state: data.location?.state || "Nigeria",
                    lga: data.location?.lga || "Unknown",
                    nearestMarket: "Unknown"
                },
                deliveryMethod: "delivery",
                status: "active",
                bulkAvailable: false,
                exportReady: false,
                views: 0,
                orders: 0,
                // Was `rating: 5` with reviewCount 0. The card renders a rating
                // only when `rating > 0`, so every flash-sale product displayed a
                // perfect score with nothing behind it, and "Highest Rated"
                // sorting placed all of them above real products with genuine
                // ratings below 5. Zero means "no reviews yet", which is true.
                rating: 0,
                reviewCount: 0,
                sellerName: sellerName,
                sellerVerified,
                createdAt: data.createdAt || new Date(),
                updatedAt: data.createdAt || new Date(),
                isFlashSale: true,
                originalPrice: data.price,
                flashPrice: data.flashPrice,
                eventId: data.eventId
            };

            /**
             * ProductSchema strips what it does not know, and it does not know
             * about flash sales.
             *
             * `isFlashSale`, `originalPrice`, `flashPrice` and `eventId` are
             * built one line above and are not fields of ProductSchema, so
             * `.parse()` removed all four — the function assembled the flash-sale
             * shape and then discarded the part that makes it one.
             *
             * /marketplace/products/[id] reads `isFlashSale` to decide whether to
             * show the sale treatment, and `flashPrice`/`originalPrice` to strike
             * the old price through. All three arrived undefined, so a flash-sale
             * product's detail page showed an ordinary product at the sale price
             * with no sale on it. The buyer LIST does the same mapping in the
             * browser without the schema, which is why the badge appeared there
             * and vanished when you clicked it.
             */
            const flashFields = {
                isFlashSale: true,
                originalPrice: data.price,
                flashPrice: data.flashPrice,
                eventId: data.eventId,
            };

            try {
                product = { ...(serializeValue(ProductSchema.parse(mappedData)) as Product), ...flashFields } as Product;
            } catch (e) {
                product = serializeValue(mappedData) as Product;
            }
        } else {
            // The badge, live, on the ordinary product branch too.
            //
            // The first pass at this fixed the FLASH branch above and left this
            // one serving the product document's own `sellerVerified` — the
            // create-time snapshot. So the product detail page still showed a
            // revoked seller as verified. Fixing readers from a hand-written
            // list is what allowed that; the test now enumerates them.
            const raw: Record<string, any> = { id: doc.id, ...(data ?? {}) };
            const trust = resolveSellerTrust(
                raw.sellerId ? await readSeller(String(raw.sellerId)) : null,
            );
            const hydrated = { ...raw, sellerName: raw.sellerName || trust.sellerName, sellerVerified: trust.sellerVerified };

            try {
                product = serializeValue(ProductSchema.parse(hydrated)) as Product;
            } catch (e) {
                product = serializeValue(hydrated) as Product;
            }
        }

        return { error: null, success: true as const, data: product };
    } catch (error) { 
        logger.error("Get product by id error:", {
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch product", data: null };
    }
}

export const getProductByIdAction = withSafeAction("getProductByIdAction", _getProductByIdAction);

export const getProductAction = getProductByIdAction;


/**
 * Get Recommended Products
 */
async function _getRecommendedProductsAction(limitCount: number = 3): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .orderBy("createdAt", "desc")
            .limit(limitCount);

        let snapshot;
        let indexError = false;
        try {
            snapshot = await query.get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Get recommended products failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                const fallbackQuery = db.collection(COLLECTIONS.PRODUCTS)
                    .where("status", "==", "active")
                    .limit(limitCount);
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            try {
                const parsed = ProductSchema.parse({ id: doc.id, ...data });
                return serializeValue(parsed);
            } catch (e) {
                return serializeValue({ id: doc.id, ...data });
            }
        });

        if (indexError) {
            products.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                if (typeof aVal === 'string') aVal = new Date(aVal).getTime();
                if (typeof bVal === 'string') bVal = new Date(bVal).getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        const withTrust = await hydrateSellerTrust(products as any[], readSeller);

        return { error: null, success: true as const, data: { products: withTrust } };
    } catch (error) {
        logger.error("Get recommended products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}


export const getRecommendedProductsAction = withSafeAction("getRecommendedProductsAction", _getRecommendedProductsAction);


/**
 * Get related products in the same category.
 *
 * The heading said "based on category and location" and the query has never
 * touched location — worth saying plainly rather than leaving a description of
 * a feature that does not exist.
 */
async function _getRelatedProductsAction(productId: string, limit: number = 4): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productSnap = await productRef.get();

        if (!productSnap.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        const product = productSnap.data() as Product;

        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("category", "==", product.category)
            .where("status", "==", "active")
            .where("availableQuantity", ">", 0)
            .limit(limit + 1)
            .get();

        const { serializeValue } = await import("@/lib/firestore-serialize");
        // Sold-out rows were included here and excluded everywhere else — the
        // catalogue search requires availableQuantity > 0 — so the one place a
        // buyer is offered "you might also like" was the one place that could
        // offer them something nobody can buy.
        const products = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
            .filter((p: any) => p.id !== productId);

        const withTrust = await hydrateSellerTrust(products.slice(0, limit) as any[], readSeller);

        return { error: null, success: true as const, data: {
                products: serializeValue(withTrust)
 }
        };
    } catch (error: any) { 
        logger.error("Get related products error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch related products", data: null };
    }
}

export const getRelatedProductsAction = withSafeAction("getRelatedProductsAction", _getRelatedProductsAction);




/**
 * Search Products
 */
async function _searchProductsAction(params: { query?: string;
    category?: string;
    state?: string;
    sortBy?: string;
    limit?: number;
    lastId?: string; }): Promise<ActionResponse<{ products: Product[]; lastId?: string; hasMore: boolean }>> { 
    try {
        const limit = params.limit || 12;
        let query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("availableQuantity", ">", 0);

        if (params.category && params.category !== "All Categories") {
            const mapped = categorySpellings(params.category);
            if (mapped.length > 1) {
                query = query.where("category", "in", mapped);
            } else {
                query = query.where("category", "==", mapped[0]);
            }
        }

        if (params.state && params.state !== "All Locations") { 
            query = query.where("location.state", "==", params.state);
        }

        if (params.sortBy === "price_asc") { 
            query = query.orderBy("pricingTiers.0.price", "asc");
        } else if (params.sortBy === "price_desc") { 
            query = query.orderBy("pricingTiers.0.price", "desc");
        } else if (params.sortBy === "rating") { 
            query = query.orderBy("rating", "desc");
        } else { 
            query = query.orderBy("createdAt", "desc");
        }

        /**
         * Same correction as getMarketplaceProductsAction: with a query, read a
         * bounded window and page the matches. The filter at the bottom of this
         * function ran after `.limit(12)`, so a search saw twelve rows of the
         * catalogue and reported what it found among them.
         */
        const searching = typeof params.query === "string" && params.query.trim() !== "";

        if (params.lastId && !searching) {
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(params.lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(searching ? PRODUCT_SEARCH_SCAN_LIMIT : limit);

        let snapshot;
        let indexError = false;
        try {
            snapshot = await query.get();
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || String(e.code) === "failed_precondition" || errMsg.includes("precondition")) {
                logger.warn("Search products failed due to missing index. Falling back to in-memory filters and sorting.", { params, error: e.message });
                indexError = true;
                
                // Fallback: simple query with status and category
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");
                if (params.category && params.category !== "All Categories") {
                    const mapped = categorySpellings(params.category);
                    if (mapped.length > 1) {
                        fallbackQuery = fallbackQuery.where("category", "in", mapped);
                    } else {
                        fallbackQuery = fallbackQuery.where("category", "==", mapped[0]);
                    }
                }
                
                snapshot = await fallbackQuery.limit(300).get();
            } else {
                throw e;
            }
        }

        // DISEASE 5 FIX: serialize before any in-memory processing
        let productsData = serializeDocs(snapshot.docs);
        let lastVisible = indexError || searching ? null : snapshot.docs[snapshot.docs.length - 1];
        let hasMore = indexError || searching ? false : snapshot.docs.length === limit;

        if (indexError) {
            // Apply availableQuantity filter
            productsData = productsData.filter((p: any) => (p.availableQuantity ?? 0) > 0);
            
            // Apply location filter
            if (params.state && params.state !== "All Locations") {
                productsData = productsData.filter((p: any) => p.location?.state === params.state);
            }
            
            // Apply sorting in memory
            if (params.sortBy === "price_asc") {
                productsData.sort((a: any, b: any) => (a.pricingTiers?.[0]?.price ?? 0) - (b.pricingTiers?.[0]?.price ?? 0));
            } else if (params.sortBy === "price_desc") {
                productsData.sort((a: any, b: any) => (b.pricingTiers?.[0]?.price ?? 0) - (a.pricingTiers?.[0]?.price ?? 0));
            } else if (params.sortBy === "rating") {
                productsData.sort((a: any, b: any) => (b.rating ?? 0) - (a.rating ?? 0));
            } else {
                // newest
                productsData.sort((a: any, b: any) => {
                    let aTime = a.createdAt;
                    let bTime = b.createdAt;
                    if (aTime?.toDate) aTime = aTime.toDate().getTime();
                    if (bTime?.toDate) bTime = bTime.toDate().getTime();
                    if (aTime instanceof Date) aTime = aTime.getTime();
                    if (bTime instanceof Date) bTime = bTime.getTime();
                    return (bTime || 0) - (aTime || 0);
                });
            }
            
            // Apply pagination in memory — unless a query is running, in which
            // case the matches are paged below and slicing here would take the
            // page BEFORE the filter all over again.
            if (!searching) {
                if (params.lastId) {
                    const startIndex = productsData.findIndex((p: any) => p.id === params.lastId);
                    if (startIndex !== -1) {
                        productsData = productsData.slice(startIndex + 1);
                    }
                }

                hasMore = productsData.length > limit;
                productsData = productsData.slice(0, limit);
                if (productsData.length > 0) {
                    const lastId = productsData[productsData.length - 1].id;
                    lastVisible = snapshot.docs.find(d => d.id === lastId) || null;
                }
            }
        }

        const products = productsData.map((p: any) => {
            try {
                return ProductSchema.parse(p);
            } catch (e) {
                return p as Product;
            }
        });

        // Seller name AND badge, both live, one read per unique seller.
        //
        // This block used to read a user document per PRODUCT that had no
        // denormalised sellerName — the comment said "optimize this with a
        // separate user index/cache later" — and it never touched
        // sellerVerified, so search results served the create-time snapshot of
        // the badge. Batching by unique sellerId fixes both at once: fewer reads
        // than before AND a badge that reflects a revocation.
        //
        // "Unknown Seller" was a fourth spelling of the missing-name fallback,
        // after "Verified Seller", "Easy Sales Seller" and the ProductSchema
        // default. One spelling now, and not a claim.
        const productsWithSellers = await hydrateSellerTrust(products as any[], readSeller);

        let finalProducts = productsWithSellers;
        let outLastId: string | undefined = lastVisible ? lastVisible.id : undefined;

        if (searching) {
            if (snapshot.docs.length >= PRODUCT_SEARCH_SCAN_LIMIT) {
                logger.warn(
                    `[searchProducts] scanned the ${PRODUCT_SEARCH_SCAN_LIMIT}-row cap; ` +
                    `matches beyond it are not shown.`,
                    { query: params.query, category: params.category, state: params.state },
                );
            }

            const matched = filterProductsByQuery(finalProducts, params.query);
            const paged = pageFilteredProducts(matched as { id?: string }[], params.lastId, limit);

            finalProducts = paged.page as typeof finalProducts;
            hasMore = paged.hasMore;
            outLastId = paged.lastId;
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return {
            error: null,
            success: true as const,
            data: {
                products: serializeValue(finalProducts),
                lastId: outLastId,
                hasMore: hasMore
            }
        };

    } catch (error: any) { 
        logger.error("Search products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Search failed", data: null };
    }
}

export const searchProductsAction = withSafeAction("searchProductsAction", _searchProductsAction);
