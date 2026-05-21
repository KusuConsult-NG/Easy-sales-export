export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withRateLimit } from "@/lib/rate-limit";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Disable MFA
 * Rate-limited to prevent account takeover via rapid disable attempts.
 */
async function disableMFAHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { token } = await request.json().catch(() => ({}));

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;

        // If MFA is active, require the current TOTP token to disable it (A-03)
        if (userData.mfaEnabled) {
            if (!token || token.length !== 6) {
                return NextResponse.json(
                    { success: false, error: "Invalid token" },
                    { status: 400 }
                );
            }
            if (!userData.totpSecret) {
                return NextResponse.json(
                    { success: false, error: "MFA data inconsistent" },
                    { status: 400 }
                );
            }

            const { verifyTOTPToken } = await import("@/lib/mfa");
            const { decryptData } = await import("@/lib/security");

            const secretKey = process.env.MFA_SECRET_KEY;
            if (!secretKey) {
                logger.error("FATAL: MFA_SECRET_KEY is not set");
                return NextResponse.json(
                    { success: false, error: "Service configuration error" },
                    { status: 500 }
                );
            }

            const secret = decryptData(userData.totpSecret, secretKey);
            const isValid = verifyTOTPToken(token, secret);

            if (!isValid) {
                return NextResponse.json(
                    { success: false, error: "Invalid verification code" },
                    { status: 400 }
                );
            }
        }

        // Disable MFA and clear secrets (Admin SDK)
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            mfaEnabled: false,
            totpSecret: null,
            mfaRecoveryCodes: null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "MFA disabled",
        });
    } catch (error: any) {
        logger.error("MFA disable error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to disable MFA" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(disableMFAHandler);
