/**
 * What the membership check ACTUALLY said — read in one place.
 *
 *   #570 THE SAME MISREADING, ON THE SECOND SCREEN.
 *
 *   #565 found /cooperatives/fixed-savings turning a failed membership check
 *   into "not_member", which renders a panel headed "you must first become an
 *   approved cooperative member" over the member's own savings.
 *   /cooperatives/loans had the identical code — a byte-for-byte copy of the
 *   same try/catch — and does the same thing over the member's own loan
 *   applications.
 *
 *   THE FIX REACHED ONE OF TWO DOORS, which is the defect class this audit has
 *   now recorded more than a dozen times. It reached one because the two
 *   screens each carried their own copy of the reading, and fixing a copy fixes
 *   a copy.
 *
 *   So this is the reading, once, for both. There is no third state to invent
 *   at a call site and no `else` for a caller to guess at.
 *
 * ── THE THREE ANSWERS, AND WHY THEY ARE THREE ───────────────────────────────
 *
 *   /api/cooperative/check-membership replies:
 *
 *       a member        { success: true, isMember: true, status }
 *       not a member    { success: true, isMember: false, status: "not_member" }
 *       COULD NOT TELL  { success: false, message } — or the fetch throws
 *
 *   The third is not a "no". Reading it as one tells a paid-up member, on a
 *   screen showing money they have borrowed or saved, that they have no
 *   membership — and offers to sell them one. That has now been the live
 *   behaviour of two screens.
 */

export type MembershipAnswer =
    | { known: true; status: "approved" | "pending" | "not_member" }
    | { known: false };

/** The answer a check-membership response carries, or "could not tell". */
export function membershipAnswerFrom(
    data: { success?: boolean; isMember?: boolean; status?: string } | null | undefined,
): MembershipAnswer {
    //   No body, or an explicit refusal. A 500 answers { success: false } with
    //   no `isMember` at all, so reading `isMember` first would call it a "no".
    if (!data || data.success === false) return { known: false };

    if (!data.isMember) return { known: true, status: "not_member" };

    //   A member whose status the row does not carry is pending, not approved:
    //   the route itself defaults to "pending" for exactly that row, and
    //   guessing upward would admit someone the admins have not passed.
    return {
        known: true,
        status: (data.status === "approved" ? "approved" : "pending"),
    };
}
