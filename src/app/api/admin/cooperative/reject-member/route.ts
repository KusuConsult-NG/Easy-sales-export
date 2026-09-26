export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

import { joinFullName, namePartsOf } from "@/lib/person-name";
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

        /*
         *   #955 THE DATABASE WAS READ ONLY WHEN THE TOKEN SAID NO.
         *
         *   The comment that stood here called the user-record read a "live Firestore
         *   roles fallback query", and that is exactly the inverted model: the record
         *   is the authority and the token is the cache, so the record is not a
         *   fallback for the token — the token is a guess the record settles.
         *
         *   As written, a token claiming cooperatives:approve_members was admitted and
         *   never re-checked; the record was consulted only when the token said no. A
         *   revoked admin kept approving members for the life of their claim, which
         *   #356 measured in hours. Its sibling approve-member is the same gate on the same act.
         *
         *   The caller's `roles` is gone rather than reassigned: nothing downstream
         *   read it. The `roles` written further down belongs to the MEMBER.
         */
        const gate = await requireAdmin("cooperatives:approve_members");
        if ("error" in gate) {
            return NextResponse.json(
                { success: false, message: gate.error },
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
            //   #533 The rejection half of the same defect — see the note on
            //   the approve route.
            await logAuditAction("cooperative_reject", memberId, "cooperative_member", {
                adminId: session.user.id,
                reason,
            });
        } catch { /* non-blocking */ }

        // Send rejection email notification
        const memberName = joinFullName(namePartsOf(memberData)).trim() || 'Member';
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
