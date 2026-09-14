"use client";

/**
 * "This list could not be read" — the admin half of #545's rule.
 *
 *   #742 TWENTY OF TWENTY-NINE ADMIN LISTS RENDERED "NOTHING HERE" WHEN THE
 *        READ HAD FAILED, AND THE HOOK KNEW.
 *
 *   `useAdminData` is the one loader every admin list goes through. On a failed
 *   read it sets `error` and LEAVES `data` alone — which is `[]` on a first
 *   load. So a screen written as
 *
 *       {items.length === 0 ? <Nothing here /> : items.map(…)}
 *
 *   tells an administrator there is nothing to do, in a queue it could not
 *   open. Nine screens already consult the error; twenty did not, and eight of
 *   those twenty destructured it as `fetchError` and never mentioned it again —
 *   bound and dropped, one occurrence in the file.
 *
 *   #545 established the rule for member-facing screens and its sweep excluded
 *   admin deliberately: "a handful of staff, not every member". #600 reversed
 *   exactly that reasoning for three other ratchets, and its words fit here
 *   better than they fit there:
 *
 *       "these are the screens where a withdrawal is approved and an escrow
 *        released: a blank admin page is a seller who does not get paid."
 *
 *   marketplace/escrow, marketplace/withdrawals and disputes are three of the
 *   twenty.
 *
 * ── WHY A COMPONENT RATHER THAN A LINE IN EACH SCREEN ───────────────────────
 *
 *   Because a line in each screen is what the nine have, and twenty of
 *   twenty-nine is what that produced. The banner is one import and one tag,
 *   and the empty state beside it gains `&& !error` — small enough that the
 *   next admin list can copy a neighbour and still be right.
 */

import { AlertCircle } from "lucide-react";

interface AdminReadFailedProps {
    /** The `error` from useAdminData. Null or empty renders nothing. */
    error: string | null | undefined;
    /** What could not be read, for the sentence: "disputes", "escrow records". */
    subject?: string;
    /** Re-run the fetch. Omitted when the screen has no refresh to offer. */
    onRetry?: () => void;
}

export default function AdminReadFailed({ error, subject = "this list", onRetry }: AdminReadFailedProps) {
    if (!error) return null;

    return (
        <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mb-6"
        >
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="font-semibold text-red-800">
                    {subject.charAt(0).toUpperCase() + subject.slice(1)} could not be loaded
                </p>
                {/*
                 *   The reason is shown. An administrator is the person who can
                 *   act on "permission denied" versus "the database is down",
                 *   and #492's finding was that a screen which hides the reason
                 *   turns an outage into a quiet day.
                 */}
                <p className="text-sm text-red-700 mt-0.5">{error}</p>
                <p className="text-sm text-red-700 mt-1">
                    This is not an empty list — nothing below reflects what is actually stored.
                </p>
            </div>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
                >
                    Try again
                </button>
            )}
        </div>
    );
}
