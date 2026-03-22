"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { BriefingRegistrationData, BriefingStatus } from "./briefing";

export interface BriefingRegistration extends BriefingRegistrationData {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: BriefingStatus;
    attended: boolean;
    confirmationSent: boolean;
}

/**
 * Fetch all WAVE Briefing Registrations (Admin Only)
 */
export async function getBriefingRegistrationsAction(): Promise<{ success: boolean; data?: BriefingRegistration[]; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        // Check admin role
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const hasAdminRole = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

        if (!hasAdminRole) {
            return { success: false, error: "Unauthorized: Admin access required" };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
            .orderBy("createdAt", "desc")
            .get();

        const data = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                ...d,
                // Handle timestamps safely
                createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : new Date(),
                updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date(),
                // Default legacy data if missing
                status: d.status || "registered",
                attended: d.attended || false,
                confirmationSent: d.confirmationSent || false
            } as BriefingRegistration;
        });

        return { success: true, data };
    } catch (error) {
        logger.error("Failed to fetch briefing registrations:", error);
        return { success: false, error: "Failed to fetch data" };
    }
}
