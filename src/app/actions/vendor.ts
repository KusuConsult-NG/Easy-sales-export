"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { withOptimisticLock } from "@/lib/data-integrity";
import { serializeDoc } from "@/lib/firestore-serialize";

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

        // sellerIds, not vendorId.
        //
        // Nothing writes `vendorId` to a marketplace order — orders carry
        // `sellerId` and `sellerIds` (marketplace/_payment.ts). This query
        // therefore matched nothing, so a vendor's order list was permanently
        // empty and had been for as long as the field name has been wrong. Not
        // a security defect; a feature that silently did not work.
        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", session.user.id);

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = snapshot.docs.map(doc => serializeDoc<VendorOrder>(doc.id, doc.data()));


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

        // Only the statuses a vendor may set, checked at RUNTIME.
        //
        // `status: VendorOrder["status"]` is a TypeScript annotation and nothing
        // more. This is a server action, so the argument crosses the wire from a
        // client and the type is erased — any string reached transaction.update.
        // MARKETPLACE_ORDERS status drives fulfilment and escrow, and the
        // integrity work went to some trouble to make every transition a claim;
        // this path wrote it directly.
        const VENDOR_SETTABLE: ReadonlyArray<string> = ["processing", "shipped", "in_transit", "delivered"];
        if (!VENDOR_SETTABLE.includes(status as string)) {
            return { success: false as const, error: "Invalid order status", data: null };
        }

        await withOptimisticLock<VendorOrder>(orderRef, _version, (transaction, currentData: any) => {
            // Verify ownership.
            //
            // orderId arrived from the caller unchecked, so any authenticated
            // user could set the status of ANY marketplace order.
            //
            // The field is sellerIds/sellerId, NOT vendorId: nothing ever writes
            // vendorId to a marketplace order — see the note on
            // _getVendorOrdersAction, which queries a field that does not exist.
            const sellerIds: string[] = Array.isArray(currentData?.sellerIds) ? currentData.sellerIds : [];
            const owns = sellerIds.includes(session.user.id) || currentData?.sellerId === session.user.id;
            if (!owns) {
                throw new Error("Unauthorized");
            }

            const updateData: any = {
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
        const products = snapshot.docs.map(doc => serializeDoc<VendorProduct>(doc.id, doc.data()));


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

        await withOptimisticLock<VendorProduct>(productRef, _version, (transaction, currentData) => {
            // Verify ownership.
            //
            // productId arrives from the caller and was used unchecked, so any
            // authenticated user could set ANY vendor's stock — zero it to take a
            // competitor's listing offline, or inflate it to force overselling.
            // session.user.id was referenced only when writing the audit row,
            // which records who did it without ever deciding whether they may.
            //
            // _deleteVendorProductAction in this same file has always had this
            // check. Three of the four writers here did not.
            if (currentData?.vendorId !== session.user.id) {
                throw new Error("Unauthorized");
            }

            const currentStock = currentData.stock || 0;
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

        await withOptimisticLock<VendorProduct>(productRef, _version, (transaction, currentData) => {
            // Verify ownership — same defect as the inventory writer above.
            // Without it, any authenticated user could deactivate any vendor's
            // product and remove it from the marketplace.
            if (currentData?.vendorId !== session.user.id) {
                throw new Error("Unauthorized");
            }

            const currentStatus = currentData.status;
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

