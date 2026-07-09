export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * PATCH /api/admin/cooperative/mark-withdrawal-completed
 * Marks an approved_pending_payout cooperative withdrawal as completed
 * Used when the admin has manually processed the bank transfer.
 */
export async function PATCH(request: NextRequest) {
    try {
        const db = getAdminDb();
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        if (!isAdmin(session.user.roles)) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json();
        const { withdrawalId, transactionReference } = body;

        if (!withdrawalId || typeof withdrawalId !== "string") {
            return NextResponse.json({ success: false, error: "withdrawalId is required" }, { status: 400 });
        }

        const ref = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);
        const snap = await ref.get();

        if (!snap.exists) {
            return NextResponse.json({ success: false, error: "Withdrawal not found" }, { status: 404 });
        }

        const data = snap.data();
        if (data?.status !== "approved_pending_payout") {
            return NextResponse.json(
                { success: false, error: `Cannot mark completed: current status is "${data?.status}"` },
                { status: 409 }
            );
        }

        const userId = data?.userId;

        await ref.update({
            status: "completed",
            completedBy: session.user.id,
            completedAt: FieldValue.serverTimestamp(),
            ...(transactionReference ? { transactionReference } : {}),
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            try {
                const { invalidateCooperativeCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateCooperativeCache(userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Mark Withdrawal Completed Route Cache] Cache clear error:', cacheError);
            }
        }

        logger.info(`Cooperative withdrawal ${withdrawalId} marked completed by admin ${session.user.id}`);
        return NextResponse.json({ success: true, message: "Withdrawal marked as completed" });
    } catch (error: any) {
        logger.error("mark-withdrawal-completed error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
