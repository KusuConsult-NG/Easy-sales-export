export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { requireAdmin } from "@/lib/require-admin";
import { recordAdminAction } from "@/lib/audit-log";
import { notifyInspectionRecorded } from "@/lib/farm-nation-notifications";

/**
 * API Route: Record what the inspector found (Admin).
 *
 *   #864 THE MISSING STEP IN THE OWNER'S FLOW.
 *
 *   "admin sends an inspector … then after inspector verifies then admin can
 *   approve." There was nothing between the dispatch and the approval. The
 *   listing recorded who was SENT — `inspectionDetails` — and nothing recorded
 *   what they came back with, so the approve button's own dialog ("Ensure the
 *   inspector report has been reviewed") was asking an admin to remember.
 *
 *   THE ADMIN FILES IT, NOT THE INSPECTOR, and that is not a shortcut. The
 *   owner confirmed inspectors hold no account on this platform: they are
 *   emailed the job and they report back to the admin. So `recordedBy` is the
 *   admin who typed it in and `inspectorName` is the person who went, kept
 *   apart so the audit trail never claims an inspector signed in.
 *
 * ── IT DOES NOT MOVE THE STATUS, DELIBERATELY ───────────────────────────────
 *
 *   The listing stays in `inspection_scheduled` — already "an inspector has
 *   been dispatched", already in AWAITING_REVIEW_STATUSES, so the queue an
 *   admin works from is unchanged. A sixteenth status would have to be taught
 *   to the fifteen readers of LandListingStatus, and every one missed is a
 *   listing that silently vanishes from a screen (#340, #717, #838).
 *
 *   A failed inspection therefore does not reject the listing either. Rejecting
 *   is a decision with a reason that goes to the seller, and reject-land is the
 *   door that does it properly; this records a finding and lets the gate refuse
 *   the approval. Doing both here would be two decisions behind one button.
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
         *   THE SAME PERMISSION THE DISPATCH DEMANDS — CHECKED LIVE.
         *
         *   Filing the report is the other half of dispatching, and it is what
         *   unlocks an approval, so it carries `farm_nation:verify_applications`
         *   like its sibling.
         *
         *   `requireAdmin` RATHER THAN `hasAdminPermission(session.user.roles)`,
         *   which is what the sibling route still does. #532's ratchet counts
         *   every door still deciding from the JWT's claims and says to fix a
         *   new one rather than raise the number — and it is right here in
         *   particular: the roles on a token are whatever they were when it was
         *   issued, so a revoked admin could file "passed" on land nobody
         *   inspected and let the approval through behind it. This asks the
         *   database.
         */
        const adminCheck = await requireAdmin("farm_nation:verify_applications");
        if ("error" in adminCheck) {
            return NextResponse.json(
                { success: false, message: adminCheck.error },
                { status: 403 }
            );
        }

        const { verificationId, outcome, findings, inspectedOn } = await request.json();

        if (!verificationId) {
            return NextResponse.json(
                { success: false, message: "Verification ID is required" },
                { status: 400 }
            );
        }

        //   Enumerated, not truthy-checked. A typo'd outcome that stored
        //   anything other than these two reads as "no report" to the gate —
        //   which fails safe, but silently, and the admin would believe they
        //   had filed one.
        if (outcome !== "passed" && outcome !== "failed") {
            return NextResponse.json(
                { success: false, message: "Outcome must be 'passed' or 'failed'" },
                { status: 400 }
            );
        }

        /*
         *   A FAILURE MUST SAY WHY.
         *
         *   The same rule #690 established for every rejection on this platform:
         *   a refusal recorded without its reason leaves the seller nothing to
         *   act on, and this one reaches her — she is told her land did not pass
         *   and what the inspector said.
         */
        if (outcome === "failed" && !String(findings ?? "").trim()) {
            return NextResponse.json(
                {
                    success: false,
                    message: "A failed inspection must record what the inspector found.",
                },
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

        const listing = listingDoc.data() ?? {};

        /*
         *   A REPORT ONLY MAKES SENSE FOR AN INSPECTION THAT WAS ORDERED.
         *
         *   Without this an admin could file "passed" on a listing nobody has
         *   ever visited and walk it straight through the approval gate — which
         *   would make the gate ceremony rather than a control. `status` is the
         *   check because the dispatch is what sets it, and a re-dispatch clears
         *   the previous report.
         */
        if (String(listing.status) !== "inspection_scheduled") {
            return NextResponse.json(
                {
                    success: false,
                    message: `This listing is '${listing.status}'. Dispatch an inspector `
                        + `before recording a report.`,
                },
                { status: 409 }
            );
        }

        const details = (listing.inspectionDetails ?? {}) as Record<string, unknown>;
        const inspectorName = String(details.inspectorName ?? "").trim() || "the inspector";

        await listingRef.update({
            inspectionReport: {
                outcome,
                //   Taken from the dispatch, not from the request: the person
                //   who went is a fact this listing already holds, and letting
                //   the caller name somebody else would make the record
                //   unfalsifiable.
                inspectorName,
                inspectedOn: String(inspectedOn ?? "").trim()
                    || String(details.scheduledDate ?? "").trim()
                    || null,
                findings: String(findings ?? "").trim() || null,
                recordedBy: session.user.id,
                recordedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", { expire: 0 });
        } catch (cacheError) {
            logger.error('[Record Inspection Route Cache] Cache clear error:', cacheError);
        }

        //   The seller is told either way. A passed inspection is the news she
        //   has been waiting for; a failed one is the only chance she has to fix
        //   whatever the inspector found. Never throws — see the notifier.
        await notifyInspectionRecorded({
            ownerId: listing.ownerId,
            ownerEmail: listing.ownerEmail,
            ownerName: listing.ownerName,
            listingId: verificationId,
            listingTitle: listing.title,
            outcome,
            findings: String(findings ?? "").trim() || null,
        });

        await recordAdminAction({
            action: 'inspection_recorded',
            userId: session.user.id,
            targetId: verificationId,
            targetType: 'land_verification',
            metadata: { outcome, inspectorName },
        });

        return NextResponse.json({
            success: true,
            message: outcome === "passed"
                ? "Inspection recorded. This listing can now be approved."
                : "Inspection recorded. This listing did not pass and cannot be approved.",
        });
    } catch (error) {
        logger.error("Failed to record inspection:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
