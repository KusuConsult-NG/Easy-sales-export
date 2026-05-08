"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "firebase-admin/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";

async function _getFarmNationStatsAction(): Promise<{ success: true; data: { stats: { totalApplications: number } } } | { success: false; error: string }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
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
        logger.error("Get farm nation stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch farm nation stats" };
    }
}
export const getFarmNationStatsAction = withFlexibleSafeAction("getFarmNationStatsAction", _getFarmNationStatsAction);

async function _getFarmNationRegistrantsAction(options: {
    limit?: number;
    page?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
} = {}): Promise<{
    success: true | false;
    data?: any;
    meta?: any;
    error?: string;
}> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !isAdmin(session.user.roles)) {
            return { error: "Unauthorized: Permission required", success: false };
        }

        const pageSize = options.search ? 2000 : (options.limit || 20);
        const page = options.page ?? 0;

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
                    serviceRegistrations: { farmNation },
                };
            })
            .filter(Boolean) as any[];

        if (options.status && options.status !== "all") {
            users = users.filter(u =>
                u.serviceRegistrations?.farmNation?.status === options.status
            );
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
            success: true as const,
            data: { users: paged },
            meta: {
                hasMore,
                cursor: hasMore ? String(page + 1) : null
            }
        };
    } catch (error: any) {
        logger.error("getFarmNationRegistrantsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            success: false as const,
            data: null,
            meta: null,
            error: "Failed to fetch farm nation registrants",
        };
    }
}
export const getFarmNationRegistrantsAction = withFlexibleSafeAction("getFarmNationRegistrantsAction", _getFarmNationRegistrantsAction);

async function _getStandardFarmNationRegistrantsAction(options: {
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}): Promise<{ success: true; data: any[]; lastDocId?: string; hasMore?: boolean; meta?: any } | { success: false; error: string }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            data: applications,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: users.length,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard Farm Nation registrants error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch applications" };
    }
}
export const getStandardFarmNationRegistrantsAction = withFlexibleSafeAction("getStandardFarmNationRegistrantsAction", _getStandardFarmNationRegistrantsAction);

/**
 * Get aggregate counts for land_listings by verification status.
 * Uses Firestore COUNT queries — independent of pagination.
 */
async function _getFarmNationVerificationStatsAction(): Promise<{
    success: true | false;
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
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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
                    pending:  pendingSnap.data().count,
                    verified: verifiedSnap.data().count,
                    rejected: 0,
                },
            },
        };

        try {
            await setCache(cacheKey, payload, 60);
        } catch (e) {}

        return payload;
    } catch (error: any) {
        logger.error("getFarmNationVerificationStatsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch stats" };
    }
}
export const getFarmNationVerificationStatsAction = withFlexibleSafeAction("getFarmNationVerificationStatsAction", _getFarmNationVerificationStatsAction);

async function _getAdminLandVerificationsAction(options: {
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<{ success: true | false; data?: any[]; error?: string; lastDocId?: string; hasMore?: boolean }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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

        const snapshot = await queryRef.limit(fetchLimit).get();
        let verifications = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
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

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            data: verifications,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Get admin land verifications error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch verifications" };
    }
}
export const getAdminLandVerificationsAction = withFlexibleSafeAction("getAdminLandVerificationsAction", _getAdminLandVerificationsAction);

async function _getFarmNationTransactionsAction(options: {
    limit?: number;
    status?: string;
    lastDocId?: string;
} = {}): Promise<{ success: true | false; data?: any[]; error?: string; lastDocId?: string; hasMore?: boolean }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const fetchLimit = options.limit || 50;
        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).orderBy("createdAt", "desc");

        if (options.status && options.status !== "all") {
            queryRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
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

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            data: transactions,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Get admin farm nation transactions error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch transactions" };
    }
}
export const getFarmNationTransactionsAction = withFlexibleSafeAction("getFarmNationTransactionsAction", _getFarmNationTransactionsAction);

async function _releaseFarmNationEscrowAction(transactionId: string): Promise<{ success: true | false; message?: string; error?: string }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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
                _version: FieldValue.increment(1),
            });

            tx.update(txRef, {
                status: "completed",
                escrowStatus: "released",
                escrowReleasedAt: FieldValue.serverTimestamp(),
                escrowReleasedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
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
                _version: 0,
            });
        });

        return { success: true as const, message: "Escrow released and property ownership transferred successfully." };
    } catch (error: any) {
        logger.error("Release Farm Nation Escrow error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message || "Failed to release escrow" };
    }
}
export const releaseFarmNationEscrowAction = withFlexibleSafeAction("releaseFarmNationEscrowAction", _releaseFarmNationEscrowAction);
