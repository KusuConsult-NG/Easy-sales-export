/**
 * The inspection, and the one rule that says an approval may proceed.
 *
 *   #864 THE SCREEN PROMISED AN INSPECTION AND NOTHING REQUIRED ONE.
 *
 *   THE OWNER: "The flow is when an admin approves a listing on Farm Nation,
 *   admin sends an inspector — the new flow should be that admin sends an
 *   inspector with all the details submitted from the listing and all the
 *   documents, then after inspector verifies then admin can approve."
 *
 *   MEASURED, and the platform was already CLAIMING this flow in two places
 *   while enforcing it in none:
 *
 *     the dispatch tab   "An email notification will be sent to the inspector
 *                        with the property location and document links."
 *                        The route sent the inspector nothing. There was no
 *                        field for their address anywhere in the form.
 *
 *     the approve button window.confirm("Approve this land listing? Ensure the
 *                        inspector report has been reviewed.")
 *                        There was no inspector report. `inspectionDetails`
 *                        holds who was SENT and when — a dispatch, not a
 *                        finding — and nothing recorded what they came back
 *                        with. The dialog asked an admin to remember.
 *
 *   A rule stated in prose and enforced by nothing is the defect this audit
 *   keeps finding, and here it was stated twice.
 *
 * ── THE INSPECTOR HAS NO ACCOUNT, AND THAT SHAPES ALL OF THIS ───────────────
 *
 *   Confirmed by the owner: inspectors are not users of this platform. They are
 *   sent the listing by email and they report back to the admin, who files what
 *   they found. So the report is written BY AN ADMIN ON THE INSPECTOR'S BEHALF,
 *   and `recordedBy` is the admin while `inspectorName` is the person who went.
 *   Conflating those two would make the audit trail claim an inspector logged
 *   in, which no inspector can do.
 *
 * ── WHY A RECORD AND NOT A STATUS ───────────────────────────────────────────
 *
 *   `inspection_passed` as a sixteenth status would have to be taught to the
 *   fifteen readers of LandListingStatus — the visibility sets, the purchase
 *   guard, the admin queues, the dashboards — and every one of them that was
 *   missed becomes a listing that silently vanishes from a screen. #340, #717
 *   and #838 are all that fault.
 *
 *   The listing stays in `inspection_scheduled`, which already means "an
 *   inspector has been dispatched" and is already in AWAITING_REVIEW_STATUSES,
 *   and the FINDING lands beside it. Nothing that reads status changes.
 *
 * ── THE GATE APPLIES TO A REVIEW, NOT TO A RE-APPROVAL ──────────────────────
 *
 *   APPROVABLE_FROM_STATUSES deliberately includes the three purchasable
 *   spellings, because that is how `available` and `approved` converge on the
 *   canonical `verified`. A listing already on sale HAS been approved; refusing
 *   to re-approve it would break that convergence and stall listings that never
 *   needed a new inspection. So the gate asks for a passed inspection only when
 *   the listing is in a REVIEW state — which is exactly the moment the owner's
 *   flow is about.
 */

import type { LandListingStatus } from "@/lib/land-listing-status";

/** What an inspector found, as filed by the admin who received their report. */
export interface InspectionReport {
    outcome: "passed" | "failed";
    /** The person who went to the land. Not a user of this platform. */
    inspectorName?: string;
    /** The date they actually visited, which need not be the date they were sent. */
    inspectedOn?: string;
    /** What they reported. The whole reason a failed inspection is useful. */
    findings?: string;
    /** The ADMIN who filed it. An inspector cannot sign in, so this is never them. */
    recordedBy?: string;
    recordedAt?: unknown;
}

/**
 * Statuses at which a listing is under review, and so needs an inspection
 * before it may be approved.
 *
 * `rejected` is here because reversing a rejection puts land on the market, and
 * that is a decision an inspection exists to support. `draft` is here for
 * completeness; nothing approves a draft today.
 */
const UNDER_REVIEW: readonly string[] = [
    "draft",
    "pending_verification",
    "inspection_scheduled",
    "rejected",
];

/** Read the report off a listing record, whatever shape the row is in. */
export function inspectionReportOf(listing: unknown): InspectionReport | null {
    const report = (listing as { inspectionReport?: unknown } | null)?.inspectionReport;
    if (!report || typeof report !== "object") return null;

    const outcome = (report as { outcome?: unknown }).outcome;
    if (outcome !== "passed" && outcome !== "failed") return null;

    return report as InspectionReport;
}

/** Has an inspector been to this land and passed it? */
export function hasPassedInspection(listing: unknown): boolean {
    return inspectionReportOf(listing)?.outcome === "passed";
}

/**
 * May this listing be approved, as far as the inspection is concerned?
 *
 * Returns the reason to refuse, or `null` to proceed. A message rather than a
 * boolean because an admin who presses Approve and is refused needs to be told
 * WHICH step is missing — dispatch an inspector, or file the report of one who
 * has already been.
 *
 * SIX DOORS CALL THIS. approve-land, admin/_land, _fn_admin.verifyProperty,
 * admin-content, land-actions and land-listings.verify all write an approval,
 * and a rule enforced at one of six is the shape that produced #340, #717 and
 * #838. There is a test that enumerates them from disk.
 */
export function inspectionRefusal(listing: unknown): string | null {
    const status = String(
        (listing as { status?: unknown } | null)?.status ?? "",
    ) as LandListingStatus;

    //   Already on sale: this is a re-approval converging the spellings, not a
    //   review. See the header.
    if (!UNDER_REVIEW.includes(status)) return null;

    const report = inspectionReportOf(listing);

    if (!report) {
        return "This listing has not been inspected. Dispatch an inspector and record "
            + "their report before approving it.";
    }

    if (report.outcome === "failed") {
        return "The inspector did not pass this listing"
            + (report.findings?.trim() ? `: ${report.findings.trim()}` : ".")
            + " Reject it, or dispatch another inspector and record a new report.";
    }

    return null;
}
