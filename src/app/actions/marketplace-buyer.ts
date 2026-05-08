"use server";
import { requireSession } from "@/lib/session-guard";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product, Order } from "@/lib/types/marketplace";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { FieldValue } from "firebase-admin/firestore";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";

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

async function _getProductsAction(filters?: ProductFilters) {
    let sessionResult;
    try {
        // This action is public but we wrap it for consistency and telemetry
        sessionResult = await requireSession().catch(() => ({ session: null }));

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active");

        // Apply filters
        if (filters?.category) {
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

        // Client-side filters (Firestore limitations)
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

        if (filters?.category && filters.category !== "all") {
            products = products.filter(product => product.category === filters.category);
        }

        return { success: true as const, data: { products: serializeValue(products) } };
    } catch (error) {
        logger.error("Get products error:", {
            userId: sessionResult?.session?.user?.id,
            filters,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch products", data: { products: [] } };
    }
}
export const getProductsAction = withFlexibleSafeAction("getProductsAction", _getProductsAction);

/**
 * Get single product by ID
 */
async function _getProductByIdAction(productId: string) {
    let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => ({ session: null }));

        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false as const, error: "Product not found" };
        }

        return { success: true as const, data: { product: serializeDoc<Product>(productDoc.id, productDoc.data()!) } };
    } catch (error) {
        logger.error("Get product error:", {
            userId: sessionResult?.session?.user?.id,
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch product" };
    }
}
export const getProductByIdAction = withFlexibleSafeAction("getProductByIdAction", _getProductByIdAction);

/**
 * Get featured products
 */
async function _getFeaturedProductsAction() {
    let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => ({ session: null }));

        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .orderBy("orders", "desc")
            .limit(8)
            .get();

        return { success: true as const, data: { products: serializeDocs<Product>(snapshot.docs) } };
    } catch (error) {
        logger.error("Get featured products error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch featured products", data: { products: [] } };
    }
}
export const getFeaturedProductsAction = withFlexibleSafeAction("getFeaturedProductsAction", _getFeaturedProductsAction);

/**
 * Get products by category
 */
async function _getProductsByCategoryAction(category: string) {
    let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => ({ session: null }));

        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("category", "==", category)
            .get();

        return { success: true as const, data: { products: serializeDocs<Product>(snapshot.docs) } };
    } catch (error) {
        logger.error("Get products by category error:", {
            userId: sessionResult?.session?.user?.id,
            category,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch products by category", data: { products: [] } };
    }
}
export const getProductsByCategoryAction = withFlexibleSafeAction("getProductsByCategoryAction", _getProductsByCategoryAction);

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

async function _getBuyerOrdersAction() {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        return { success: true as const, data: { orders: serializeDocs<Order>(snapshot.docs) } };
    } catch (error) {
        logger.error("Get buyer orders error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch orders" };
    }
}
export const getBuyerOrdersAction = withFlexibleSafeAction("getBuyerOrdersAction", _getBuyerOrdersAction);

async function _confirmOrderReceiptAction(orderId: string) {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const userId = session.user.id;

        // 1. Get Order
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false as const, error: "Order not found" };
        }

        const orderData = orderDoc.data();

        // 2. Verify Buyer
        if (orderData?.buyerId !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }

        if (orderData?.status !== "in_transit" && orderData?.status !== "processing" && orderData?.status !== "shipped") {
            return { success: false as const, error: "Order is not yet in transit or processing" };
        }

        await db.runTransaction(async (transaction) => {
            // 3. Update Order Status
            transaction.update(orderRef, {
                status: "delivered",
                paymentStatus: "paid_to_seller",
                deliveredAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            // 4. Release Escrow Funds
            const escrowQuery = await transaction.get(db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId));

            escrowQuery.docs.forEach(doc => {
                transaction.update(doc.ref, {
                    status: "released",
                    releasedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                });
            });
        });

        return { success: true as const, data: { message: "Order confirmed and funds released to seller(s)." } };

    } catch (error) {
        logger.error("Confirm receipt error:", {
            userId: sessionResult?.session?.user?.id,
            orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to confirm receipt" };
    }
}
export const confirmOrderReceiptAction = withFlexibleSafeAction("confirmOrderReceiptAction", _confirmOrderReceiptAction);

