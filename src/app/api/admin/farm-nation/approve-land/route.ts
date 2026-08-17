export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";

/**
 * API Route: Approve Land Listing (Admin)
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

        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId } = await request.json();

        if (!verificationId) {
            return NextResponse.json(
                { success: false, message: "Verification ID is required" },
                { status: 400 }
            );
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(verificationId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Listing not found" },
                { status: 404 }
            );
        }

        const previous = listingDoc.data() ?? {};

        /**
         * Which statuses an approval may legitimately start from.
         *
         * THE DEFECT THIS CLOSES
         * ----------------------
         * This route checked only that the listing EXISTS, then wrote
         * `status: "verified"` unconditionally.
         *
         * "verified" is in PUBLIC_LAND_STATUSES, so it puts the parcel back on
         * the public market. Farm Nation sets `pending_escrow` while a purchase
         * is in flight — verifyPropertyPaymentAction leaves it there with the
         * buyer's money held — so approving a listing that had since gone into
         * escrow made it purchasable again WHILE an escrow was held for the
         * first buyer. Two buyers, two escrows, one parcel, and the first
         * buyer's purchase silently invalidated because the listing reads as
         * available.
         *
         * `sold`, `pending_transfer` and `deleted` are excluded for the same
         * reason: none of them should be reopened by an approval.
         *
         * `rejected` IS included — reversing a rejection is a real admin
         * action, and the block below deliberately preserves the prior
         * rejection reason when it happens.
         */
        const APPROVABLE_FROM = [
            "pending",
            "pending_verification",
            "inspection_scheduled",
            "rejected",
        ];

        // Compare-and-swap, not a blind write. Two admins clicking approve on
        // the same listing cannot both proceed, and neither can an approval race
        // a purchase that has just moved the listing into escrow.
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: verificationId,
            fromAny: APPROVABLE_FROM,
            to: "verified",
            patch: {
            verificationStatus: {
                // The prior decision is carried forward rather than replaced.
                //
                // This assigned a fresh object, so approving a listing that had
                // been rejected erased the rejection reason and who gave it —
                // the record of the earlier decision disappeared at the moment
                // it was reversed, which is exactly when it matters.
                ...(previous.verificationStatus ?? {}),
                verified: true,
                rejectionReason: null,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp()
            },
                updatedAt: FieldValue.serverTimestamp(),
            },
            // So a later reversal can put the listing back where it came from
            // rather than to a hardcoded guess.
            recordPreviousAs: "statusBeforeVerification",
        });

        if (!transition.claimed) {
            // 409, not 500: the request was well-formed, the state was wrong.
            // The message names the blocking status so the admin can see WHY —
            // "pending_escrow" tells them a purchase is in flight, which is
            // exactly the case that used to be silently overwritten.
            logger.warn(
                `[approve-land] Refused: listing ${verificationId} is '${transition.status}', ` +
                `which is not an approvable state (${APPROVABLE_FROM.join(", ")}).`
            );
            return NextResponse.json(
                {
                    success: false,
                    message: transition.status === null
                        ? "Listing not found"
                        : `This listing is '${transition.status}' and cannot be approved from that state. ` +
                          `A listing with a purchase in progress must be resolved first.`,
                },
                { status: transition.status === null ? 404 : 409 }
            );
        }

        // Recorded, which it was not.
        //
        // `land_verified` exists in the AuditAction union and is emitted by
        // land-listings.ts — an action the admin screen does not call. The
        // screen posts here, so every land verification made through the UI
        // went unrecorded while the vocabulary for recording it sat unused.
        await createAdminAuditLog({
            action: "land_verified",
            userId: session.user.id,
            targetType: "land_listing",
            targetId: verificationId,
            details: `Approved land listing ${verificationId}`,
            metadata: { previousStatus: previous.status ?? null },
        }).catch((e) => logger.error("[approve-land] audit log failed", e));

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", "page");
        } catch (cacheError) {
            logger.error('[Approve Land Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: "Land listing approved successfully"
        });
    } catch (error) {
        logger.error("Failed to approve listing:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
