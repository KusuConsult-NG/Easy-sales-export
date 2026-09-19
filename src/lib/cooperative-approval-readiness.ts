/**
 * Whether there is enough on a membership record to approve it.
 *
 *   715 MEMBERS WERE ACTIVE AND PAID WITH NO NAME, NO PHONE, NO DATE OF
 *   BIRTH, NO OCCUPATION, NO LGA, NO WARD AND NO ADDRESS ON FILE.
 *
 *   THE OWNER: "missing details for this user and others". Counted against
 *   production, `onboardingCompleted` is absent on 800 of 1,840 membership
 *   rows; 723 of those have a completed payment and 715 of THOSE read
 *   "active".
 *
 *   Split by cause, 328 of the 715 carry an `approvedBy` — an admin pressed
 *   Approve — and 387 became active some other way.
 *
 * ── WHY THE 328 HAPPENED ────────────────────────────────────────────────────
 *
 *   Neither approval door asked. api/admin/cooperative/approve-member wrote
 *
 *       txn.update(memberRef, { membershipStatus: "active", approvedBy, ... })
 *
 *   on nothing but the row existing, and _updateMemberStatusAction — its
 *   server-action twin, reached from the same screen — wrote membershipStatus
 *   unconditionally, its own comment noting "No status guard here".
 *
 *   And the screen could not have told them: `onboardingCompleted` was on the
 *   admin page's own type and was never rendered, so an un-onboarded member
 *   was visually identical to a complete one. An admin approving a list of
 *   paid members was doing the reasonable thing with the information shown.
 *
 * ── WHAT APPROVAL MEANS ─────────────────────────────────────────────────────
 *
 *   Approval admits somebody to a cooperative that will hold their savings
 *   and lend them money. It cannot be granted to a record that does not say
 *   who they are — there is nobody to admit, no number to call about a loan,
 *   and the ID card the membership entitles them to cannot be issued.
 *
 *   THE FLAG IS NOT THE ONLY EVIDENCE. Refusing purely on
 *   `onboardingCompleted !== true` would block real members whose details
 *   arrived by a route that never set it — so a record that NAMES somebody and
 *   gives a way to REACH them is approvable on that basis alone. The legacy
 *   bulk import writes `onboardingCompleted: true` along with a full name and
 *   phone (admin/_legacy.ts), so legacy members satisfy the first test
 *   outright; this second one is for the rows nobody has thought of.
 *
 *   THE BAR IS DELIBERATELY LOW: does this record NAME somebody, and give a
 *   way to REACH them. Not a phone specifically — an email reaches a member
 *   as well. Not a complete name — a first name names somebody.
 *
 *   Set any higher and it refuses records that describe a real, contactable
 *   person, which is how a guard comes to be removed wholesale rather than
 *   corrected. Set here it still refuses every one of the 715, because they
 *   carry no name field at all. Refusing more than that buys nothing and
 *   costs the guard its welcome.
 *
 *   It is NOT a completeness check. A member with no date of birth, no LGA
 *   and no next of kin is still approvable; chasing those is the
 *   cooperative's business, not this function's.
 *
 *   SUSPENSION IS NOT APPROVAL AND IS NEVER BLOCKED. An admin must be able to
 *   suspend a member whose record is incomplete — that is precisely a record
 *   they may need to act against, and a guard that prevented it would be
 *   worse than the one that was missing.
 */

/** Statuses that ADMIT a member, as opposed to describing or removing one. */
const ADMITTING_STATUSES = new Set(["active", "approved"]);

export interface ApprovalReadiness {
    /** True when this record may be approved. */
    ready: boolean;
    /** What an admin is told, or null when ready. */
    reason: string | null;
    /** Which details are absent, for the log and the message. */
    missing: string[];
}

function has(v: unknown): boolean {
    return typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined && v !== false;
}

/** Whether a status change is an admission and therefore subject to the rule. */
export function isAdmittingStatus(status: string | null | undefined): boolean {
    return ADMITTING_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/**
 * Whether `member` carries enough to be approved.
 *
 * Callers apply this ONLY when the status being written admits the member —
 * see isAdmittingStatus. Anything else, suspension included, is none of this
 * function's business.
 */
export function approvalReadiness(
    member: Record<string, any> | null | undefined,
): ApprovalReadiness {
    const m = member ?? {};

    if (m.onboardingCompleted === true) {
        return { ready: true, reason: null, missing: [] };
    }

    //   ANY name, not a complete one. A record giving only a first name names
    //   somebody; refusing it over a missing surname refuses a real member,
    //   and buys nothing — all 715 rows this guard exists for carry no name
    //   field at all.
    const name = has(m.fullName) || has(m.firstName) || has(m.lastName);
    const contact = has(m.phone) || has(m.phoneNumber) || has(m.email);

    if (name && contact) {
        return { ready: true, reason: null, missing: [] };
    }

    const missing: string[] = [];
    if (!name) missing.push("name");
    if (!contact) missing.push("phone number or email address");

    return {
        ready: false,
        missing,
        reason:
            "This member has not completed their onboarding form, so the record has no "
            + missing.join(" and ")
            + ". Approving would admit somebody the cooperative cannot identify or contact. "
            + "Ask them to complete onboarding at /cooperatives/onboarding, or use Import "
            + "Legacy Member to enter their details, then approve.",
    };
}
