import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

// Ensure this route is server-only
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enable MFA after verification
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

        const { token } = await request.json();

        if (!token || token.length !== 6) {
            return NextResponse.json(
                { success: false, error: "Invalid token" },
                { status: 400 }
            );
        }

        // Get user's TOTP secret
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, session.user.id));

        if (!userDoc.exists()) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();

        if (!userData.totpSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up. Please run setup first." },
                { status: 400 }
            );
        }

        // Decrypt secret and verify token (lazy load to avoid build issues)
        const { verifyTOTPToken } = await import("@/lib/mfa");
        const { decryptData } = await import("@/lib/security");

        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const secret = decryptData(userData.totpSecret, secretKey);

        // Verify token
        const isValid = verifyTOTPToken(token, secret);

        if (!isValid) {
            return NextResponse.json(
                { success: false, error: "Invalid verification code" },
                { status: 400 }
            );
        }

        // Enable MFA
        await updateDoc(doc(db, COLLECTIONS.USERS, session.user.id), {
            mfaEnabled: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "MFA enabled successfully",
        });
    } catch (error: any) {
        console.error("MFA enable error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to enable MFA" },
            { status: 500 }
        );
    }
}
