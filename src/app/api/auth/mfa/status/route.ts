import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Check MFA status for current user
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();

        // Return non-error response when not authenticated
        // This prevents console errors during page load
        if (!session?.user) {
            return NextResponse.json({
                success: true,
                enabled: false,
                authenticated: false,
            });
        }

        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, session.user.id));

        if (!userDoc.exists()) {
            return NextResponse.json({
                success: true,
                enabled: false,
                authenticated: true,
            });
        }

        const userData = userDoc.data();

        return NextResponse.json({
            success: true,
            enabled: userData.mfaEnabled || false,
            authenticated: true,
        });
    } catch (error: any) {
        logger.error("MFA status check error:", error);
        // Return graceful error response instead of 500
        return NextResponse.json({
            success: true,
            enabled: false,
            error: "Failed to check status",
        });
    }
}
