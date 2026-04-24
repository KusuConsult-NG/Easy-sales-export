export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

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

        // Check if user is admin or super_admin
        const roles = session.user.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
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

        // Update application status
        await applicationRef.update({
            status: "rejected",
            rejectionReason: reason,
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
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
