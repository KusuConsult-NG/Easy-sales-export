"use server";

/**
 * Server-side file upload — Firebase Storage with Firestore fallback
 *
 * STRATEGY (never returns a 500):
 *  1. Try Firebase Storage (primary) — stores file, returns signed URL
 *  2. If Storage unavailable → store base64 in Firestore (fallback)
 *     The admin panel can download/migrate these later once Storage is set up.
 *  3. If both fail → return a structured error (no throw, no 500)
 *
 * Both paths return { success: true, url } so the UI always proceeds.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getAdminStorage, getAdminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const ALLOWED_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
};

const MAX_SIZE_MB = 5;

// ── Primary: Firebase Storage ────────────────────────────────────────────────
async function uploadToStorage(
    buffer: Buffer,
    userId: string,
    fileName: string,
    mimeType: string,
    documentType: string,
    ext: string
): Promise<string> {
    const bucketName =
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    if (!bucketName) throw new Error("FIREBASE_STORAGE_BUCKET not configured");

    const storage = getAdminStorage();
    const bucket = storage.bucket(bucketName);

    const [exists] = await bucket.exists();
    if (!exists) throw new Error(`Storage bucket '${bucketName}' does not exist`);

    const timestamp = Date.now();
    const storagePath = `documents/${userId}/${documentType}-${timestamp}.${ext}`;

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

    // 7-year signed read URL
    const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 7 * 365 * 24 * 60 * 60 * 1000,
    });

    return signedUrl;
}

// ── Fallback: Firestore document storage ────────────────────────────────────
async function uploadToFirestore(
    base64Content: string,
    userId: string,
    fileName: string,
    mimeType: string,
    documentType: string
): Promise<string> {
    const db = getAdminDb();
    const docRef = db.collection("_document_uploads").doc();
    const docId = docRef.id;

    await docRef.set({
        userId,
        documentType,
        fileName,
        mimeType,
        base64: base64Content,
        storedVia: "firestore_fallback",
        uploadedAt: Timestamp.now(),
        migrated: false,
    });

    logger.warn(
        `File stored in Firestore fallback (Storage not available). Doc: ${docId}`
    );

    // Return a internal reference URL so the app can still function.
    // Admin panel reads /api/admin/documents/[docId] to serve the file.
    return `/api/admin/documents/${docId}`;
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function uploadDocumentAction(
    base64Data: string,
    fileName: string,
    mimeType: string,
    documentType: string
): Promise<{ success: boolean; url?: string; error?: string; fallback?: boolean }> {
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

        // Decode base64
        const base64Content = base64Data.split(",").pop() || base64Data;
        const buffer = Buffer.from(base64Content, "base64");

        // Size check
        const sizeMB = buffer.byteLength / (1024 * 1024);
        if (sizeMB > MAX_SIZE_MB) {
            return { success: false, error: `File too large. Max ${MAX_SIZE_MB}MB.` };
        }

        const userId = session.user.id;

        // ── Path 1: Firebase Storage ──────────────────────────────────────
        try {
            const url = await uploadToStorage(buffer, userId, fileName, mimeType, documentType, ext);
            logger.info(`Document uploaded to Storage: ${documentType} for user ${userId}`);
            return { success: true, url };
        } catch (storageErr) {
            logger.warn(
                `Firebase Storage unavailable (${(storageErr as Error).message}), using Firestore fallback`
            );
        }

        // ── Path 2: Firestore Fallback ────────────────────────────────────
        try {
            const url = await uploadToFirestore(base64Content, userId, fileName, mimeType, documentType);
            return { success: true, url, fallback: true };
        } catch (firestoreErr) {
            logger.error("Firestore fallback also failed:", firestoreErr);
            return {
                success: false,
                error: "Upload failed — please try again or contact support.",
            };
        }

    } catch (error) {
        logger.error("uploadDocumentAction unexpected error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Upload failed.",
        };
    }
}
