"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { uploadFileToStorage } from "@/lib/storage-admin";

/**
 * Certificate Management Actions
 */

export interface Certificate {
    id?: string;
    userId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    certificateType: "training" | "license" | "accreditation" | "other";
    issueDate?: Date;
    expiryDate?: Date;
    issuer?: string;
    uploadedAt: Date | any;
    size: number;
}

/**
 * Upload certificate
 */
export async function uploadCertificateAction(
    userId: string,
    file: File,
    metadata: {
        certificateType: string;
        issueDate?: string;
        expiryDate?: string;
        issuer?: string;
    }
): Promise<{ error: string | null, success: true | false; ; certificateId?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }
        // Validate file size (10MB max)
        const maxSize = parseInt(process.env.MAX_CERTIFICATE_SIZE_MB || "10", 10) * 1024 * 1024;
        if (file.size > maxSize) {
            return { success: false as const, error: `File size exceeds ${maxSize / 1024 / 1024}MB limit` };
        }

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            return { success: false as const, error: "Invalid file type. Only PDF and images are allowed" };
        }

        // Upload to Firebase Storage (Admin SDK)
        const fileName = `${Date.now()}-${file.name}`;
        const destination = `certificates/${userId}/${fileName}`;

        // Upload and get URL (Signed URL, effectively private/secure)
        const fileUrl = await uploadFileToStorage(file, destination, false);

        const certificate: Omit<Certificate, "id"> = {
            userId,
            fileName: file.name,
            fileUrl,
            fileType: file.type,
            certificateType: metadata.certificateType as Certificate["certificateType"],
            issueDate: metadata.issueDate ? new Date(metadata.issueDate) : undefined,
            expiryDate: metadata.expiryDate ? new Date(metadata.expiryDate) : undefined,
            issuer: metadata.issuer,
            uploadedAt: FieldValue.serverTimestamp(),
            size: file.size,
        };

        const docRef = await db.collection(COLLECTIONS.CERTIFICATES).add(certificate);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: docRef.id,
            targetType: "certificate_upload",
            metadata: {
                fileName: file.name,
                certificateType: metadata.certificateType,
            },
        });

        return { error: null, success: true as const, certificateId: docRef.id };
    } catch (error) {
        logger.error("Certificate upload error:", error);
        return { success: false as const, error: "Failed to upload certificate" };
    }
}

/**
 * Get user certificates
 */
export async function getUserCertificatesAction(userId: string): Promise<Certificate[]> {
    try {
        const q = db.collection(COLLECTIONS.CERTIFICATES).where("userId", "==", userId);
        const snapshot = await q.get();

        return serializeDocs(snapshot.docs) as unknown as Certificate[];
    } catch (error) {
        logger.error("Failed to fetch certificates:", error);
        return [];
    }
}

/**
 * Delete certificate
 */
export async function deleteCertificateAction(
    certificateId: string,
    userId: string
): Promise<{ error: string | null, success: true | false;  }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }
        const certRef = db.collection(COLLECTIONS.CERTIFICATES).doc(certificateId);
        const certDoc = await certRef.get();

        if (!certDoc.exists) {
            return { success: false as const, error: "Certificate not found" };
        }

        const cert = certDoc.data() as Certificate;

        // Verify ownership
        if (cert.userId !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }

        // Delete from Cloud Storage
        if (cert.fileUrl) {
            try {
                const { getStorage } = await import("firebase-admin/storage");
                const bucket = getStorage().bucket();
                // Extract object path: strip the signed URL prefix / query string
                // fileUrl is in the format: https://storage.googleapis.com/<bucket>/<path>?...
                const urlObj = new URL(cert.fileUrl);
                // Path is everything after the bucket name segment
                const pathParts = urlObj.pathname.split("/");
                // pathname = /<bucket>/certificates/<userId>/<filename>
                // We drop index 0 (empty) and index 1 (bucket name)
                const objectPath = pathParts.slice(2).join("/");
                if (objectPath) {
                    await bucket.file(objectPath).delete({ ignoreNotFound: true });
                }
            } catch (storageError) {
                // Log but don't fail — Firestore doc is still deleted
                logger.warn("Failed to delete certificate file from storage:", { error: storageError instanceof Error ? storageError.message : String(storageError) });
            }
        }

        // Delete from Firestore
        await certRef.delete();

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: certificateId,
            targetType: "certificate_delete",
            metadata: {
                fileName: cert.fileName,
            },
        });

        return { error: null, success: true };
    } catch (error) {
        logger.error("Certificate deletion error:", error);
        return { success: false as const, error: "Failed to delete certificate" };
    }
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboardingAction(userId: string): Promise<{ error: string | null, success: true | false;  }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await userRef.update({
            onboardingCompleted: true,
            onboardingCompletedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetType: "onboarding_completion",
        });

        return { error: null, success: true };
    } catch (error) {
        logger.error("Failed to complete onboarding:", error);
        return { success: false as const, error: "Failed to complete onboarding" };
    }
}

/**
 * Check if user has completed onboarding
 */
export async function checkOnboardingStatusAction(userId: string): Promise<boolean> {
    try {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return false;
        }

        const userData = userDoc.data();
        return userData?.onboardingCompleted === true;
    } catch (error) {
        logger.error("Failed to check onboarding status:", error);
        return false;
    }
}
