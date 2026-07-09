"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { Query } from "firebase-admin/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getLogisticsProvider } from "@/lib/logistics";
import { WaveApplicationReviewSchema } from "@/lib/schemas";
import { createAdminAuditLog } from "@/lib/audit-log";
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
        videoUrl: string;
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
export async function updateTrainingEventAction(...args: Parameters<typeof _updateTrainingEventAction>) {
    return withFlexibleSafeAction("updateTrainingEventAction", _updateTrainingEventAction)(...args);
}

async function _deleteTrainingEventAction(
    eventId: string
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

        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).delete();

        // Clean up associated training sessions if any exist
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", `wave-training-${eventId}`)
            .get();
        if (!sessionQuery.empty) {
            const deleteBatch = db.batch();
            sessionQuery.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();
        }

        await createAdminAuditLog({
            action: "wave_training_deleted",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Delete event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to delete event" , data: null };
    }
}
export const deleteTrainingEventAction = withFlexibleSafeAction("deleteTrainingEventAction", _deleteTrainingEventAction);

async function _startWaveLiveSessionAction(
    eventId: string,
    customMeetingLink?: string
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

        // 1. Get event details
        const eventDoc = await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).get();
        if (!eventDoc.exists) {
            return { success: false as const, error: "Event not found" , data: null };
        }
        const eventData = eventDoc.data()!;

        // 2. Parse duration minutes from duration string (e.g. "2 hours" -> 120, "45 min" -> 45)
        let durationMinutes = 60;
        const durStr = String(eventData.duration || "");
        const numMatch = durStr.match(/\d+/);
        if (numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (durStr.toLowerCase().includes("hour")) {
                durationMinutes = num * 60;
            } else {
                durationMinutes = num;
            }
        }

        const roomName = `wave-training-${eventId}`;
        const finalMeetingLink = customMeetingLink || `/wave/live-training`;

        // 3. Update event status to ongoing
        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            status: "ongoing",
            meetingLink: finalMeetingLink,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 4. Create/overwrite the live training session document
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", roomName)
            .get();

        if (sessionQuery.empty) {
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).add({
                title: eventData.title,
                description: eventData.description || "",
                scheduledAt: new Date(),
                durationMinutes,
                roomName,
                isActive: true,
                customMeetingLink: customMeetingLink || null,
                createdAt: new Date(),
                createdBy: session.user.id,
            });
        } else {
            // Update existing to make it active now
            const docId = sessionQuery.docs[0].id;
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).doc(docId).update({
                scheduledAt: new Date(),
                isActive: true,
                durationMinutes,
                customMeetingLink: customMeetingLink || null,
                updatedAt: new Date(),
            });
        }

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const, data: { roomName } };
    } catch (error) {
        logger.error("Start live session error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to start live session" , data: null };
    }
}
export async function startWaveLiveSessionAction(...args: Parameters<typeof _startWaveLiveSessionAction>) {
    return withFlexibleSafeAction("startWaveLiveSessionAction", _startWaveLiveSessionAction)(...args);
}

async function _endWaveLiveSessionAction(
    eventId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // 1. Mark the training event as completed
        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            status: "completed",
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Mark the training session document as inactive
        const roomName = `wave-training-${eventId}`;
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", roomName)
            .get();

        for (const doc of sessionQuery.docs) {
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).doc(doc.id).update({
                isActive: false,
                endedAt: new Date(),
                updatedAt: new Date(),
            });
        }

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("End live session error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to end live session", data: null };
    }
}
export async function endWaveLiveSessionAction(...args: Parameters<typeof _endWaveLiveSessionAction>) {
    return withFlexibleSafeAction("endWaveLiveSessionAction", _endWaveLiveSessionAction)(...args);
}



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

        let snapshot;
        try {
            snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .orderBy("submittedAt", "desc")
                .limit(1000)
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

        const rawApplications = serializeDocs(snapshot.docs);

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

        return { error: null, success: true as const, data: { applications } };
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
            const currentStatus = appData?.status || "pending";
            if (currentStatus !== "pending" && currentStatus !== "under_review") {
                throw new Error("Application is not in a reviewable state");
            }
            targetUserId = appData?.userId;

            let userDoc = null;
            let userRef = null;
            if (targetUserId) {
                userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                userDoc = await transaction.get(userRef);
            }

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

            if (targetUserId && userRef) {
                if (!userDoc || !userDoc.exists) {
                    transaction.set(userRef, {
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

                transaction.update(userRef, updates);

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
            const currentStatus = appData?.status || "pending";
            if (currentStatus !== "pending" && currentStatus !== "under_review") {
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

        const cacheKey = `admin:wave-applications-count:${options.status || "all"}`;
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
                const from = new Date(options.dateFrom);
                from.setHours(0, 0, 0, 0);
                applications = applications.filter(app => {
                    const d = app.createdAt?.seconds ? new Date(app.createdAt.seconds * 1000) : new Date(app.createdAt);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = new Date(options.dateTo);
                to.setHours(23, 59, 59, 999);
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
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            finalForms = finalForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
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

        const fetchLimit = options.search ? 5000 : (options.limit || 25);
        const orderDirection = options.sortOrder || "desc";
        let q: any = db.collection(COLLECTIONS.WAVE_WITHDRAWALS);
        if (options.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        if (options.dateFrom) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("requestedAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = dateRangeEnd(options.dateTo);
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

        let enrichedWithdrawals = withdrawals.map((w: any) => ({
            ...w,
            user: userMap[w.userId] || null,
            bankDetails: userMap[w.userId]?.bankDetails || {
                bankName: "",
                accountNumber: "",
                accountName: "",
                bankCode: ""
            }
        }));

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            enrichedWithdrawals = enrichedWithdrawals.filter((w: any) => {
                const searchString = [
                    w.id,
                    w.userId,
                    w.user?.name,
                    w.user?.email,
                    w.user?.phone,
                    w.bankDetails?.bankName,
                    w.bankDetails?.accountNumber,
                    w.bankDetails?.accountName,
                    w.reference,
                    w.status,
                    w.type
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const limit = options.limit || 25;
        let page = 0;
        if ((options as any).page !== undefined) {
            page = Number((options as any).page);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = options.search ? enrichedWithdrawals.slice(offset, offset + limit) : enrichedWithdrawals;
        const _hasMore = options.search 
            ? (offset + limit < enrichedWithdrawals.length) 
            : hasMore;
            
        const nextCursor = options.search 
            ? (_hasMore ? String(page + 1) : null)
            : (_hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined);

        return { 
            error: null, success: true as const, 
            data: paged,
            lastDocId: nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: enrichedWithdrawals.length,
                hasMore: _hasMore
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

/**
 * Create a new shipment for a WAVE member
 */
async function _createWaveShipmentAction(data: {
    memberId: string;
    productName: string;
    destination: string;
    carrier: string;
    trackingNumber?: string;
}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const { memberId, productName, destination, carrier, trackingNumber } = data;

        if (!memberId || !productName || !destination || !carrier) {
            return { success: false as const, error: "Missing required fields", data: null };
        }

        const memberDoc = await db.collection(COLLECTIONS.USERS).doc(memberId).get();
        if (!memberDoc.exists) {
            return { success: false as const, error: "Member not found", data: null };
        }

        const memberData = memberDoc.data();
        const memberName = memberData?.firstName 
            ? `${memberData.firstName} ${memberData.surname || memberData.lastName || ""}`.trim()
            : (memberData?.name || "Member");

        let finalTrackingNumber = trackingNumber;
        if (!finalTrackingNumber) {
            const provider = getLogisticsProvider();
            const shipment = await provider.createShipment({
                memberId,
                memberName,
                productName,
                destination,
            });
            finalTrackingNumber = shipment.trackingNumber;
        }

        const shipmentId = `WSH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);

        const newShipment = {
            id: shipmentId,
            memberId,
            memberName,
            memberEmail: memberData?.email || memberData?.userEmail || "",
            orderId: `ORD-${Date.now().toString().slice(-6)}`,
            productName,
            destination,
            carrier,
            trackingNumber: finalTrackingNumber,
            status: "pending" as const,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            updates: [
                {
                    timestamp: new Date(),
                    location: "WAVE Warehouse",
                    status: "pending",
                    note: "Shipment generated and ready for pickup",
                }
            ],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        };

        await shipmentRef.set(newShipment);

        await createAdminAuditLog({
            action: "wave_shipment_created",
            userId: session.user.id,
            targetType: "wave_shipment",
            targetId: shipmentId,
            metadata: { memberId, trackingNumber: finalTrackingNumber }
        });

        return { error: null, success: true as const, data: { id: shipmentId, trackingNumber: finalTrackingNumber } };
    } catch (error: any) {
        logger.error("Create wave shipment error:", error);
        return { success: false as const, error: error.message || "Failed to create shipment", data: null };
    }
}
export const createWaveShipmentAction = withFlexibleSafeAction("createWaveShipmentAction", _createWaveShipmentAction);

/**
 * Get all WAVE shipments
 */
async function _getWaveShipmentsAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .orderBy("createdAt", "desc")
            .get();

        return { error: null, success: true as const, data: serializeDocs(snapshot.docs) };
    } catch (error: any) {
        logger.error("Get wave shipments error:", error);
        return { success: false as const, error: error.message || "Failed to fetch wave shipments", data: null };
    }
}
export const getWaveShipmentsAction = withFlexibleSafeAction("getWaveShipmentsAction", _getWaveShipmentsAction);
