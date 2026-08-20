"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
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

        /**
         * THE WAVE ADMIN COULD NOT ISSUE A WAVE CERTIFICATE.
         *
         * This was `roles.includes("admin") || roles.includes("super_admin")`,
         * read off the session. Two things wrong with it, both already fixed
         * elsewhere in this codebase and left here:
         *
         *   1. It excludes wave_admin — the role that runs the training these
         *      certificates are FOR. Every other action in the WAVE admin area
         *      (create a training event, approve an application, process a
         *      withdrawal) admits wave_admin through PERMISSION_MATRIX. Only the
         *      certificate did not, so the person who ran the course could not
         *      certify anyone who took it. Same lockout shape as #115, #118 and
         *      #122.
         *
         *   2. A literal includes() on session roles cannot see a role granted
         *      since the JWT was minted, and cannot see that super_admin implies
         *      admin. hasAdminPermission resolves both from the matrix.
         *
         * "wave:manage_training" — super_admin, admin, wave_admin. Issuing a
         * training certificate is part of managing the training, and it is the
         * permission the training screens next door already require.
         */
        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized: Permission required - wave:manage_training", data: null };
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

        /**
         * ONE CERTIFICATE PER MEMBER PER PROGRAMME, NOT ONE PER CLICK.
         *
         * The id was `cert_${userId}_${Date.now()}` and the write was a `set`,
         * with no check for an existing certificate. Two consequences, both
         * reachable by an admin pressing the button twice:
         *
         *   - A second later: two certificate documents for the same member and
         *     the same programme, with two different certificate numbers, both
         *     verifying as genuine. There is no way to tell afterwards which one
         *     was intended, and revoking one leaves the other standing.
         *
         *   - Inside the same millisecond: the same id, so the second `set`
         *     silently overwrites the first. The certificate number printed from
         *     the first response no longer exists in the database, and looking it
         *     up returns the OTHER number.
         *
         * The id is derived from what makes a certificate unique instead, which
         * is the same discipline creditWalletOnce uses for money: re-issuing is
         * then an idempotent no-op rather than a duplicate. Existing rows keep
         * their timestamped ids and their verification URLs.
         */
        const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const certId = `cert_${userId}_${certificateType}_${slug(programName)}`;

        const existing = await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certId).get();
        if (existing.exists) {
            const prior = existing.data() ?? {};
            logger.info(
                `[WAVE Certificate] ${userId} already holds a "${certificateType}" certificate for ` +
                `"${programName}" (${prior.certificateNumber}); returning it rather than issuing a second.`
            );
            return {
                error: null,
                success: true as const,
                data: { ...prior, id: certId } as unknown as WaveCertificate,
            };
        }

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

        /**
         * THE AUDIT ROW NAMED THE RECIPIENT AS THE ACTOR.
         *
         * `userId` here is the MEMBER the certificate is issued to. Passed as the
         * audit log's `userId` — the field every other call site fills with
         * `session.user.id` — it recorded each certificate as having been issued
         * BY the person who received it. The one question the log exists to
         * answer, "which admin issued this?", was the one it could not.
         *
         * Same defect as #129 in the dispute audit trail. The member is the
         * TARGET; targetId keeps pointing at the certificate, and metadata
         * carries the member so the row is still searchable by recipient.
         *
         * The action was "user_update", which is not what happened either.
         * "certificate_issued" is already in the AuditAction union and was used
         * by nothing.
         */
        await createAdminAuditLog({
            action: "certificate_issued",
            userId: session.user.id,
            targetId: certId,
            targetType: "wave_certificate",
            metadata: { memberId: userId, certificateType, programName, certificateNumber: certNumber },
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
