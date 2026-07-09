import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
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

        if (!userData.mfaEnabled || !userData.totpSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up" },
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

        let secret: string;
        try {
            secret = decryptData(userData.totpSecret, secretKey);
        } catch (decryptErr) {
            logger.error("MFA secret decryption failed:", decryptErr);
            return NextResponse.json(
                { success: false, error: "Failed to verify MFA code" },
                { status: 500 }
            );
        }

        const isValid = verifyTOTPToken(code, secret);

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
            domain: process.env.NODE_ENV === "production" ? ".easysalesexport.com" : undefined,
            path: "/",
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
