export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * Check MFA status for current user
 */
async function getMFAStatusHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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

export const GET = withRateLimit(getMFAStatusHandler);
