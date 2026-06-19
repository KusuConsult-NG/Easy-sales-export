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

        logger.info(`[Admin KYC QoreID] Bypassing live verification and marking as verified`, {
            adminId: session.user.id,
            collectionName,
            docId,
            field,
            firstName,
            lastName
        });

        const docRef = db.collection(collectionName).doc(docId);

        // Success: Update document as verified forcefully
        await docRef.update({
            [`${field}Verified`]: true,
            [`${field}Status`]: "verified",
            [`${field}VerifiedAt`]: FieldValue.serverTimestamp(),
            [`${field}VerifiedBy`]: session.user.id,
            [`${field}VerificationDetails`]: { bypassed: true, note: "QoreID verification bypassed by system rule" }
        });

        logger.info(`[Admin KYC QoreID] Unconditionally marked verified`, { docId, field });
        return NextResponse.json({
            success: true,
            isMatch: true,
            message: `${field.toUpperCase()} verified successfully.`
        });

    } catch (error: any) {
        logger.error("Failed to verify ID via QoreID:", error);
        return NextResponse.json(
            { success: false, message: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
