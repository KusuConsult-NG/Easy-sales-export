"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { requireSession, isAdmin } from "@/lib/session-guard";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createAdminAuditLog } from "@/lib/audit-log";
import { uploadFileToStorage, detectFileType } from "@/lib/storage-admin";
import { USER_UPLOADED_DOCUMENT, isIssuedCertificate } from "@/lib/certificate-kind";

/**
 * Certificate Management Actions
 */

export interface Certificate { id?: string;
    recordType?: string;
    userId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    certificateType: "training" | "license" | "accreditation" | "other";
    issueDate?: Date;
    expiryDate?: Date;
    issuer?: string;
    uploadedAt: Date | any;
    size: number; }

/**
 * Upload certificate
 */
export async function uploadCertificateAction(
    userId: string,
    file: File,
    metadata: { certificateType: string;
        issueDate?: string;
        expiryDate?: string;
        issuer?: string;
    }
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) { return { success: false as const, error: "Unauthorized", data: null };
        }
        // Validate file size (10MB max)
        const maxSize = parseInt(process.env.MAX_CERTIFICATE_SIZE_MB || "10", 10) * 1024 * 1024;
        if (file.size > maxSize) { return { success: false as const, error: `File size exceeds ${maxSize / 1024 / 1024}MB limit` };
        }

        // The file type is now decided by the file's CONTENT.
        //
        // `file.type` is a string the client sends. It was the only thing
        // checked here, and while uploadFileToStorage does sniff magic bytes, it
        // does so against a BROADER list — ALLOWED_MIMES there also permits
        // video, Word documents, webp and gif. So an MP4 declared as
        // `application/pdf` satisfied this check and then satisfied that one
        // too, and was stored with `fileType: "application/pdf"` recorded
        // against it: a certificate whose recorded type was a lie.
        //
        // "image/jpg" is dropped from the list because it is not a MIME type;
        // JPEG content is detected as image/jpeg.
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
        const buffer = Buffer.from(await file.arrayBuffer());
        const detectedType = await detectFileType(buffer, file.name);
        if (!detectedType || !allowedTypes.includes(detectedType)) {
            return { success: false as const, error: "Invalid file type. Only PDF and images are allowed", data: null };
        }

        // The stored metadata is validated too. These are TypeScript types on a
        // server action, erased before the request arrives, so they constrain
        // the callsite and nothing else. An unparseable date becomes Invalid
        // Date and is stored as one — the same silent failure as the CMS banner
        // dates.
        const certificateTypes = ["training", "license", "accreditation", "other"];
        if (!certificateTypes.includes(metadata.certificateType)) {
            return { success: false as const, error: "Unknown certificate type", data: null };
        }
        for (const [label, value] of [["Issue", metadata.issueDate], ["Expiry", metadata.expiryDate]] as const) {
            if (value !== undefined && Number.isNaN(new Date(value).getTime())) {
                return { success: false as const, error: `${label} date is not a valid date`, data: null };
            }
        }

        // Upload to Firebase Storage (Admin SDK)
        const fileName = `${Date.now()}-${file.name}`;
        const destination = `certificates/${userId}/${fileName}`;

        // Upload and get URL (Signed URL, effectively private/secure)
        const fileUrl = await uploadFileToStorage(file, destination, false);

        const certificate: Omit<Certificate, "id"> = {
            // Marks this as a document the user attached, not a credential the
            // platform issued. Both kinds live in this collection, and three
            // readers used to treat every row as the second — including the
            // PUBLIC verification endpoint, which answered isValid:true for the
            // id this action hands back. See lib/certificate-kind.
            recordType: USER_UPLOADED_DOCUMENT,
            userId,
            fileName: file.name,
            fileUrl,
            fileType: detectedType,
            certificateType: metadata.certificateType as Certificate["certificateType"],
            issueDate: metadata.issueDate ? new Date(metadata.issueDate) : undefined,
            expiryDate: metadata.expiryDate ? new Date(metadata.expiryDate) : undefined,
            issuer: metadata.issuer,
            uploadedAt: FieldValue.serverTimestamp(),
            size: file.size };

        const docRef = await db.collection(COLLECTIONS.CERTIFICATES).add(certificate);

        await createAdminAuditLog({ action: "user_update",
            userId,
            targetId: docRef.id,
            targetType: "certificate_upload",
            metadata: {
                fileName: file.name,
                certificateType: metadata.certificateType } });

        return { error: null, success: true as const, certificateId: docRef.id , data: null };
    } catch (error) { logger.error("Certificate upload error:", error);
        return { success: false as const, error: "Failed to upload certificate", data: null };
    }
}

/**
 * Get user certificates
 */
export async function getUserCertificatesAction(userId: string): Promise<Certificate[]> { try {
        // Was unauthenticated and took the userId from the caller, so anyone
        // could read anyone's certificates. User ids are not secret — they
        // appear as ownerId on public land listings, among other places.
        //
        // No caller today, but a dead export is still a reachable server
        // action. Guarded rather than deleted, matching createPaymentRecordAction.
        //
        // Public *verification* of a certificate is a separate, deliberate
        // endpoint: /api/academy/verify/[certificateId].
        const sessionResult = await requireSession();
        const session = sessionResult.session;
        if (!session?.user?.id) return [];
        if (session.user.id !== userId && !isAdmin(session.user.roles)) return [];

        const q = db.collection(COLLECTIONS.CERTIFICATES).where("userId", "==", userId);
        const snapshot = await q.get();

        return serializeDocs(snapshot.docs) as unknown as Certificate[];
    } catch (error) { logger.error("Failed to fetch certificates:", error);
        return [];
    }
}

/**
 * Delete certificate
 */
export async function deleteCertificateAction(
    certificateId: string,
    userId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) { return { success: false as const, error: "Unauthorized", data: null };
        }
        const certRef = db.collection(COLLECTIONS.CERTIFICATES).doc(certificateId);
        const certDoc = await certRef.get();

        if (!certDoc.exists) { return { success: false as const, error: "Certificate not found", data: null };
        }

        const cert = certDoc.data() as Certificate;

        // Verify ownership
        if (cert.userId !== userId) { return { success: false as const, error: "Unauthorized", data: null };
        }

        // This endpoint manages documents the user attached to their own
        // profile. Academy-issued credentials share the collection, carry the
        // learner's userId, and would therefore have passed the ownership check
        // above — so a learner could delete a credential the platform issued and
        // that a third party may be verifying, through the attach-a-file screen.
        if (isIssuedCertificate(cert as unknown as Record<string, any>)) {
            return { success: false as const, error: "Issued certificates cannot be deleted here", data: null };
        }

        // Delete from Cloud Storage
        if (cert.fileUrl) { try {
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
                if (objectPath) { await bucket.file(objectPath).delete({ ignoreNotFound: true });
                }
            } catch (storageError) { // Log but don't fail — Firestore doc is still deleted
                logger.warn("Failed to delete certificate file from storage:", { error: storageError instanceof Error ? storageError.message : String(storageError) });
            }
        }

        // Delete from Firestore
        await certRef.delete();

        await createAdminAuditLog({ action: "user_update",
            userId,
            targetId: certificateId,
            targetType: "certificate_delete",
            metadata: {
                fileName: cert.fileName } });

        return { error: null, success: true as const , data: null };
    } catch (error) { logger.error("Certificate deletion error:", error);
        return { success: false as const, error: "Failed to delete certificate", data: null };
    }
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboardingAction(userId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) { return { success: false as const, error: "Unauthorized", data: null };
        }
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await userRef.update({ onboardingCompleted: true,
            onboardingCompletedAt: FieldValue.serverTimestamp() });

        await createAdminAuditLog({ action: "user_update",
            userId,
            targetType: "onboarding_completion" });

        return { error: null, success: true as const , data: null };
    } catch (error) { logger.error("Failed to complete onboarding:", error);
        return { success: false as const, error: "Failed to complete onboarding", data: null };
    }
}

/**
 * Check if user has completed onboarding
 */
export async function checkOnboardingStatusAction(userId: string): Promise<boolean> { try {
        // Same shape: an unauthenticated read of another user's record, keyed
        // on a caller-supplied id.
        const sessionResult = await requireSession();
        const session = sessionResult.session;
        if (!session?.user?.id) return false;
        if (session.user.id !== userId && !isAdmin(session.user.roles)) return false;

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return false;
        }

        const userData = userDoc.data();
        return userData?.onboardingCompleted === true;
    } catch (error) { logger.error("Failed to check onboarding status:", error);
        return false;
    }
}
