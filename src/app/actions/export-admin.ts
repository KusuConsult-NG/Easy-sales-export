"use server";

import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";

const DEFAULT_CATALOG = [
    { id: "cashew-nuts", name: "Cashew Nuts", icon: "🥜", origin: "Ogbomoso, Oyo State", season: "Feb - May", category: "nuts", grades: ["W320", "W240", "W210"], certifications: ["NAFDAC", "SON"], pricePerMT: 2850, minOrderMT: 20 },
    { id: "sesame-seeds", name: "Sesame Seeds", icon: "🌰", origin: "Jigawa & Nassarawa", season: "Oct - Jan", category: "nuts", grades: ["White (99%)", "Brown (98%)"], certifications: ["NAFDAC", "SGS"], pricePerMT: 1750, minOrderMT: 25 },
    { id: "dried-hibiscus", name: "Dried Hibiscus (Zobo)", icon: "🌺", origin: "Kano & Jigawa", season: "Nov - Mar", category: "spices", grades: ["Dark Red", "Light Red"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2200, minOrderMT: 15 },
    { id: "cocoa-beans", name: "Cocoa Beans", icon: "🫘", origin: "Ondo & Cross River", season: "Sep - Feb", category: "nuts", grades: ["Grade A", "Grade B"], certifications: ["NAFDAC", "ICO"], pricePerMT: 3400, minOrderMT: 10 },
    { id: "shea-butter", name: "Shea Butter", icon: "🧴", origin: "Niger & Kwara", season: "Year-round", category: "oils", grades: ["Unrefined Grade A", "Refined"], certifications: ["NAFDAC", "Organic Certified"], pricePerMT: 1900, minOrderMT: 5 },
    { id: "ginger", name: "Ginger", icon: "🫚", origin: "Kaduna & Nasarawa", season: "Nov - Mar", category: "spices", grades: ["Split Dried", "Powder"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2600, minOrderMT: 15 },
    { id: "moringa-leaves", name: "Moringa Leaves (Dried)", icon: "🍃", origin: "Kebbi & Sokoto", season: "Year-round", category: "spices", grades: ["Grade A Powder", "Whole Dried"], certifications: ["Organic Certified", "EU Compliant"], pricePerMT: 3200, minOrderMT: 5 },
    { id: "charcoal", name: "Hardwood Charcoal", icon: "🪵", origin: "Benue & Nassarawa", season: "Year-round", category: "other", grades: ["Lump (80mm+)", "BBQ Grade"], certifications: ["SON", "FSC Compliant"], pricePerMT: 450, minOrderMT: 28 },
];

export async function getAdminExportCatalogAction(options: { 
    limit?: number; 
    lastDocId?: string; 
} = {}): Promise<{ success: boolean; data?: any[]; meta?: any; error?: string; hasMore?: boolean; lastDocId?: string | null }> {
    try {
        const db = getAdminDb();
        let query = db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .orderBy("sortOrder", "asc");

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const fetchLimit = options.limit || 50;
        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        if (docs.length > 0) {
            const products = docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const nextCursor = hasMore ? docs[docs.length - 1].id : undefined;

            return { 
                success: true, 
                data: products, 
                lastDocId: nextCursor,
                hasMore: hasMore,
                meta: { hasMore, lastDocId: nextCursor } 
            };
        }

        // Only return default catalog if not paginated and collection is empty
        if (!options.lastDocId) {
            return { 
                success: true, 
                data: DEFAULT_CATALOG, 
                lastDocId: null,
                hasMore: false,
                meta: { hasMore: false, lastDocId: null, source: "default" } 
            };
        }

        return { success: true, data: [], hasMore: false, meta: { hasMore: false } };

    } catch (error: any) {
        logger.error("Get export catalog error:", error);
        return { success: false, error: "Failed to fetch catalog" };
    }
}

export async function createExportCatalogAction(productData: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        
        if (!session?.user || !session.user.roles?.some(r => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();

        if (productData.id && typeof productData.id === 'string' && !productData.id.includes(' ')) {
            // Update existing or default
            await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productData.id).set({
                ...productData,
                isActive: true,
                updatedAt: new Date(),
                updatedBy: session.user.id,
            }, { merge: true });
            
            return { success: true, data: { id: productData.id } };
        } else {
            // Create new
            const dataToSave = { ...productData };
            delete dataToSave.id;
            
            const ref = await db.collection(COLLECTIONS.EXPORT_CATALOG).add({
                ...dataToSave,
                isActive: true,
                sortOrder: Date.now(),
                createdAt: new Date(),
                createdBy: session.user.id,
            });
            
            return { success: true, data: { id: ref.id } };
        }
    } catch (error: any) {
        logger.error("Create/update export catalog error:", error);
        return { success: false, error: "Failed to save catalog item" };
    }
}

// ============================================
// Export Request Stats (server-side COUNT)
// ============================================

export async function getExportRequestStatsAction(): Promise<{
    success: boolean;
    error?: string;
    data?: {
        total: number;
        pending: number;
        inTransit: number;
        delivered: number;
        completed: number;
    };
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        if (!session?.user?.roles?.some((r: string) => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();
        const col = db.collection(COLLECTIONS.EXPORT_WINDOWS);

        const [totalSnap, pendingSnap, inTransitSnap, deliveredSnap, completedSnap] = await Promise.all([
            col.count().get(),
            col.where("status", "==", "pending").count().get(),
            col.where("status", "==", "in_transit").count().get(),
            col.where("status", "==", "delivered").count().get(),
            col.where("status", "==", "completed").count().get(),
        ]);

        return {
            success: true,
            data: {
                total: totalSnap.data().count,
                pending: pendingSnap.data().count,
                inTransit: inTransitSnap.data().count,
                delivered: deliveredSnap.data().count,
                completed: completedSnap.data().count,
            },
        };
    } catch (error: any) {
        logger.error("Get export request stats error:", error);
        return { success: false, error: "Failed to fetch export stats" };
    }
}

// ============================================
// Export Catalog Stats (server-side COUNT)
// ============================================

export async function getExportCatalogStatsAction(): Promise<{
    success: boolean;
    error?: string;
    data?: {
        totalProducts: number;
    };
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        if (!session?.user?.roles?.some((r: string) => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();
        const snap = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .count()
            .get();

        return {
            success: true,
            data: { totalProducts: snap.data().count },
        };
    } catch (error: any) {
        logger.error("Get export catalog stats error:", error);
        return { success: false, error: "Failed to fetch catalog stats" };
    }
}

export async function deleteExportCatalogAction(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        
        if (!session?.user || !session.user.roles?.some(r => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();
        await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productId).update({ 
            isActive: false, 
            deletedAt: new Date(),
            deletedBy: session.user.id
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Delete export catalog error:", error);
        return { success: false, error: "Failed to delete item" };
    }
}

export async function getAdminPendingExportProductsAction(): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        
        if (!session?.user || !session.user.roles?.some(r => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("status", "==", "pending")
            .orderBy("createdAt", "desc")
            .get();

        const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return { success: true, data: products };
    } catch (error: any) {
        logger.error("Get pending export products error:", error);
        return { success: false, error: "Failed to fetch pending products" };
    }
}

export async function reviewExportProductAction(productId: string, action: 'approve' | 'reject'): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error };
        const { session } = sessionResult;
        
        if (!session?.user || !session.user.roles?.some(r => r === "admin" || r === "super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const db = getAdminDb();
        
        const updates = action === 'approve' 
            ? { status: 'live', isActive: true } 
            : { status: 'rejected', isActive: false };

        const productRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productId);
        const productDoc = await productRef.get();
        const productData = productDoc.data();

        await productRef.update({ 
            ...updates,
            updatedAt: new Date(),
            reviewedBy: session.user.id,
            reviewedAt: new Date()
        });

        // Send Email Notification if userId exists
        if (productData?.userId) {
            try {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(productData.userId).get();
                const userData = userDoc.data();
                if (userData?.email) {
                    const { sendExportProductApprovalEmail, sendExportProductRejectionEmail } = await import("@/lib/email-notifications");
                    const userName = userData.name || userData.firstName || "Export Participant";
                    const productName = productData.name || "Export Product";
                    
                    if (action === 'approve') {
                        await sendExportProductApprovalEmail(userData.email, userName, productName);
                    } else {
                        await sendExportProductRejectionEmail(userData.email, userName, productName);
                    }
                }
            } catch (emailErr) {
                logger.error("Failed to send export product review email:", emailErr);
            }
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Review export product error:", error);
        return { success: false, error: "Failed to review product" };
    }
}

/**
 * Fetch all export orders for admin dashboard
 */
export async function getAdminExportOrdersAction(): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized access" };
        }

        const db = getAdminDb();
        const ordersSnapshot = await db.collection(COLLECTIONS.EXPORT_ORDERS)
            .orderBy("createdAt", "desc")
            .get();

        const orders = ordersSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
            };
        });

        return { success: true, data: orders };
    } catch (error: any) {
        logger.error("Failed to fetch admin export orders:", error);
        return { success: false, error: "Failed to fetch export orders" };
    }
}

/**
 * Update the status of an export order
 */
export async function updateAdminExportOrderStatusAction(
    orderId: string, 
    status: string,
    documentData?: { name: string; url: string; type: string }
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized access" };
        }

        const db = getAdminDb();
        const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderId);
        
        // Import FieldValue from firebase-admin for arrayUnion
        const { FieldValue } = await import('firebase-admin/firestore');

        const updateData: any = {
            status,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (documentData) {
            updateData.documents = FieldValue.arrayUnion(documentData);
        }

        await orderRef.update(updateData);

        return { success: true };
    } catch (error: any) {
        logger.error("Failed to update export order status:", error);
        return { success: false, error: "Failed to update export order status" };
    }
}
