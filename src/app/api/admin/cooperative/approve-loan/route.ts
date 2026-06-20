export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "@/lib/admin-permissions";

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

        // 🔒 Use a transaction for atomic loan approval + balance update
        await db.runTransaction(async (transaction) => {
            const applicationRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
            const applicationDoc = await transaction.get(applicationRef);

            if (!applicationDoc.exists) {
                throw new Error("Application not found");
            }

            const appData = applicationDoc.data()!;
            userId = appData.userId;

            if (appData.status !== "pending") {
                throw new Error(`Application is already ${appData.status}`);
            }

            if (appData.tier && !appData.guarantorVerified) {
                throw new Error("Guarantor verification required before loan approval.");
            }

            // Update application status
            transaction.update(applicationRef, {
                status: "approved",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Update member's loan balance
            const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(appData.userId);
            transaction.update(memberRef, {
                loanBalance: FieldValue.increment(appData.amount),
                updatedAt: FieldValue.serverTimestamp(),
            });
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
