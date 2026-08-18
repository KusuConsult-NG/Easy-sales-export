export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import {
    needsDualControl,
    guarantorBlocksApproval,
    GUARANTOR_UNVERIFIED_MESSAGE,
} from "@/lib/loan-approval-policy";
import { resolveLoanApplication } from "@/lib/loan-application-location";

/**
 * API Route: Approve Loan Application (Admin Only)
 * Uses a Firestore transaction for atomic status + balance update
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

        const { applicationId } = await request.json();

        if (!applicationId) {
            return NextResponse.json(
                { success: false, message: "Application ID is required" },
                { status: 400 }
            );
        }

        let userId: string | null = null;

        // WHAT WAS WRONG HERE
        // -------------------
        // This is a FOURTH door onto `status: "approved"` in LOAN_APPLICATIONS,
        // and the only guard on it was isAdmin(). The other three —
        // admin.ts, cooperative/_loans.ts and loan-actions.ts — require two
        // different admins above MAKER_CHECKER_THRESHOLD. Any admin could POST
        // here and approve a loan of any size alone, which is the same bypass
        // that was fixed on the other three, still open on this one.
        //
        // It also incremented the member's loanBalance off a check-then-write
        // that took no lock, so two approvals arriving together both read
        // "pending" and both incremented: the member was recorded as owing
        // TWICE the amount they had borrowed.
        //
        // Both are closed the same way as the others: the threshold comes from
        // the shared policy module, and the transition is claimed.
        // Resolved rather than assumed: an application filed through the member
        // loan page lives in cooperative_loans, and this route answered 404 for
        // it. See lib/loan-application-location.ts.
        const resolvedApp = await resolveLoanApplication(applicationId);

        if (!resolvedApp) {
            return NextResponse.json({ success: false, message: "Application not found" }, { status: 404 });
        }

        const applicationCollection = resolvedApp.collection;
        const appData = resolvedApp.snap.data()!;
        userId = appData.userId;

        // The guarantor gate keyed on `tier`, which only the wizard writes.
        //
        // Every application filed through /api/cooperative/apply-loan records a
        // guarantor and `guarantorVerified: false` and NO tier, so this check
        // was skipped for exactly the applications that had an unverified
        // guarantor on file. The rule is about the guarantor, not about a tier —
        // see lib/loan-approval-policy.ts, which also explains why the sibling
        // action's unconditional demand was wrong in the other direction.
        if (guarantorBlocksApproval(appData)) {
            return NextResponse.json(
                { success: false, message: GUARANTOR_UNVERIFIED_MESSAGE },
                { status: 400 }
            );
        }

        const approvalChain = appData.approvalChain || {};
        const adminId = session.user.id;
        const adminName = session.user.name || session.user.email;
        const nowIso = new Date().toISOString();
        const requiresDualControl = needsDualControl(appData.amount);

        if (requiresDualControl && !approvalChain.firstApprover) {
            const makerClaim = await claimStatusTransitionFromAny({
                collection: applicationCollection,
                id: applicationId,
                fromAny: ["pending", "reviewing"],
                to: "partially_approved",
                patch: {
                    // Written whole because the CAS patch shallow-merges.
                    approvalChain: {
                        firstApprover: adminId,
                        firstApprovalAt: nowIso,
                        firstApproverName: adminName,
                    },
                    updatedAt: nowIso,
                },
            });

            if (!makerClaim.claimed) {
                return NextResponse.json(
                    {
                        success: false,
                        message: makerClaim.status === null
                            ? "Application not found"
                            : `Application is already ${makerClaim.status}`,
                    },
                    { status: 409 }
                );
            }

            // No balance moves on a first approval.
            return NextResponse.json({
                success: true,
                message: "First approval recorded. A second admin must approve before this loan is disbursed.",
            });
        }

        if (requiresDualControl && approvalChain.firstApprover === adminId) {
            return NextResponse.json(
                { success: false, message: "You cannot verify your own approval. Another admin is required." },
                { status: 403 }
            );
        }

        const finalClaim = await claimStatusTransitionFromAny({
            collection: applicationCollection,
            id: applicationId,
            fromAny: requiresDualControl ? ["partially_approved"] : ["pending", "reviewing"],
            to: "approved",
            patch: {
                approvedAt: nowIso,
                approvedBy: adminId,
                updatedAt: nowIso,
                ...(requiresDualControl
                    ? {
                        approvalChain: {
                            ...approvalChain,
                            secondApprover: adminId,
                            secondApprovalAt: nowIso,
                            secondApproverName: adminName,
                        },
                    }
                    : {}),
            },
        });

        if (!finalClaim.claimed) {
            return NextResponse.json(
                {
                    success: false,
                    message: finalClaim.status === null
                        ? "Application not found"
                        : `Application is already ${finalClaim.status}`,
                },
                { status: 409 }
            );
        }

        // Update member's loan balance — only the caller that won the claim
        // reaches this, so it can run exactly once per approval.
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(appData.userId);
        await memberRef.update({
            loanBalance: FieldValue.increment(appData.amount),
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            try {
                const { invalidateCooperativeCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateCooperativeCache(userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Approve Loan Route Cache] Cache clear error:', cacheError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "Loan application approved successfully"
        });
    } catch (error: any) {
        logger.error("Failed to approve loan:", error);

        if (error instanceof Error) {
            return NextResponse.json(
                { success: false, message: error.message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
