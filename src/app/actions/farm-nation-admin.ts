"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "firebase-admin/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

/**
 * Get global stats for Farm Nation admin dashboard
 */
async function _getFarmNationStatsAction(): Promise<ActionResponse<{ stats: { totalApplications: number } }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // Redis error should not block the action
        }

        const countSnap = await db.collection(COLLECTIONS.USERS)
            .where('serviceRegistrations.farmNation.status', '!=', null)
            .count()
            .get();
        const totalApplications = countSnap.data().count;

        const response: ActionResponse<{ stats: { totalApplications: number } }> = {
            success: true,
            error: null,
            data: { stats: { totalApplications } }
        };

        try {
            await setCache(cacheKey, response, 120);
        } catch (e) {
            // Redis error should not block the action
        }

        return response;
    } catch (error: any) {
        logger.error("Get farm nation stats error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch farm nation stats", data: null };
    }
}
export const getFarmNationStatsAction = withFlexibleSafeAction("getFarmNationStatsAction", _getFarmNationStatsAction);

/**
 * Get registrants for Farm Nation (Legacy/General User collection check)
 */
async function _getFarmNationRegistrantsAction(options: { 
    limit?: number;
    page?: number;
    search?: string;
    status?: string;
    lastDocId?: string; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const pageSize = options.search ? 2000 : (options.limit || 20);
        const page = options.page ?? 0;

        // Note: This fetches a large set of users and filters in memory. 
        // This is not ideal for massive scale but works for the current user base.
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
                    farmNation: data.farmNation,
                    serviceRegistrations: { farmNation }
                };
            })
            .filter(Boolean) as any[];

        if (options.status && options.status !== "all") {
            users = users.filter(u => u.serviceRegistrations?.farmNation?.status === options.status);
        }

        if (options.search) {
            const q = options.search.toLowerCase();
            users = users.filter(u =>
                u.name?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q) ||
                u.phone?.includes(q)
            );
        }

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
            error: null, 
            data: paged,
            meta: { 
                hasMore,
                cursor: hasMore ? String(page + 1) : null,
                total: users.length
            }
        };
    } catch (error: any) {
        logger.error("getFarmNationRegistrantsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch farm nation registrants", data: null };
    }
}
export const getFarmNationRegistrantsAction = withFlexibleSafeAction("getFarmNationRegistrantsAction", _getFarmNationRegistrantsAction);

/**
 * Get standard Farm Nation registrants with enriched profile data
 */
async function _getStandardFarmNationRegistrantsAction(options: { 
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS)
            .where('serviceRegistrations.farmNation.status', '!=', null);

        const applicationsSortDirection = options.sortOrder || "desc";

        if (options.dateFrom) {
            const fromTs = new Date(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = new Date(options.dateTo + "T23:59:59");
            q = q.where("createdAt", "<=", toTs);
        }

        q = q.orderBy("createdAt", applicationsSortDirection);

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.USERS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        q = q.limit(fetchLimit);

        const snapshot = await q.get();
        const users = serializeDocs(snapshot.docs);

        let applications = users.filter((user: any) => {
            const status = user.serviceRegistrations?.farmNation?.status || "pending";
            if (options.status && options.status !== "all" && status !== options.status) return false;
            return true;
        }).map((user: any) => {
            const userName = user.firstName
                ? `${user.firstName} ${user.lastName || ''}`.trim()
                : (user.name || user.fullName || user.email || "Unknown User");
            const status = user.serviceRegistrations?.farmNation?.status || "pending";

            const profileAlias = { 
                phone:   user.phone || user.phoneNumber || null,
                state:   user.stateOfOrigin || user.address?.state || user.state || null,
                lga:     user.lga || user.address?.lga || null,
                address: user.residentialAddress || user.address?.street || (typeof user.address === 'string' ? user.address : null) || null 
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
                farmNation: {
                    ...(user.farmNation || {}),
                    profile: {
                        ...(user.farmNation?.profile || {}),
                        phone:   (user.farmNation?.profile?.phone   || profileAlias.phone),
                        state:   (user.farmNation?.profile?.state   || profileAlias.state),
                        lga:     (user.farmNation?.profile?.lga     || profileAlias.lga),
                        address: (user.farmNation?.profile?.address || profileAlias.address) 
                    },
                    interests: user.farmNation?.interests || user.serviceRegistrations?.farmNation?.interests || null 
                } 
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
                    lga: mergedData.lga || "Unknown" 
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

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            error: null, 
            data: applications, 
            meta: {
                totalFetched: users.length, 
                hasMore: !!nextCursor,
                lastDocId: nextCursor
            }
        };
    } catch (error: any) {
        logger.error("Get standard Farm Nation registrants error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch applications", data: null };
    }
}
export const getStandardFarmNationRegistrantsAction = withFlexibleSafeAction("getStandardFarmNationRegistrantsAction", _getStandardFarmNationRegistrantsAction);

/**
 * Get aggregate counts for land_listings by verification status.
 */
async function _getFarmNationVerificationStatsAction(): Promise<ActionResponse<{ stats: { total: number; pending: number; verified: number; rejected: number; } }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-verification-stats";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // Redis error should not block the action
        }

        const [totalSnap, pendingSnap, verifiedSnap] = await Promise.all([
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).count().get(),
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).where("verified", "==", false).count().get(),
            db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).where("verified", "==", true).count().get(),
        ]);

        const stats = {
            total: totalSnap.data().count,
            pending: pendingSnap.data().count,
            verified: verifiedSnap.data().count,
            rejected: 0 // Placeholder if rejection is tracked separately
        };

        const response: ActionResponse<{ stats: { total: number; pending: number; verified: number; rejected: number; } }> = {
            success: true,
            error: null,
            data: { stats }
        };

        try {
            await setCache(cacheKey, response, 60);
        } catch (e) {
            // Redis error should not block the action
        }

        return response;
    } catch (error: any) {
        logger.error("getFarmNationVerificationStatsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch stats", data: null };
    }
}
export const getFarmNationVerificationStatsAction = withFlexibleSafeAction("getFarmNationVerificationStatsAction", _getFarmNationVerificationStatsAction);

/**
 * Get land listings for admin verification
 */
async function _getAdminLandVerificationsAction(options: { 
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).orderBy("createdAt", orderDirection);

        if (options.status && options.status !== "all") {
            const isVerified = options.status === "verified";
            queryRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
                .where("verified", "==", isVerified)
                .orderBy("createdAt", orderDirection);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
        let verifications = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                verificationStatus: data.verified ? "verified" : "pending",
                createdAt: data.createdAt?.toDate() || new Date(),
                verifiedAt: data.verifiedAt?.toDate() || undefined
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

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            error: null, 
            data: verifications, 
            meta: {
                lastDocId: nextCursor, 
                hasMore: !!nextCursor
            }
        };
    } catch (error: any) {
        logger.error("Get admin land verifications error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch verifications", data: null };
    }
}
export const getAdminLandVerificationsAction = withFlexibleSafeAction("getAdminLandVerificationsAction", _getAdminLandVerificationsAction);

/**
 * Get farm nation transactions
 */
async function _getFarmNationTransactionsAction(options: { 
    limit?: number;
    status?: string;
    lastDocId?: string; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const fetchLimit = options.limit || 50;
        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).orderBy("createdAt", "desc");

        if (options.status && options.status !== "all") {
            queryRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
        let transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
                paymentVerifiedAt: data.paymentVerifiedAt?.toDate() || undefined
            };
        }) as any[];

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            error: null, 
            data: transactions, 
            meta: {
                lastDocId: nextCursor, 
                hasMore: !!nextCursor
            }
        };
    } catch (error: any) {
        logger.error("Get admin farm nation transactions error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch transactions", data: null };
    }
}
export const getFarmNationTransactionsAction = withFlexibleSafeAction("getFarmNationTransactionsAction", _getFarmNationTransactionsAction);

/**
 * Release escrow and transfer property ownership
 */
async function _releaseFarmNationEscrowAction(transactionId: string): Promise<ActionResponse<{ message: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
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

            tx.update(propertyRef, {
                status: "sold",
                ownerId: txData.buyerId,
                ownerEmail: txData.buyerEmail,
                previousOwnerId: txData.sellerId,
                soldAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            tx.update(txRef, {
                status: "completed",
                escrowStatus: "released",
                escrowReleasedAt: FieldValue.serverTimestamp(),
                escrowReleasedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            const payoutRef = db.collection("farm_nation_payouts").doc(transactionId);
            tx.set(payoutRef, {
                transactionId,
                propertyId: txData.propertyId,
                sellerId: txData.sellerId,
                amount: txData.escrowAmount,
                status: "pending_transfer",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });
        });

        return { 
            success: true, 
            error: null, 
            data: { message: "Escrow released and property ownership transferred successfully." }
        };
    } catch (error: any) {
        logger.error("Release Farm Nation Escrow error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: error.message || "Failed to release escrow", data: null };
    }
}
export const releaseFarmNationEscrowAction = withFlexibleSafeAction("releaseFarmNationEscrowAction", _releaseFarmNationEscrowAction);
