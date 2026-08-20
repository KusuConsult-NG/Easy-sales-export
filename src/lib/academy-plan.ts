/**
 * Which academy plan is this, and was it paid for? — one answer.
 *
 * THE DEFECT
 * ----------
 * Academy registration is fulfilled by TWO paths, and only one checked the
 * amount.
 *
 *   processAcademyRegistration        the Paystack WEBHOOK. Derives the
 *   (infrastructure/payments)         expected fee from the plan and throws
 *                                     on underpayment.
 *
 *   _verifyAcademyPaymentAction       the INTERACTIVE path, wired to
 *   (actions/academy/_payment.ts)     /academy/payment/callback. No amount
 *                                     validation at all.
 *
 * The interactive path read `verify.data.amount`, wrote it as `paymentAmount`,
 * marked `paymentStatus: "completed"`, granted the `academy_participant` role
 * and `isVerified: true`, auto-approved the application with
 * `reviewedBy: "paystack_auto_approval"`, and wrote a completed ledger row —
 * without once comparing what was paid against what the plan costs.
 *
 * The two race by design: the webhook usually finishes before the user is
 * redirected back. So which one reached a payment first decided whether an
 * underpaid registration was accepted.
 *
 * This is the same shape as the marketplace order defect
 * (lib/order-payment-amount.ts), with the permissive path on the other side:
 * there the interactive path was the strict one.
 *
 * A PLAN NOBODY SELLS
 * -------------------
 * The interactive path stored `metadata.plan || "registration"`. There are
 * three plans — foundation, standard, elite — and "registration" is not one of
 * them. A record carrying it matches no plan lookup, so the fee it was supposed
 * to have paid cannot be determined afterwards.
 *
 * "advanced" is a fourth spelling, of `standard`. Both fulfilment paths already
 * mapped it; it is mapped here once instead.
 */

import { ACADEMY_CONFIG } from "@/lib/constants";
import { isDecidedAgainst } from "@/lib/registration-progress";

export const ACADEMY_PLANS = ["foundation", "standard", "elite"] as const;

export type AcademyPlan = (typeof ACADEMY_PLANS)[number];

/** The default when nothing usable was recorded. The cheapest, deliberately. */
export const DEFAULT_ACADEMY_PLAN: AcademyPlan = "foundation";

/**
 * Maps whatever was stored onto a real plan.
 *
 * Returns null rather than guessing when the value is not one we sell — the
 * caller decides whether that is a refusal or a fallback, and those are
 * different decisions.
 */
export function normaliseAcademyPlan(plan: unknown): AcademyPlan | null {
    const raw = String(plan ?? "").trim().toLowerCase();
    if (!raw) return null;
    // "advanced" was the old name for standard, and both fulfilment paths
    // already translated it.
    if (raw === "advanced") return "standard";
    return (ACADEMY_PLANS as readonly string[]).includes(raw) ? (raw as AcademyPlan) : null;
}

/**
 * The tier an APPLICATION represents, repairing the rows already in production.
 *
 * _submitAcademyApplicationAction wrote `plan: "registration"` on every
 * application it created, unconditionally. The form pays first — step 5 only
 * renders Submit once paymentStatus is "paid" — so the row was always created
 * AFTER checkout, and because no application existed at payment time both
 * fulfilment paths skipped their `if (appDoc)` update. Nothing ever corrected
 * it.
 *
 * So the admin applications screen, its plan badge and its CSV export said
 * "Registration" for every learner, including everyone who paid the elite fee,
 * with the correct amount displayed in the next column.
 *
 * Every one of those rows is still in the database. `normaliseAcademyPlan`
 * already returns null for "registration", so falling back to the tier on the
 * learner's user document repairs them on read — no migration, and no guessing:
 * the user document is where the fulfilment paths write the plan they verified
 * the payment against.
 *
 * null means what it says: registered, no tier bought. Registration itself is
 * free, so that is a real state and not a missing value.
 */
export function resolveApplicationPlan(
    applicationPlan: unknown,
    userAcademyPlan: unknown,
): AcademyPlan | null {
    return normaliseAcademyPlan(applicationPlan) ?? normaliseAcademyPlan(userAcademyPlan);
}

/**
 * Did this learner buy a package? — one answer, in the vocabulary of the rule
 * that grants the access.
 *
 * FOUR HAND-ROLLED COPIES, AND NONE OF THEM TRIMMED
 * -------------------------------------------------
 *   _getEnrolledCoursesWithDetailsAction  ["elite","standard","foundation","advanced"]
 *   api/academy/dashboard/route.ts        the same four, copy-pasted
 *   autoEnrollPaidUser                    eleven entries, including the
 *                                         STATUSES "active", "enrolled" and
 *                                         "approved" and four plan names
 *                                         nothing in this codebase writes
 *
 * All three call sites lower-cased and none trimmed, while
 * normaliseAcademyPlan — which the checkCourseAccess call two lines further on
 * uses — does both, and maps the legacy "advanced" onto standard.
 * academy-course-access.test.ts asserts checkCourseAccess(" Elite ", "elite")
 * is true.
 *
 * So a plan stored with a stray space opened every elite course in the
 * catalogue and handed over every video through getCourseByIdAction, and failed
 * all three of these gates — the auto-enrolment sweep never ran for that
 * learner. They were shown the whole catalogue unlocked and a dashboard saying
 * they were enrolled in nothing. Same shape as #228, one file over.
 *
 * The eleven-entry list is narrower now, deliberately. For all eight of its
 * extra tokens normaliseAcademyPlan already returned null, so checkCourseAccess
 * — which autoEnrollPaidUser applies per course a few lines later — refused
 * every paid tier for them anyway. The only enrolments they produced were in
 * FREE courses, which are open to everybody with or without a row. Nothing that
 * was reachable stops being reachable; the sweep just stops running for a
 * learner whose recorded plan is a status word.
 */
export function isPaidAcademyPlan(plan: unknown): boolean {
    return normaliseAcademyPlan(plan) !== null;
}

/** What a plan costs, in naira. */
export function academyPlanFee(plan: unknown): number {
    const normalised = normaliseAcademyPlan(plan) ?? DEFAULT_ACADEMY_PLAN;
    return ACADEMY_CONFIG.plans[normalised].fee;
}

/**
 * Which course tiers a plan opens — the one copy.
 *
 * There were THREE, and the two client-side ones each carried the comment
 * "Helper client-side check replicated from checkCourseAccess inside
 * _actions.ts". _actions.ts no longer exists; the server copy had moved to
 * _ac_enrollment.ts, and the replicas stayed where they were.
 *
 *   _ac_enrollment.ts                 the decision. Refuses the enrolment.
 *   academy/[courseId]/page.tsx       decides whether to redirect the learner.
 *   academy/(learner)/courses/page.tsx  decides which cards show a lock.
 *
 * Copies of an access rule drift, and this one drifted the moment the server
 * copy was normalised: the server began accepting a plan with stray whitespace
 * or capitals that the two replicas still rejected, so the catalogue would have
 * shown a lock on a course the enrolment endpoint would happily grant.
 *
 * Living here rather than in _ac_enrollment.ts because that file is "use
 * server" — every export of it must be an async server action, so a client
 * component cannot import a plain predicate from it. That constraint is why the
 * copies existed.
 */
export const ACADEMY_TIERS_OPENED: Readonly<Record<AcademyPlan, readonly string[]>> = {
    elite: ["foundation", "standard", "elite"],
    standard: ["foundation", "standard"],
    foundation: ["foundation"],
};

export function checkCourseAccess(userPlan: unknown, courseTier: unknown): boolean {
    const tier = String(courseTier ?? "").trim().toLowerCase();

    // An absent or free tier is open to everybody, signed in or not.
    if (!tier || tier === "free") return true;

    const plan = normaliseAcademyPlan(userPlan);
    // Default deny. "Registered, no tier bought" is a real state — registration
    // itself is free — and it grants no paid content.
    if (!plan) return false;

    return ACADEMY_TIERS_OPENED[plan].includes(tier);
}

/**
 * The same question, asked of a REGISTRATION rather than a bare plan string.
 *
 * THE CONTENT GATE NEVER ASKED WHETHER THE REGISTRATION HAD BEEN REFUSED.
 * ---------------------------------------------------------------------
 * `checkCourseAccess` takes a plan, and a plan is what somebody BOUGHT. It is
 * not what an admin DECIDED. Rejecting an Academy application writes
 * `serviceRegistrations.academy.status = "rejected"` and leaves
 * `...academy.plan` exactly as it was — deliberately, since the payment
 * happened — so a rejected applicant who had paid the elite fee still carries
 * `plan: "elite"` for ever.
 *
 * _ac_catalog.ts read that plan straight out of the session and served on it.
 * getCourseByIdAction returns every lesson's videoUrl, documentUrl, excelUrl
 * and body text when the tier opens; getCoursesAction returns a page of them
 * the same way. Neither consulted the status. So the rejection took away the
 * role (#210), the enrolment (#225) and every page that checks module access —
 * and left the actual material reachable by calling the action directly, which
 * is precisely the gap academy-content-gating.test.ts was written about: "the
 * tier gate was applied everywhere except where the content is served".
 *
 * A DECIDED-AGAINST REGISTRATION HOLDS NO PLAN, WHICH IS NOT THE SAME AS NO ACCESS.
 * -------------------------------------------------------------------------------
 * It is mapped to `null` rather than refused outright, so a free-tier course
 * stays open. `checkCourseAccess` opens a free or absent tier to everybody,
 * signed in or not — refusing a rejected applicant something an anonymous
 * visitor is handed would be a rule that reads backwards. What closes is
 * exactly the paid material the plan was buying.
 */
export function checkCourseAccessForRegistration(
    registration: { plan?: unknown; status?: unknown } | null | undefined,
    courseTier: unknown,
): boolean {
    const plan = isDecidedAgainst(registration?.status as string | undefined | null)
        ? null
        : registration?.plan;
    return checkCourseAccess(plan, courseTier);
}


/** Naira of rounding slack, matching what the webhook already allowed. */
export const ACADEMY_AMOUNT_TOLERANCE = 1;

export type AcademyPaymentVerdict =
    | { ok: true; plan: AcademyPlan; fee: number; overpaidBy: number }
    | { ok: false; reason: "underpaid"; plan: AcademyPlan; fee: number; shortfall: number; message: string }
    | { ok: false; reason: "unreadable_amount"; message: string };

/**
 * Was this enough for that plan?
 *
 * UNDERPAYMENT IS REFUSED — the webhook already refused it, and granting a
 * plan nobody paid for is the case that matters.
 *
 * OVERPAYMENT IS ACCEPTED and reported, not refused. Refusing leaves a learner
 * who has been charged with no registration and an error, which is the outcome
 * this codebase treats as the worst one everywhere it appears. The caller is
 * told by how much so it can be recorded.
 */
export function checkAcademyPayment(amountPaid: unknown, plan: unknown): AcademyPaymentVerdict {
    const paid = Number(amountPaid);
    if (!Number.isFinite(paid) || paid <= 0) {
        return {
            ok: false,
            reason: "unreadable_amount",
            message: "No payment amount could be read for this registration.",
        };
    }

    const resolved = normaliseAcademyPlan(plan) ?? DEFAULT_ACADEMY_PLAN;
    const fee = ACADEMY_CONFIG.plans[resolved].fee;

    if (paid + ACADEMY_AMOUNT_TOLERANCE < fee) {
        return {
            ok: false,
            reason: "underpaid",
            plan: resolved,
            fee,
            shortfall: Number((fee - paid).toFixed(2)),
            message: `The amount paid is less than the ${ACADEMY_CONFIG.plans[resolved].name} fee.`,
        };
    }

    const surplus = paid - fee;
    return {
        ok: true,
        plan: resolved,
        fee,
        overpaidBy: surplus > ACADEMY_AMOUNT_TOLERANCE ? Number(surplus.toFixed(2)) : 0,
    };
}
