"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { WaveCertificate } from "@/lib/types/wave-actions";

/**
 * Generate certificate for member
 */
async function _generateCertificateAction(
    userId: string,
    programName: string,
    certificateType: WaveCertificate["certificateType"]
): Promise<ActionResponse<WaveCertificate>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { success: false as const, error: "User not found", data: null };
        }

        const userData = userDoc.data();
        const certNumber = `WAVE-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const certId = `cert_${userId}_${Date.now()}`;
        const issuedDate = new Date();

        const certificate: WaveCertificate = {
            id: certId,
            memberId: userId,
            memberName: userData?.name || "Member",
            certificateType,
            programName,
            issuedDate,
            certificateNumber: certNumber,
            verificationUrl: `/wave/verify-certificate/${certNumber}`
        };

        await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certId).set(certificate);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: certId,
            targetType: "wave_certificate"
        });

        return { error: null, success: true as const, data: certificate };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Generate certificate error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const generateCertificateAction = withFlexibleSafeAction("generateCertificateAction", _generateCertificateAction);


/**
 * Get member certificates
 */
async function _getMemberCertificatesAction(userId: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // Allow reading own certificates
        if (session.user.id !== userId) return { success: false as const, error: "Unauthorized", data: null };

        const snapshot = await db.collection(COLLECTIONS.WAVE_CERTIFICATES)
            .where("memberId", "==", userId)
            .get();

        return { error: null, success: true as const, data: serializeDocs<WaveCertificate>(snapshot.docs) };
    } catch (error) {
        logger.error("Get certificates error:", error);
        return { success: false as const, error: "Failed to load certificates", data: null };
    }
}


export const getMemberCertificatesAction = withFlexibleSafeAction("getMemberCertificatesAction", _getMemberCertificatesAction);


/**
 * Get current user's certificates (auth handled internally)
 */
async function _getCurrentUserCertificatesAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        return await getMemberCertificatesAction(session.user.id);
    } catch (error) {
        logger.error("Get current user certificates error:", error);
        return { success: false as const, error: "Failed to load certificates", data: null };
    }
}


export const getCurrentUserCertificatesAction = withFlexibleSafeAction("getCurrentUserCertificatesAction", _getCurrentUserCertificatesAction);
