export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { sendSellerRejectionEmail } from "@/lib/email-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Reject Seller Verification (Admin Only)
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

        const { verificationId, reason } = await request.json();

        if (!verificationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Verification ID and rejection reason are required" },
                { status: 400 }
            );
        }

        // Get verification (Admin SDK)
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const verificationDoc = await verificationRef.get();

        if (!verificationDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Verification not found" },
                { status: 404 }
            );
        }

        const verificationData = verificationDoc.data()!;

        // Update verification status
        await verificationRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update marketplace_sellers record
        await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(verificationData.userId).set({
            verificationStatus: "rejected",
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Recorded, which it was not.
        //
        // "seller_rejected" is declared in the AuditAction union and had ZERO
        // emitters anywhere in the codebase — as do the other two seller
        // decisions. The vocabulary for recording who approved, rejected or
        // suspended a seller was written and never used, so the audit log holds
        // no record of any of them.
        await createAdminAuditLog({
            action: "seller_rejected",
            userId: session.user.id,
            targetType: "seller_verification",
            targetId: verificationId,
            details: `Rejected seller ${verificationData.userId}: ${reason}`,
            metadata: { sellerUserId: verificationData.userId ?? null, reason },
        }).catch((e) => logger.error("[reject-seller] audit log failed", e));

        // ✅ FIX: Sync rejection status to user doc so they can re-apply.
        // Without this, serviceRegistrations.marketplace.status stays 'pending',
        // permanently blocking re-application with "application is still being processed".
        try {
            await db.collection(COLLECTIONS.USERS).doc(verificationData.userId).update({
                sellerVerificationStatus: "rejected",
                "serviceRegistrations.marketplace.status": "rejected",
                "serviceRegistrations.marketplace.rejectionReason": reason,
                updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (userUpdateErr) {
            logger.error("Failed to sync rejection status to user doc:", userUpdateErr);
            // Non-fatal — verification and seller records are already updated
        }

        // Fetch user document to get the correct email/name and send email (non-blocking)
        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(verificationData.userId).get();
            const userData = userDoc.data();
            const email = userData?.email || verificationData.email || verificationData.userEmail;
            const name = userData?.fullName || verificationData.userName || "Seller";

            if (email) {
                await sendSellerRejectionEmail(email, name, reason);
            }
        } catch (emailError) {
            logger.error("Failed to send seller rejection email:", emailError);
        }

        // Invalidate cache
        if (verificationData.userId) {
            try {
                const { invalidateSellerCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateSellerCache(verificationData.userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Reject Seller Route Cache] Cache clear error:', cacheError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "Seller verification rejected"
        });
    } catch (error) {
        logger.error("Failed to reject seller:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
