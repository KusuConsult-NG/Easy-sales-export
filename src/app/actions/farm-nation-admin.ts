"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransition } from "@/lib/status-transition";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";


/**
 * Get global stats for Farm Nation admin dashboard
 */
async function _getFarmNationStatsAction(): Promise<ActionResponse<{ stats: { totalApplications: number } }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
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

        const countSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
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
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const pageSize = options.search ? 5000 : (options.limit || 20);
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
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date(0).toISOString(),
                    farmNation: data.farmNation,
                    serviceRegistrations: { farmNation }
                };
            })
            .filter(Boolean) as any[];

        if (options.status && options.status !== "all") {
            users = users.filter(u => u.serviceRegistrations?.farmNation?.status === options.status);
        }

        if (options.search) {
            const q = options.search.toLowerCase().trim();
            users = users.filter((u: any) => {
                const searchString = [u.name, u.email, u.phone].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
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
    status?: "pending" | "approved" | "rejected" | "under_review" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    sortBy?: "createdAt" | "gender";
    dateFrom?: string;
    dateTo?: string; 
} = {}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const useMemoryPagination = options.sortBy === "gender" || !!options.search || !!options.dateFrom || !!options.dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const applicationsSortDirection = options.sortOrder || "desc";

        let applications: any[] = [];
        let hasMoreRaw = false;

        if (options.search) {
            const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
            const matchingUserIds = await searchUserIdsByQuery(options.search);
            if (matchingUserIds.length === 0) {
                return {
                    success: true,
                    error: null,
                    data: [],
                    meta: {
                        totalFetched: 0,
                        hasMore: false,
                        lastDocId: null
                    }
                };
            }

            const querySnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "in", matchingUserIds)
                .get();

            applications = serializeDocs(querySnap.docs);
            if (options.status && options.status !== "all") {
                applications = applications.filter(app => app.status === options.status);
            }
            if (options.dateFrom) {
                const from = new Date(options.dateFrom);
                from.setHours(0, 0, 0, 0);
                applications = applications.filter(app => {
                    const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = new Date(options.dateTo);
                to.setHours(23, 59, 59, 999);
                applications = applications.filter(app => {
                    const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                    return d <= to;
                });
            }
        } else {
            let q: any = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).orderBy("submittedAt", applicationsSortDirection);

            if (options.status && options.status !== "all") {
                q = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                    .where("status", "==", options.status)
                    .orderBy("submittedAt", applicationsSortDirection);
            }

            if (options.dateFrom) {
                const fromTs = dateRangeStart(options.dateFrom);
                q = q.where("submittedAt", ">=", fromTs);
            }
            if (options.dateTo) {
                const toTs = dateRangeEnd(options.dateTo);
                q = q.where("submittedAt", "<=", toTs);
            }

            if (options.lastDocId && !useMemoryPagination) {
                const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(options.lastDocId).get();
                if (lastDoc.exists) {
                    q = q.startAfter(lastDoc);
                }
            }

            q = q.limit(fetchLimit + 1);
            const snapshot = await q.get();
            applications = serializeDocs(snapshot.docs);
            hasMoreRaw = applications.length > fetchLimit;
            if (!useMemoryPagination) {
                applications = applications.slice(0, fetchLimit);
            }
        }

        // 2. Hydrate User Data (Standard Hydration Pattern)
        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeDoc(d.id, d.data()))));

        // 3. Normalize and Merge Data for the Admin Table
        let finalApplications = applications.map((app: any) => {
            const uData = (userMap.get(app.userId) || {}) as any;
            const profile = (app.profile || app.personalInfo || {}) as any;
            
            // Reconstruct the userName
            const userName = profile.firstName 
                ? `${profile.firstName} ${profile.lastName || ''}`.trim() 
                : (profile.fullName || uData.fullName || uData.name || "Unknown");

            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || "N/A",
                accountNumber: uData.bankAccountNumber || "N/A",
                accountName: uData.bankAccountName || "N/A",
                bankCode: uData.bankCode || "N/A"
            };

            const mergedData = {
                ...uData,
                ...app,
                // Flatten profile fields to top-level for UI consistency
                phone: app.phone || profile.phone || profile.phoneNumber || uData.phone || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                email: app.email || profile.email || uData.email || null,
                stateOfOrigin: profile.state || uData.state || uData.stateOfOrigin || (typeof uData.address === 'object' ? uData.address?.state : uData.stateOfOrigin) || null,
                lga: profile.lga || uData.lga || (typeof uData.address === 'object' ? uData.address?.lga : uData.lga) || null,
                residentialAddress: profile.address || profile.residentialAddress || uData.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                firstName: profile.firstName || uData.firstName || null,
                lastName: profile.lastName || uData.lastName || null,
                fullName: userName
            };

            return {
                id: app.id,
                userId: app.userId,
                user: {
                    id: app.userId,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                    gender: mergedData.gender || "Unknown",
                    bankDetails
                },
                status: app.status,
                data: mergedData,
                submittedAt: app.submittedAt
            };
        });

        // Sort by Gender in-memory if requested
        if (options.sortBy === "gender") {
            finalApplications.sort((a: any, b: any) => {
                const ga = (a.user?.gender || a.data?.gender || "").toLowerCase();
                const gb = (b.user?.gender || b.data?.gender || "").toLowerCase();
                if (applicationsSortDirection === "asc") {
                    return ga.localeCompare(gb);
                } else {
                    return gb.localeCompare(ga);
                }
            });
        }

        // 4. Client-side Search (if requested)
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalApplications = finalApplications.filter((app: any) => {
                const searchString = [
                    app.id,
                    app.userId,
                    app.user?.name,
                    app.user?.email,
                    app.user?.phone,
                    app.data?.firstName,
                    app.data?.lastName,
                    app.data?.fullName,
                    app.data?.stateOfOrigin
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            finalApplications = finalApplications.filter((app: any) => {
                const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
            finalApplications = finalApplications.filter((app: any) => {
                const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                return d <= to;
            });
        }

        const limit = options.limit || 50;
        let page = 0;
        if ((options as any).page !== undefined) {
            page = Number((options as any).page);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = useMemoryPagination ? finalApplications.slice(offset, offset + limit) : finalApplications;
        const hasMore = useMemoryPagination 
            ? (offset + limit < finalApplications.length) 
            : hasMoreRaw;
            
        const nextCursor = useMemoryPagination 
            ? (hasMore ? String(page + 1) : null)
            : (hasMore ? applications[applications.length - 1].id : null);

        await createAdminAuditLog({
            action: "data_access",
            userId: session.user.id,
            targetType: "farm_nation_applications",
            targetId: "list",
            details: `Accessed Farm Nation registrants list (limit: ${fetchLimit}, status: ${options.status || 'all'})`,
            metadata: { options }
        });

        return { 
            success: true, 
            error: null, 
            data: paged, 
            meta: {
                totalFetched: finalApplications.length, 
                hasMore: hasMore,
                lastDocId: nextCursor
            }
        };
    } catch (error: any) {
        logger.error("Get standard Farm Nation registrants error:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
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
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
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

        const [totalSnap, pendingSnap1, pendingSnap2, verifiedSnap, rejectedSnap] = await Promise.all([
            db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending_verification").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "inspection_scheduled").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
        ]);

        const stats = {
            total: totalSnap.data().count,
            pending: pendingSnap1.data().count + pendingSnap2.data().count,
            verified: verifiedSnap.data().count,
            rejected: rejectedSnap.data().count
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
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const useMemoryPagination = !!options.search;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LAND_LISTINGS).orderBy("createdAt", orderDirection);

        if (options.status && options.status !== "all" && !useMemoryPagination) {
            const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
            if (mappedStatus === "pending_verification") {
                queryRef = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "in", ["pending_verification", "inspection_scheduled"])
                    .orderBy("createdAt", orderDirection);
            } else {
                queryRef = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "==", mappedStatus)
                    .orderBy("createdAt", orderDirection);
            }
        }

        if (options.lastDocId && !useMemoryPagination) {
            const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.toLowerCase()?.includes("index")) {
                logger.warn("getAdminLandVerificationsAction query failed (missing index). Falling back to memory sorting.");
                indexError = true;
                
                let fallbackQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LAND_LISTINGS);
                if (options.status && options.status !== "all" && !useMemoryPagination) {
                    const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
                    if (mappedStatus === "pending_verification") {
                        fallbackQuery = fallbackQuery.where("status", "in", ["pending_verification", "inspection_scheduled"]);
                    } else {
                        fallbackQuery = fallbackQuery.where("status", "==", mappedStatus);
                    }
                }
                
                if (options.lastDocId && !useMemoryPagination) {
                    const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(options.lastDocId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }
                
                snapshot = await fallbackQuery.limit(fetchLimit).get();
            } else {
                throw e;
            }
        }

        const rawVerifications = serializeDocs(snapshot.docs).map((doc: any) => {
            let mappedVerificationStatus = "pending";
            if (doc.status === "verified") mappedVerificationStatus = "verified";
            else if (doc.status === "rejected") mappedVerificationStatus = "rejected";
            else if (doc.status === "pending_verification" || doc.status === "inspection_scheduled") mappedVerificationStatus = "pending";
            
            let docsObj = { landTitle: "", surveyPlan: "", taxClearance: "" };
            if (doc.documents) {
                if (Array.isArray(doc.documents)) {
                    const landTitle = doc.documents.find((url: string) => url && (url.includes("_title_") || url.includes("title"))) || doc.documents[0] || "";
                    const surveyPlan = doc.documents.find((url: string) => url && (url.includes("_survey_") || url.includes("survey"))) || doc.documents[1] || "";
                    const taxClearance = doc.documents.find((url: string) => url && (url.includes("_tax_") || url.includes("tax"))) || doc.documents[2] || undefined;
                    docsObj = { landTitle, surveyPlan, taxClearance };
                } else if (typeof doc.documents === "object") {
                    docsObj = {
                        landTitle: doc.documents.landTitle || "",
                        surveyPlan: doc.documents.surveyPlan || "",
                        taxClearance: doc.documents.taxClearance || undefined
                    };
                }
            }

            return {
                ...doc,
                totalPrice: doc.totalPrice ?? doc.price ?? 0,
                price: doc.price ?? doc.totalPrice ?? 0,
                verificationStatus: mappedVerificationStatus,
                documents: docsObj,
                createdAt: doc.createdAt || new Date().toISOString(),
                verifiedAt: doc.verificationStatus?.verifiedAt || doc.verifiedAt || undefined
            };
        }) as any[];

        if (indexError) {
            rawVerifications.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return orderDirection === "desc" ? bTime - aTime : aTime - bTime;
            });
        }

        let filteredVerifications = rawVerifications;
        if (options.search) {
            const q = options.search.toLowerCase().trim();
            filteredVerifications = filteredVerifications.filter((v: any) => {
                const searchString = [
                    v.ownerName, v.name, v.state, v.lga, v.size, v.pricePerUnit
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        // Calculate dynamic cohort stats
        let stats: any = null;
        if (useMemoryPagination) {
            const total = filteredVerifications.length;
            const pending = filteredVerifications.filter((v: any) => v.verificationStatus === "pending").length;
            const verified = filteredVerifications.filter((v: any) => v.verificationStatus === "verified").length;
            const rejected = filteredVerifications.filter((v: any) => v.verificationStatus === "rejected").length;
            stats = { total, pending, verified, rejected };

            // Apply status filter in memory
            if (options.status && options.status !== "all") {
                const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
                filteredVerifications = filteredVerifications.filter((v: any) => {
                    if (mappedStatus === "pending_verification") {
                        return v.status === "pending_verification" || v.status === "inspection_scheduled";
                    }
                    return v.status === mappedStatus;
                });
            }
        } else {
            const [totalSnap, pendingSnap1, pendingSnap2, verifiedSnap, rejectedSnap] = await Promise.all([
                db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending_verification").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "inspection_scheduled").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
            ]);
            stats = {
                total: totalSnap.data().count,
                pending: pendingSnap1.data().count + pendingSnap2.data().count,
                verified: verifiedSnap.data().count,
                rejected: rejectedSnap.data().count
            };
        }

        const limit = options.limit || 50;
        let page = 0;
        const pageOption = (options as any).page;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = useMemoryPagination ? filteredVerifications.slice(offset, offset + limit) : filteredVerifications;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < filteredVerifications.length)
            : (snapshot.docs.length === fetchLimit);

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : (snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined);

        // HYDRATION: Batch-resolve owner bank details for active page slice only
        const ownerIds = [...new Set(paged.map((v: any) => v.ownerId).filter(Boolean))];
        const ownerMap: Record<string, any> = {};

        if (ownerIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < ownerIds.length; i += 30) {
                chunks.push(ownerIds.slice(i, i + 30));
            }

            const ownerSnapsArray = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            ownerSnapsArray.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    ownerMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || data.phoneNumber || data.kyc?.phoneNumber || data.kyc?.phone || "",
                        bankDetails: data.bankDetails || {
                            bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "N/A"),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                        }
                    };
                });
            });
        }

        const verifications = paged.map((v: any) => ({
            ...v,
            owner: ownerMap[v.ownerId] || null,
            bankDetails: ownerMap[v.ownerId]?.bankDetails || {
                bankName: "N/A",
                accountNumber: "N/A",
                accountName: "N/A",
                bankCode: "N/A"
            }
        }));

        return { 
            success: true, 
            error: null, 
            data: verifications, 
            meta: {
                lastDocId: _nextCursor || null, 
                hasMore: _hasMore,
                stats
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
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const fetchLimit = options.limit || 50;
        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).orderBy("createdAt", "desc");

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

        let snapshot;
        let indexError = false;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.toLowerCase()?.includes("index")) {
                logger.warn("getFarmNationTransactionsAction query failed (missing index). Falling back to memory sorting.");
                indexError = true;
                
                let fallbackQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS);
                if (options.status && options.status !== "all") {
                    fallbackQuery = fallbackQuery.where("status", "==", options.status);
                }
                
                if (options.lastDocId) {
                    const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(options.lastDocId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }
                
                snapshot = await fallbackQuery.limit(fetchLimit).get();
            } else {
                throw e;
            }
        }

        const transactions = serializeDocs(snapshot.docs).map((doc: any) => ({
            ...doc,
            createdAt: doc.createdAt || new Date().toISOString(),
            updatedAt: doc.updatedAt || new Date().toISOString(),
            paymentVerifiedAt: doc.paymentVerifiedAt || undefined
        })) as any[];

        if (indexError) {
            transactions.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
        }

        // HYDRATION: Batch-resolve user bank details (Sellers/Participants)
        const participantIds = [...new Set(transactions.map((t: any) => t.sellerId).filter(Boolean))];
        const participantMap: Record<string, any> = {};

        if (participantIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < participantIds.length; i += 30) {
                chunks.push(participantIds.slice(i, i + 30));
            }

            const participantSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where("__name__", "in", chunk)
                        .get()
                )
            );

            participantSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    participantMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: data.bankDetails || {
                            bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "N/A"),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                        }
                    };
                });
            });
        }

        const enrichedTransactions = transactions.map((t: any) => ({
            ...t,
            participant: participantMap[t.sellerId] || null,
            // Fallback for UI components expecting root bankDetails
            bankDetails: participantMap[t.sellerId]?.bankDetails || {
                bankName: "N/A",
                accountNumber: "N/A",
                accountName: "N/A",
                bankCode: "N/A"
            }
        }));

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            error: null, 
            data: enrichedTransactions, 
            meta: {
                lastDocId: nextCursor, 
                hasMore: !!nextCursor,
                totalFetched: enrichedTransactions.length
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
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const txRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(transactionId);
        
        // Escrow release transfers a property and queues a payout, off a
        // check-then-write that took no lock. Two admins releasing the same
        // escrow both read "held"/"payment_confirmed" and both proceeded.
        //
        // The payout row is keyed on the transaction id, so it could not
        // duplicate — but the ownership transfer and the escrow release both
        // ran twice, and nothing recorded that they had.
        // Everything knowable is checked BEFORE the claim.
        //
        // Claiming first is right — it is what stops two admins both releasing —
        // but it also means anything that throws afterwards leaves the
        // transaction reading "completed" and "released" with the property never
        // transferred and no payout row written. The claim cannot be retried,
        // because a second attempt no longer sees "payment_confirmed": the
        // seller is simply never paid, and the record says the release
        // succeeded.
        //
        // The property going missing and the escrow amount being absent are both
        // knowable now, while backing out still costs nothing. What remains
        // after the claim is a write failure, which is a reconciliation problem
        // rather than a silent one.
        const preTx = await txRef.get();
        if (!preTx.exists) {
            return { success: false, error: "Transaction not found", data: null };
        }

        const preTxData = preTx.data()!;
        const preAmount = Number(preTxData.escrowAmount ?? 0);
        if (!Number.isFinite(preAmount) || preAmount <= 0) {
            return { success: false, error: "Transaction has no escrow amount to release", data: null };
        }

        if (!preTxData.propertyId) {
            return { success: false, error: "Transaction is not linked to a property", data: null };
        }

        const preProperty = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(preTxData.propertyId).get();
        if (!preProperty.exists) {
            return { success: false, error: "Property not found", data: null };
        }

        const releaseClaim = await claimStatusTransition({
            collection: COLLECTIONS.FARM_NATION_TRANSACTIONS,
            id: transactionId,
            from: "payment_confirmed",
            to: "completed",
            patch: {
                escrowStatus: "released",
                escrowReleasedAt: new Date().toISOString(),
                escrowReleasedBy: session.user.id,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!releaseClaim.claimed) {
            return {
                success: false,
                error: releaseClaim.status === null
                    ? "Transaction not found"
                    : "Transaction is not in a valid state for escrow release",
                data: null,
            };
        }

        await (async () => {
            const txDoc = await txRef.get();
            if (!txDoc.exists) throw new Error("Transaction not found");
            const txData = txDoc.data()!;

            const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(txData.propertyId);
            const propertyDoc = await propertyRef.get();
            if (!propertyDoc.exists) throw new Error("Property not found");

            const isLease = propertyDoc.data()?.type === "lease";
            await propertyRef.update({
                status: isLease ? "leased" : "sold",
                ownerId: txData.buyerId,
                ownerEmail: txData.buyerEmail,
                previousOwnerId: txData.sellerId,
                ...(isLease 
                    ? { leasedAt: FieldValue.serverTimestamp() }
                    : { soldAt: FieldValue.serverTimestamp() }),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            // Status and escrowStatus are written by the claim above; only the
            // version bump the CAS patch cannot carry remains.
            await txRef.update({
                _version: FieldValue.increment(1)
            });

            const payoutRef = db.collection("farm_nation_payouts").doc(transactionId);
            await payoutRef.set({
                transactionId,
                propertyId: txData.propertyId,
                sellerId: txData.sellerId,
                amount: txData.escrowAmount,
                status: "pending_transfer",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });
        })();

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

/**
 * Update Land Listing Details (Admin only)
 */
async function _updateAdminLandListingAction(data: {
    listingId: string;
    title: string;
    category: string;
    state: string;
    lga: string;
    address?: string;
    size: number;
    price: number;
    gpsCoordinates?: { latitude: number; longitude: number };
}): Promise<ActionResponse<null>> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    if (!isAdmin(session.user.roles)) {
        return { success: false, error: "Unauthorized: Admin access required", data: null };
    }

    try {
        const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(data.listingId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return { success: false, error: "Land listing not found", data: null };
        }

        const updateData: any = {
            title: data.title,
            category: data.category,
            location: {
                state: data.state,
                lga: data.lga,
                address: data.address || doc.data()?.location?.address || ""
            },
            size: Number(data.size),
            price: Number(data.price),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (data.gpsCoordinates) {
            updateData.gpsCoordinates = {
                latitude: Number(data.gpsCoordinates.latitude),
                longitude: Number(data.gpsCoordinates.longitude)
            };
        }

        await docRef.update(updateData);

        // Create audit log
        await createAdminAuditLog({
            action: "land_updated",
            userId: session.user.id,
            userEmail: session.user.email || "",
            targetId: data.listingId,
            targetType: "land_listing",
            metadata: {
                title: data.title,
                size: data.size,
                price: data.price,
                reason: "Admin corrected details"
            }
        });

        return { success: true, error: null, data: null };
    } catch (e: any) {
        logger.error("updateAdminLandListingAction error:", e);
        return { success: false, error: e.message || "Failed to update land listing details", data: null };
    }
}
export const updateAdminLandListingAction = withFlexibleSafeAction("updateAdminLandListingAction", _updateAdminLandListingAction);
