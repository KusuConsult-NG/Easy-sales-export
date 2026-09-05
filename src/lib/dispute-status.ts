/**
 * Dispute status — the vocabulary, and which of it is reachable.
 *
 *   #420 THREE SCREENS OFFERED A FILTER THAT COULD NEVER MATCH A ROW.
 *
 *   Four type unions declare `"closed"` as a dispute status. NOTHING IN THIS
 *   CODEBASE WRITES IT — resolution writes `"resolved"`, in both resolvers
 *   (actions/disputes.ts and marketplace/_escrow_disputes.ts), and there is no
 *   other transition. Checked for every write shape: `status:`, a dot-notation
 *   patch, and `to:` on a claimStatusTransition.
 *
 *   AND THREE SCREENS OFFERED IT AS A CHOICE:
 *
 *     admin/disputes                    <option value="closed">Closed</option>
 *     admin/marketplace/disputes        <option value="closed">Closed</option>
 *     dashboard/disputes                a member-facing "Closed" TAB
 *
 *   The member-facing one is the one that matters. A buyer or seller with a
 *   settled dispute clicks "Closed", sees nothing, and reads it as "I have no
 *   closed disputes" — when the truth is that the tab can never show anything
 *   and their settled dispute is under "Resolved". An empty list that means
 *   something other than empty: #307's and #408's family, arrived at from the
 *   other end — here the FILTER is impossible rather than the read failing.
 *
 *   NOTHING IS DELETED. `"closed"` stays in the vocabulary and stays matched:
 *   the terminal filter asks for the SET below, so a row stored as closed —
 *   legacy, imported, or written by something added later — is still findable.
 *   What goes is the separate choice that could only ever answer "none".
 *
 *   THE GUARDS THAT TEST FOR IT STAY TOO. `_resolveDisputeAction` refuses a
 *   dispute that is already `resolved` OR `closed`; that clause cannot fire
 *   today, and it should still be there if a closed row ever exists. A guard
 *   that is defensive is not the same as a filter that is impossible.
 */

/** Every status a dispute can be stored with. */
export const DISPUTE_STATUSES = [
    "open",
    "under_review",
    "resolved",
    "closed",
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Statuses meaning the dispute is settled and needs no further action.
 *
 * Both spellings, deliberately. `"resolved"` is what the two resolvers write;
 * `"closed"` is declared, unwritten today, and included so that asking for
 * settled disputes never silently omits one.
 */
export const DISPUTE_TERMINAL_STATUSES: readonly DisputeStatus[] = ["resolved", "closed"];

/** Statuses meaning somebody still has to act. */
export const DISPUTE_OPEN_STATUSES: readonly DisputeStatus[] = ["open", "under_review"];

/** Whether a dispute is settled — the rule the screens and the guards share. */
export function isDisputeSettled(status: string | null | undefined): boolean {
    return DISPUTE_TERMINAL_STATUSES.includes(String(status ?? "") as DisputeStatus);
}

/**
 * The stored statuses a filter choice should match.
 *
 * "resolved" is the SETTLED choice and matches both spellings; everything else
 * matches itself. This is what stops a screen offering a choice that can only
 * answer "none".
 */
export function disputeStatusesForFilter(choice: string): readonly string[] {
    if (choice === "resolved") return DISPUTE_TERMINAL_STATUSES;
    return [choice];
}
