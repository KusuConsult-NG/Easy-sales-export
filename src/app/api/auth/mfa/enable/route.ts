import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withRateLimit } from "@/lib/rate-limit";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enable MFA after verification
 * Rate-limited to prevent TOTP token brute-forcing.
 */
async function enableMFAHandler(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { token } = await request.json();

        if (!token || token.length !== 6) {
            return NextResponse.json(
                { success: false, error: "Invalid token" },
                { status: 400 }
            );
        }

        // Get user's TOTP secret (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;

        if (!userData.totpSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up. Please run setup first." },
                { status: 400 }
            );
        }

        const { verifyTOTPToken } = await import("@/lib/mfa");
        const { decryptData } = await import("@/lib/security");

        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const secret = decryptData(userData.totpSecret, secretKey);

        const isValid = verifyTOTPToken(token, secret);

        if (!isValid) {
            return NextResponse.json(
                { success: false, error: "Invalid verification code" },
                { status: 400 }
            );
        }

        // Enable MFA (Admin SDK)
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            mfaEnabled: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "MFA enabled successfully",
        });
    } catch (error: any) {
        logger.error("MFA enable error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to enable MFA" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(enableMFAHandler);
