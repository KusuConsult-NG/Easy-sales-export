"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { COLLECTIONS, type ExportWindow } from "@/lib/types/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";

export type ExportOpportunity = {
    id: string;
    commodity: string;
    destination: string;
    openDate: Date | string;
    closeDate: Date | string;
    minInvestment: number;
    projectedROI: string;
    status: string;
    spotsLeft: number;
    totalSpots: number;
    image: string;
    // Deep data
    description?: string;
    specifications?: string[];
    benefits?: string[];
    documents?: {
        name: string;
        url?: string;
        required: boolean;
    }[];
    timeline?: {
        phase: string;
        duration: string;
        description: string;
        status: string;
    }[];
};

/**
 * Get all export investment opportunities
 */



/**
 * Get all export investment opportunities
 */

// Internal cached version
const getCachedExportOpportunities = unstable_cache(
    async () => {
        try {
            const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
                .where("status", "in", ["open", "active"])
                .orderBy("createdAt", "desc")
                .get();

            const opportunities = snapshot.docs.map(doc => {
                const data = doc.data() as ExportWindow;
                return {
                    id: doc.id,
                    commodity: data.commodity,
                    destination: (data as any).destination || "International",
                    openDate: (data.startDate as any)?.toDate?.().toISOString() || new Date().toISOString(),
                    closeDate: (data.endDate as any)?.toDate?.().toISOString() || new Date().toISOString(),
                    minInvestment: data.amount,
                    projectedROI: data.roi,
                    status: data.status === "active" ? "Opening Soon" : "Open",
                    spotsLeft: (data.totalSpots || 0) - (data.spotsFilled || 0),
                    totalSpots: data.totalSpots || 0,
                    image: data.image || "/images/export-placeholder.jpg",
                    // Deep data
                    description: data.description,
                    specifications: data.specifications || [],
                    benefits: data.benefits || [],
                    documents: data.documents || [],
                    timeline: data.timeline?.map((t: any) => ({
                        phase: t.phase,
                        duration: t.date || t.duration || "TBD",
                        description: t.description || "",
                        status: t.status || "pending"
                    })) || [],
                };
            });

            return { success: true, data: opportunities };
        } catch (error: any) {
            logger.error("Error fetching export opportunities:", error);
            return { success: false, error: error.message };
        }
    },
    ["export-opportunities"],
    { revalidate: 3600, tags: ["export-opportunities"] }
);

/**
 * Get all export investment opportunities
 */
export async function getExportOpportunities() {
    return getCachedExportOpportunities();
}

/**
 * Seed initial export opportunities (Temporary helper) - Admin Only
 */
export async function seedExportOpportunities() {
    // Legacy seeding function - discouraged now that we use real Export Windows
    return { success: false, error: "Seeding is deprecated. Please create Export Windows from Admin Panel." };
}

/**
 * Get single export opportunity by ID
 */

// Internal cached version
const getCachedExportOpportunityById = (id: string) => unstable_cache(
    async () => {
        try {
            const docRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(id);
            const snapshot = await docRef.get();

            if (!snapshot.exists) {
                return { success: false, error: "Opportunity not found" };
            }

            const data = snapshot.data() as ExportWindow;

            const opportunity: ExportOpportunity = {
                id: snapshot.id,
                commodity: data.commodity,
                destination: (data as any).destination || "International",
                openDate: (data.startDate as any)?.toDate?.().toISOString() || new Date().toISOString(),
                closeDate: (data.endDate as any)?.toDate?.().toISOString() || new Date().toISOString(),
                minInvestment: data.amount,
                projectedROI: data.roi,
                status: data.status === "active" ? "Opening Soon" : "Open",
                spotsLeft: (data.totalSpots || 0) - (data.spotsFilled || 0),
                totalSpots: data.totalSpots || 0,
                image: data.image || "/images/export-placeholder.jpg",
                // Deep data
                description: data.description,
                specifications: data.specifications || [],
                benefits: data.benefits || [],
                documents: data.documents || [],
                timeline: data.timeline?.map((t: any) => ({
                    phase: t.phase,
                    duration: t.date || t.duration || "TBD",
                    description: t.description || "",
                    status: t.status || "pending"
                })) || [],
            };

            return { success: true, data: opportunity };
        } catch (error: any) {
            logger.error("Error fetching export opportunity:", error);
            return { success: false, error: error.message };
        }
    },
    [`export-opportunity-${id}`],
    { revalidate: 3600, tags: [`export-opportunity-${id}`] }
)();

/**
 * Get single export opportunity by ID
 */
export async function getExportOpportunityById(id: string) {
    return getCachedExportOpportunityById(id);
}
