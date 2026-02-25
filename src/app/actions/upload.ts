"use server";

/**
 * Server-side file upload using Firebase Storage Admin SDK
 *
 * Uses the same FIREBASE_* environment variables already configured.
 * Falls back to a clear error if Storage bucket is not set up on this project.
 *
 * Path pattern: documents/{userId}/{documentType}-{timestamp}.{ext}
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getAdminStorage } from "@/lib/firebase-admin";

const ALLOWED_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
};

const MAX_SIZE_MB = 5;

export async function uploadDocumentAction(
    base64Data: string,
    fileName: string,
    mimeType: string,
    documentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
        // Auth check
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Validate mime type
        const ext = ALLOWED_TYPES[mimeType];
        if (!ext) {
            return { success: false, error: "Invalid file type. Only JPG, PNG, PDF allowed." };
        }

        // Decode base64 + size check
        const base64Content = base64Data.split(",").pop() || base64Data;
        const buffer = Buffer.from(base64Content, "base64");
        const sizeMB = buffer.byteLength / (1024 * 1024);
        if (sizeMB > MAX_SIZE_MB) {
            return { success: false, error: `File too large. Max ${MAX_SIZE_MB}MB.` };
        }

        // Check that a storage bucket is configured
        const bucketName =
            process.env.FIREBASE_STORAGE_BUCKET ||
            process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

        if (!bucketName) {
            logger.error("FIREBASE_STORAGE_BUCKET is not set — cannot upload files");
            return {
                success: false,
                error: "File storage is not configured on this server. Please contact support.",
            };
        }

        // Get storage bucket from Admin SDK
        let bucket;
        try {
            const storage = getAdminStorage();
            bucket = storage.bucket(bucketName);
        } catch (storageErr) {
            logger.error("Failed to access Firebase Storage bucket:", storageErr);
            return {
                success: false,
                error: "File storage is temporarily unavailable. Please try again later.",
            };
        }

        // Build storage path
        const userId = session.user.id;
        const timestamp = Date.now();
        const storagePath = `documents/${userId}/${documentType}-${timestamp}.${ext}`;

        // Upload buffer
        const file = bucket.file(storagePath);
        await file.save(buffer, {
            metadata: {
                contentType: mimeType,
                metadata: {
                    uploadedBy: userId,
                    documentType,
                    originalName: fileName,
                    uploadedAt: new Date().toISOString(),
                },
            },
            resumable: false,
        });

        // Generate a long-lived signed URL (~7 years) for admin access
        const [signedUrl] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 7 * 365 * 24 * 60 * 60 * 1000,
        });

        logger.info(`Document uploaded: ${storagePath}`);
        return { success: true, url: signedUrl };

    } catch (error) {
        logger.error("Document upload failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Upload failed. Please try again.",
        };
    }
}
