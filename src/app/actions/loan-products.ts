"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createAdminAuditLog } from "@/lib/audit-log-admin";

export interface LoanProduct {
    id?: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;
    durationMonths: number;
    isActive: boolean;
}

/**
 * Admin: Get paginated loan products
 */
export async function getAdminLoanProductsAction(options: {
    limit?: number;
    lastDocId?: string;
} = {}): Promise<{
    success: boolean;
    data?: LoanProduct[];
    error?: string;
    lastDocId?: string;
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const { session } = sessionResult;
        
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.limit || 20;

        let query = db.collection(COLLECTIONS.LOAN_PRODUCTS)
            .orderBy("minAmount", "asc");

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const products = serializeDocs(docs) as unknown as LoanProduct[];
        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: products,
            lastDocId: nextCursor,
            hasMore
        };
    } catch (error: any) {
        logger.error("Failed to fetch admin loan products:", error);
        return { success: false, error: error.message };
    }
}

export async function createAdminLoanProductAction(data: Omit<LoanProduct, "id">) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        
        if (!sessionResult.session.user.roles?.includes("admin") && !sessionResult.session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const newDocRef = await db.collection(COLLECTIONS.LOAN_PRODUCTS).add(data);
        
        await createAdminAuditLog({
            action: "loan_product_created",
            userId: sessionResult.session.user.id,
            targetId: newDocRef.id,
            targetType: "loan_product",
            metadata: { name: data.name }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Create loan product error:", error);
        return { success: false, error: error.message };
    }
}

export async function updateAdminLoanProductAction(productId: string, data: Partial<LoanProduct>) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        
        if (!sessionResult.session.user.roles?.includes("admin") && !sessionResult.session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId).update(data as any);
        
        await createAdminAuditLog({
            action: "loan_product_updated",
            userId: sessionResult.session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: { ...data }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update loan product error:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteAdminLoanProductAction(productId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        
        if (!sessionResult.session.user.roles?.includes("admin") && !sessionResult.session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const docRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId);
        const doc = await docRef.get();
        if (!doc.exists) return { success: false, error: "Product not found" };

        await docRef.delete();
        
        await createAdminAuditLog({
            action: "loan_product_deleted",
            userId: sessionResult.session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: { name: doc.data()?.name }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Delete loan product error:", error);
        return { success: false, error: error.message };
    }
}
