"use server";
import { requireSession } from "@/lib/session-guard";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product } from "@/lib/types/marketplace";

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

export async function getProductsAction(filters?: ProductFilters) {
    try {
        let query = db.collection(COLLECTIONS.PRODUCTS)
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
        let products = snapshot.docs.map(doc => doc.data() as Product);

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

        return { success: true, data: { products } };
    } catch (error: any) {
        logger.error("Get products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

/**
 * Get single product by ID
 */
export async function getProductByIdAction(productId: string) {
    try {
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false, error: "Product not found" };
        }

        const product = productDoc.data() as Product;

        return { success: true, data: { product } };
    } catch (error: any) {
        logger.error("Get product error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get featured products
 */
export async function getFeaturedProductsAction() {
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .orderBy("orders", "desc")
            .limit(8)
            .get();

        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, data: { products } };
    } catch (error: any) {
        logger.error("Get featured products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

/**
 * Get products by category
 */
export async function getProductsByCategoryAction(category: string) {
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("category", "==", category)
            .get();

        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, data: { products } };
    } catch (error: any) {
        logger.error("Get products by category error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

export async function getBuyerOrdersAction() {
    try {
        const { auth } = await import("@/lib/auth");
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Authentication required" };
        }

        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                // Format dates for client
                date: data.createdAt?.toDate().toLocaleDateString() || "N/A",
                estimatedDelivery: data.estimatedDelivery?.toDate().toLocaleDateString() || "Pending",
                deliveredDate: data.deliveredAt?.toDate().toLocaleDateString(),
            };
        });

        return { success: true, data: { orders } };
    } catch (error: any) {
        logger.error("Get buyer orders error:", error);
        return { success: false, error: error.message };
    }
}

export async function confirmOrderReceiptAction(orderId: string) {
    try {
        const { auth } = await import("@/lib/auth");
        const { FieldValue } = await import("firebase-admin/firestore");
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Authentication required" };
        }

        // 1. Get Order
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const orderData = orderDoc.data();

        // 2. Verify Buyer
        if (orderData?.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // ✅ FIX: Orders use field 'status', not 'orderStatus'.
        // The old check was dead code — it never triggered, so buyers could confirm
        // any order regardless of actual state. Now enforced correctly.
        if (orderData?.status !== "in_transit" && orderData?.status !== "processing" && orderData?.status !== "shipped") {
            return { success: false, error: "Order is not yet in transit or processing" };
        }

        await db.runTransaction(async (transaction) => {
            // 3. Update Order Status
            transaction.update(orderRef, {
                // ✅ FIX: Write to 'status', not 'orderStatus' (non-existent field).
                // Previously the order status was never actually updated to 'delivered'.
                status: "delivered",
                paymentStatus: "paid_to_seller",
                deliveredAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 4. Release Escrow Funds
            const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get();

            escrowQuery.docs.forEach(doc => {
                transaction.update(doc.ref, {
                    status: "released",
                    releasedAt: FieldValue.serverTimestamp(),
                });
            });
        });

        return { success: true, message: "Order confirmed and funds released to seller(s)." };

    } catch (error: any) {
        logger.error("Confirm receipt error:", error);
        return { success: false, error: error.message };
    }
}
