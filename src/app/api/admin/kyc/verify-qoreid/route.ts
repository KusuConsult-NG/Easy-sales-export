export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { qoreIdService } from "@/lib/qoreid";

const ALLOWED_COLLECTIONS = [
    "wave_applications",
    "export_onboarding_applications",
    "cooperative_onboarding_applications",
    "cooperative_members",
    "users"
];

/**
 * API Route: Live verify BVN/NIN using QoreID (Admin Only)
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
        if (!isAdmin(session.user.roles)) {
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

        if (!/^\d{11}$/.test(value)) {
            return NextResponse.json(
                { success: false, message: `${field.toUpperCase()} must be exactly 11 digits.` },
                { status: 400 }
            );
        }

        logger.info(`[Admin KYC QoreID] Initiating live verification`, {
            adminId: session.user.id,
            collectionName,
            docId,
            field,
            firstName,
            lastName
        });

        // Call QoreID Service
        let qoreIdResult;
        if (field === "bvn") {
            qoreIdResult = await qoreIdService.verifyBVN(value, firstName, lastName);
        } else {
            qoreIdResult = await qoreIdService.verifyNIN(value, firstName, lastName);
        }

        const docRef = db.collection(collectionName).doc(docId);

        if (!qoreIdResult.success) {
            logger.error(`[Admin KYC QoreID] QoreID API failure`, { error: qoreIdResult.error });
            return NextResponse.json(
                { success: false, message: qoreIdResult.error || "QoreID verification API call failed" },
                { status: 524 } // Gateway timeout or connection issue indicator
            );
        }

        if (qoreIdResult.isMatch) {
            // Success: Update document as verified
            await docRef.update({
                [`${field}Verified`]: true,
                [`${field}Status`]: "verified",
                [`${field}VerifiedAt`]: FieldValue.serverTimestamp(),
                [`${field}VerifiedBy`]: session.user.id,
                [`${field}VerificationDetails`]: qoreIdResult.details || null
            });

            logger.info(`[Admin KYC QoreID] Successful match`, { docId, field });
            return NextResponse.json({
                success: true,
                isMatch: true,
                message: `${field.toUpperCase()} verified successfully.`
            });
        } else {
            // Mismatch: Update document as failed match
            await docRef.update({
                [`${field}Verified`]: false,
                [`${field}Status`]: "failed",
                [`${field}VerificationDetails`]: qoreIdResult.details || null
            });

            logger.warn(`[Admin KYC QoreID] Mismatch returned`, { docId, field });
            return NextResponse.json({
                success: true,
                isMatch: false,
                message: `${field.toUpperCase()} name check failed. The name on the identity record does not match the applicant's name.`
            });
        }

    } catch (error: any) {
        logger.error("Failed to verify ID via QoreID:", error);
        return NextResponse.json(
            { success: false, message: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
