import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

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

        // Check if user is admin
        if (!session.user.roles?.includes("admin")) {
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

        // Update membership status
        const memberRef = doc(db, "cooperative_members", memberId);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Member not found" },
                { status: 404 }
            );
        }

        await updateDoc(memberRef, {
            membershipStatus: "suspended",
            rejectionReason: reason,
            rejectedBy: session.user.id,
            rejectedAt: new Date(),
            updatedAt: new Date(),
        });

        // Send rejection email notification  
        const memberData = memberDoc.data();
        const { sendMembershipRejectionEmail } = await import('@/lib/email-notifications');
        await sendMembershipRejectionEmail(
            memberData.email || '',
            memberData.name || 'Member',
            reason
        );


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
