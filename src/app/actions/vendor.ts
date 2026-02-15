"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";

/**
 * VENDOR ACTIONS
 * For vendor-specific operations (different from marketplace sellers)
 */

export interface VendorOrder {
    id: string;
    orderNumber: string;
    customerId: string;
    customerName: string;
    items: {
        productId: string;
        productName: string;
        quantity: number;
        price: number;
        unit?: string;
    }[];
    totalAmount: number;
    status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
    paymentStatus: "pending" | "paid" | "refunded";
    deliveryAddress?: {
        street: string;
        city: string;
        state: string;
        country: string;
        postalCode?: string;
    };
    trackingNumber?: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface VendorProduct {
    id: string;
    sku: string;
    name: string;
    description: string;
    category: string;
    price: number;
    cost: number;
    stock: number;
    reorderLevel: number;
    unit: string;
    images: string[];
    status: "active" | "inactive" | "out_of_stock";
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Get all orders for vendor
 */
export async function getVendorOrdersAction(filters?: {
    status?: VendorOrder["status"];
}): Promise<{ success: boolean; orders?: VendorOrder[]; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        let query = db.collection("vendor_orders").where("vendorId", "==", session.user.id);

        if (filters?.status) {
            query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as VendorOrder[];

        return { success: true, orders };
    } catch (error: any) {
        logger.error("Get vendor orders error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update vendor order status
 */
export async function updateVendorOrderStatusAction(
    orderId: string,
    status: VendorOrder["status"],
    trackingNumber?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const orderRef = db.collection("vendor_orders").doc(orderId);

        const updateData: any = {
            status,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (trackingNumber) {
            updateData.trackingNumber = trackingNumber;
        }

        await orderRef.update(updateData);

        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: orderId,
            targetType: "vendor_order",
            metadata: { status, trackingNumber },
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update vendor order error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get vendor products (catalog)
 */
export async function getVendorProductsAction(filters?: {
    status?: VendorProduct["status"];
    category?: string;
}): Promise<{ success: boolean; products?: VendorProduct[]; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        let query = db.collection("vendor_products").where("vendorId", "==", session.user.id);

        if (filters?.status) {
            query = query.where("status", "==", filters.status);
        }

        if (filters?.category) {
            query = query.where("category", "==", filters.category);
        }

        const snapshot = await query.get();
        const products = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as VendorProduct[];

        return { success: true, products };
    } catch (error: any) {
        logger.error("Get vendor products error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update vendor product inventory
 */
export async function updateVendorProductInventoryAction(
    productId: string,
    stockChange: number,
    operation: "add" | "subtract" | "set"
): Promise<{ success: boolean; newStock?: number; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const productRef = db.collection("vendor_products").doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false, error: "Product not found" };
        }

        const currentStock = productDoc.data()?.stock || 0;
        let newStock = currentStock;

        switch (operation) {
            case "add":
                newStock = currentStock + stockChange;
                break;
            case "subtract":
                newStock = Math.max(0, currentStock - stockChange);
                break;
            case "set":
                newStock = stockChange;
                break;
        }

        // Check if out of stock
        const status = newStock === 0 ? "out_of_stock" : "active";

        await productRef.update({
            stock: newStock,
            status,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: productId,
            targetType: "vendor_product",
            metadata: { operation, stockChange, newStock },
        });

        return { success: true, newStock };
    } catch (error: any) {
        logger.error("Update inventory error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Toggle vendor product status
 */
export async function toggleVendorProductStatusAction(
    productId: string
): Promise<{ success: boolean; newStatus?: VendorProduct["status"]; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const productRef = db.collection("vendor_products").doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false, error: "Product not found" };
        }

        const currentStatus = productDoc.data()?.status;
        const newStatus = currentStatus === "active" ? "inactive" : "active";

        await productRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, newStatus };
    } catch (error: any) {
        logger.error("Toggle product status error:", error);
        return { success: false, error: error.message };
    }
}
/**
 * Delete a vendor product
 */
export async function deleteVendorProductAction(
    productId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const productRef = db.collection("vendor_products").doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false, error: "Product not found" };
        }

        const productData = productDoc.data();

        // Verify ownership
        if (productData?.vendorId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Soft delete
        await productRef.update({
            status: "inactive",
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "user_delete",
            userId: session.user.id,
            targetId: productId,
            targetType: "vendor_product",
            metadata: { name: productData?.name },
        });

        return {
            success: true,
            message: "Product deleted successfully",
        };
    } catch (error: any) {
        logger.error("Delete vendor product error:", error);
        return { success: false, error: error.message };
    }
}
