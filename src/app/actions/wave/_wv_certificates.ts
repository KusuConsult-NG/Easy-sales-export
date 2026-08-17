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
import { FieldValue } from "@/lib/firestore-compat";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";
import { WAVE_CERTIFICATE as WAVE_CERTIFICATE_RECORD_TYPE } from "@/lib/certificate-kind";
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

        /**
         * The member's name, resolved the way the rest of the platform resolves it.
         *
         * This read `userData?.name || "Member"`, and NOTHING writes `name` onto a
         * user. Registration writes `fullName`, `firstName` and `lastName` — there
         * is no `name` field in the profile it creates — so the fallback always
         * won and every certificate this action has ever issued was made out to
         * "Member".
         *
         * extractCanonicalUser is the shared resolver, used by the admin lists, the
         * withdrawal payout and the application screens. A certificate is the one
         * artefact where the name is the entire point.
         */
        const canonical = extractCanonicalUser(userData ?? {});
        const memberName = canonical.name || "Member";

        if (!canonical.name) {
            logger.warn(
                `[WAVE Certificate] No name could be resolved for ${userId}; issuing to "Member". ` +
                `Fill in the member's name before this certificate is presented anywhere.`
            );
        }

        /**
         * A certificate number nobody can guess, and no two certificates share.
         *
         * It was `Math.random().toString(36).substring(2, 8)` — six base-36
         * characters, from a generator that is not cryptographically random and is
         * seeded predictably enough that sequences can be reconstructed. For a
         * number whose purpose is to let a third party confirm a credential is
         * genuine, guessable is the wrong property to have.
         *
         * Six characters is also about 2.2 billion values, so at fifteen thousand
         * certificates the chance of a collision is a few percent — and nothing
         * checked for one before writing.
         *
         * randomUUID gives 122 bits. Twelve hex characters of it is 48 bits, which
         * makes a collision negligible at any volume this programme will reach while
         * staying short enough to read off a printed page.
         */
        const { randomUUID } = await import("crypto");
        const certNumber = `WAVE-${new Date().getFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
        const certId = `cert_${userId}_${Date.now()}`;
        const issuedDate = new Date();

        const certificate: WaveCertificate = {
            id: certId,
            memberId: userId,
            memberName,
            certificateType,
            programName,
            issuedDate,
            certificateNumber: certNumber,
            // Keyed on the document id, and pointing at a verifier that exists.
            //
            // It was `/wave/verify-certificate/${certNumber}` — a route with no
            // page and no handler anywhere in the app, so every certificate ever
            // issued carried a verification link that 404s. The public verifier is
            // /api/academy/verify/[certificateId], which now looks in this
            // collection too; the path keeps its historical name because the
            // academy certificate URLs already in circulation use it.
            verificationUrl: `/academy/verify/${certId}`
        };

        await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certId).set({
            ...certificate,
            // The fields the unified certificates endpoint reads. It queried this
            // collection on `userId` while this writer stored `memberId`, and read
            // `type`, `issuedAt` and `certificateUrl` where this writer stored
            // `certificateType`, `issuedDate` and nothing — four field names, none
            // of them matching, so its WAVE branch returned no rows at all and
            // could not have rendered them if it had.
            //
            // Written alongside rather than instead of, so the member page — which
            // reads the names above — keeps working on old and new rows alike.
            userId,
            type: certificateType,
            issuedAt: issuedDate,
            recordType: WAVE_CERTIFICATE_RECORD_TYPE,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

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
