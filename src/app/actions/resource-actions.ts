"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { uploadFileToStorage } from "@/lib/storage-admin";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs } from "@/lib/firestore-serialize";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { isResourceWithdrawn, RESOURCE_LIVE_FIELDS, RESOURCE_WITHDRAWN_FIELDS } from "@/lib/wave-resource-visibility";

export interface WaveResource { id?: string;
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
    updatedAt?: FieldValue | Timestamp; }

/**
 * Upload a resource to Firebase Storage and create Firestore record
 */
/**
 * Is this caller entitled to WAVE resources?
 *
 * wave/_actions.ts::_getWaveResourcesAction — the module's own listing of this
 * same collection — requires an ACTIVE wave_members record, or an admin. The two
 * endpoints in this file serve /wave/(member)/resources and enforced neither:
 * the listing had no session check at all, and the download had only a session.
 *
 * So the membership gate the WAVE module applies to its resource list was
 * undone by a second listing of the same documents. The same shape as the
 * unguarded export catalogue in #112, where one endpoint had no check while its
 * siblings all did.
 */
async function callerMayAccessResources(): Promise<
    { ok: true; userId: string } | { ok: false; error: string }
> {
    const sessionResult = await requireSession();
    if (!sessionResult.session?.user?.id) {
        return { ok: false, error: sessionResult.error?.error ?? "Authentication required" };
    }
    const { session } = sessionResult;

    const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();
    if (memberDoc.exists && memberDoc.data()?.active) {
        return { ok: true, userId: session.user.id };
    }

    const { isAdmin } = await import("@/lib/admin-permissions");
    if (isAdmin(session.user.roles)) {
        return { ok: true, userId: session.user.id };
    }

    return { ok: false, error: "WAVE membership required" };
}

export async function uploadResourceAction(formData: FormData): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || !hasAdminPermission(userRoles, "wave:manage_training")) { return { success: false as const, error: "Admin access required", data: null };
        }

        const file = formData.get("file") as File;
        const title = formData.get("title") as string;
        const description = formData.get("description") as string;
        const category = formData.get("category") as "document" | "video" | "template" | "guide";
        const tags = formData.get("tags") as string;

        if (!file || !title || !description || !category) { return { success: false as const, error: "Missing required fields", data: null };
        }

        // Validate file size (50MB for documents, 200MB for videos)
        const maxSize = category === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
        if (file.size > maxSize) { return { success: false as const, error: `File too large. Max size: ${maxSize / (1024 * 1024)}MB`
            };
        }

        // Validate file type
        const allowedTypes: Record<string, string[]> = { document: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            video: ["video/mp4", "video/quicktime"],
            template: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            guide: ["application/pdf"]
        };

        if (!category || !(category in allowedTypes)) {
            return { success: false as const, error: "Invalid resource category", data: null };
        }

        if (!allowedTypes[category].includes(file.type)) { return { success: false as const, error: "Invalid file type for this category"};
        }

        // Create unique filename
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `wave_resources/${category}/${timestamp}_${sanitizedFileName}`;

        // Upload via the shared server-side uploader (Cloudinary).
        // This previously went through the firebase-admin/storage shim, whose
        // bucket handle has no makePublic() — so every resource upload threw.
        const fileUrl = await uploadFileToStorage(file, storagePath);

        // Create Firestore record
        const resourceData: Omit<WaveResource, "id"> = { title,
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
            ...RESOURCE_LIVE_FIELDS,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add(resourceData);

        // Create audit log
        await createAdminAuditLog({ action: "resource_uploaded",
            userId: session.user.id,
            targetId: docRef.id,
            targetType: "wave_resource" });

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("Resource upload error:", error);
        return { success: false as const, error: error.message || "Failed to upload resource", data: null };
    }
}

/**
 * Get all active resources, optionally filtered by category
 */
export async function getResourcesAction(category?: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        // The same gate the WAVE module puts on its own listing.
        //
        // This had no session check at all, while
        // wave/_actions.ts::_getWaveResourcesAction requires an active
        // wave_members record or an admin to list the very same collection. Its
        // only caller is /wave/(member)/resources, so the intent was never in
        // doubt — a second listing simply bypassed it, and a route group named
        // (member) enforces nothing on a server action, which is reachable
        // directly regardless of which page imports it.
        const access = await callerMayAccessResources();
        if (access.ok !== true) {
            return { success: false as const, error: access.error, data: null };
        }

        // Withdrawal is filtered in memory, not in SQL.
        //
        // This queried `.where("isActive", "==", true)`, and a resource created
        // through wave/_wv_admin_resources.ts has no `isActive` at all — so this
        // listing, which is what /wave/(member)/resources shows, excluded every
        // resource uploaded from that screen. The library was there and members
        // could not see it.
        //
        // "true or absent" is not expressible as one equality, and the alternative
        // — backfilling `isActive` across the collection — is a migration to fix a
        // reader. isResourceWithdrawn honours all three shapes live rows hold; see
        // wave-resource-visibility.ts for why absent counts as visible.
        let query = db.collection(COLLECTIONS.WAVE_RESOURCES)
            .orderBy("uploadedAt", "desc");

        if (category) {
            query = query.where("category", "==", category);
        }

        const snapshot = await query.get();
        const visible = snapshot.docs.filter((doc) => !isResourceWithdrawn(doc.data()));

        return { error: null, success: true as const, data: serializeDocs(visible) as unknown as WaveResource[] };
    } catch (error) { logger.error("Failed to fetch resources:", error);
        return { success: false as const, error: "Failed to fetch resources", data: null };
    }
}

/**
 * Track download and return resource URL
 */
export async function downloadResourceAction(resourceId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const access = await callerMayAccessResources();
        if (access.ok !== true) {
            return { success: false as const, error: access.error, data: null };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);
        const resourceDoc = await resourceRef.get();

        if (!resourceDoc.exists) { return { success: false as const, error: "Resource not found", data: null };
        }

        const resource = resourceDoc.data() as WaveResource;

        // A deleted resource is not downloadable.
        //
        // This path fetched by id and never looked at whether the resource had
        // been withdrawn, so anyone holding the id could still download the file
        // after an admin removed it. The deletion looked effective and was not.
        //
        // The check is now the shared predicate rather than `isActive === false`.
        // There are TWO delete actions on this collection: this file's sets
        // `isActive: false`, and wave/_wv_admin_resources.ts's set `deleted: true`
        // — which this guard did not test, so a resource withdrawn through the WAVE
        // admin screen was still downloadable. See wave-resource-visibility.ts.
        //
        // Reported as "not found", the same as a missing id, so the endpoint
        // does not confirm that a withdrawn resource exists.
        if (isResourceWithdrawn(resource as any)) {
            return { success: false as const, error: "Resource not found", data: null };
        }

        // Increment download count
        await resourceRef.update({ downloads: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp() });

        // Create audit log
        await createAdminAuditLog({ action: "resource_download",
            userId: access.userId,
            targetId: resourceId,
            targetType: "wave_resource" });

        return { error: null,  success: true as const, data: { url: resource.fileUrl } };
    } catch (error: any) { logger.error("Download tracking error:", error);
        return { success: false as const, error: error.message || "Failed to track download", data: null };
    }
}

/**
 * Soft delete a resource (admin only)
 */
export async function deleteResourceAction(resourceId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || !hasAdminPermission(userRoles, "wave:manage_training")) { return { success: false as const, error: "Admin access required", data: null };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        // Soft delete
        await resourceRef.update({ ...RESOURCE_WITHDRAWN_FIELDS,
            updatedAt: FieldValue.serverTimestamp(),
            deletedAt: FieldValue.serverTimestamp() });

        // Create audit log
        await createAdminAuditLog({ action: "resource_delete",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource" });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Delete resource error:", error);
        return { success: false as const, error: error.message || "Failed to delete resource", data: null };
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
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // Check if user is admin (multi-role array aware)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userRoles: string[] = userData?.roles || (userData?.role ? [userData.role] : []);
        if (!userDoc.exists || !userData || !hasAdminPermission(userRoles, "wave:manage_training")) { return { success: false as const, error: "Admin access required", data: null };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        await resourceRef.update({ title,
            description,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
            updatedAt: FieldValue.serverTimestamp() });

        // Create audit log
        await createAdminAuditLog({ action: "resource_update",
            userId: session.user.id,
            targetId: resourceId,
            targetType: "wave_resource" });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Update resource error:", error);
        return { success: false as const, error: error.message || "Failed to update resource", data: null };
    }
}
