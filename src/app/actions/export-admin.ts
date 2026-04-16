"use server";

import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
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
} = {}): Promise<{ success: boolean; data?: any[]; meta?: any; error?: string }> {
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
                meta: { hasMore, lastDocId: nextCursor } 
            };
        }

        // Only return default catalog if not paginated and collection is empty
        if (!options.lastDocId) {
            return { 
                success: true, 
                data: DEFAULT_CATALOG, 
                meta: { hasMore: false, lastDocId: null, source: "default" } 
            };
        }

        return { success: true, data: [], meta: { hasMore: false } };

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
