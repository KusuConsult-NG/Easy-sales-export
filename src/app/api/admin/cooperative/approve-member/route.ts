export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Approve Cooperative Membership Application
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
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

        const { memberId } = await request.json();

        if (!memberId) {
            return NextResponse.json(
                { success: false, message: "Member ID is required" },
                { status: 400 }
            );
        }

        // Update membership status (Admin SDK)
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Member not found" },
                { status: 404 }
            );
        }

        await memberRef.update({
            membershipStatus: "approved",
            approvedBy: session.user.id,
            approvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Log audit entry
        try {
            const { logAuditAction } = await import('@/app/actions/audit');
            await logAuditAction("wave_approve", memberId, "cooperative_member", {
                adminId: session.user.id,
                action: "cooperative_membership_approved",
            });
        } catch { /* non-blocking */ }

        // Send approval email notification
        const memberData = memberDoc.data();
        const memberName = `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || 'Member';
        try {
            const { sendMembershipApprovalEmail } = await import('@/lib/email-notifications');
            await sendMembershipApprovalEmail(
                memberData?.email || '',
                memberName
            );
        } catch (emailError) {
            logger.error("Failed to send approval email (non-blocking):", emailError);
        }

        return NextResponse.json({
            success: true,
            message: "Membership approved successfully",
        });
    } catch (error) {
        logger.error("Failed to approve member:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
