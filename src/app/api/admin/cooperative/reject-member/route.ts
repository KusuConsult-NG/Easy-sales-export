import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Reject Cooperative Membership Application
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

        const { memberId, reason } = await request.json();

        if (!memberId || !reason) {
            return NextResponse.json(
                { success: false, message: "Member ID and reason are required" },
                { status: 400 }
            );
        }

        // Update membership status (Admin SDK)
        const memberRef = db.collection("cooperative_members").doc(memberId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Member not found" },
                { status: 404 }
            );
        }

        await memberRef.update({
            membershipStatus: "suspended",
            rejectionReason: reason,
            rejectedBy: session.user.id,
            rejectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Send rejection email notification
        const memberData = memberDoc.data();
        try {
            const { sendMembershipRejectionEmail } = await import('@/lib/email-notifications');
            await sendMembershipRejectionEmail(
                memberData?.email || '',
                memberData?.name || 'Member',
                reason
            );
        } catch (emailError) {
            logger.error("Failed to send rejection email (non-blocking):", emailError);
        }

        return NextResponse.json({
            success: true,
            message: "Membership rejected",
        });
    } catch (error) {
        logger.error("Failed to reject member:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
