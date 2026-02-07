"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";
import { createAuditLog } from "@/lib/audit-log";

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
    createdAt: Timestamp;
    updatedAt: Timestamp;
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
    createdAt: Timestamp;
    updatedAt: Timestamp;
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

        let q = query(
            collection(db, "vendor_orders"),
            where("vendorId", "==", session.user.id)
        );

        if (filters?.status) {
            q = query(q, where("status", "==", filters.status));
        }

        const snapshot = await getDocs(q);
        const orders = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as VendorOrder[];

        return { success: true, orders };
    } catch (error: any) {
        console.error("Get vendor orders error:", error);
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

        const orderRef = doc(db, "vendor_orders", orderId);

        const updateData: any = {
            status,
            updatedAt: Timestamp.now(),
        };

        if (trackingNumber) {
            updateData.trackingNumber = trackingNumber;
        }

        await updateDoc(orderRef, updateData);

        await createAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: orderId,
            targetType: "vendor_order",
            metadata: { status, trackingNumber },
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update vendor order error:", error);
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

        let q = query(
            collection(db, "vendor_products"),
            where("vendorId", "==", session.user.id)
        );

        if (filters?.status) {
            q = query(q, where("status", "==", filters.status));
        }

        if (filters?.category) {
            q = query(q, where("category", "==", filters.category));
        }

        const snapshot = await getDocs(q);
        const products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as VendorProduct[];

        return { success: true, products };
    } catch (error: any) {
        console.error("Get vendor products error:", error);
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

        const productRef = doc(db, "vendor_products", productId);
        const productSnap = await getDocs(query(collection(db, "vendor_products"), where("__name__", "==", productId)));

        if (productSnap.empty) {
            return { success: false, error: "Product not found" };
        }

        const currentStock = productSnap.docs[0].data().stock || 0;
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

        await updateDoc(productRef, {
            stock: newStock,
            status,
            updatedAt: Timestamp.now(),
        });

        await createAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: productId,
            targetType: "vendor_product",
            metadata: { operation, stockChange, newStock },
        });

        return { success: true, newStock };
    } catch (error: any) {
        console.error("Update inventory error:", error);
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

        const productRef = doc(db, "vendor_products", productId);
        const productSnap = await getDocs(query(collection(db, "vendor_products"), where("__name__", "==", productId)));

        if (productSnap.empty) {
            return { success: false, error: "Product not found" };
        }

        const currentStatus = productSnap.docs[0].data().status;
        const newStatus = currentStatus === "active" ? "inactive" : "active";

        await updateDoc(productRef, {
            status: newStatus,
            updatedAt: Timestamp.now(),
        });

        return { success: true, newStatus };
    } catch (error: any) {
        console.error("Toggle product status error:", error);
        return { success: false, error: error.message };
    }
}
