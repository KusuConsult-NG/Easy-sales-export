import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Check MFA status for current user
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        // Return non-error response when not authenticated
        if (!session?.user) {
            return NextResponse.json({
                success: true,
                enabled: false,
                authenticated: false,
            });
        }

        // Get user MFA status (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();

        if (!userDoc.exists) {
            return NextResponse.json({
                success: true,
                enabled: false,
                authenticated: true,
            });
        }

        const userData = userDoc.data()!;

        return NextResponse.json({
            success: true,
            enabled: userData.mfaEnabled || false,
            authenticated: true,
        });
    } catch (error: any) {
        logger.error("MFA status check error:", error);
        return NextResponse.json({
            success: true,
            enabled: false,
            error: "Failed to check status",
        });
    }
}
