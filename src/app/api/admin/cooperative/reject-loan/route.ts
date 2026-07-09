export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Reject Loan Application (Admin Only)
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { applicationId, reason } = await request.json();

        if (!applicationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Application ID and rejection reason are required" },
                { status: 400 }
            );
        }

        // Get application (Admin SDK)
        const applicationRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const applicationDoc = await applicationRef.get();

        if (!applicationDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Application not found" },
                { status: 404 }
            );
        }

        const appData = applicationDoc.data();
        const userId = appData?.userId;

        // Update application status
        await applicationRef.update({
            status: "rejected",
            rejectionReason: reason,
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            try {
                const { invalidateCooperativeCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateCooperativeCache(userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Reject Loan Route Cache] Cache clear error:', cacheError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "Loan application rejected"
        });
    } catch (error) {
        logger.error("Failed to reject loan:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
