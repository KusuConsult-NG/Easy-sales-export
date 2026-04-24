import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

// Force server-side execution
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { withRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/auth/mfa/verify
 * Verify MFA code for session (used by middleware enforcement)
 */
async function verifyMFAHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { code } = await request.json();

        if (!code || typeof code !== "string") {
            return NextResponse.json(
                { success: false, error: "Verification code is required" },
                { status: 400 }
            );
        }

        // Get user's MFA secret from Firestore (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;

        if (!userData.mfaEnabled || !userData.mfaSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up" },
                { status: 400 }
            );
        }

        const { verifyTOTPToken } = await import("@/lib/mfa");

        const isValid = verifyTOTPToken(code, userData.mfaSecret);

        if (!isValid) {
            return NextResponse.json(
                { success: false, error: "Invalid verification code" },
                { status: 400 }
            );
        }

        // Set MFA verified cookie (30 minutes)
        const response = NextResponse.json({ success: true });
        response.cookies.set("mfa_verified", "true", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 30 * 60,
        });

        return response;
    } catch (error: any) {
        logger.error("MFA verification error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to verify MFA code" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(verifyMFAHandler);
