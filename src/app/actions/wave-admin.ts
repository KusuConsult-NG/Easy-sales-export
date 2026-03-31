/**
 * Admin Server Actions for WAVE Management
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { serializeDocs } from "@/lib/firestore-serialize";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";

// ============================================================================
// RESOURCES MANAGEMENT
// ============================================================================

export async function createResourceAction(data: {
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
}): Promise<{ success: boolean; error?: string; resourceId?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const resourceRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add({
            downloads: 0,
            uploadedAt: FieldValue.serverTimestamp(),
            uploadedBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "resource_uploaded",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceRef.id,
        });

        return { success: true, resourceId: resourceRef.id };
    } catch (error) {
        logger.error("Create resource error:", error);
        return { success: false, error: "Failed to create resource" };
    }
}

export async function updateResourceAction(
    resourceId: string,
    data: Partial<{
        title: string;
        description: string;
        category: "document" | "video" | "template" | "guide";
        fileUrl: string;
        fileName: string;
        fileSize: number;
    }>
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Update resource error:", error);
        return { success: false, error: "Failed to update resource" };
    }
}

export async function deleteResourceAction(
    resourceId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,
        });

        await createAdminAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Delete resource error:", error);
        return { success: false, error: "Failed to delete resource" };
    }
}

// ============================================================================
// TRAINING EVENTS MANAGEMENT
// ============================================================================

export async function createTrainingEventAction(data: {
    title: string;
    description: string;
    instructor: string;
    date: Date;
    duration: string;
    maxParticipants: number;
    meetingLink?: string;
}): Promise<{ success: boolean; error?: string; eventId?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const eventRef = await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).add({
            currentParticipants: 0,
            status: "upcoming",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "wave_training_created",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventRef.id,
        });

        return { success: true, eventId: eventRef.id };
    } catch (error) {
        logger.error("Create event error:", error);
        return { success: false, error: "Failed to create event" };
    }
}

export async function updateTrainingEventAction(
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
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Update event error:", error);
        return { success: false, error: "Failed to update event" };
    }
}

export async function getEventParticipantsAction(eventId: string): Promise<{
    success: boolean;
    participants?: any[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const snap = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("eventId", "==", eventId)
            .get();

        const participants = serializeDocs(snap.docs);

        return { success: true, participants };
    } catch (error) {
        logger.error("Get participants error:", error);
        return { success: false, error: "Failed to fetch participants" };
    }
}

// ============================================================================
// APPLICATIONS MANAGEMENT
// ============================================================================

export async function getWaveApplicationsAction(): Promise<{
    success: boolean;
    applications?: any[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(1000).get();
        const applications = serializeDocs(snapshot.docs);

        return { success: true, applications };
    } catch (error) {
        logger.error("Get applications error:", error);
        return { success: false, error: "Failed to fetch applications" };
    }
}

export async function approveWaveApplicationAction(
    applicationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        // Get application
        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) {
            return { success: false, error: "Application not found" };
        }

        const appData = appDoc.data();

        // Update application status
        await appRef.update({
            status: "approved",
            approvedAt: FieldValue.serverTimestamp(),
            approvedBy: session.user.id,
        });

        // Enroll user in WAVE
        if (appData?.userId) {
            await db.collection(COLLECTIONS.WAVE_MEMBERS).add({
                userId: appData.userId,
                enrolledAt: FieldValue.serverTimestamp(),
                active: true,
            });

            // CLEAR CACHE - User now has Wave access
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(appData.userId, 'wave');
                logger.info(`[Wave Approval] Cleared cache for user: ${appData.userId}`);
            } catch (cacheError) {
                // Non-critical - continue even if cache clear fails
                logger.error('[Wave Approval] Cache invalidation error:', cacheError);
            }

            // Send approval email
            const userDocData = await db.collection(COLLECTIONS.USERS).doc(appData.userId).get();
            if (userDocData.exists) {
                const userData = userDocData.data();
                const { sendWaveApplicationEmail } = await import('@/lib/email-notifications');
                await sendWaveApplicationEmail(
                    userData?.email,
                    userData?.name || 'Member',
                    'approved'
                );
            }
        }

        await createAdminAuditLog({
            action: "wave_application_approved",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Approve application error:", error);
        return { success: false, error: "Failed to approve application" };
    }
}

export async function rejectWaveApplicationAction(
    applicationId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        // Get application data for email
        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (appDoc.exists) {
            const appData = appDoc.data();
            if (appData?.userId) {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(appData.userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    const { sendWaveApplicationEmail } = await import('@/lib/email-notifications');
                    await sendWaveApplicationEmail(
                        userData?.email,
                        userData?.name || 'Member',
                        'rejected',
                        reason
                    );
                }
            }
        }

        await appRef.update({
            status: "rejected",
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            rejectionReason: reason,
        });

        await createAdminAuditLog({
            action: "wave_application_rejected",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Reject application error:", error);
        return { success: false, error: "Failed to reject application" };
    }
}
