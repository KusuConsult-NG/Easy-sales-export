"use server";

import { auth } from "@/lib/auth";
import { db, storage } from "@/lib/firebase";
import {
    doc,
    collection,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    where,
    orderBy,
    Timestamp,
    increment
} from "firebase/firestore";
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "firebase/storage";
import { createAuditLog } from "@/lib/audit-log";

export interface WaveResource {
    id?: string;
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    uploadedAt: Timestamp;
    uploadedBy: string;
    uploadedByName: string;
    downloads: number;
    tags?: string[];
    isActive: boolean;
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
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
        const allowedTypes = {
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

        // Upload to Firebase Storage
        const storageRef = ref(storage, storagePath);
        const arrayBuffer = await file.arrayBuffer();
        const snapshot = await uploadBytes(storageRef, arrayBuffer, {
            contentType: file.type,
        });

        // Get download URL
        const fileUrl = await getDownloadURL(snapshot.ref);

        // Create Firestore record
        const resourceData: Omit<WaveResource, "id"> = {
            title,
            description,
            category,
            fileUrl,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            uploadedAt: Timestamp.now(),
            uploadedBy: session.user.id,
            uploadedByName: session.user.name || "Unknown",
            downloads: 0,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
            isActive: true,
        };

        const docRef = await addDoc(collection(db, "wave_resources"), resourceData);

        // Create audit log
        await createAuditLog({
            action: "resource_upload",
            userId: session.user.id,
            targetId: docRef.id,
            targetType: "wave_resource",
        });

        return { success: true, resourceId: docRef.id };
    } catch (error: any) {
        console.error("Resource upload error:", error);
        return { success: false, error: error.message || "Failed to upload resource" };
    }
}

/**
 * Get all active resources, optionally filtered by category
 */
export async function getResourcesAction(category?: string): Promise<WaveResource[]> {
    try {
        let q = query(
            collection(db, "wave_resources"),
            where("isActive", "==", true),
            orderBy("uploadedAt", "desc")
        );

        if (category) {
            q = query(q, where("category", "==", category));
        }

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveResource[];
    } catch (error) {
        console.error("Failed to fetch resources:", error);
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        const resourceRef = doc(db, "wave_resources", resourceId);
        const resourceDoc = await getDoc(resourceRef);

        if (!resourceDoc.exists()) {
            return { success: false, error: "Resource not found" };
        }

        const resource = resourceDoc.data() as WaveResource;

        // Increment download count
        await updateDoc(resourceRef, {
            downloads: increment(1),
        });

        // Create audit log
        await createAuditLog({
            action: "resource_download",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true, url: resource.fileUrl };
    } catch (error: any) {
        console.error("Download tracking error:", error);
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Admin access required" };
        }

        const resourceRef = doc(db, "wave_resources", resourceId);

        // Soft delete
        await updateDoc(resourceRef, {
            isActive: false,
        });

        // Create audit log
        await createAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true };
    } catch (error: any) {
        console.error("Delete resource error:", error);
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Admin access required" };
        }

        const resourceRef = doc(db, "wave_resources", resourceId);

        await updateDoc(resourceRef, {
            title,
            description,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
        });

        // Create audit log
        await createAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource",
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update resource error:", error);
        return { success: false, error: error.message || "Failed to update resource" };
    }
}
