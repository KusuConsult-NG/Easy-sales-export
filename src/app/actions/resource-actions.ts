"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { serializeDocs } from "@/lib/firestore-serialize";

export interface WaveResource {
    id?: string;
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    uploadedAt: FieldValue | Timestamp;
    uploadedBy: string;
    uploadedByName: string;
    downloads: number;
    tags?: string[];
    isActive: boolean;
    createdAt?: FieldValue | Timestamp;
    updatedAt?: FieldValue | Timestamp;
}

/**
 * Upload a resource to Firebase Storage and create Firestore record
 */
export async function uploadResourceAction(formData: FormData): Promise<{
    success: boolean;
    error?: string;
    resourceId?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || (!userRoles.includes("admin") && !userRoles.includes("super_admin"))) {
            return { success: false, error: "Admin access required" };
        }

        const file = formData.get("file") as File;
        const title = formData.get("title") as string;
        const description = formData.get("description") as string;
        const category = formData.get("category") as "document" | "video" | "template" | "guide";
        const tags = formData.get("tags") as string;

        if (!file || !title || !description || !category) {
            return { success: false, error: "Missing required fields" };
        }

        // Validate file size (50MB for documents, 200MB for videos)
        const maxSize = category === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: `File too large. Max size: ${maxSize / (1024 * 1024)}MB`
            };
        }

        // Validate file type
        const allowedTypes: Record<string, string[]> = {
            document: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            video: ["video/mp4", "video/quicktime"],
            template: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            guide: ["application/pdf"]
        };

        if (!allowedTypes[category].includes(file.type)) {
            return { success: false, error: "Invalid file type for this category" };
        }

        // Create unique filename
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `wave_resources/${category}/${timestamp}_${sanitizedFileName}`;

        // Upload to Firebase Storage using Admin SDK
        const bucket = getStorage().bucket();
        const fileRef = bucket.file(storagePath);
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await fileRef.save(buffer, {
            metadata: {
                contentType: file.type,
            },
        });

        // Make file public or generate signed URL
        // For simplicity, we'll make it public assuming resources are public
        await fileRef.makePublic();
        const fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // Create Firestore record
        const resourceData: Omit<WaveResource, "id"> = {
            title,
            description,
            category,
            fileUrl,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            uploadedAt: FieldValue.serverTimestamp(),
            uploadedBy: session.user.id,
            uploadedByName: session.user.name || "Unknown",
            downloads: 0,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add(resourceData);

        // Create audit log
        await createAdminAuditLog({
            action: "resource_uploaded",
            userId: session.user.id,
            targetId: docRef.id,
            targetType: "wave_resource",
        });

        return { success: true, resourceId: docRef.id };
    } catch (error: any) {
        logger.error("Resource upload error:", error);
        return { success: false, error: error.message || "Failed to upload resource" };
    }
}

/**
 * Get all active resources, optionally filtered by category
 */
export async function getResourcesAction(category?: string): Promise<WaveResource[]> {
    try {
        let query = db.collection(COLLECTIONS.WAVE_RESOURCES)
            .where("isActive", "==", true)
            .orderBy("uploadedAt", "desc");

        if (category) {
            query = query.where("category", "==", category);
        }

        const snapshot = await query.get();

        return serializeDocs(snapshot.docs) as unknown as WaveResource[];
    } catch (error) {
        logger.error("Failed to fetch resources:", error);
        return [];
    }
}

/**
 * Track download and return resource URL
 */
export async function downloadResourceAction(resourceId: string): Promise<{
    success: boolean;
    url?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);
        const resourceDoc = await resourceRef.get();

        if (!resourceDoc.exists) {
            return { success: false, error: "Resource not found" };
        }

        const resource = resourceDoc.data() as WaveResource;

        // Increment download count
        await resourceRef.update({
            downloads: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create audit log
        await createAdminAuditLog({
            action: "resource_download",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true, url: resource.fileUrl };
    } catch (error: any) {
        logger.error("Download tracking error:", error);
        return { success: false, error: error.message || "Failed to track download" };
    }
}

/**
 * Soft delete a resource (admin only)
 */
export async function deleteResourceAction(resourceId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || (!userRoles.includes("admin") && !userRoles.includes("super_admin"))) {
            return { success: false, error: "Admin access required" };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        // Soft delete
        await resourceRef.update({
            isActive: false,
            updatedAt: FieldValue.serverTimestamp(),
            deletedAt: FieldValue.serverTimestamp(),
        });

        // Create audit log
        await createAdminAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Delete resource error:", error);
        return { success: false, error: error.message || "Failed to delete resource" };
    }
}

/**
 * Update resource metadata (admin only)
 */
export async function updateResourceAction(
    resourceId: string,
    title: string,
    description: string,
    tags?: string
): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || (!userRoles.includes("admin") && !userRoles.includes("super_admin"))) {
            return { success: false, error: "Admin access required" };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        await resourceRef.update({
            title,
            description,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create audit log
        await createAdminAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update resource error:", error);
        return { success: false, error: error.message || "Failed to update resource" };
    }
}
