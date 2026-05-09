"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue, FieldPath, Query } from "firebase-admin/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { WaveApplicationReviewSchema } from "@/lib/schemas";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { getCached, setCache } from "@/lib/redis";
import { sendWaveApplicationEmail } from "@/lib/email-notifications";
import { paystackPayout } from "@/lib/paystack-transfer";
import { z } from "zod";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";

// ============================================================================
// RESOURCES MANAGEMENT
// ============================================================================

async function _createResourceAction(data: {
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const resourceRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add({
            ...data,
            downloads: 0,
            uploadedAt: FieldValue.serverTimestamp(),
            uploadedBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        });

        await createAdminAuditLog({
            action: "resource_uploaded",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceRef.id,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Create resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create resource" , data: null };
    }
}
export const createResourceAction = withFlexibleSafeAction("createResourceAction", _createResourceAction);

async function _updateResourceAction(
    resourceId: string,
    data: Partial<{
        title: string;
        description: string;
        category: "document" | "video" | "template" | "guide";
        fileUrl: string;
        fileName: string;
        fileSize: number;
    }>
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Update resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update resource" , data: null };
    }
}
export const updateResourceAction = withFlexibleSafeAction("updateResourceAction", _updateResourceAction);

async function _deleteResourceAction(
    resourceId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Delete resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to delete resource" , data: null };
    }
}
export const deleteResourceAction = withFlexibleSafeAction("deleteResourceAction", _deleteResourceAction);

// ============================================================================
// TRAINING EVENTS MANAGEMENT
// ============================================================================

async function _createTrainingEventAction(data: {
    title: string;
    description: string;
    instructor: string;
    date: Date;
    duration: string;
    maxParticipants: number;
    meetingLink?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const eventRef = await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).add({
            ...data,
            currentParticipants: 0,
            status: "upcoming",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        });

        await createAdminAuditLog({
            action: "wave_training_created",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventRef.id,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Create event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create event" , data: null };
    }
}
export const createTrainingEventAction = withFlexibleSafeAction("createTrainingEventAction", _createTrainingEventAction);

async function _updateTrainingEventAction(
    eventId: string,
    data: Partial<{
        title: string;
        description: string;
        instructor: string;
        date: Date;
        duration: string;
        maxParticipants: number;
        meetingLink: string;
        status: "upcoming" | "ongoing" | "completed" | "cancelled";
    }>
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Update event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update event" , data: null };
    }
}
export const updateTrainingEventAction = withFlexibleSafeAction("updateTrainingEventAction", _updateTrainingEventAction);

async function _getEventParticipantsAction(eventId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const snap = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("eventId", "==", eventId)
            .get();

        const participants = serializeDocs(snap.docs);

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Get participants error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch participants" , data: null };
    }
}
export const getEventParticipantsAction = withFlexibleSafeAction("getEventParticipantsAction", _getEventParticipantsAction);

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
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(1000).get();
        const applications = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: null };
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

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const appDoc = await transaction.get(appRef);

            if (!appDoc.exists) throw new Error("Application not found");
            const appData = appDoc.data();
            if (appData?.status !== "pending" && appData?.status !== "under_review") {
                throw new Error("Application is not in a reviewable state");
            }
            targetUserId = appData?.userId;

            transaction.update(appRef, {
                status: "approved",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                reviewedBy: session.user.id,
                approvalTimestamp: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            // If user exists, update their profile and roles
            if (targetUserId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                transaction.update(userRef, {
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
                });

                // Create/Update Wave Member Record
                const memberRef = db.collection(COLLECTIONS.WAVE_MEMBERS).doc(targetUserId);
                transaction.set(memberRef, {
                    active: true,
                    enrolledAt: FieldValue.serverTimestamp(),
                    applicationId: applicationId,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                }, { merge: true });
            }
        });

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

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const appDoc = await transaction.get(appRef);

            if (!appDoc.exists) throw new Error("Application not found");
            const appData = appDoc.data();
            if (appData?.status !== "pending" && appData?.status !== "under_review") {
                throw new Error("Application is not in a reviewable state");
            }
            targetUserId = appData?.userId;

            transaction.update(appRef, {
                status: "rejected",
                rejectionReason: reason,
                rejectedAt: FieldValue.serverTimestamp(),
                rejectedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                reviewedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (targetUserId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                transaction.update(userRef, {
                    "serviceRegistrations.wave.status": "rejected",
                    "serviceRegistrations.wave.rejectedAt": FieldValue.serverTimestamp(),
                    waveStatus: "rejected",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                });
            }
        });

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

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        let q = db.collection(COLLECTIONS.WAVE_APPLICATIONS).orderBy("createdAt", orderDirection);
        let countQ: Query = db.collection(COLLECTIONS.WAVE_APPLICATIONS);

        if (options.status && options.status !== "all") {
            q = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", orderDirection);
            countQ = countQ.where("status", "==", options.status);
        }

        if (options.dateFrom) {
            const fromTs = new Date(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = new Date(options.dateTo + "T23:59:59");
            q = q.where("createdAt", "<=", toTs);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        q = q.limit(fetchLimit);

        const cacheKey = `admin:wave-applications-count:${options.status || "all"}`;
        let totalCount = 0;
        try {
            const cachedCount = await getCached<number>(cacheKey);
            if (cachedCount !== null) {
                totalCount = cachedCount;
            }
        } catch (e) { }

        const snapshot = await q.get();
        const applications = serializeDocs(snapshot.docs);
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

        const standardForms = applications.map((app: any) => {
            const uData = userMap.get(app.userId as string) || {};
            const canonical = extractCanonicalUser(uData, app);

            return {
                id: app.id,
                user: {
                    id: app.userId,
                    name: canonical.name,
                    email: canonical.email,
                    phone: canonical.phone,
                    dob: canonical.dateOfBirth || "N/A",
                    address: canonical.address.street,
                    state: canonical.address.state,
                    lga: canonical.address.lga,
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

        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalForms = standardForms.filter((f: any) => {
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
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const lastDocId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : undefined;
        const hasMore = snapshot.docs.length === fetchLimit;

        return { 
            error: null, success: true as const, 
            data: finalForms,
            lastDocId,
            hasMore,
            meta: {
                totalFetched: applications.length,
                totalCount: totalCount,
                hasMore
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

async function _getStandardWaveWithdrawalsAction(options: {
    status?: "pending" | "processing" | "approved" | "approved_pending_payout" | "completed" | "rejected" | "all";
    limit?: number;
    lastDocId?: string;
    search?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
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

        const fetchLimit = options.limit || 25;
        const orderDirection = options.sortOrder || "desc";
        let q: any = db.collection(COLLECTIONS.WAVE_WITHDRAWALS);
        if (options.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        if (options.dateFrom) {
            const fromTs = new Date(options.dateFrom);
            q = q.where("requestedAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = new Date(options.dateTo + "T23:59:59");
            q = q.where("requestedAt", "<=", toTs);
        }

        q = q.orderBy("requestedAt", orderDirection);

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        q = q.limit(fetchLimit + 1);

        const snapshot = await q.get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const withdrawals = serializeDocs(docs);

        // HYDRATION: Batch-resolve user bank details
        const userIds = [...new Set(withdrawals.map((w: any) => w.userId).filter(Boolean))];
        const userMap: Record<string, any> = {};

        if (userIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < userIds.length; i += 30) {
                chunks.push(userIds.slice(i, i + 30));
            }

            const userSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            userSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const uData = doc.data();
                    const canonical = extractCanonicalUser(uData);
                    userMap[doc.id] = {
                        name: canonical.name,
                        email: canonical.email,
                        phone: canonical.phone,
                        bankDetails: canonical.bankDetails
                    };
                });
            });
        }

        const enrichedWithdrawals = withdrawals.map((w: any) => ({
            ...w,
            user: userMap[w.userId] || null,
            // Fallback for UI components expecting root bankDetails
            bankDetails: userMap[w.userId]?.bankDetails || {
                bankName: "N/A",
                accountNumber: "N/A",
                accountName: "N/A",
                bankCode: "N/A"
            }
        }));


        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            error: null, success: true as const, 
            data: enrichedWithdrawals,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: enrichedWithdrawals.length,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard WAVE withdrawals error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch WAVE withdrawals" };
    }
}
export const getStandardWaveWithdrawalsAction = withFlexibleSafeAction("getStandardWaveWithdrawalsAction", _getStandardWaveWithdrawalsAction);

/**
 * processWaveWithdrawalAction
 * Standardized hardened action for processing WAVE withdrawals.
 * Handles approve (auto-payout via Paystack), reject, and complete actions.
 */
async function _processWaveWithdrawalAction(data: {
    withdrawalId: string;
    action: "approve" | "reject" | "complete";
    adminNotes?: string;
    transactionReference?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles) || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { success: false as const, error: "Unauthorized: finance:process_withdrawals permission required" };
        }

        const { withdrawalId, action, adminNotes, transactionReference } = data;
        const ref = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);

        let withdrawalData: any = null;

        // PHASE 1: ATOMIC STATE TRANSITION & LOCKING
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error("Withdrawal not found");
            withdrawalData = snap.data();
            const currentStatus = withdrawalData.status;

            if (action === "complete") {
                if (currentStatus !== "approved_pending_payout" && currentStatus !== "approved") {
                    throw new Error("Can only complete approved withdrawals");
                }
                tx.update(ref, {
                    status: "completed",
                    completedBy: session.user.id,
                    completedAt: FieldValue.serverTimestamp(),
                    ...(adminNotes ? { adminNotes } : {}),
                    ...(transactionReference ? { transactionReference } : {}),
                    updatedAt: FieldValue.serverTimestamp(),
                });

                // Clear the lock on user doc
                const userRef = db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId);
                tx.update(userRef, {
                    'serviceRegistrations.wave.hasPendingWithdrawal': false,
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Update Wallet Transaction
                const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);
                tx.update(walletTxnRef, {
                    status: "completed",
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else if (action === "reject") {
                if (currentStatus !== "pending") {
                    throw new Error("Only pending withdrawals can be rejected");
                }
                tx.update(ref, {
                    status: "rejected",
                    processedBy: session.user.id,
                    processedAt: FieldValue.serverTimestamp(),
                    ...(adminNotes ? { adminNotes } : {}),
                    updatedAt: FieldValue.serverTimestamp(),
                });

                // Clear the lock on user doc AND restore the balance
                const userRef = db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId);
                tx.update(userRef, {
                    'serviceRegistrations.wave.hasPendingWithdrawal': false,
                    'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(withdrawalData.amount),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Update Wallet Transaction
                const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);
                tx.update(walletTxnRef, {
                    status: "rejected",
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else if (action === "approve") {
                if (currentStatus !== "pending") {
                    throw new Error("Only pending withdrawals can be approved");
                }
                // Lock for processing to prevent double-payouts
                tx.update(ref, {
                    status: "approved_processing",
                    processedBy: session.user.id,
                    processedAt: FieldValue.serverTimestamp(),
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + "Locking for automated payout...",
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        // AUDIT LOG (First Phase)
        await createAdminAuditLog({
            userId: session.user.id,
            action: `wave_withdrawal_${action}` as any,
            targetId: withdrawalId,
            targetType: "wave_withdrawal",
            metadata: { action, adminNotes },
            details: `WAVE withdrawal ${action}ed by admin ${session.user.id}`,
        });

        if (action !== "approve") {
             // Invalidate cache for user
             if (withdrawalData?.userId) {
                 try {
                     const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                     await invalidateServiceCache(withdrawalData.userId, 'wave');
                 } catch (e) { }
             }
             return { error: null, success: true as const, data: null };
        }

        // PHASE 2: SIDE-EFFECT (PAYOUT)
        // If we reached here, the action is "approve" and the record is locked as 'approved_processing'
        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId).get();
            const userData = userDoc.data();
            if (!userData?.bankAccountNumber || !userData?.bankCode) {
                // Rollback to pending
                await ref.update({ 
                    status: "pending", 
                    payoutError: "User bank details not configured",
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + "Payout failed: Missing bank details.",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: "User bank details missing" };
            }

            const payoutResult = await paystackPayout(
                 {
                     accountNumber: userData.bankAccountNumber,
                     bankCode: userData.bankCode,
                     accountName: userData.bankAccountName || userData.name,
                 },
                 withdrawalData.amount,
                 `WAVE Withdrawal payout - ${withdrawalId}`
            );

            if (!payoutResult.success) {
                // Rollback status to pending with error message
                await ref.update({ 
                    status: "pending", 
                    payoutError: payoutResult.error,
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + `Payout failed: ${payoutResult.error}`,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: `Paystack payout failed: ${payoutResult.error}` };
            }

            // PHASE 3: FINAL COMMIT
            // Payout succeeded! Mark as completed and clear user lock.
            const batch = db.batch();
            
            batch.update(ref, {
                status: "completed",
                completedBy: session.user.id,
                completedAt: FieldValue.serverTimestamp(),
                transactionReference: payoutResult.reference,
                adminNotes: (adminNotes ? adminNotes + " - " : "") + "Auto-paid via Paystack.",
                payoutError: null,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Clear the lock on user doc
            const userRef = db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId);
            batch.update(userRef, {
                'serviceRegistrations.wave.hasPendingWithdrawal': false,
                updatedAt: FieldValue.serverTimestamp()
            });

            // Update Wallet Transaction
            const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);
            batch.update(walletTxnRef, {
                status: "completed",
                updatedAt: FieldValue.serverTimestamp()
            });

            await batch.commit();

            // Invalidate cache
            if (withdrawalData?.userId) {
                try {
                    const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                    await invalidateServiceCache(withdrawalData.userId, 'wave');
                } catch (e) { }
            }

            return { error: null, success: true as const, data: null };

        } catch (error: any) {
            logger.error(`[WAVE:Payout] Critical error during payout for ${withdrawalId}:`, error);
            // Revert to pending so it can be re-tried
            await ref.update({ 
                status: "pending", 
                payoutError: "Critical error during payout side-effect",
                updatedAt: FieldValue.serverTimestamp(),
            }).catch(e => logger.error(`[WAVE:Rollback] Failed to rollback status for ${withdrawalId}:`, e));
            return { success: false as const, error: "Critical payout failure. Status reverted to pending." , data: null };
        }

    } catch (error: any) {
        logger.error("Process WAVE withdrawal error:", error);
        return { success: false as const, error: error.message || "Failed to process withdrawal" , data: null };
    }
}

export const processWaveWithdrawalAction = withFlexibleSafeAction("processWaveWithdrawalAction", _processWaveWithdrawalAction);
