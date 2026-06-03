"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { requireSession, isAdmin } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";

export async function submitExportProductAction(productData: any) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const dataToSave = { ...productData };
        delete dataToSave.id;
        
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

        const products = snapshot.docs.map(doc => { 
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
            if (!isAdmin(roles)) {
                return { success: false as const, error: "Unauthorized: You do not own this product", data: null };
            }
        }

        await productRef.delete();

        return { error: null, success: true as const, data: { message: "Product deleted successfully" } };
    } catch (error: any) {
        logger.error("Delete export product error:", error);
        return { success: false as const, error: "Failed to delete product", data: null };
    }
}
