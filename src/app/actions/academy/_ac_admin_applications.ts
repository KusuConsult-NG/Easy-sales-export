"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { createAdminAuditLog } from "@/lib/audit-log";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { resolveApplicationPlan } from "@/lib/academy-plan";

/**
 * Get Pending Academy Applications (Admin)
 */
async function _getPendingAcademyApplicationsAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&
            !session.user.roles?.includes("academy_admin")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const , data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("status", "==", "pending")
            .get();

        const applications = serializeDocs(snapshot.docs);

        // Standard Hydration Pattern
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
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));

        const enrichedApps = applications.map(app => {
            const uData = userMap.get(app.userId as string) || {};
            const pi = (app.personalInfo || {}) as any;
            
            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || uData.bankAccount?.bankName || "N/A",
                accountNumber: uData.bankAccountNumber || uData.bankAccount?.accountNumber || "N/A",
                accountName: uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : "N/A"),
                bankCode: uData.bankCode || uData.bankAccount?.bankCode || "N/A"
            };

            return {
                ...app,
                userProfile: {
                    name: uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (uData.name || pi.fullName || "Unknown"),
                    email: uData.email || pi.email || "N/A",
                    phone: uData.phone || uData.phoneNumber || pi.phone || "N/A"
                },
                bankDetails
            };
        });

        // Ensure sorting is consistent after serialization
        enrichedApps.sort((a: any, b: any) =>
            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        );

        return { success: true, error: null, data: enrichedApps };
    } catch (error: any) {
        logger.error("Get pending Academy applications error:", error);
        return { success: false, error: "Failed to fetch applications", data: null };
    }
}

export const getPendingAcademyApplicationsAction = withFlexibleSafeAction("getPendingAcademyApplicationsAction", _getPendingAcademyApplicationsAction);


async function _getAcademyApplicationStatsAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        // Ensure user has admin permissions
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const [pendingSnap, underReviewSnap, approvedSnap, rejectedSnap] = await Promise.all([
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "under_review").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "approved").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "rejected").count().get(),
        ]);

        const pending = pendingSnap.data().count;
        const under_review = underReviewSnap.data().count;
        const approved = approvedSnap.data().count;
        const rejected = rejectedSnap.data().count;
        const totalApplications = pending + under_review + approved + rejected;

        return {
            success: true,
            error: null,
            data: {
                stats: {
                    totalApplications,
                    pending,
                    under_review,
                    approved,
                    rejected
                }
            }
        };
    } catch (error: any) {
        logger.error("Get Academy application stats error:", error);
        return { success: false, error: "Failed to fetch application statistics", data: null };
    }
}

export const getAcademyApplicationStatsAction = withFlexibleSafeAction("getAcademyApplicationStatsAction", _getAcademyApplicationStatsAction);


async function _getStandardAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "approved" | "rejected" | "under_review" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    sortBy?: "createdAt" | "gender";
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
    paymentStatus?: "completed" | "pending" | "all";
    registry?: "legacy" | "regular" | "all";
} = {}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo || (options.paymentStatus && options.paymentStatus !== "all") || (options.registry && options.registry !== "all") || options.sortBy === "gender";
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        
        let snapshot: any = null;
        let applications: any[] = [];

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
                        lastDocId: null,
                        stats: {
                            totalApplications: 0,
                            pending: 0,
                            under_review: 0,
                            approved: 0,
                            rejected: 0
                        }
                    }
                };
            }

            const querySnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "in", matchingUserIds)
                .get();

            applications = serializeDocs(querySnap.docs);
        } else {
            let q: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).orderBy("submittedAt", orderDirection);

            if (!useMemoryPagination) {
                if (options.status && options.status !== "all") {
                    q = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                        .where("status", "==", options.status)
                        .orderBy("submittedAt", orderDirection);
                }
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
                const lastDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(options.lastDocId).get();
                if (lastDoc.exists) {
                    q = q.startAfter(lastDoc);
                }
            }
            q = q.limit(fetchLimit);

            snapshot = await q.get();
            applications = serializeDocs(snapshot.docs);
        }

        // Perform cohort filtering & stats calculations in memory
        let stats: any = null;
        if (useMemoryPagination) {
            // Apply date filters in memory if they were not applied in Firestore query
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

            // Apply registry type filter
            if (options.registry && options.registry !== "all") {
                applications = applications.filter(app => {
                    const isLegacy = !!(app._isLegacy || app.isLegacy);
                    return options.registry === "legacy" ? isLegacy : !isLegacy;
                });
            }

            // Apply payment status filter
            if (options.paymentStatus && options.paymentStatus !== "all") {
                applications = applications.filter(app => {
                    const isPaid = app.paymentStatus === "completed" || app.paymentStatus === "paid";
                    return options.paymentStatus === "completed" ? isPaid : !isPaid;
                });
            }

            // Apply in-memory search
            if (options.search) {
                const s = options.search.toLowerCase().trim();
                const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
                const matchingUserIds = await searchUserIdsByQuery(options.search);
                const matchingUserIdsSet = new Set(matchingUserIds);
                applications = applications.filter(app => {
                    const pi = app.personalInfo || {};
                    const searchString = [
                        app.id,
                        app.userId,
                        pi.fullName,
                        pi.firstName,
                        pi.lastName,
                        pi.email,
                        pi.phone,
                        app.paymentStatus,
                        app.plan
                    ].filter(Boolean).map(String).join(" ").toLowerCase();
                    return searchString.includes(s) || matchingUserIdsSet.has(app.userId);
                });
            }

            // Calculate stats counts before status filter is applied
            const pending = applications.filter(app => app.status === "pending").length;
            const under_review = applications.filter(app => app.status === "under_review").length;
            const approved = applications.filter(app => app.status === "approved").length;
            const rejected = applications.filter(app => app.status === "rejected").length;
            stats = {
                totalApplications: pending + under_review + approved + rejected,
                pending,
                under_review,
                approved,
                rejected
            };

            // Apply status filter
            if (options.status && options.status !== "all") {
                applications = applications.filter(app => app.status === options.status);
            }
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
        const paged = useMemoryPagination ? applications.slice(offset, offset + limit) : applications;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < applications.length)
            : (snapshot.docs.length === fetchLimit);

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : (snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined);

        // 2. Hydrate User Data for active page slice only
        let standardForms: any[] = [];
        if (options.sortBy === "gender") {
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
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));

            const mapped = applications.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const pi = (app.personalInfo || {}) as any;
                
                const userName = uData.firstName
                    ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                    : (uData.name || uData.fullName || pi.fullName || (pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : "Unknown User"));

                const mergedData = {
                    ...uData,
                    ...app,
                    phone: app.phone || pi.phone || uData.phone || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                    email: app.email || pi.email || uData.email || null,
                    gender: app.gender || pi.gender || uData.gender || null,
                    dateOfBirth: app.dateOfBirth || pi.dateOfBirth || uData.dob || null,
                    occupation: app.occupation || pi.occupation || uData.occupation || null,
                    stateOfOrigin: app.stateOfOrigin || pi.stateOfOrigin || uData.state || uData.stateOfOrigin || (typeof uData.address === 'object' ? uData.address?.state : uData.stateOfOrigin) || uData.verificationProfile?.address?.state || null,
                    lga: app.lga || pi.lga || uData.lga || (typeof uData.address === 'object' ? uData.address?.lga : uData.lga) || null,
                    residentialAddress: app.residentialAddress || pi.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                    fullName: userName,
                    // The tier, repaired on read. `...app` above carries the
                    // literal "registration" that every application row was
                    // written with, so the badge and the CSV said "Registration"
                    // for every learner — including everyone who paid the elite
                    // fee, with the correct amount displayed beside it. The user
                    // document holds the plan the fulfilment paths verified the
                    // payment against. See lib/academy-plan.ts.
                    plan: resolveApplicationPlan(
                        app.plan,
                        uData?.serviceRegistrations?.academy?.plan,
                    ),
                };

                const bankDetails = uData.bankDetails || {
                    bankName: uData.bankName || "N/A",
                    accountNumber: uData.bankAccountNumber || "N/A",
                    accountName: uData.bankAccountName || "N/A",
                    bankCode: uData.bankCode || "N/A"
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
                    status: app.status || "pending",
                    data: mergedData,
                    submittedAt: app.submittedAt,
                    isLegacy: !!(app._isLegacy || uData.legacyOnboardedBy || uData.isLegacy || app.isLegacy)
                };
            });

            // Sort by gender in-memory
            const order = options.sortOrder || "desc";
            mapped.sort((a, b) => {
                const ga = (a.user?.gender || "").toLowerCase();
                const gb = (b.user?.gender || "").toLowerCase();
                if (ga === gb) {
                    const aTime = a.submittedAt?.seconds ? a.submittedAt.seconds * 1000 : new Date(a.submittedAt || 0).getTime();
                    const bTime = b.submittedAt?.seconds ? b.submittedAt.seconds * 1000 : new Date(b.submittedAt || 0).getTime();
                    return bTime - aTime;
                }
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
            });

            standardForms = mapped.slice(offset, offset + limit);
        } else {
            const userIds = [...new Set(paged.map(app => app.userId).filter(Boolean))];
            const userMap = new Map<string, any>();
            const userPromises = [];
            for (let i = 0; i < userIds.length; i += 30) {
                const chunk = userIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));

            standardForms = paged.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const pi = (app.personalInfo || {}) as any;
                
                const userName = uData.firstName
                    ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                    : (uData.name || uData.fullName || pi.fullName || (pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : "Unknown User"));

                const mergedData = {
                    ...uData,
                    ...app,
                    phone: app.phone || pi.phone || uData.phone || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                    email: app.email || pi.email || uData.email || null,
                    gender: app.gender || pi.gender || uData.gender || null,
                    dateOfBirth: app.dateOfBirth || pi.dateOfBirth || uData.dob || null,
                    occupation: app.occupation || pi.occupation || uData.occupation || null,
                    stateOfOrigin: app.stateOfOrigin || pi.stateOfOrigin || uData.state || uData.stateOfOrigin || (typeof uData.address === 'object' ? uData.address?.state : uData.stateOfOrigin) || uData.verificationProfile?.address?.state || null,
                    lga: app.lga || pi.lga || uData.lga || (typeof uData.address === 'object' ? uData.address?.lga : uData.lga) || null,
                    residentialAddress: app.residentialAddress || pi.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                    fullName: userName,
                    // The tier, repaired on read. `...app` above carries the
                    // literal "registration" that every application row was
                    // written with, so the badge and the CSV said "Registration"
                    // for every learner — including everyone who paid the elite
                    // fee, with the correct amount displayed beside it. The user
                    // document holds the plan the fulfilment paths verified the
                    // payment against. See lib/academy-plan.ts.
                    plan: resolveApplicationPlan(
                        app.plan,
                        uData?.serviceRegistrations?.academy?.plan,
                    ),
                };

                const bankDetails = uData.bankDetails || {
                    bankName: uData.bankName || "N/A",
                    accountNumber: uData.bankAccountNumber || "N/A",
                    accountName: uData.bankAccountName || "N/A",
                    bankCode: uData.bankCode || "N/A"
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
                    status: app.status || "pending",
                    data: mergedData,
                    submittedAt: app.submittedAt,
                    isLegacy: !!(app._isLegacy || uData.legacyOnboardedBy || uData.isLegacy || app.isLegacy)
                };
            });
        }

        await createAdminAuditLog({
            action: "data_access",
            userId: session.user.id,
            targetType: "academy_applications",
            targetId: "list",
            details: `Accessed Academy applications list (limit: ${fetchLimit}, status: ${options.status || 'all'})`,
            metadata: { options }
        });

        return { 
            success: true,
            error: null, 
            data: standardForms,
            meta: {
                totalFetched: useMemoryPagination ? applications.length : standardForms.length,
                hasMore: _hasMore,
                lastDocId: _nextCursor || null,
                stats
            }
        };
    } catch (error: any) {
        logger.error("Get standard academy apps error:", {
            error: error instanceof Error ? error.message : String(error),
            code: error?.code
        });
        
        if (error?.code === 9 || error?.message?.includes("FAILED_PRECONDITION")) {
            return { 
                success: false, 
                error: "Failed to fetch applications: Missing Firestore Index. Please check server logs for the creation link.", 
                data: null 
            };
        }

        return { success: false, error: "Failed to fetch applications", data: null };
    }
}


export const getStandardAcademyApplicationsAction = withFlexibleSafeAction("getStandardAcademyApplicationsAction", _getStandardAcademyApplicationsAction);


/**
 * Log Academy Export Action
 */
async function _logAcademyExportAction(details: any): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Writing to the admin audit log is an admin action.
        //
        // This endpoint took `details` from the caller and wrote it into
        // createAdminAuditLog with action "data_export" and targetId
        // "academy_applications", behind a session check alone. Every other
        // export in this file — getStandardAcademyApplicationsAction,
        // getPendingAcademyApplicationsAction — is gated on isAdmin; only the
        // record of the export was not.
        //
        // So any signed-in user could write entries into the log that says who
        // read the applicant data, with a count and filters they chose. That log
        // is the evidence an incident is reconstructed from, and this platform
        // has an open data-exposure incident. A record anybody can write to is
        // not evidence.
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        await createAdminAuditLog({
            action: "data_export",
            userId: session.user.id,
            targetId: "academy_applications",
            targetType: "export",
            details: `Exported ${details.count} academy applications. Filters: ${JSON.stringify(details.filters)}`,
            metadata: details
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Error logging export:", error);
        return { success: false, error: "An unexpected error occurred", data: null };
    }
}

export const logAcademyExportAction = withFlexibleSafeAction("logAcademyExportAction", _logAcademyExportAction);
