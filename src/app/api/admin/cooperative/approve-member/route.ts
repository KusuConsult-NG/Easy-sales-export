export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";

/**
 * API Route: Approve Cooperative Membership Application
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

        const { memberId } = await request.json();

        if (!memberId) {
            return NextResponse.json(
                { success: false, message: "Member ID is required" },
                { status: 400 }
            );
        }

        // Update membership status (Admin SDK) — use "active" as the canonical
        // approved state, consistent with updateMemberStatusAction and all filters.
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

        // Atomic update: member doc + user doc in a single transaction
        await db.runTransaction(async (txn) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userSnap = await txn.get(userRef);

            txn.update(memberRef, {
                membershipStatus: "active",   // canonical approved state
                approvedBy: session.user.id,
                approvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (!userSnap.exists) {
                txn.set(userRef, {
                    uid: userId,
                    email: memberData?.email || "",
                    fullName: `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || "Cooperative Member",
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["cooperative_member"],
                    isVerified: true,
                });
            }
            txn.update(userRef, normalizeUserUpdate({
                isVerified: true,
                roles: FieldValue.arrayUnion("cooperative_member"),
                "serviceRegistrations.cooperatives.status": "active",
                "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            }));
        });

        // Bust Redis caches so the admin dashboard refreshes immediately
        try {
            const cooperativeId = memberData?.cooperativeId;
            await Promise.allSettled([
                invalidateCooperativeCache(userId, cooperativeId),
                invalidateAdminGlobalStats(),
            ]);
        } catch (cacheErr) {
            logger.error("[approve-member] Cache bust failed (non-blocking):", cacheErr);
        }

        // Log audit entry
        try {
            const { logAuditAction } = await import('@/app/actions/audit');
            await logAuditAction("wave_approve", memberId, "cooperative_member", {
                adminId: session.user.id,
                action: "cooperative_membership_approved",
            });
        } catch { /* non-blocking */ }

        // Send approval email notification
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
