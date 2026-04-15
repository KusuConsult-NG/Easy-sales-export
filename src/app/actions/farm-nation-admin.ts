"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";

/**
 * Get all users who have submitted a Farm Nation registration.
 * Queries users collection and filters in-memory for those with
 * serviceRegistrations.farmNation field populated.
 */
export async function getFarmNationRegistrantsAction(options: {
    limit?: number;
    page?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
} = {}): Promise<{
    success: boolean;
    data?: any;
    meta?: any;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false };
        }

        const pageSize = options.limit || 20;
        const page = options.page ?? 0;

        // Firestore can't query "field exists" directly, so fetch all users and
        // filter in-memory for those with a farm nation registration.
        const snapshot = await db.collection(COLLECTIONS.USERS).limit(500).get();

        let users = snapshot.docs
            .map(doc => {
                const data = doc.data();
                const farmNation = data.serviceRegistrations?.farmNation;
                if (!farmNation) return null;
                return {
                    id: doc.id,
                    name: data.fullName || data.name || "Unknown",
                    email: data.email,
                    phone: data.phone,
                    role: data.roles?.[0] || "general_user",
                    roles: data.roles || [],
                    isVerified: data.isVerified ?? false,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(0),
                    // Farm Nation onboarding profile (if saved to top-level farmNation field)
                    farmNation: data.farmNation,
                    serviceRegistrations: { farmNation },
                };
            })
            .filter(Boolean) as any[];

        // Status filter
        if (options.status && options.status !== "all") {
            users = users.filter(u =>
                u.serviceRegistrations?.farmNation?.status === options.status
            );
        }

        // Search filter
        if (options.search) {
            const q = options.search.toLowerCase();
            users = users.filter(u =>
                u.name?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q) ||
                u.phone?.includes(q)
            );
        }

        // Sort by submittedAt desc (most recent first)
        users.sort((a, b) => {
            const aT = a.serviceRegistrations?.farmNation?.submittedAt?.seconds || 0;
            const bT = b.serviceRegistrations?.farmNation?.submittedAt?.seconds || 0;
            return bT - aT;
        });

        const offset = page * pageSize;
        const paged = users.slice(offset, offset + pageSize);
        const hasMore = offset + pageSize < users.length;

        return {
            success: true,
            data: { users: paged },
            meta: {
                hasMore,
                cursor: hasMore ? String(page + 1) : null
            }
        };
    } catch (error: any) {
        logger.error("getFarmNationRegistrantsAction error:", error);
        return {
            success: false,
            data: null,
            meta: null,
            error: "Failed to fetch farm nation registrants: " + error.message,
        };
    }
}

export async function getStandardFarmNationRegistrantsAction(statusFilter?: "pending" | "approved" | "rejected" | "revision_required" | "all"): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        let q = db.collection(COLLECTIONS.USERS).where('registeredServices', 'array-contains', 'farmNation');
        const snapshot = await q.get();
        const users = serializeDocs(snapshot.docs);

        // Filter and map out the standard forms
        const applications = users.filter((user: any) => {
            const status = user.serviceRegistrations?.farmNation?.status || "pending";
            if (statusFilter && statusFilter !== "all" && status !== statusFilter) return false;
            return true;
        }).map((user: any) => {
            const userName = user.name || user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : (user.email || "Unknown User");
            const status = user.serviceRegistrations?.farmNation?.status || "pending";
            return {
                id: user.id, // Using the user ID since Farm Nation ties reg straight to user
                user: {
                    id: user.id,
                    name: userName,
                    email: user.email || "Unknown",
                },
                status: status,
                data: user // Returning complete user profile including nested farmNation data
            };
        });

        // We sort manually since array-contains restricts our compound ordering options generically
        applications.sort((a, b) => {
            const tA = new Date(a.data.serviceRegistrations?.farmNation?.submittedAt || a.data.createdAt).getTime();
            const tB = new Date(b.data.serviceRegistrations?.farmNation?.submittedAt || b.data.createdAt).getTime();
            return tB - tA;
        });

        return { success: true, data: applications };
    } catch (error) {
        logger.error("Get standard Farm Nation registrants error:", error);
        return { success: false, error: "Failed to fetch normalized Farm Nation applications" };
    }
}

