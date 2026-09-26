export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { FieldValue } from "@/lib/firestore-compat";
import { requireAdmin } from "@/lib/require-admin";
import { recordsAGuarantor } from "@/lib/loan-approval-policy";
import { resolveLoanApplication } from "@/lib/loan-application-location";
import { recordAdminAction } from "@/lib/audit-log";

/**
 * API Route: Verify Guarantor (Admin Only)
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

        /*
         *   #951 LIVE RE-VALIDATION, replacing a check on the JWT.
         *
         *   It verifies a guarantor, which is the step that makes a loan
         *   approvable at all — so a stale token here is the precondition for the
         *   approval approve-loan now refuses.
         *
         *   The rule is stated once in lib/stale-authorisation:
         *   `cooperatives:approve_loans` is IRREVERSIBLE, because a loan creates a
         *   debt and raises loanBalance, and revoking the admin afterwards does
         *   not unmake it. #356 measured the window a stale claim buys — hours.
         */
        const gate = await requireAdmin("cooperatives:approve_loans");
        if ("error" in gate) {
            return NextResponse.json(
                { success: false, message: gate.error },
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

        // Resolved rather than assumed — an application filed through the member
        // loan page lives in cooperative_loans, and this route answered 404 for
        // it while the queue that offered the button listed it. Same gap as the
        // reject route beside it. See lib/loan-application-location.ts.
        const resolved = await resolveLoanApplication(applicationId);

        if (!resolved) {
            return NextResponse.json(
                { success: false, message: "Application not found" },
                { status: 404 }
            );
        }

        const applicationRef = resolved.ref;
        const appData = resolved.snap.data()!;

        if (appData.status !== "pending") {
            return NextResponse.json(
                { success: false, message: "Application is not pending" },
                { status: 400 }
            );
        }

        // There has to BE a guarantor to verify.
        //
        // The member loan page collects none, so those applications carry no
        // guarantor fields at all. Writing guarantorVerified: true onto one
        // records a verification that never happened and cannot have — an
        // admin attesting to details the application does not contain.
        if (!recordsAGuarantor(appData)) {
            return NextResponse.json(
                {
                    success: false,
                    message: "This application did not record a guarantor, so there is nothing to verify.",
                },
                { status: 400 }
            );
        }

        await applicationRef.update({
            guarantorVerified: true,
            guarantorVerifiedAt: FieldValue.serverTimestamp(),
            guarantorVerifiedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await recordAdminAction({
            action: 'guarantor_verified',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'loan_application',
        });
        return NextResponse.json({
            success: true,
            message: "Guarantor verified successfully"
        });
    } catch (error: any) {
        logger.error("Failed to verify guarantor:", error);

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
