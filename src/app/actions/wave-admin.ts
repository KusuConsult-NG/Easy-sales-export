/**
 * Admin Server Actions for WAVE Management
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
    Timestamp,
    getDoc,
} from "firebase/firestore";
import { createAuditLog } from "@/lib/audit-log";

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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const resourceRef = await addDoc(collection(db, "wave_resources"), {
            ...data,
            downloads: 0,
            uploadedAt: Timestamp.now(),
            uploadedBy: session.user.id,
        });

        await createAuditLog({
            action: "resource_uploaded",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceRef.id,
        });

        return { success: true, resourceId: resourceRef.id };
    } catch (error) {
        console.error("Create resource error:", error);
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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(doc(db, "wave_resources", resourceId), {
            ...data,
            updatedAt: Timestamp.now(),
        });

        await createAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { success: true };
    } catch (error) {
        console.error("Update resource error:", error);
        return { success: false, error: "Failed to update resource" };
    }
}

export async function deleteResourceAction(
    resourceId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await deleteDoc(doc(db, "wave_resources", resourceId));

        await createAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { success: true };
    } catch (error) {
        console.error("Delete resource error:", error);
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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const eventRef = await addDoc(collection(db, "wave_training_events"), {
            ...data,
            currentParticipants: 0,
            status: "upcoming",
            createdAt: Timestamp.now(),
            createdBy: session.user.id,
        });

        await createAuditLog({
            action: "wave_training_created",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventRef.id,
        });

        return { success: true, eventId: eventRef.id };
    } catch (error) {
        console.error("Create event error:", error);
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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(doc(db, "wave_training_events", eventId), {
            ...data,
            updatedAt: Timestamp.now(),
        });

        await createAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { success: true };
    } catch (error) {
        console.error("Update event error:", error);
        return { success: false, error: "Failed to update event" };
    }
}

export async function getEventParticipantsAction(eventId: string): Promise<{
    success: boolean;
    participants?: any[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const q = query(
            collection(db, "wave_training_registrations"),
            where("eventId", "==", eventId)
        );
        const snap = await getDocs(q);

        const participants = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, participants };
    } catch (error) {
        console.error("Get participants error:", error);
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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const snapshot = await getDocs(collection(db, "wave_applications"));
        const applications = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, applications };
    } catch (error) {
        console.error("Get applications error:", error);
        return { success: false, error: "Failed to fetch applications" };
    }
}

export async function approveWaveApplicationAction(
    applicationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        // Get application
        const appDoc = await getDoc(doc(db, "wave_applications", applicationId));
        if (!appDoc.exists()) {
            return { success: false, error: "Application not found" };
        }

        const appData = appDoc.data();

        // Update application status
        await updateDoc(doc(db, "wave_applications", applicationId), {
            status: "approved",
            approvedAt: Timestamp.now(),
            approvedBy: session.user.id,
        });

        // Enroll user in WAVE
        if (appData.userId) {
            await addDoc(collection(db, "wave_members"), {
                userId: appData.userId,
                enrolledAt: Timestamp.now(),
                active: true,
            });
        }

        await createAuditLog({
            action: "wave_application_approved",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
        });

        return { success: true };
    } catch (error) {
        console.error("Approve application error:", error);
        return { success: false, error: "Failed to approve application" };
    }
}

export async function rejectWaveApplicationAction(
    applicationId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || !userDoc.data().roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(doc(db, "wave_applications", applicationId), {
            status: "rejected",
            rejectedAt: Timestamp.now(),
            rejectedBy: session.user.id,
            rejectionReason: reason,
        });

        await createAuditLog({
            action: "wave_application_rejected",
            userId: session.user.id,
            targetType: "wave_application",
            targetId: applicationId,
        });

        return { success: true };
    } catch (error) {
        console.error("Reject application error:", error);
        return { success: false, error: "Failed to reject application" };
    }
}
