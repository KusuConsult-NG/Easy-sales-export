import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

// Force server-side execution
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/verify
 * Verify MFA code for session (used by middleware enforcement)
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

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

        // Get user's MFA secret from Firestore
        const userRef = doc(db, COLLECTIONS.USERS, session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();

        if (!userData.mfaEnabled || !userData.mfaSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up" },
                { status: 400 }
            );
        }

        // Lazy-load crypto-dependent function
        const { verifyTOTPToken } = await import("@/lib/mfa");

        // Verify the TOTP code
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
            maxAge: 30 * 60, // 30 minutes
        });

        return response;
    } catch (error: any) {
        console.error("MFA verification error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to verify MFA code" },
            { status: 500 }
        );
    }
}
