export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";

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

        if (!hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
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
        const userId = data?.userId;

        // Read the status, compare it, then write — with no lock and no
        // wrapper, which is why the runTransaction sweep never saw this one.
        // Two admins marking the same payout completed both passed the check
        // and both wrote, so the audit trail records two different admins as
        // the one who completed it and the second overwrites the first's
        // transactionReference — the reference for a real bank transfer.
        const nowIso = new Date().toISOString();
        // A COOPERATIVE WITHDRAWAL COULD NEVER REACH "completed".
        //
        // Two admin screens approve one cooperative withdrawal, and they leave
        // it in different states:
        //
        //   admin/_withdrawals.ts processWithdrawalAction  pending →
        //       payout_initiated → "completed" or "approved_pending_payout",
        //       depending on whether the Paystack transfer succeeded
        //
        //   cooperative/_coop_admin_money.ts approveWithdrawalAction
        //       pending → "approved", with the payout made by hand
        //
        // This route accepted only the first path's failed-transfer state. So a
        // withdrawal approved on the COOPERATIVE screen — the screen built for
        // cooperative withdrawals — sat at "approved" for ever with no
        // transition out, and the member's own withdrawal history, which sums
        // `status === "completed"`, reported ₦0 withdrawn no matter how much had
        // been paid to them.
        //
        // The platform already answers this: the WAVE equivalent claims
        // `fromAny: ["approved_pending_payout", "approved"]`. The cooperative
        // one was the hold-out.
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.COOPERATIVE_WITHDRAWALS,
            id: withdrawalId,
            fromAny: ["approved_pending_payout", "approved"],
            to: "completed",
            patch: {
                completedBy: session.user.id,
                completedAt: nowIso,
                ...(transactionReference ? { transactionReference } : {}),
                updatedAt: nowIso,
            },
        });

        if (!claim.claimed) {
            return NextResponse.json(
                {
                    success: false,
                    error: claim.status === null
                        ? "Withdrawal not found"
                        : `Cannot mark completed: current status is "${claim.status}"`,
                },
                { status: 409 }
            );
        }

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
