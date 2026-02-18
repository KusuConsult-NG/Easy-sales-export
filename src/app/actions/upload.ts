"use server";

/**
 * Server-side file upload to Firebase Storage
 *
 * Uses Firebase Admin SDK to bypass App Check restrictions that block
 * client-side uploads. Files are sent as base64 strings and uploaded
 * server-side where Admin SDK has full access.
 */

import { auth } from "@/lib/auth";
import { getAdminStorage } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
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
        if (!ALLOWED_TYPES.includes(mimeType)) {
            return { success: false, error: "Invalid file type. Only JPG, PNG, PDF allowed." };
        }

        // Decode base64
        const base64Content = base64Data.split(",").pop() || base64Data;
        const buffer = Buffer.from(base64Content, "base64");

        // Check size
        const sizeMB = buffer.byteLength / (1024 * 1024);
        if (sizeMB > MAX_SIZE_MB) {
            return { success: false, error: `File too large. Max ${MAX_SIZE_MB}MB.` };
        }

        // Build storage path
        const userId = session.user.id;
        const timestamp = Date.now();
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `cooperative/documents/${userId}/${documentType}-${timestamp}-${sanitizedName}`;

        // Get bucket name - prefer server-side var, fallback to public var
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
        if (!bucketName) {
            return { success: false, error: "Storage bucket not configured. Set FIREBASE_STORAGE_BUCKET in environment variables." };
        }

        // Upload via Admin SDK (bypasses App Check)
        const adminStorage = getAdminStorage();
        // Use bucket() with explicit name to ensure correct bucket is used
        const bucket = adminStorage.bucket(bucketName);
        const file = bucket.file(storagePath);

        logger.info(`Uploading to bucket: ${bucketName}, path: ${storagePath}`);

        await file.save(buffer, {
            metadata: {
                contentType: mimeType,
                metadata: {
                    uploadedBy: userId,
                    documentType,
                    originalName: fileName,
                },
            },
        });

        // Make file publicly readable and get URL
        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;

        logger.info(`Document uploaded: ${storagePath}`);
        return { success: true, url: publicUrl };
    } catch (error) {
        logger.error("Document upload failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Upload failed",
        };
    }
}
