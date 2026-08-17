"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";

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
                const from = dateRangeStart(options.dateFrom);
                applications = applications.filter(app => {
                    const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = dateRangeEnd(options.dateTo);
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
            const from = dateRangeStart(options.dateFrom);
            finalApplications = finalApplications.filter((app: any) => {
                const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
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
