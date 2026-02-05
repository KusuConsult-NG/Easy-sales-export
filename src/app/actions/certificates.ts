"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { createAuditLog } from "@/lib/audit-log";

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
    uploadedAt: Timestamp;
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
): Promise<{ success: boolean; error?: string; certificateId?: string }> {
    try {
        // Validate file size (10MB max)
        const maxSize = parseInt(process.env.MAX_CERTIFICATE_SIZE_MB || "10", 10) * 1024 * 1024;
        if (file.size > maxSize) {
            return { success: false, error: `File size exceeds ${maxSize / 1024 / 1024}MB limit` };
        }

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            return { success: false, error: "Invalid file type. Only PDF and images are allowed" };
        }

        // Upload to Firebase Storage
        const fileName = `${Date.now()}-${file.name}`;
        const storageRef = ref(storage, `certificates/${userId}/${fileName}`);

        // Note: In actual implementation, we'd convert File to Buffer
        // For server action, we need to handle this differently
        // This is a placeholder for the actual upload logic

        const certificate: Omit<Certificate, "id"> = {
            userId,
            fileName: file.name,
            fileUrl: `https://storage.googleapis.com/placeholder/${fileName}`, // Placeholder
            fileType: file.type,
            certificateType: metadata.certificateType as any,
            issueDate: metadata.issueDate ? new Date(metadata.issueDate) : undefined,
            expiryDate: metadata.expiryDate ? new Date(metadata.expiryDate) : undefined,
            issuer: metadata.issuer,
            uploadedAt: Timestamp.now(),
            size: file.size,
        };

        const docRef = await addDoc(collection(db, "certificates"), certificate);

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: docRef.id,
            targetType: "certificate_upload",
            metadata: {
                fileName: file.name,
                certificateType: metadata.certificateType,
            },
        });

        return { success: true, certificateId: docRef.id };
    } catch (error) {
        console.error("Certificate upload error:", error);
        return { success: false, error: "Failed to upload certificate" };
    }
}

/**
 * Get user certificates
 */
export async function getUserCertificatesAction(userId: string): Promise<Certificate[]> {
    try {
        const q = query(collection(db, "certificates"), where("userId", "==", userId));
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Certificate[];
    } catch (error) {
        console.error("Failed to fetch certificates:", error);
        return [];
    }
}

/**
 * Delete certificate
 */
export async function deleteCertificateAction(
    certificateId: string,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const certRef = doc(db, "certificates", certificateId);
        const certDoc = await getDoc(certRef);

        if (!certDoc.exists()) {
            return { success: false, error: "Certificate not found" };
        }

        const cert = certDoc.data() as Certificate;

        // Verify ownership
        if (cert.userId !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        // Delete from Storage (placeholder - actual implementation would delete the file)
        // await deleteObject(ref(storage, cert.fileUrl));

        // Delete from Firestore
        await deleteDoc(certRef);

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: certificateId,
            targetType: "certificate_delete",
            metadata: {
                fileName: cert.fileName,
            },
        });

        return { success: true };
    } catch (error) {
        console.error("Certificate deletion error:", error);
        return { success: false, error: "Failed to delete certificate" };
    }
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboardingAction(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const userRef = doc(db, COLLECTIONS.USERS, userId);

        await updateDoc(userRef, {
            onboardingCompleted: true,
            onboardingCompletedAt: Timestamp.now(),
        });

        await createAuditLog({
            action: "user_update",
            userId,
            targetType: "onboarding_completion",
        });

        return { success: true };
    } catch (error) {
        console.error("Failed to complete onboarding:", error);
        return { success: false, error: "Failed to complete onboarding" };
    }
}

/**
 * Check if user has completed onboarding
 */
export async function checkOnboardingStatusAction(userId: string): Promise<boolean> {
    try {
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return false;
        }

        const userData = userDoc.data();
        return userData.onboardingCompleted === true;
    } catch (error) {
        console.error("Failed to check onboarding status:", error);
        return false;
    }
}
