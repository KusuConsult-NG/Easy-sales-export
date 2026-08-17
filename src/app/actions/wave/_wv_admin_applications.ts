"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { FieldValue, Timestamp, FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { WaveApplicationReviewSchema } from "@/lib/schemas";
import { createAdminAuditLog } from "@/lib/audit-log";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { getCached, setCache } from "@/lib/redis";
import { sendWaveApplicationEmail } from "@/lib/email-notifications";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";

// ============================================================================
// APPLICATIONS MANAGEMENT
// ============================================================================

async function _getWaveApplicationsAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        // Audit logging
        await createAdminAuditLog({
            userId: session.user.id,
            userEmail: session.user.email ?? "unknown",
            action: "FETCH_WAVE_APPLICATIONS",
            targetType: "WAVE_APPLICATIONS",
            details: JSON.stringify({})
        });

        /**
         * Ordered by `createdAt`, which is a field that exists.
         *
         * THE DEFECT
         * ----------
         * This ordered by `submittedAt`, and NOTHING writes `submittedAt` onto a
         * WAVE application. The submit path writes `applicationDate`, `createdAt`
         * and `updatedAt`; the resubmit path adds `resubmittedAt`. `submittedAt`
         * is written only onto the USER record, under
         * `serviceRegistrations.wave.submittedAt` — a different document.
         *
         * WAVE_APPLICATIONS lives in the JSONB table, so the sort key resolves to
         * `raw_data->>'submittedAt'`, which is NULL for every row. Ordering by a
         * column that is uniformly NULL is not an error and does not warn: it
         * returns rows in whatever order the plan produces. Combined with the cap
         * below, on a collection of this size that made the admin list an
         * ARBITRARY subset presented as "the most recent" — and which rows an
         * admin saw could change between two identical requests.
         *
         * data-recovery.ts had the same sort on this collection, and then copied
         * `waveData.submittedAt` — undefined — into the user's registration as the
         * recovered submission date.
         *
         * THE CAP
         * -------
         * Kept, because the response hydrates a user record per applicant, but no
         * longer silent. A cap that is not reported reads as a complete list, and
         * "there are 1,000 applications" is a materially different statement from
         * "here are 1,000 of them".
         */
        const APPLICATION_SCAN_LIMIT = 1000;

        let snapshot;
        try {
            snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .orderBy("createdAt", "desc")
                .limit(APPLICATION_SCAN_LIMIT + 1)
                .get();
        } catch (error: any) {
             if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Wave Applications:", error.message);
                return { 
                    success: false, 
                    error: "Administrative index is currently being provisioned. Please try again in 5 minutes.", 
                    data: null 
                };
            }
            throw error;
        }

        const truncated = snapshot.docs.length > APPLICATION_SCAN_LIMIT;
        const rawApplications = serializeDocs(snapshot.docs.slice(0, APPLICATION_SCAN_LIMIT));

        if (truncated) {
            logger.warn(
                `[WAVE Admin] More than ${APPLICATION_SCAN_LIMIT} WAVE applications exist; ` +
                `returning the ${APPLICATION_SCAN_LIMIT} most recent. Use ` +
                `getStandardWaveApplicationsAction for a paginated view.`
            );
        }

        // HYDRATION: Batch-resolve user profiles
        const userIds = [...new Set(rawApplications.map((app: any) => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();

        if (userIds.length > 0) {
            const userPromises = [];
            for (let i = 0; i < userIds.length; i += 30) {
                const chunk = userIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));
        }

        const applications = rawApplications.map((app: any) => {
            const uData = userMap.get(app.userId) || {};
            const canonical = extractCanonicalUser(uData, app);

            return {
                ...app,
                user: {
                    id: app.userId,
                    name: canonical.name,
                    email: canonical.email,
                    phone: canonical.phone,
                    bankDetails: canonical.bankDetails
                }
            };
        });

        return {
            error: null,
            success: true as const,
            data: { applications },
            // Reported to the caller, not only to the log, so a screen can say so.
            meta: { truncated, scanLimit: APPLICATION_SCAN_LIMIT },
        };
    } catch (error) {
        logger.error("Get applications error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch applications" , data: null };
    }
}

export const getWaveApplicationsAction = withFlexibleSafeAction("getWaveApplicationsAction", _getWaveApplicationsAction);


async function _approveWaveApplicationAction(
    applicationId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { success: false as const, error: "Invalid application data" , data: null };
        }

        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        let targetUserId: string | undefined;

        // Approve and reject read the same two statuses and write opposite
        // answers, inside runTransaction, which takes no lock. An approval and
        // a rejection landing together both passed, so the applicant was
        // granted the wave_participant role AND marked rejected. Claimed now,
        // so exactly one verdict lands.
        await (async () => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const appDoc = await appRef.get();

            if (!appDoc.exists) throw new Error("Application not found");
            const appData = appDoc.data();
            targetUserId = appData?.userId;

            let userDoc = null;
            let userRef = null;
            if (targetUserId) {
                userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                userDoc = await userRef.get();
            }

            const nowIso = new Date().toISOString();
            const claim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.WAVE_APPLICATIONS,
                id: applicationId,
                fromAny: ["pending", "under_review"],
                to: "approved",
                patch: {
                    approvedAt: nowIso,
                    approvedBy: session.user.id,
                    reviewedAt: nowIso,
                    reviewedBy: session.user.id,
                    approvalTimestamp: nowIso,
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Application not found"
                    : "Application is not in a reviewable state");
            }

            // _version is bumped separately: the CAS patch is JSONB and does not
            // resolve FieldValue sentinels.
            await appRef.update({ _version: FieldValue.increment(1) });

            if (targetUserId && userRef) {
                if (!userDoc || !userDoc.exists) {
                    await userRef.set({
                        uid: targetUserId,
                        email: appData?.email || appData?.userEmail || "",
                        fullName: [appData?.firstName, appData?.otherNames, appData?.surname].filter(Boolean).join(" ").trim() || "WAVE Participant",
                        createdAt: FieldValue.serverTimestamp(),
                        roles: ["wave_participant"],
                        isVerified: true,
                    });
                }
                
                const updates: any = {
                    isVerified: true,
                    verifiedBy: session.user.id,
                    verifiedAt: FieldValue.serverTimestamp(),
                    roles: FieldValue.arrayUnion("wave_participant"),
                    "serviceRegistrations.wave.status": "approved",
                    "serviceRegistrations.wave.paymentStatus": "completed",
                    "serviceRegistrations.wave.approvedAt": FieldValue.serverTimestamp(),
                    waveStatus: "active",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                };

                // Sync NIN/BVN from application if not already set on user
                if (appData?.nin) {
                    updates.nin = appData.nin;
                    updates["kyc.nin"] = appData.nin;
                }
                if (appData?.bvn) {
                    updates.bvn = appData.bvn;
                    updates["kyc.bvn"] = appData.bvn;
                }

                // Sync next of kin details
                if (appData?.nextOfKinName) {
                    updates.nextOfKinName = appData.nextOfKinName;
                    updates.nextOfKinPhone = appData.nextOfKinPhone || "";
                    updates.nextOfKinRelationship = appData.nextOfKinRelationship || "";
                    updates.nextOfKin = {
                        name: appData.nextOfKinName,
                        phone: appData.nextOfKinPhone || "",
                        relationship: appData.nextOfKinRelationship || "",
                        address: ""
                    };
                }

                // Sync bank details if available
                if (appData?.accountNumber) {
                    updates.bankAccountNumber = appData.accountNumber;
                    updates.bankAccountName = appData.bankAccountName || [appData.firstName, appData.otherNames, appData.surname].filter(Boolean).join(" ").trim();
                    updates.bankDetails = {
                        accountNumber: appData.accountNumber,
                        bankName: appData.bankName || "",
                        accountName: appData.bankAccountName || [appData.firstName, appData.otherNames, appData.surname].filter(Boolean).join(" ").trim(),
                        bankCode: appData.bankCode || ""
                    };
                }

                await userRef.update(updates);

                // Create/Update Wave Member Record
                const memberRef = db.collection(COLLECTIONS.WAVE_MEMBERS).doc(targetUserId);
                await memberRef.set({
                    active: true,
                    enrolledAt: FieldValue.serverTimestamp(),
                    applicationId: applicationId,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                }, { merge: true });
            }
        })();

        // Audit Log
        await createAdminAuditLog({
            action: "wave_application_approved",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
            metadata: { userId: targetUserId }
        });

        // Email Notification
        if (targetUserId) {
            try {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
                const userData = userDoc.data();
                const userEmail = userData?.email || userData?.userEmail;
                const userName = userData?.firstName 
                    ? `${userData.firstName} ${userData.surname || userData.lastName || ""}`.trim()
                    : (userData?.name || "Member");

                if (userEmail) {
                    await sendWaveApplicationEmail(userEmail, userName, 'approved');
                    logger.info(`[WAVE Admin] Approval email sent to: ${userEmail}`);
                }
            } catch (err) {
                logger.error("[WAVE Admin] Failed to send approval email:", err);
            }
        }

        // Cache invalidation (Post-Commit)
        if (targetUserId) {
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(targetUserId, 'wave');
                logger.info(`[WAVE Admin] Cache invalidated for user: ${targetUserId}`);
            } catch (err) {
                logger.error("[WAVE Admin] Cache invalidation failed:", err);
            }
        }

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Approve application error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to approve application" };
    }
}

export const approveWaveApplicationAction = withFlexibleSafeAction("approveWaveApplicationAction", _approveWaveApplicationAction);


async function _rejectWaveApplicationAction(
    applicationId: string,
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { success: false as const, error: "Invalid rejection data" };
        }

        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        let targetUserId: string | undefined;

        // Claimed for the same reason as the approval path: the two verdicts
        // raced each other, not just themselves.
        await (async () => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const appDoc = await appRef.get();

            if (!appDoc.exists) throw new Error("Application not found");
            const appData = appDoc.data();
            targetUserId = appData?.userId;

            const nowIso = new Date().toISOString();
            const claim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.WAVE_APPLICATIONS,
                id: applicationId,
                fromAny: ["pending", "under_review"],
                to: "rejected",
                patch: {
                    rejectionReason: reason,
                    rejectedAt: nowIso,
                    rejectedBy: session.user.id,
                    reviewedAt: nowIso,
                    reviewedBy: session.user.id,
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Application not found"
                    : "Application is not in a reviewable state");
            }

            await appRef.update({ _version: FieldValue.increment(1) });

            if (targetUserId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                await userRef.update({
                    "serviceRegistrations.wave.status": "rejected",
                    "serviceRegistrations.wave.rejectedAt": FieldValue.serverTimestamp(),
                    waveStatus: "rejected",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                });
            }
        })();

        // Audit Log
        await createAdminAuditLog({
            action: "wave_application_rejected",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
            metadata: { reason, userId: targetUserId }
        });

        // Email Notification
        if (targetUserId) {
            try {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
                const userData = userDoc.data();
                const userEmail = userData?.email || userData?.userEmail;
                const userName = userData?.firstName 
                    ? `${userData.firstName} ${userData.surname || userData.lastName || ""}`.trim()
                    : (userData?.name || "Member");

                if (userEmail) {
                    await sendWaveApplicationEmail(userEmail, userName, 'rejected', reason);
                    logger.info(`[WAVE Admin] Rejection email sent to: ${userEmail}`);
                }
            } catch (err) {
                logger.error("[WAVE Admin] Failed to send rejection email:", err);
            }
        }

        // Cache invalidation (Post-Commit)
        if (targetUserId) {
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(targetUserId, 'wave');
            } catch (err) {
                logger.error("[WAVE Admin] Cache invalidation failed:", err);
            }
        }

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Reject application error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to reject application" };
    }
}

export const rejectWaveApplicationAction = withFlexibleSafeAction("rejectWaveApplicationAction", _rejectWaveApplicationAction);


async function _getStandardWaveApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "under_review" | "approved" | "rejected" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    sortBy?: "createdAt" | "gender";
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
} = {}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo || options.sortBy === "gender";
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";

        let countQ: any = db.collection(COLLECTIONS.WAVE_APPLICATIONS);
        if (options.status && options.status !== "all") {
            countQ = countQ.where("status", "==", options.status);
        }

        const cacheKey = options.status === "approved" ? "admin:wave-members-count:approved" : `admin:wave-applications-count:${options.status || "all"}`;
        let totalCount = 0;
        try {
            const cachedCount = await getCached<number>(cacheKey);
            if (cachedCount !== null) {
                totalCount = cachedCount;
            }
        } catch (e) { }

        let applications: any[] = [];
        let hasMoreRaw = false;
        let nextCursor: string | undefined = undefined;

        if (options.status === "approved") {
            let q = db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "wave_participant")
                .orderBy("createdAt", orderDirection);

            if (options.search) {
                const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
                const matchingUserIds = await searchUserIdsByQuery(options.search);
                if (matchingUserIds.length === 0) {
                    return {
                        error: null, success: true as const,
                        data: [],
                        lastDocId: undefined,
                        hasMore: false,
                        meta: { totalFetched: 0, totalCount: 0, hasMore: false }
                    };
                }
                q = db.collection(COLLECTIONS.USERS)
                    .where("roles", "array-contains", "wave_participant")
                    .where(FieldPath.documentId(), "in", matchingUserIds);
            }

            if (options.lastDocId) {
                const lastDoc = await db.collection(COLLECTIONS.USERS).doc(options.lastDocId).get();
                if (lastDoc.exists) {
                    q = q.startAfter(lastDoc);
                }
            }

            q = q.limit(fetchLimit + 1);
            const snapshot = await q.get();
            const userDocs = snapshot.docs;

            const hasMoreRaw = userDocs.length > fetchLimit;
            const slicedDocs = hasMoreRaw ? userDocs.slice(0, fetchLimit) : userDocs;

            const finalForms = slicedDocs.map((uDoc: any) => {
                const uData = uDoc.data();
                const uid = uDoc.id;
                const canonical = extractCanonicalUser(uData);

                const approvalDate = uData.createdAt ? new Date(uData.createdAt.seconds ? uData.createdAt.seconds * 1000 : uData.createdAt) : new Date();
                const mockApp = {
                    id: `legacy-${uid}`,
                    userId: uid,
                    status: "approved",
                    createdAt: Timestamp.fromDate(approvalDate),
                    reviewedAt: Timestamp.fromDate(approvalDate),
                    approvalTimestamp: Timestamp.fromDate(approvalDate),
                    fullName: canonical.name,
                    firstName: uData.firstName || "",
                    surname: uData.lastName || uData.surname || "",
                    email: canonical.email,
                    phone: canonical.phone,
                    state: canonical.address.state || "",
                    lga: canonical.address.lga || "",
                };

                return {
                    id: mockApp.id,
                    user: {
                        id: uid,
                        name: canonical.name,
                        email: canonical.email,
                        phone: canonical.phone,
                        dob: canonical.dateOfBirth || "",
                        address: canonical.address.street,
                        state: canonical.address.state,
                        lga: canonical.address.lga,
                        gender: uData.gender || canonical.gender || "",
                        bankDetails: canonical.bankDetails
                    },
                    status: "approved",
                    data: mockApp
                };
            });

            const nextCursor = finalForms.length > 0 ? finalForms[finalForms.length - 1].user.id as string : undefined;

            if (totalCount === 0) {
                const countSnap = await db.collection(COLLECTIONS.USERS)
                    .where("roles", "array-contains", "wave_participant")
                    .count()
                    .get();
                totalCount = countSnap.data().count;
                try {
                    await setCache(cacheKey, totalCount, 120);
                } catch (e) { }
            }

            const { serializeValue } = await import("@/lib/firestore-serialize");
            return {
                success: true,
                error: null,
                data: serializeValue(finalForms),
                lastDocId: nextCursor,
                hasMore: hasMoreRaw,
                meta: {
                    totalFetched: finalForms.length,
                    totalCount,
                    hasMore: hasMoreRaw
                }
            };
        }

        if (options.search) {
            const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
            const matchingUserIds = await searchUserIdsByQuery(options.search);
            if (matchingUserIds.length === 0) {
                return {
                    error: null, success: true as const,
                    data: [],
                    lastDocId: undefined,
                    hasMore: false,
                    meta: {
                        totalFetched: 0,
                        totalCount: 0,
                        hasMore: false
                    }
                };
            }

            const querySnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userId", "in", matchingUserIds)
                .get();

            applications = serializeDocs(querySnap.docs);
            if (options.status && options.status !== "all") {
                applications = applications.filter(app => app.status === options.status);
            }
            if (options.dateFrom) {
                const from = dateRangeStart(options.dateFrom);
                applications = applications.filter(app => {
                    const d = app.createdAt?.seconds ? new Date(app.createdAt.seconds * 1000) : new Date(app.createdAt);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = dateRangeEnd(options.dateTo);
                applications = applications.filter(app => {
                    const d = app.createdAt?.seconds ? new Date(app.createdAt.seconds * 1000) : new Date(app.createdAt);
                    return d <= to;
                });
            }
        } else {
            let q = db.collection(COLLECTIONS.WAVE_APPLICATIONS).orderBy("createdAt", orderDirection);

            if (options.status && options.status !== "all") {
                q = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("status", "==", options.status)
                    .orderBy("createdAt", orderDirection);
            }

            if (options.dateFrom) {
                const fromTs = dateRangeStart(options.dateFrom);
                q = q.where("createdAt", ">=", fromTs);
            }
            if (options.dateTo) {
                const toTs = dateRangeEnd(options.dateTo);
                q = q.where("createdAt", "<=", toTs);
            }

            if (options.lastDocId && !useMemoryPagination) {
                const lastDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(options.lastDocId).get();
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
            nextCursor = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;
        }
        if (totalCount === 0) {
            const countSnap = await countQ.count().get();
            totalCount = countSnap.data().count;
            try {
                await setCache(cacheKey, totalCount, 120);
            } catch (e) { }
        }

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
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

        let finalForms = applications.map((app: any) => {
            const uData = userMap.get(app.userId as string) || {};
            const canonical = extractCanonicalUser(uData, app);

            return {
                id: app.id,
                user: {
                    id: app.userId,
                    name: canonical.name,
                    email: canonical.email,
                    phone: canonical.phone,
                    dob: canonical.dateOfBirth || "",
                    address: canonical.address.street,
                    state: canonical.address.state,
                    lga: canonical.address.lga,
                    gender: app.gender || uData.gender || canonical.gender || "",
                    bankDetails: canonical.bankDetails
                },
                status: app.status || "pending",
                data: {
                    ...app,
                    ...canonical, // Inject SSOT fields directly into the data object
                    bankDetails: canonical.bankDetails
                }
            };
        });

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalForms = finalForms.filter((f: any) => {
                const searchString = [
                    f.id,
                    f.user?.id,
                    f.user?.name,
                    f.user?.email,
                    f.user?.phone,
                    f.data?.bankName,
                    f.data?.accountNumber,
                    f.data?.stateOfOrigin,
                    f.data?.nin,
                    f.data?.bvn
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = dateRangeStart(options.dateFrom);
            finalForms = finalForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
            finalForms = finalForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d <= to;
            });
        }

        if (options.sortBy === "gender") {
            const order = options.sortOrder || "desc";
            finalForms.sort((a, b) => {
                const ga = (a.user?.gender || "").toLowerCase();
                const gb = (b.user?.gender || "").toLowerCase();
                if (ga === gb) {
                    const aTime = a.data?.createdAt?.seconds ? a.data.createdAt.seconds * 1000 : new Date(a.data?.createdAt || 0).getTime();
                    const bTime = b.data?.createdAt?.seconds ? b.data.createdAt.seconds * 1000 : new Date(b.data?.createdAt || 0).getTime();
                    return bTime - aTime;
                }
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
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
        const paged = useMemoryPagination ? finalForms.slice(offset, offset + limit) : finalForms;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < finalForms.length) 
            : hasMoreRaw;
            
        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : null)
            : (_hasMore ? nextCursor : undefined);

        return { 
            error: null, success: true as const, 
            data: paged,
            lastDocId: _nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: applications.length,
                totalCount: totalCount,
                hasMore: _hasMore
            }
        };
    } catch (error) {
        logger.error("Get standard WAVE applications error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch normalized Wave applications" };
    }
}

export const getStandardWaveApplicationsAction = withFlexibleSafeAction("getStandardWaveApplicationsAction", _getStandardWaveApplicationsAction);
