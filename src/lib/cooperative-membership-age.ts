/**
 *   #969 A LOAN REQUIRED A MINIMUM MEMBERSHIP PERIOD AND NOTHING CHECKED ONE.
 *
 *   The operational brief handed to counsel stated that loan applications
 *   "require minimum active membership duration, verified guarantors within the
 *   cooperative, and are capped against the member's aggregate savings ratio".
 *   Two of those three are real. isEligibleForLoan enforced exactly four things:
 *   a positive amount, a non-negative recorded balance, the ₦5,000 minimum
 *   contribution, and `(requested + outstanding) <= 0.5 x contribution`.
 *
 *   There was no duration test anywhere in the tree — no `joinedAt` comparison,
 *   no months-of-membership arithmetic, nothing. A member could pay in ₦5,000 and
 *   borrow ₦2,500 the same afternoon.
 *
 *   The owner confirmed the rule is real and the period is THREE MONTHS.
 *
 * ── WHICH DATE MEMBERSHIP STARTS FROM, MEASURED ─────────────────────────────
 *
 *   `CooperativeMember.joinedAt` is declared on the type and is the obvious
 *   field to reach for. IT HAS NO WRITER. Both creation sites in
 *   _coop_registration.ts write `createdAt` and neither writes `joinedAt`, and
 *   api/admin/verify-id/lookup already works around that by reading
 *   `membData?.createdAt` and calling the result joinedAt. A gate built on
 *   `joinedAt` would have compared against `undefined` on every member in the
 *   database — and depending on which way the comparison fell, either refused
 *   every loan or allowed every one.
 *
 *   The rule this codebase already settled on lives in _coop_identity.ts, in a
 *   comment beside the ID card's issue date:
 *
 *       // Issue date = approvedAt (when admin approved) — not createdAt (when
 *       // applied).
 *
 *   That is the right rule for "ACTIVE membership duration" too, and for the same
 *   reason: a row is created `pending` when somebody applies, and an applicant
 *   waiting on an admin is not yet a member. api/admin/cooperative/approve-member
 *   writes `approvedAt` onto the member row at the moment of approval, so the
 *   answer is `approvedAt`, falling back to `createdAt` for the rows approved
 *   before that field existed.
 *
 *   SO THE RULE LIVES HERE, ONCE, and both readers take it from here. Two copies
 *   of "when did this membership begin" — one deciding what an ID card says and
 *   one deciding whether somebody may borrow — is #330's shape exactly, and the
 *   loan copy is the one where drift costs money.
 *
 * ── AND IT REFUSES WHEN IT CANNOT TELL ──────────────────────────────────────
 *
 *   #744's rule, which this module follows deliberately: what the member HAS
 *   falls back to the refusing answer. An unreadable or missing start date means
 *   the duration is UNKNOWN, and an unknown duration must not satisfy a minimum.
 *   The alternative fails open, and a gate that fails open on bad data is the
 *   defect #744 found twice in one function.
 *
 *   Pure module: no session, no database, no next/*. The loan rule and the ID
 *   card both import it, and its tests execute it directly.
 */

/**
 * How long a membership must have been active before the member may borrow.
 *
 * Stated by the owner on 2026-09-28. Named rather than inlined so changing the
 * policy is one edit that reaches every application path — the same argument
 * api/cooperative/apply-loan makes in its own words about the 2x requirement it
 * had open-coded.
 */
export const LOAN_MIN_MEMBERSHIP_MONTHS = 3;

/** The fields either reader has to hand. Deliberately loose: these rows are JSONB. */
export interface MembershipDates {
    /** Written by api/admin/cooperative/approve-member at the moment of approval. */
    approvedAt?: unknown;
    /** Written at both creation sites. The fallback for rows approved before approvedAt existed. */
    createdAt?: unknown;
}

/**
 * Anything this store holds a date as, turned into a Date — or null.
 *
 * Firestore Timestamps, `{ seconds }` shapes, ISO strings, epoch numbers and
 * Dates all occur on these rows. null for anything unreadable, which the callers
 * treat as "cannot tell" rather than as a date.
 */
export function toDateOrNull(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    if (typeof value === 'object') {
        const anyVal = value as any;
        //   A real Firestore Timestamp.
        if (typeof anyVal.toDate === 'function') {
            try {
                const d = anyVal.toDate();
                return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
            } catch { return null; }
        }
        //   The serialised shape the same value arrives as through JSONB.
        if (typeof anyVal.seconds === 'number' && Number.isFinite(anyVal.seconds)) {
            return new Date(anyVal.seconds * 1000);
        }
        //   `_seconds` is what a Timestamp becomes once it has been through
        //   JSON.stringify, which is how it reaches some of these readers.
        if (typeof anyVal._seconds === 'number' && Number.isFinite(anyVal._seconds)) {
            return new Date(anyVal._seconds * 1000);
        }
        return null;
    }

    //   A number is epoch milliseconds. Guarded because `new Date(NaN)` is a
    //   Date, and an invalid one compares false against everything — which is
    //   the fail-open direction #744 warns about.
    if (typeof value === 'number') {
        return Number.isFinite(value) ? new Date(value) : null;
    }

    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * When this membership became ACTIVE, or null when that cannot be determined.
 *
 * `approvedAt` first, `createdAt` second — see the header for why that order and
 * not the other. null when neither is readable, and every caller must treat null
 * as a refusal rather than as "long enough ago".
 */
export function membershipActiveSince(member: MembershipDates | null | undefined): Date | null {
    return toDateOrNull(member?.approvedAt) ?? toDateOrNull(member?.createdAt);
}

/**
 * Whether a membership that began at `activeSince` has been active long enough.
 *
 * CALENDAR MONTHS, not a multiple of thirty days. "Three months" to a member
 * means the same day of the month three months later; counting 90 days makes the
 * rule land on a different date depending on which months it spans, and February
 * would cost somebody a week. a-delivery-estimate-is-a-day-not-a-minute recorded
 * the same trap the other way round — measuring elapsed milliseconds where the
 * promise was in calendar days.
 */
export function hasMinimumMembership(
    activeSince: Date | null,
    months: number = LOAN_MIN_MEMBERSHIP_MONTHS,
    now: Date = new Date(),
): boolean {
    //   Cannot tell → refuse. The whole reason this returns a boolean rather
    //   than a number of months is that "unknown" and "zero" must not be
    //   distinguishable to a caller that is only allowed to say yes or no.
    if (!activeSince || Number.isNaN(activeSince.getTime())) return false;

    const eligibleFrom = new Date(activeSince.getTime());
    eligibleFrom.setMonth(eligibleFrom.getMonth() + months);

    return now.getTime() >= eligibleFrom.getTime();
}

/**
 * What an applicant is told when the period has not elapsed.
 *
 * #322's rule: a refusal that does not say what to do instead reads as a broken
 * button. This one states the requirement and, when the date is known, the day it
 * is met — because "not yet" without a date is the same as no answer.
 */
export function membershipDurationRefusal(
    activeSince: Date | null,
    months: number = LOAN_MIN_MEMBERSHIP_MONTHS,
): string {
    const plural = months === 1 ? 'month' : 'months';

    if (!activeSince) {
        //   Deliberately different wording: this is not "wait a little longer",
        //   it is "we cannot establish your membership date", and it needs a
        //   human rather than patience.
        return `Your membership start date could not be read, so the `
            + `${months}-${plural} membership requirement for a loan cannot be checked. `
            + `Please contact cooperative support.`;
    }

    const eligibleFrom = new Date(activeSince.getTime());
    eligibleFrom.setMonth(eligibleFrom.getMonth() + months);

    return `A loan requires ${months} ${plural} of active membership. `
        + `Yours began on ${activeSince.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}, `
        + `so you may apply from ${eligibleFrom.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
}
