export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * Disable MFA
 * Rate-limited to prevent account takeover via rapid disable attempts.
 */
async function disableMFAHandler(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Disable MFA and clear secrets (Admin SDK)
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            mfaEnabled: false,
            totpSecret: null,
            mfaRecoveryCodes: null,
            updatedAt: new Date(),
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
