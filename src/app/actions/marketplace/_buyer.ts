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

/**
 * Get products with filtering
 */
async function _getProductsAction(filters?: ProductFilters): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");

        // Apply Firestore-supported filters
        if (filters?.category && filters.category !== "all") { 
            query = query.where("category", "==", filters.category);
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

        const snapshot = await query.get();
        let products = serializeDocs<Product>(snapshot.docs);

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

        let products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Product[];
        
        if (indexError) {
            products.sort((a: any, b: any) => {
                const aOrders = a.orders || 0;
                const bOrders = b.orders || 0;
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

        await db.runTransaction(async (transaction) => { 
            transaction.update(orderRef, {
                status: "delivered",
                paymentStatus: "paid_to_seller",
                deliveredAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });

            const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("orderId", "==", orderId).get();
            escrowQuery.docs.forEach(doc => { 
                transaction.update(doc.ref, {
                    status: "released",
                    releasedAt: FieldValue.serverTimestamp(),
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


