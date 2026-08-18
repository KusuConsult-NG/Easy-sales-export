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
import { APPROVABLE_FROM_STATUSES } from "@/lib/land-listing-status";

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

        if (!hasAdminPermission(session.user.roles, "land:verify_listings")) {
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
         * The set is shared with the other four admin decision paths.
         * This route's own copy omitted `available` — the status farm-nation's
         * creation path writes — so a farm-nation listing could not be approved
         * from the admin land queue at all, while _fn_admin.verifyPropertyAction
         * approved it happily. See APPROVABLE_FROM_STATUSES for the five copies
         * and where each of them differed.
         */

        // Compare-and-swap, not a blind write. Two admins clicking approve on
        // the same listing cannot both proceed, and neither can an approval race
        // a purchase that has just moved the listing into escrow.
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: verificationId,
            fromAny: [...APPROVABLE_FROM_STATUSES],
            to: "verified",
            patch: {
                // A STRING, and this is the fix to a defect the previous version
                // of this block introduced.
                //
                // It spread the prior value forward — `...(previous
                // .verificationStatus ?? {})` — to keep a rejection reason from
                // being erased when a rejection was reversed. But four other
                // writers put a STRING on this field, including create-listing,
                // which sets "pending" on every listing made through the API.
                // Spreading a string into an object literal yields its indexed
                // characters, so approving a newly created listing wrote
                // `{0:"p", 1:"e", 2:"n", ..., verified:true}`.
                //
                // The string is the canonical shape: it is what admin/_land.ts
                // QUERIES the database for and what the shared type declares.
                // The decision detail goes to the top-level fields, and the prior
                // reason is preserved where a reversed decision belongs — the
                // audit log written below, which records previousStatus too.
                verificationStatus: "approved",
                verified: true,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: null,
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
                `which is not an approvable state (${APPROVABLE_FROM_STATUSES.join(", ")}).`
            );
            return NextResponse.json(
                {
                    success: false,
                    message: transition.status === null
                        ? (transition.exists
                            ? "This listing has no status recorded, so it cannot be approved. " +
                              "Its status has to be set before a decision can be made on it."
                            : "Listing not found")
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
            metadata: {
                previousStatus: previous.status ?? null,
                // The reason this approval reverses, if it reverses one. The
                // record itself no longer carries it forward — an approved
                // listing showing a rejection reason is what the object shape
                // produced — so the audit entry is where a reversed decision is
                // kept, and the claim in the patch above depends on this line.
                reversedRejectionReason:
                    previous.rejectionReason
                    ?? (previous.verificationStatus as any)?.rejectionReason
                    ?? null,
            },
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
