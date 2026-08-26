"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";
import { recordAdminAction } from "@/lib/audit-log";
import { retirementPatch, isRetired } from "@/lib/record-retirement";

export async function submitExportProductAction(productData: any) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const dataToSave = { ...productData };
        delete dataToSave.id;

        // A submitted price has to be a real one.
        //
        // productData arrives as `any` and is stored wholesale — no schema, no
        // checks — and export-payment.ts later multiplies pricePerMT by the
        // ordered tonnage to build the charge. A negative price there is not
        // caught by anything downstream once an admin approves the listing, and
        // an admin reviewing a product page has no particular reason to notice
        // a minus sign.
        //
        // Checkout now refuses a non-positive stored price as well. This is the
        // source; that is the boundary. Both, for the same reason as #113.
        if (dataToSave.pricePerMT !== undefined && dataToSave.pricePerMT !== null) {
            const price = Number(dataToSave.pricePerMT);
            if (!Number.isFinite(price) || price <= 0) {
                return { success: false as const, error: "Price per MT must be greater than zero", data: null };
            }
            dataToSave.pricePerMT = price;
        }

        if (dataToSave.availableQuantityMT !== undefined && dataToSave.availableQuantityMT !== null) {
            const qty = Number(dataToSave.availableQuantityMT);
            if (!Number.isFinite(qty) || qty < 0) {
                return { success: false as const, error: "Available quantity cannot be negative", data: null };
            }
            dataToSave.availableQuantityMT = qty;
        }
        
        const ref = await db.collection(COLLECTIONS.EXPORT_CATALOG).add({ ...dataToSave,
            userId: session.user.id,
            status: "pending", // pending, live, rejected
            isActive: false, // only true when approved by admin
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });
        
        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("Submit export product error:", error);
        return { success: false as const, error: "Failed to submit product", data: null };
    }
}

export async function getUserExportProductsAction() { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { error: "Authentication required", success: false as const, data: null };
        }

        const userId = session.user.id;

        let snapshot;
        let indexError = false;
        try {
            snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
                .where("userId", "==", userId)
                .orderBy("createdAt", "desc")
                .get();
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || String(e.code) === "failed_precondition" || errMsg.includes("precondition")) {
                logger.warn("Get user export products failed due to missing index. Falling back.", { userId, error: e.message });
                indexError = true;
                snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
                    .where("userId", "==", userId)
                    .get();
            } else {
                throw e;
            }
        }

        // #301 A retired product must leave its owner's list too. This queries
        // by userId and nothing else, so without this the seller would delete a
        // product and watch it stay. The public catalogue and the stats already
        // filter isActive == true and need no change.
        const products = snapshot.docs
            .filter(doc => !isRetired(doc.data()))
            .map(doc => {
                const data = doc.data();
                return serializeValue({
                    id: doc.id,
                    ...data,
                });
            });

        if (indexError) {
            products.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        return { error: null, success: true as const, data: products };
    } catch (error: any) { 
        logger.error("Get user export products error:", error);
        return { error: "Failed to fetch products", success: false as const, data: null };
    }
}

export async function deleteExportProductAction(productId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const productRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productId);
        const productDoc = await productRef.get();
        if (!productDoc.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        const productData = productDoc.data();
        if (productData?.userId !== userId) {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const roles = userDoc.data()?.roles || [];
            if (!hasAdminPermission(roles, "export:approve_applications")) {
                return { success: false as const, error: "Unauthorized: You do not own this product", data: null };
            }
        }

        /**
         *   #301 THE SELLER'S DOOR DESTROYED WHAT THE ADMIN'S DOOR RETIRES.
         *
         *        deleteExportCatalogAction in export-admin.ts — same collection,
         *        same intent — writes { isActive: false, deletedAt, deletedBy }
         *        and leaves the row in place. The public catalogue route and the
         *        catalogue stats both query isActive == true, so that is all
         *        hiding an export product has ever required.
         *
         *        This door called .delete() instead, on rows that export orders
         *        reference by id (export-payment.ts reads
         *        EXPORT_CATALOG.doc(item.productId) when a payment lands).
         *
         *        Same convention as the admin door now, plus the shared
         *        retirement bookkeeping so both record who and when.
         */
        await productRef.update({
            isActive: false,
            deletedAt: new Date(),
            deletedBy: userId,
            ...retirementPatch(userId, productData?.status),
        });

        await recordAdminAction({
            action: 'export_product_delete',
            userId: userId,
            targetId: productId,
            targetType: 'export_product',
        });
        return { error: null, success: true as const, data: { message: "Product deleted successfully" } };
    } catch (error: any) {
        logger.error("Delete export product error:", error);
        return { success: false as const, error: "Failed to delete product", data: null };
    }
}
