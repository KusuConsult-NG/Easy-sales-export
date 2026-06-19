"use server";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product, Order, ProductCategory } from "@/lib/types/marketplace";
import { withSafeAction } from "@/lib/safe-action";
import { FieldValue } from "firebase-admin/firestore";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";
import { ProductSchema } from "@/lib/validations/marketplace";
import { notifyOrderCancelled } from "@/lib/marketplace-notifications";

import { runQueryWithRetry } from "@/lib/firestore-utils";

// ============================================================================
// PRODUCT BROWSING
// ============================================================================

export interface ProductFilters { 
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    state?: string;
    lga?: string;
    bulkAvailable?: boolean;
    exportReady?: boolean;
    searchTerm?: string; 
}

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
 * Get products with filtering
 */
async function _getProductsAction(filters?: ProductFilters): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");

        // Apply Firestore-supported filters
        if (filters?.category && filters.category !== "all") { 
            const mapped = categoryMapping[filters.category.toLowerCase()] || [filters.category];
            if (mapped.length > 1) {
                query = query.where("category", "in", mapped);
            } else {
                query = query.where("category", "==", mapped[0]);
            }
        }

        if (filters?.state) { 
            query = query.where("location.state", "==", filters.state);
        }

        if (filters?.bulkAvailable) { 
            query = query.where("bulkAvailable", "==", true);
        }

        if (filters?.exportReady) { 
            query = query.where("exportReady", "==", true);
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await runQueryWithRetry(() => query.get());
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || String(e.code) === "failed_precondition" || errMsg.includes("precondition")) {
                logger.warn("Get products failed due to missing index. Falling back to in-memory filters.", { filters, error: e.message });
                indexError = true;
                
                // Fallback: only filter by status and category at DB level
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");
                if (filters?.category && filters.category !== "all") {
                    const mapped = categoryMapping[filters.category.toLowerCase()] || [filters.category];
                    if (mapped.length > 1) {
                        fallbackQuery = fallbackQuery.where("category", "in", mapped);
                    } else {
                        fallbackQuery = fallbackQuery.where("category", "==", mapped[0]);
                    }
                }
                snapshot = await runQueryWithRetry(() => fallbackQuery.limit(300).get());
            } else {
                throw e;
            }
        }

        let products: Product[] = [];
        if (indexError) {
            // DISEASE 5 FIX: serialize first to convert Timestamps before in-memory filtering
            let productsData = serializeDocs(snapshot.docs);
            
            // Apply filtered states in-memory
            if (filters?.state) {
                productsData = productsData.filter((p: any) => p.location?.state === filters.state);
            }
            if (filters?.bulkAvailable) {
                productsData = productsData.filter((p: any) => p.bulkAvailable === true);
            }
            if (filters?.exportReady) {
                productsData = productsData.filter((p: any) => p.exportReady === true);
            }
            
            products = productsData as unknown as Product[];
        } else {
            products = serializeDocs<Product>(snapshot.docs);
        }

        // Client-side filters (for complex/non-indexed queries)
        if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) { 
            products = products.filter(product => {
                const price = product.pricingTiers[0]?.price || 0;
                const meetsMin = filters.minPrice === undefined || price >= filters.minPrice;
                const meetsMax = filters.maxPrice === undefined || price <= filters.maxPrice;
                return meetsMin && meetsMax;
            });
        }

        if (filters?.searchTerm) { 
            const term = filters.searchTerm.toLowerCase();
            products = products.filter(product =>
                product.title?.toLowerCase()?.includes(term) ||
                product.description?.toLowerCase()?.includes(term)
            );
        }

        if (filters?.lga) { 
            products = products.filter(product => product.location.lga === filters.lga);
        }

        return { error: null, success: true as const, data: { products } };
    } catch (error) { 
        logger.error("Get products error:", { filters, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}
export const getProductsAction = withSafeAction("getProductsAction", _getProductsAction);



/**
 * Get featured products (most orders)
 */
async function _getFeaturedProductsAction(): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        let snapshot;
        let indexError = false;
        try {
            snapshot = await db.collection(COLLECTIONS.PRODUCTS)
                .where("status", "==", "active")
                .orderBy("orders", "desc")
                .limit(8)
                .get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Get featured products failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                snapshot = await db.collection(COLLECTIONS.PRODUCTS)
                    .where("status", "==", "active")
                    .limit(50) // limit more since we'll sort in memory and slice
                    .get();
            } else {
                throw e;
            }
        }

        // DISEASE 5 FIX: serialize immediately to prevent Timestamps crashing sorting/rendering
        let products = serializeDocs<Product>(snapshot.docs);
        
        if (indexError) {
            products.sort((a: any, b: any) => {
                const aOrders = (a as any).orders || 0;
                const bOrders = (b as any).orders || 0;
                return bOrders - aOrders;
            });
            products = products.slice(0, 8);
        }
        
        return { error: null, success: true as const, data: { products: serializeValue(products) } };
    } catch (error) { 
        logger.error("Get featured products error:", error);
        return { success: false as const, error: "Failed to fetch featured products", data: null };
    }
}
export const getFeaturedProductsAction = withSafeAction("getFeaturedProductsAction", _getFeaturedProductsAction);

/**
 * Get products by category
 */
async function _getProductsByCategoryAction(category: string): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("category", "==", category)
            .get();

        return { error: null, success: true as const, data: { products: serializeDocs<Product>(snapshot.docs) } };
    } catch (error) { 
        logger.error("Get products by category error:", { category, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to fetch products by category", data: null };
    }
}
export const getProductsByCategoryAction = withSafeAction("getProductsByCategoryAction", _getProductsByCategoryAction);

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================



/**
 * Confirm order receipt (releases escrow)
 */
async function _confirmOrderReceiptAction(orderId: string): Promise<ActionResponse<{ success: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) { 
            return { success: false as const, error: "Order not found", data: null };
        }

        const orderData = orderDoc.data();
        if (orderData?.buyerId !== userId) { 
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const allowedStatuses = ["in_transit", "processing", "shipped"];
        if (!allowedStatuses.includes(orderData?.status)) { 
            return { success: false as const, error: "Order is not in a confirmable state", data: null };
        }

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("orderId", "==", orderId).get();

        await db.runTransaction(async (transaction) => { 
            transaction.update(orderRef, {
                status: "delivered",
                buyerConfirmed: true,
                buyerConfirmedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });

            escrowQuery.docs.forEach(doc => { 
                transaction.update(doc.ref, {
                    status: "delivered",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1) 
                });
            });
        });

        return { error: null, success: true as const, data: { success: true } };
    } catch (error) { 
        logger.error("Confirm receipt error:", { userId: sessionResult?.session?.user?.id, orderId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to confirm receipt", data: null };
    }
}
export const confirmOrderReceiptAction = withSafeAction("confirmOrderReceiptAction", _confirmOrderReceiptAction);

/**
 * Cancel a pending order (reverts product inventory and updates status)
 */
async function _cancelOrderAction(orderId: string): Promise<ActionResponse<{ success: boolean }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false as const, error: "Order not found", data: null };
        }

        const orderData = orderDoc.data();
        if (orderData?.buyerId !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        if (orderData?.status !== "pending_payment") {
            return { success: false as const, error: "Only pending orders can be cancelled", data: null };
        }

        const items = orderData.items || [];
        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("orderId", "==", orderId).get();

        await db.runTransaction(async (transaction) => {
            // 1. Revert product quantities
            for (const item of items) {
                if (item.productId && item.quantity) {
                    const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                    const productDoc = await transaction.get(productRef);
                    if (productDoc.exists) {
                        const productData = productDoc.data();
                        const currentQty = productData?.availableQuantity || 0;
                        transaction.update(productRef, {
                            availableQuantity: currentQty + item.quantity,
                            _version: FieldValue.increment(1),
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    }
                }
            }

            // 2. Update order status -> cancelled
            transaction.update(orderRef, {
                status: "cancelled",
                paymentStatus: "cancelled",
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            // 3. Update escrow transactions status -> cancelled
            escrowQuery.docs.forEach(doc => {
                transaction.update(doc.ref, {
                    status: "cancelled",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1)
                });
            });
        });

        // 4. Trigger notification
        const primarySellerId = items[0]?.sellerId;
        if (primarySellerId) {
            notifyOrderCancelled({
                buyerId: userId,
                sellerId: primarySellerId,
                orderId,
                orderNumber: orderData.orderNumber || orderId,
                reason: "Cancelled by buyer",
                cancelledBy: "buyer"
            }).catch((e) => logger.error("[cancelOrderAction] Notification failed:", { userId, error: e }));
        }

        return { error: null, success: true as const, data: { success: true } };
    } catch (error) {
        logger.error("Cancel order error:", { userId: sessionResult?.session?.user?.id, orderId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to cancel order", data: null };
    }
}
export const cancelOrderAction = withSafeAction("cancelOrderAction", _cancelOrderAction);

async function _getMarketplaceStatsAction(): Promise<ActionResponse<{ productsCount: number; tradersCount: number }>> {
    try {
        const [productsSnap, sellersSnap] = await Promise.all([
            db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active").count().get(),
            db.collection(COLLECTIONS.USERS).where("sellerVerificationStatus", "==", "approved").count().get()
        ]);
        return {
            error: null,
            success: true as const,
            data: {
                productsCount: productsSnap.data().count,
                tradersCount: sellersSnap.data().count
            }
        };
    } catch (error) {
        logger.error("getMarketplaceStatsAction error:", error);
        return { success: false as const, error: "Failed to fetch marketplace statistics", data: null };
    }
}
export const getMarketplaceStatsAction = withSafeAction("getMarketplaceStatsAction", _getMarketplaceStatsAction);



