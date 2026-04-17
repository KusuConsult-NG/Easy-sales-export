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
import { FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
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
}): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

        return { success: true, data: { resourceId: resourceRef.id } };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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
}): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

        return { success: true, data: { eventId: eventRef.id } };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

export async function getEventParticipantsAction(eventId: string): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

        return { success: true, data: { participants } };
    } catch (error) {
        logger.error("Get participants error:", error);
        return { success: false, error: "Failed to fetch participants" };
    }
}

// ============================================================================
// APPLICATIONS MANAGEMENT
// ============================================================================

export async function getWaveApplicationsAction(): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

        return { success: true, data: { applications } };
    } catch (error) {
        logger.error("Get applications error:", error);
        return { success: false, error: "Failed to fetch applications" };
    }
}

export async function approveWaveApplicationAction(
    applicationId: string
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
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

export async function getStandardWaveApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "under_review" | "approved" | "rejected" | "all";
    lastDocId?: string;
} = {}): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any; lastDocId?: string; hasMore?: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        let q = db.collection(COLLECTIONS.WAVE_APPLICATIONS).orderBy("createdAt", "desc");
        
        let countQ: FirebaseFirestore.Query = db.collection(COLLECTIONS.WAVE_APPLICATIONS);

        if (options.status && options.status !== "all") {
            q = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
            countQ = countQ.where("status", "==", options.status);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        
        q = q.limit(fetchLimit);

        const [snapshot, countSnap] = await Promise.all([
            q.get(),
            countQ.count().get()
        ]);
        const applications = serializeDocs(snapshot.docs);
        const totalCount = countSnap.data().count;

        // Fetch all connected users
        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        
        // Chunk users into blocks of 30 for 'in' queries
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                const userSnaps = await db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get();
                userSnaps.docs.forEach(d => userMap.set(d.id, d.data()));
            }
        }

        const standardForms = applications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (app.surname ? `${app.firstName} ${app.surname}`.trim() : "Unknown User");

            const mergedData = {
                ...app,
                phone:              app.phone              || uData.phone       || uData.phoneNumber || null,
                gender:             app.gender             || uData.gender      || null,
                dateOfBirth:        app.dateOfBirth        || uData.dob         || null,
                occupation:         app.occupation         || uData.occupation  || null,
                stateOfOrigin:      app.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state  : uData.stateOfOrigin)  || null,
                lga:                app.lga                || (typeof uData.address === 'object' ? uData.address?.lga    : uData.lga)            || null,
                residentialAddress: app.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address)        || null,
                firstName:          app.firstName          || uData.firstName   || null,
                lastName:           app.lastName || app.surname || uData.lastName || null,
                email:              app.email || app.userEmail || uData.email    || null,
            };

            return {
                id: app.id,
                user: {
                    id: app.userId,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                },
                status: app.status || "pending",
                data: mergedData
            };
        });

        // Client-side search application if specified
        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase();
            finalForms = standardForms.filter((f: any) => 
                f.user.name?.toLowerCase().includes(s) || 
                f.user.email?.toLowerCase().includes(s) || 
                f.user.phone?.includes(s)
            );
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: finalForms,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: applications.length,
                totalCount: totalCount,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard WAVE applications error:", error);
        return { success: false, error: "Failed to fetch normalized Wave applications" };
    }
}

export async function getStandardWaveWithdrawalsAction(options: {
    status?: "pending" | "processing" | "approved" | "approved_pending_payout" | "completed" | "rejected" | "all";
    limit?: number;
    lastDocId?: string;
} = {}): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any; lastDocId?: string; hasMore?: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 25);
        let q = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).orderBy("requestedAt", "desc");
        
        if (options.status && options.status !== "all") {
            q = db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
                .where("status", "==", options.status)
                .orderBy("requestedAt", "desc");
        }

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

        const withdrawals = docs.map(doc => ({
            withdrawalId: doc.id,
            ...doc.data(),
            requestedAt: doc.data().requestedAt?.toDate?.()?.toISOString() ?? null,
            processedAt: doc.data().processedAt?.toDate?.()?.toISOString() ?? null,
            completedAt: doc.data().completedAt?.toDate?.()?.toISOString() ?? null,
        }));

        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: withdrawals,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: withdrawals.length,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard WAVE withdrawals error:", error);
        return { success: false, error: "Failed to fetch WAVE withdrawals" };
    }
}
