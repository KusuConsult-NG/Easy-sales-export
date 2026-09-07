export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { manuallyVerifiedFields } from "@/lib/identity-verification";
import { recordAdminAction } from "@/lib/audit-log";

const ALLOWED_COLLECTIONS = [
    "wave_applications",
    "export_onboarding_applications",
    "cooperative_onboarding_applications",
    "cooperative_members",
    "users"
];

/**
 *   #485 THIS ROUTE TOLD THE ADMIN AN IDENTITY CHECK HAD RUN.
 *
 *        It imported an external verification service, never called it, logged
 *        "Bypassing live verification and marking as verified", wrote
 *        `{ bypassed: true }` into the record, and answered the browser with
 *        "BVN verified successfully." — under a button that named that third
 *        party. An admin clicking it had every reason to believe an external
 *        register had confirmed the member's identity. Nothing had.
 *
 *        It is now what it always was: A NAMED ADMIN CONFIRMING AN IDENTITY BY
 *        HAND. That is a real and useful act — it is the only identity check
 *        this platform performs — and it is worth strictly more than the
 *        self-declared flag every other path writes, so it is recorded as its
 *        own method, with the admin's id, and it is what the green "Verified"
 *        badge now means.
 *
 *        The path lost the provider's name too: an operator reading a network
 *        log should not see a service being called that is not being called.
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!hasAdminPermission(session.user.roles, "users:update")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { collectionName, docId, field, value, firstName, lastName } = body;

        if (!collectionName || !docId || !field || !value || !firstName || !lastName) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
            return NextResponse.json(
                { success: false, message: "Unauthorized collection update attempt" },
                { status: 400 }
            );
        }

        if (field !== "bvn" && field !== "nin") {
            return NextResponse.json(
                { success: false, message: "Invalid verification field. Must be 'bvn' or 'nin'." },
                { status: 400 }
            );
        }

        logger.info(`[Admin KYC] Recording a manual identity confirmation`, {
            adminId: session.user.id,
            collectionName,
            docId,
            field,
            firstName,
            lastName
        });

        const docRef = db.collection(collectionName).doc(docId);

        await docRef.update({
            ...manuallyVerifiedFields(field, session.user.id),
            [`${field}VerifiedAt`]: FieldValue.serverTimestamp(),
            [`${field}VerificationDetails`]: {
                method: "manual_admin_review",
                adminId: session.user.id,
                //   The names the admin was looking at when they confirmed.
                //   Without them the record says an identity was confirmed and
                //   not what it was confirmed against, which is the difference
                //   between an audit trail and a timestamp.
                confirmedAgainst: { firstName, lastName },
            }
        });

        logger.info(`[Admin KYC] Manual confirmation recorded`, { docId, field, adminId: session.user.id });
        await recordAdminAction({
            action: 'kyc_manual_verify',
            userId: session.user.id,
            targetId: docId,
            targetType: 'docId',
        });
        return NextResponse.json({
            success: true,
            isMatch: true,
            method: "manual_admin_review",
            //   Says who confirmed it and on what basis. "verified
            //   successfully" read as a result returned BY something; this
            //   reads as a record OF something the admin just did.
            message: `${field.toUpperCase()} marked as manually verified by you. No automated identity check was performed.`
        });

    } catch (error: any) {
        logger.error("Failed to record manual identity verification:", error);
        return NextResponse.json(
            { success: false, message: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
