export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Reject Cooperative Membership Application
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

        // Check if user is admin (with live Firestore roles fallback query)
        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return NextResponse.json(
                    { success: false, message: "Admin access required" },
                    { status: 403 }
                );
            }
        }

        const { memberId, reason } = await request.json();

        if (!memberId || !reason) {
            return NextResponse.json(
                { success: false, message: "Member ID and reason are required" },
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

        const memberData = memberDoc.data();
        const userId = memberData?.userId || memberId;

        await memberRef.update({
            membershipStatus: "rejected",
            rejectionReason: reason,
            rejectedBy: session.user.id,
            rejectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            try {
                const { invalidateCooperativeCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateCooperativeCache(userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Reject Member Route Cache] Cache clear error:', cacheError);
            }
        }

        // Log audit entry
        try {
            const { logAuditAction } = await import('@/app/actions/audit');
            await logAuditAction("wave_reject", memberId, "cooperative_member", {
                adminId: session.user.id,
                action: "cooperative_membership_rejected",
                reason,
            });
        } catch { /* non-blocking */ }

        // Send rejection email notification
        const memberName = `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || 'Member';
        try {
            const { sendMembershipRejectionEmail } = await import('@/lib/email-notifications');
            await sendMembershipRejectionEmail(
                memberData?.email || '',
                memberName,
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
