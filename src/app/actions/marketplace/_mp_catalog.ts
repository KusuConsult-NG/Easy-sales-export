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

        if (category && category !== "all") { 
            query = query.where("category", "==", category);
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

        if (lastId) {
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
            if (lastDoc.exists) {
                orderedQuery = orderedQuery.startAfter(lastDoc);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await orderedQuery.limit(limitCount).get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Marketplace products search failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");
                if (category && category !== "all") fallbackQuery = fallbackQuery.where("category", "==", category);
                if (location) fallbackQuery = fallbackQuery.where("location.state", "==", location);
                
                if (lastId) {
                    const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }
                
                snapshot = await fallbackQuery.limit(limitCount).get();
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

        if (search) { 
            const searchLower = search.toLowerCase().trim();
            products = products.filter((p) => {
                const searchString = [p.title, p.description].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(searchLower);
            });
        }

        let newLastId = undefined;
        let hasMore = false;
        if (snapshot.docs.length === limitCount) {
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { error: null, success: true as const, data: { products, lastId: newLastId, hasMore } };
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
            // Map to standard product structure
            let sellerName = "Verified Seller";
            try {
                if (data.sellerId) {
                    const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(data.sellerId).get();
                    if (sellerDoc.exists) {
                        sellerName = sellerDoc.data()?.businessName || sellerDoc.data()?.displayName || "Verified Seller";
                    }
                }
            } catch (err) {
                logger.error("Failed to fetch seller name for flash sale product:", err);
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
                rating: 5,
                reviewCount: 0,
                sellerName: sellerName,
                sellerVerified: true,
                createdAt: data.createdAt || new Date(),
                updatedAt: data.createdAt || new Date(),
                isFlashSale: true,
                originalPrice: data.price,
                flashPrice: data.flashPrice,
                eventId: data.eventId
            };

            try {
                product = serializeValue(ProductSchema.parse(mappedData)) as Product;
            } catch (e) {
                product = serializeValue(mappedData) as Product;
            }
        } else {
            try {
                product = serializeValue(ProductSchema.parse({ id: doc.id, ...data })) as Product;
            } catch (e) {
                product = serializeValue({ id: doc.id, ...data }) as Product;
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

        return { error: null, success: true as const, data: { products } };
    } catch (error) { 
        logger.error("Get recommended products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}


export const getRecommendedProductsAction = withSafeAction("getRecommendedProductsAction", _getRecommendedProductsAction);


/**
 * Get related products based on category and location
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
            .limit(limit + 1)
            .get();

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const products = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
            .filter((p: any) => p.id !== productId);

        return { error: null, success: true as const, data: { 
                products: serializeValue(products.slice(0, limit)) 
 } 
        };
    } catch (error: any) { 
        logger.error("Get related products error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch related products", data: null };
    }
}

export const getRelatedProductsAction = withSafeAction("getRelatedProductsAction", _getRelatedProductsAction);


const categoryMapping: Record<string, string[]> = {
    grains: ["grains", "cereal", "cereals"],
    roots: ["roots", "roots_tubers", "roots & tubers", "tuber", "tubers", "yam", "yams", "cassava"],
    vegetables: ["vegetables", "vegetable", "horticultural"],
    fruits: ["fruits", "fruit"],
    nuts: ["nuts", "nut", "seed", "seeds", "sesame", "sesame seeds", "sesame_seeds"],
    spices: ["spices", "spices_herbs_seasonings", "spices & herbs", "spices_herbs", "hibiscus", "zobo"],
    livestock: ["livestock"],
    poultry: ["poultry"],
    dairy: ["dairy", "dairy & eggs", "dairy_eggs"],
    processed: ["processed", "processed foods", "processed_foods", "natural_oils", "beverages"],
    organic: ["organic", "organics"],
    sea_foods: ["sea_foods", "fishery"],
    fishery: ["fishery", "sea_foods"],
};


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
            const mapped = categoryMapping[params.category.toLowerCase()] || [params.category];
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

        if (params.lastId) { 
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(params.lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

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
                    const mapped = categoryMapping[params.category.toLowerCase()] || [params.category];
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
        let lastVisible = indexError ? null : snapshot.docs[snapshot.docs.length - 1];
        let hasMore = indexError ? false : snapshot.docs.length === limit;

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
            
            // Apply pagination in memory
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

        const products = productsData.map((p: any) => {
            try {
                return ProductSchema.parse(p);
            } catch (e) {
                return p as Product;
            }
        });

        // Fetch seller names (optimize this with a separate user index/cache later)
        const productsWithSellers = await Promise.all(
            products.map(async (product) => { 
                let sellerName = "Unknown Seller";
                if (product.sellerId) {
                    if (product.sellerName) {
                        sellerName = product.sellerName; 
                    } else { 
                        const userRef = db.collection(COLLECTIONS.USERS).doc(product.sellerId);
                        const userSnap = await userRef.get();
                        if (userSnap.exists) {
                            const userData = userSnap.data();
                            sellerName = userData?.businessName || userData?.displayName || "Unknown Seller";
                        }
                    }
                }
                return { ...product, sellerName };
            })
        );

        let finalProducts = productsWithSellers;
        if (params.query) { 
            const lowerQuery = params.query.toLowerCase();
            finalProducts = finalProducts.filter(p =>
                p.title?.toLowerCase()?.includes(lowerQuery) ||
                p.description?.toLowerCase()?.includes(lowerQuery)
            );
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return { 
            error: null, 
            success: true as const, 
            data: { 
                products: serializeValue(finalProducts), 
                lastId: lastVisible ? lastVisible.id : undefined, 
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
