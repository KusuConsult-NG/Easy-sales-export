export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { recordAdminAction } from "@/lib/audit-log";

/**
 * API Route: Dispatch Inspector for Land Verification (Admin)
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

        if (!hasAdminPermission(session.user.roles, "farm_nation:verify_applications")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId, inspectorName, scheduledDate, notes } = await request.json();

        if (!verificationId || !inspectorName || !scheduledDate) {
            return NextResponse.json(
                { success: false, message: "Verification ID, inspector name, and scheduled date are required" },
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

        /**
         * Which statuses an inspector dispatch may start from.
         *
         * Third instance of the same defect in this module: like approve-land and
         * reject-land, this checked only that the listing existed and then wrote
         * a new status over whatever was there.
         *
         * `inspection_scheduled` is NOT in PUBLIC_LAND_STATUSES, so this write
         * DELISTS a parcel. Applied to a listing in `pending_escrow` it took land
         * off the market while a buyer's money sat in escrow, and destroyed the
         * escrow's own state in the process — the purchase flow reads `status`
         * to decide what to do next.
         *
         * The admin queue (land-verifications) returns every listing unfiltered,
         * including escrowed and sold ones, so this was reachable by clicking the
         * wrong row.
         *
         * `verified` is allowed: re-inspecting land that is already listed is a
         * plausible admin action, and the cost is only that it leaves the public
         * list until the inspection completes. The money states —
         * pending_escrow, pending_payment, payment_confirmed, pending_transfer —
         * plus sold, completed and deleted are not: a listing with money against
         * it has to be resolved through the escrow flow first.
         *
         * Dispatching from `inspection_scheduled` is allowed so an inspection can
         * be rescheduled.
         */
        const DISPATCHABLE_FROM = [
            "pending",
            "pending_verification",
            "inspection_scheduled",
            "rejected",
            "verified",
        ];

        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: verificationId,
            fromAny: DISPATCHABLE_FROM,
            to: "inspection_scheduled",
            // Rescheduling is dispatching from `inspection_scheduled` to itself,
            // which is not a transition — so the helper filters the target out of
            // the starting set unless a caller asks for it. This is the only
            // caller that does, and the only one where it is right: dispatching
            // twice sends another inspector and moves no money. See
            // claimStatusTransitionFromAny's allowSameStatus for what it gives up.
            allowSameStatus: true,
            patch: {
                inspectionDetails: {
                    inspectorName,
                    scheduledDate,
                    notes: notes || "",
                    dispatchedBy: session.user.id,
                    dispatchedAt: FieldValue.serverTimestamp()
                },
                verificationNotes: `Inspector: ${inspectorName}\nScheduled Date: ${scheduledDate}\nNotes: ${notes || "None"}`,
                updatedAt: FieldValue.serverTimestamp(),
            },
            // A listing dispatched from `verified` must go back to `verified`, not
            // to whichever value a later reversal happens to hardcode.
            recordPreviousAs: "statusBeforeInspection",
        });

        if (!transition.claimed) {
            logger.warn(
                `[dispatch-inspector] Refused: listing ${verificationId} is '${transition.status}', ` +
                `which is not a dispatchable state (${DISPATCHABLE_FROM.join(", ")}).`
            );
            return NextResponse.json(
                {
                    success: false,
                    message: transition.status === null
                        ? "Listing not found"
                        : `This listing is '${transition.status}' and an inspector cannot be dispatched ` +
                          `from that state. A listing with a purchase in progress must be resolved first.`,
                },
                { status: transition.status === null ? 404 : 409 }
            );
        }

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", { expire: 0 });
        } catch (cacheError) {
            logger.error('[Dispatch Inspector Route Cache] Cache clear error:', cacheError);
        }

        await recordAdminAction({
            action: 'inspector_dispatched',
            userId: session.user.id,
            targetId: verificationId,
            targetType: 'land_verification',
            metadata: { inspectorName, scheduledDate },
        });
        return NextResponse.json({
            success: true,
            message: "Inspector dispatched successfully"
        });
    } catch (error) {
        logger.error("Failed to dispatch inspector:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
