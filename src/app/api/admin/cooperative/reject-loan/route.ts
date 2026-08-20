export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { LOAN_REJECTABLE_STATUSES } from "@/lib/loan-approval-policy";
import { resolveLoanApplication } from "@/lib/loan-application-location";

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
        if (!hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
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

        // AN ADMIN COULD SEE THESE APPLICATIONS AND COULD NOT REJECT ANY OF THEM
        // ----------------------------------------------------------------------
        // This is the route the Reject button on /admin/cooperatives/loans calls,
        // and it opened LOAN_APPLICATIONS directly. The queue above it merges
        // cooperative_loans — the collection the member loan page is the only
        // path into — so every application a member actually filed through the UI
        // appeared in the list and answered 404 "Application not found" when an
        // admin clicked Reject on it.
        //
        // The approve route was taught to resolve the application when the queue
        // was fixed. This one and verify-guarantor were left behind, so the pair
        // of buttons on one row disagreed about whether the row existed.
        //
        // See lib/loan-application-location.ts.
        const resolved = await resolveLoanApplication(applicationId);

        if (!resolved) {
            return NextResponse.json(
                { success: false, message: "Application not found" },
                { status: 404 }
            );
        }

        const appData = resolved.snap.data();
        const userId = appData?.userId ?? appData?.memberId;

        // Rejection was a blind write.
        //
        // Read nothing, compare nothing, write "rejected" — while approval and
        // disbursement on either side of it both claim the transition. So a
        // disbursed loan could be marked rejected after the money had left, and a
        // rejected one could be rejected again, the second reason and timestamp
        // overwriting any record of the first.
        //
        // Which statuses may be rejected from — and why "approved" is not one of
        // them — is in lib/loan-approval-policy.ts.
        const rejectClaim = await claimStatusTransitionFromAny({
            collection: resolved.collection,
            id: applicationId,
            fromAny: [...LOAN_REJECTABLE_STATUSES],
            to: "rejected",
            patch: {
                rejectionReason: reason,
                rejectedAt: new Date().toISOString(),
                rejectedBy: session.user.id,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!rejectClaim.claimed) {
            return NextResponse.json(
                {
                    success: false,
                    message: rejectClaim.status === null
                        ? "Application not found"
                        : `This application is already ${rejectClaim.status} and can no longer be rejected.`,
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
                logger.error('[Reject Loan Route Cache] Cache clear error:', cacheError);
            }
        }

        await recordAdminAction({
            action: "loan_rejected",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: { borrowerId: userId ?? null, reason },
        });

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
