"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function submitExportProductAction(productData: any) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        if (!session?.user) {
            return { error: "Authentication required", success: false as const };
        }

        const dataToSave = { ...productData };
        delete dataToSave.id;
        
        const ref = await db.collection(COLLECTIONS.EXPORT_CATALOG).add({
            ...dataToSave,
            userId: session.user.id,
            status: "pending", // pending, live, rejected
            isActive: false, // only true when approved by admin
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        return { success: true as const, data: { id: ref.id } };
    } catch (error: any) {
        logger.error("Submit export product error:", error);
        return { success: false as const, error: "Failed to submit product" };
    }
}

export async function getUserExportProductsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Authentication required", success: false as const };
        }

        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const products = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            };
        });

        return {
            error: null,
            success: true as const,
            data: products
        };
    } catch (error: any) {
        logger.error("Get user export products error:", error);
        return { error: "Failed to fetch products", success: false as const };
    }
}
