"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { withOptimisticLock } from "@/lib/data-integrity";

/**
 * VENDOR ACTIONS
 * For vendor-specific operations (different from marketplace sellers)
 */

export interface VendorOrder { id: string;
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
    deliveryAddress?: { street: string;
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

export interface VendorProduct { id: string;
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
    vendorId: string;
    createdAt: Date;
    updatedAt: Date; }

/**
 * Get all orders for vendor
 */
async function _getVendorOrdersAction(filters?: { status?: VendorOrder["status"]; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).where("vendorId", "==", session.user.id);

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date() };
        }) as VendorOrder[];

        return { success: true as const, error: null, data: { orders } };
    } catch (error: any) { logger.error("Get vendor orders error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorOrdersAction = withFlexibleSafeAction("getVendorOrdersAction", _getVendorOrdersAction);

/**
 * Update vendor order status
 */
async function _updateVendorOrderStatusAction(
    orderId: string,
    status: VendorOrder["status"],
    trackingNumber?: string,
    _version?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        await withOptimisticLock<VendorOrder>(orderRef, _version, (transaction) => { const updateData: any = {
                status,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (trackingNumber) { updateData.trackingNumber = trackingNumber;
            }

            transaction.update(orderRef, updateData);
        });

        await createAdminAuditLog({ action: "user_update",
            userId: session.user.id,
            targetId: orderId,
            targetType: "vendor_order",
            metadata: { status, trackingNumber } });

        return { error: null,  success: true as const, data: { message: "Order status updated successfully" } };
    } catch (error: any) { logger.error("Update vendor order error:", {
            userId: sessionResult?.session?.user?.id,
            orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const updateVendorOrderStatusAction = withFlexibleSafeAction("updateVendorOrderStatusAction", _updateVendorOrderStatusAction);

/**
 * Get vendor products (catalog)
 */
async function _getVendorProductsAction(filters?: { status?: VendorProduct["status"];
    category?: string; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        let query = db.collection(COLLECTIONS.VENDOR_PRODUCTS).where("vendorId", "==", session.user.id);

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        if (filters?.category) { query = query.where("category", "==", filters.category);
        }

        const snapshot = await query.get();
        const products = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date() };
        }) as VendorProduct[];

        return { success: true as const, error: null, data: { products } };
    } catch (error: any) { logger.error("Get vendor products error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorProductsAction = withFlexibleSafeAction("getVendorProductsAction", _getVendorProductsAction);

/**
 * Update vendor product inventory
 * 
 * @param productId Product to update
 * @param stockChange Amount to change
 * @param operation Action to perform
 * @param _version Current version for optimistic locking
 */
async function _updateVendorProductInventoryAction(
    productId: string,
    stockChange: number,
    operation: "add" | "subtract" | "set",
    _version?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const productRef = db.collection(COLLECTIONS.VENDOR_PRODUCTS).doc(productId);
        let updatedStock = 0;

        await withOptimisticLock<VendorProduct>(productRef, _version, (transaction, currentData) => { const currentStock = currentData.stock || 0;
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

            updatedStock = newStock;
            const status = newStock === 0 ? "out_of_stock" : "active";

            transaction.update(productRef, { stock: newStock,
                status,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        await createAdminAuditLog({ action: "user_update",
            userId: session.user.id,
            targetId: productId,
            targetType: "vendor_product",
            metadata: { operation, stockChange, newStock: updatedStock } });

        return { error: null,  success: true as const, data: { message: "Inventory updated successfully" } };
    } catch (error: any) { logger.error("Update inventory error:", {
            userId: sessionResult?.session?.user?.id,
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message.includes("STALE_DATA") 
                ? "Inventory was modified by another process. Please refresh and try again."
                : error.message || "Failed to update inventory", data: null };
    }
}
export const updateVendorProductInventoryAction = withFlexibleSafeAction("updateVendorProductInventoryAction", _updateVendorProductInventoryAction);

/**
 * Toggle vendor product status
 */
async function _toggleVendorProductStatusAction(
    productId: string,
    _version?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const productRef = db.collection(COLLECTIONS.VENDOR_PRODUCTS).doc(productId);

        let newStatus: VendorProduct["status"] = "active";

        await withOptimisticLock<VendorProduct>(productRef, _version, (transaction, currentData) => { const currentStatus = currentData.status;
            newStatus = currentStatus === "active" ? "inactive" : "active";

            transaction.update(productRef, {
                status: newStatus,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        return { success: true as const, error: null, data: { message: `Product status changed to ${newStatus}` } };
    } catch (error: any) { logger.error("Toggle product status error:", {
            userId: sessionResult?.session?.user?.id,
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const toggleVendorProductStatusAction = withFlexibleSafeAction("toggleVendorProductStatusAction", _toggleVendorProductStatusAction);

/**
 * Delete a vendor product
 */
async function _deleteVendorProductAction(
    productId: string,
    _version?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const productRef = db.collection(COLLECTIONS.VENDOR_PRODUCTS).doc(productId);

        await withOptimisticLock<VendorProduct>(productRef, _version, (transaction, productData) => { // Verify ownership
            if (productData?.vendorId !== session.user.id) {
                throw new Error("Unauthorized");
            }

            // Soft delete
            transaction.update(productRef, { status: "inactive",
                deletedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        await createAdminAuditLog({ action: "user_delete",
            userId: session.user.id,
            targetId: productId,
            targetType: "vendor_product",
            metadata: { name: productId }, // productData name is not accessible here easily without returning it from callback
        });

        return { error: null, success: true as const, data: { message: "Product deleted successfully" } };
    } catch (error: any) { logger.error("Delete vendor product error:", {
            userId: sessionResult?.session?.user?.id,
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const deleteVendorProductAction = withFlexibleSafeAction("deleteVendorProductAction", _deleteVendorProductAction);

