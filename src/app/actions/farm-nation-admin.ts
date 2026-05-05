"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Get Farm Nation global stats (Admin)
 */
export async function getFarmNationStatsAction(): Promise<{
    success: boolean;
    data?: {
        stats: {
            totalApplications: number;
        }
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !isAdmin(session.user.roles)) {
            return { error: "Unauthorized: Permission required", success: false };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const countSnap = await db.collection(COLLECTIONS.USERS)
            .where('serviceRegistrations.farmNation.status', '!=', null)
            .count()
            .get();
        
        const totalApplications = countSnap.data().count;

        const payload = { success: true as const, data: { stats: { totalApplications } } };

        try {
            await setCache(cacheKey, payload, 120);
        } catch (e) {}

        return payload;
    } catch (error: any) {
        logger.error("Get farm nation stats error:", error);
        return { success: false, error: "Failed to fetch farm nation stats" };
    }
}

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
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !isAdmin(session.user.roles)) {
            return { error: "Unauthorized: Permission required", success: false };
        }

        const pageSize = options.search ? 2000 : (options.limit || 20);
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

export async function getStandardFarmNationRegistrantsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "approved" | "rejected" | "revision_required" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any; lastDocId?: string; hasMore?: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || !isAdmin(userDoc.data()?.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        // Query users who have a Farm Nation service registration.
        // The field serviceRegistrations.farmNation.status is written during onboarding
        // (farm-nation.ts sets it to "pending" on submission).
        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        let q: any = db.collection(COLLECTIONS.USERS)
            .where('serviceRegistrations.farmNation.status', '!=', null);

        // Determine sorting direction based on input
        const applicationsSortDirection = options.sortOrder || "desc";

        if (options.dateFrom) {
            const fromTs = new Date(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = new Date(options.dateTo + "T23:59:59");
            q = q.where("createdAt", "<=", toTs);
        }

        // We use createdAt for sorting to support date inequality
        q = q.orderBy("createdAt", applicationsSortDirection);


        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.USERS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        
        q = q.limit(fetchLimit);

        let snapshot;
        try {
            snapshot = await q.get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9) {
                logger.warn("Missing index for getStandardFarmNationRegistrantsAction, falling back to memory filter");
                snapshot = await db.collection(COLLECTIONS.USERS)
                    .where('serviceRegistrations.farmNation.status', '!=', null)
                    .get();
            } else {
                throw e;
            }
        }

        
        const users = serializeDocs(snapshot.docs);


        // Filter and map out the standard forms
        let applications = users.filter((user: any) => {
            const status = user.serviceRegistrations?.farmNation?.status || "pending";
            if (options.status && options.status !== "all" && status !== options.status) return false;
            return true;
        }).map((user: any) => {
            // Fix: check firstName presence FIRST to avoid "undefined undefined" for legacy users
            const userName = user.firstName
                ? `${user.firstName} ${user.lastName || ''}`.trim()
                : (user.name || user.fullName || user.email || "Unknown User");
            const status = user.serviceRegistrations?.farmNation?.status || "pending";

            // Flatten nested address & personal fields so admin modal reads consistent top-level keys.
            // Also inject a synthetic farmNation.profile alias so the admin page's nested paths resolve.
            const profileAlias = {
                phone:   user.phone || user.phoneNumber || null,
                state:   user.stateOfOrigin || user.address?.state || user.state || null,
                lga:     user.lga || user.address?.lga || null,
                address: user.residentialAddress || user.address?.street || (typeof user.address === 'string' ? user.address : null) || null,
            };
            const mergedData = {
                ...user,
                phone:              profileAlias.phone,
                gender:             user.gender             || null,
                dateOfBirth:        user.dateOfBirth        || user.dob           || null,
                occupation:         user.occupation         || null,
                stateOfOrigin:      profileAlias.state,
                lga:                profileAlias.lga,
                residentialAddress: profileAlias.address,
                // Inject farmNation.profile so admin page paths resolve when the nested object is missing
                farmNation: {
                    ...(user.farmNation || {}),
                    profile: {
                        ...(user.farmNation?.profile || {}),
                        phone:   (user.farmNation?.profile?.phone   || profileAlias.phone),
                        state:   (user.farmNation?.profile?.state   || profileAlias.state),
                        lga:     (user.farmNation?.profile?.lga     || profileAlias.lga),
                        address: (user.farmNation?.profile?.address || profileAlias.address),
                    },
                    interests: user.farmNation?.interests || user.serviceRegistrations?.farmNation?.interests || null,
                },
            };

            return {
                id: user.id,
                user: {
                    id: user.id,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                },
                status: status,
                data: mergedData
            };
        });

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            applications = applications.filter((app: any) => {
                const searchString = [
                    app.id,
                    app.user?.id,
                    app.user?.name,
                    app.user?.email,
                    app.user?.phone,
                    app.data?.firstName,
                    app.data?.lastName,
                    app.data?.fullName,
                    app.data?.stateOfOrigin
                ].filter(Boolean).join(" ").toLowerCase();
                
                return searchString.includes(s);
            });
        }

        // Sorting
        applications.sort((a: any, b: any) => {

            const dateA = a.data?.createdAt?.toDate?.() || new Date(a.data?.createdAt || 0);
            const dateB = b.data?.createdAt?.toDate?.() || new Date(b.data?.createdAt || 0);
            return applicationsSortDirection === "desc" 
                ? dateB.getTime() - dateA.getTime()
                : dateA.getTime() - dateB.getTime();
        });



        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: applications,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: users.length,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard Farm Nation registrants error:", error);
        return { success: false, error: "Failed to fetch normalized Farm Nation applications" };
    }
}

/**
 * Get aggregate counts for land_listings by verification status.
 * Uses Firestore COUNT queries — independent of pagination.
 */
export async function getFarmNationVerificationStatsAction(): Promise<{
    success: boolean;
    data?: {
        stats: {
            total: number;
            pending: number;
            verified: number;
            rejected: number;
        };
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || !isAdmin(userDoc.data()?.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-verification-stats";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const [totalSnap, pendingSnap, verifiedSnap] = await Promise.all([
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).count().get(),
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).where("verified", "==", false).count().get(),
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).where("verified", "==", true).count().get(),
        ]);

        const payload = {
            success: true as const,
            data: {
                stats: {
                    total:    totalSnap.data().count,
                    pending:  pendingSnap.data().count, // false
                    verified: verifiedSnap.data().count, // true
                    rejected: 0, // Not supported in boolean schema
                },
            },
        };

        try {
            await setCache(cacheKey, payload, 60); // 60-second cache
        } catch (e) {}

        return payload;
    } catch (error: any) {
        logger.error("getFarmNationVerificationStatsAction error:", error);
        return { success: false, error: "Failed to fetch verification stats" };
    }
}

export async function getAdminLandVerificationsAction(options: {
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || !isAdmin(userDoc.data()?.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        let queryRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).orderBy("createdAt", orderDirection);

        if (options.status && options.status !== "all") {
            const isVerified = options.status === "verified";
            queryRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
                .where("verified", "==", isVerified)
                .orderBy("createdAt", orderDirection);
        }

        let snapshot;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9) {
                logger.warn("Missing index for getAdminLandVerificationsAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).get();
                // We will sort verifications array below
            } else {
                throw e;
            }
        }

        let verifications = snapshot.docs.map(doc => {

            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Map verified boolean to verificationStatus for UI compatibility
                verificationStatus: data.verified ? "verified" : "pending",
                createdAt: data.createdAt?.toDate() || new Date(),
                verifiedAt: data.verifiedAt?.toDate() || undefined,
            };
        }) as any[];

        if (options.search) {
            const q = options.search.toLowerCase();
            verifications = verifications.filter(v => 
                v.ownerName?.toLowerCase().includes(q) ||
                v.name?.toLowerCase().includes(q) ||
                v.state?.toLowerCase().includes(q)
            );
        }

        // Sorting
        const landSortDirection = options.sortOrder || "desc";
        verifications.sort((a: any, b: any) => {
            const dateA = a.createdAt?.getTime?.() || new Date(a.createdAt).getTime();
            const dateB = b.createdAt?.getTime?.() || new Date(b.createdAt).getTime();
            return landSortDirection === "desc" ? dateB - dateA : dateA - dateB;
        });



        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: verifications,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Get admin land verifications error:", error);
        return { success: false, error: error.message };
    }
}

export async function getFarmNationTransactionsAction(options: {
    limit?: number;
    status?: string;
    lastDocId?: string;
} = {}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || !isAdmin(userDoc.data()?.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.limit || 50;
        let queryRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).orderBy("createdAt", "desc");

        if (options.status && options.status !== "all") {
            queryRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
        }

        let snapshot;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9) {
                logger.warn("Missing index for getFarmNationTransactionsAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).get();
            } else {
                throw e;
            }
        }

        let transactions = snapshot.docs.map(doc => {

            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
                paymentVerifiedAt: data.paymentVerifiedAt?.toDate() || undefined,
            };
        }) as any[];

        // Sorting
        transactions.sort((a: any, b: any) => {
            const dateA = a.createdAt?.getTime?.() || new Date(a.createdAt).getTime();
            const dateB = b.createdAt?.getTime?.() || new Date(b.createdAt).getTime();
            return dateB - dateA;
        });


        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: transactions,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Get admin farm nation transactions error:", error);
        return { success: false, error: error.message };
    }
}

export async function releaseFarmNationEscrowAction(transactionId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || !isAdmin(userDoc.data()?.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        const txRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(transactionId);
        
        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");
            const txData = txDoc.data()!;

            if (txData.escrowStatus !== "held" || txData.status !== "payment_confirmed") {
                throw new Error("Transaction is not in a valid state for escrow release");
            }

            const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(txData.propertyId);
            const propertyDoc = await tx.get(propertyRef);
            if (!propertyDoc.exists) throw new Error("Property not found");

            // Finalize transfer of ownership
            tx.update(propertyRef, {
                status: "sold",
                ownerId: txData.buyerId,
                ownerEmail: txData.buyerEmail,
                previousOwnerId: txData.sellerId,
                soldAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Mark Escrow as Released
            tx.update(txRef, {
                status: "completed",
                escrowStatus: "released",
                escrowReleasedAt: FieldValue.serverTimestamp(),
                escrowReleasedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });
            
            // Record the seller payout in ledger
            const payoutRef = db.collection("farm_nation_payouts").doc(transactionId);
            tx.set(payoutRef, {
                transactionId,
                propertyId: txData.propertyId,
                sellerId: txData.sellerId,
                amount: txData.escrowAmount,
                status: "pending_transfer", // Awaiting actual bank transfer
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true, message: "Escrow released and property ownership transferred successfully." };
    } catch (error: any) {
        logger.error("Release Farm Nation Escrow error:", error);
        return { success: false, error: error.message };
    }
}
