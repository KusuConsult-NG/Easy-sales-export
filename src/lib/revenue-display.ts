/**
 * How a revenue figure should be presented, given what is known about it.
 *
 *   #665 THREE SCREENS SHOW THIS NUMBER AND EACH DECIDED FOR ITSELF.
 *
 *   /admin, /admin/finance and /admin/analytics all render the platform's total
 *   revenue. The service returns two facts about it — `revenueAvailable`, false
 *   when neither Paystack nor the database could answer, and `revenueIsPartial`,
 *   true when the Paystack sweep stopped at its ceiling and the figure is a
 *   FLOOR — and the three screens between them consulted the first once and the
 *   second never.
 *
 *   Written as a function for the reason middleware.ts already records about
 *   `adminSiloRedirect`: "middleware cannot be exercised in a test and a
 *   function can. The version that lived inline was asserted by matching
 *   strings in this file, and mutation testing showed what that was worth."
 *
 *   That is exactly what happened here. The first fix wrote the branch into all
 *   three screens and asserted it by looking for the identifier; FIVE mutants
 *   survived, because each screen mentions the flag twice and removing one
 *   mention left the other for the assertion to find. A check on the presence
 *   of a name is not a check on what the name does.
 *
 * ── WHY THREE STATES AND NOT TWO ────────────────────────────────────────────
 *
 *   "Unavailable" and "a floor" are different claims and an admin acts on them
 *   differently:
 *
 *     exact        the number is the number.
 *     partial      the number is REAL and too low. Still worth reading, still
 *                  worth acting on — so it is shown, marked "at least".
 *                  Replacing it with "Unavailable" would throw away a usable
 *                  figure and overstate the problem.
 *     unavailable  nothing could be read. Rendering ₦0 here is the defect
 *                  #620 and #621 are filed under: an outage drawn as a day
 *                  with no sales.
 *
 *   `unavailable` wins over `partial`, because a figure nobody could read is
 *   not a floor — it is nothing.
 */

export type RevenueDisplay = "exact" | "partial" | "unavailable";

/**
 * Which of the three states this figure is in.
 *
 * Both inputs are optional because the contract declares them that way: older
 * callers and cached payloads may carry neither, and "not stated" has to mean
 * "no reason to doubt it" rather than throwing or defaulting to a warning on
 * every screen.
 */
export function revenueDisplay(
    revenueAvailable?: boolean,
    revenueIsPartial?: boolean,
): RevenueDisplay {
    //   `=== false`, not falsy: an absent flag is not a claim that the figure
    //   could not be read.
    if (revenueAvailable === false) return "unavailable";
    if (revenueIsPartial === true) return "partial";
    return "exact";
}

/** What goes in front of the amount. Empty unless the figure is a floor. */
export function revenuePrefix(display: RevenueDisplay): string {
    return display === "partial" ? "at least " : "";
}

/**
 * The line under the figure, when the figure is not exact.
 *
 * Null for "exact", so each screen keeps its own ordinary subtitle — one says
 * "Based on transaction volume", another counts successful payments, and
 * neither is this module's business.
 */
export function revenueNote(display: RevenueDisplay): string | null {
    switch (display) {
        case "unavailable":
            return "Could not reach Paystack or the database — retry shortly";
        case "partial":
            return "Paystack paging limit reached — this is a floor, not a total";
        default:
            return null;
    }
}
