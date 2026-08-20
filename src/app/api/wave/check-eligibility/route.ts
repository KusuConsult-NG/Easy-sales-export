export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { checkWaveEligibility } from "@/lib/wave-eligibility";

/**
 * GET /api/wave/check-eligibility
 * Check WAVE eligibility and application status for the authenticated user.
 *
 * Response: { success, data: { gender, applicationStatus, eligible }, meta: { cursor: null, hasMore: false } }
 */
export async function GET(_request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, data: null, error: "User profile not found", meta: { cursor: null, hasMore: false } },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;
        const gender: string | null = userData.gender || null;

        /**
         * The shared rule.
         *
         * This file carried a line-for-line copy of _checkWaveEligibilityAction,
         * including the CUTOFF_DATE literal — and a THIRD copy in the submit action
         * had no cutoff at all, so this endpoint reported ineligible for accounts
         * whose applications the submit action then accepted. See
         * wave-eligibility.ts.
         */
        const eligible = checkWaveEligibility(userData).eligible;

        // Check application status from user's serviceRegistrations (single source of truth)
        const applicationStatus: string =
            userData.serviceRegistrations?.wave?.status || "not_applied";

        return NextResponse.json({
            success: true,
            data: {
                gender,
                applicationStatus,
                eligible,
            },
            meta: { cursor: null, hasMore: false },
        });
    } catch (error) {
        logger.error("GET /api/wave/check-eligibility error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Internal server error", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
