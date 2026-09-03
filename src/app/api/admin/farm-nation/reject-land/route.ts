export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { REJECTABLE_FROM_STATUSES } from "@/lib/land-listing-status";

/**
 * API Route: Reject Land Listing (Admin)
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

        if (!hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId, reason } = await request.json();

        if (!verificationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Verification ID and reason are required" },
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
         * Which statuses a rejection may legitimately start from.
         *
         * Same defect as approve-land, same shape: this checked only that the
         * listing exists, then wrote `status: "rejected"` unconditionally.
         *
         * The damaging case here is the mirror of approval's. Rejecting a listing
         * that is `pending_escrow` — a purchase in flight, the buyer's money held
         * — took the parcel off the market while the escrow stayed open, leaving
         * a buyer who has paid for land that is now marked rejected, with nothing
         * in the flow to release or refund them.
         *
         * `verified` is included on purpose: revoking a verification is a real
         * admin action. `pending_escrow`, `pending_transfer`, `sold` and
         * `deleted` are not — a listing with money against it has to be resolved
         * through the escrow flow first.
         *
         * The set is shared with the other four admin decision paths rather than
         * written out here; this copy was one of five that disagreed. See
         * REJECTABLE_FROM_STATUSES.
         */
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: verificationId,
            fromAny: [...REJECTABLE_FROM_STATUSES],
            to: "rejected",
            patch: {
                // A string, and the decision detail at the top level. See
                // approve-land for why: the object shape this replaced was
                // unqueryable, and spreading the previous value forward broke on
                // the string create-listing writes.
                verificationStatus: "rejected",
                verified: false,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: reason,
                updatedAt: FieldValue.serverTimestamp(),
            },
            recordPreviousAs: "statusBeforeRejection",
        });

        if (!transition.claimed) {
            logger.warn(
                `[reject-land] Refused: listing ${verificationId} is '${transition.status}', ` +
                `which is not a rejectable state (${REJECTABLE_FROM_STATUSES.join(", ")}).`
            );
            return NextResponse.json(
                {
                    success: false,
                    message: transition.status === null
                        ? (transition.exists
                            ? "This listing has no status recorded, so it cannot be rejected. " +
                              "Its status has to be set before a decision can be made on it."
                            : "Listing not found")
                        : `This listing is '${transition.status}' and cannot be rejected from that state. ` +
                          `A listing with a purchase in progress must be resolved first.`,
                },
                { status: transition.status === null ? 404 : 409 }
            );
        }

        await createAdminAuditLog({
            action: "land_rejected",
            userId: session.user.id,
            targetType: "land_listing",
            targetId: verificationId,
            details: `Rejected land listing ${verificationId}: ${reason}`,
            metadata: { previousStatus: previous.status ?? null, reason },
        }).catch((e) => logger.error("[reject-land] audit log failed", e));

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", { expire: 0 });
        } catch (cacheError) {
            logger.error('[Reject Land Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: "Land listing rejected"
        });
    } catch (error) {
        logger.error("Failed to reject listing:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
