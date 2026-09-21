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
 * THE PRICES BEFORE THE CURRENT ONES, AND WHY THEY ARE STILL ENFORCED.
 *
 *   THE OWNER: "ensure that this change in price doesn't affect the ones who
 *   had paid before (25k, 50k and 100k) but ensure that all those paying now
 *   are paying the new prices."
 *
 * Two prices for the same plan, decided by WHEN the money moved. A learner who
 * settled under the old list is judged against the old list forever; everybody
 * else is charged and judged at today's.
 *
 * ── WHERE THESE THREE FIGURES COME FROM ─────────────────────────────────────
 *
 *   ·  The owner named them.
 *   ·  _payment.ts already says so in its own words, in the comment above the
 *      refusal this rule feeds: "₦25,000, ₦50,000 and ₦100,000 are PLAN
 *      prices". That comment predates this change.
 *   ·  And the Paystack reconciliation of every Academy payment ever settled
 *      found exactly those three amounts and no others, until June:
 *
 *          ₦25,000  x2    ₦50,000  x2    ₦100,000  x5      Feb – May 2026
 *          ₦90,000  x1                                     June 2026
 *
 *      ₦90,000 is today's Standard fee. It is the FIRST payment at the current
 *      list and the only one, which is what fixes the changeover between
 *      2026-05-05 (the last old-list payment) and 2026-06-06 (that one).
 *
 * ── WHY A DATE AND NOT AN AMOUNT ────────────────────────────────────────────
 *
 *   Classifying by amount cannot work here: ₦100,000 is both the old Elite
 *   price AND today's Standard `originalFee`, so the same figure means two
 *   different things depending on when it was paid. The plan recorded beside a
 *   payment cannot break the tie either — the reconciliation found ₦100,000
 *   filed under Elite, Foundation AND Standard on three different records. The
 *   settlement date is the only field on a payment that is not in dispute.
 *
 * ── WHY AN UNKNOWN DATE MEANS TODAY'S PRICE ─────────────────────────────────
 *
 *   `paidAt` absent or unreadable falls through to the CURRENT list, so the
 *   grandfather clause has to be proven, never assumed. The alternative fails
 *   the second half of the instruction: a new registration that arrived
 *   without a timestamp would be admitted at ₦25,000. Paystack stamps
 *   `paid_at` on every successful transaction, so a real payment always has
 *   one, and both fulfilment paths now pass it.
 */
export const LEGACY_ACADEMY_PLAN_FEES: Readonly<Record<AcademyPlan, number>> = {
    foundation: 25000,
    standard: 50000,
    elite: 100000,
};

/**
 * The instant the current price list took effect.
 *
 *   Any cutoff between 2026-05-05 and 2026-06-06 classifies all ten reconciled
 *   payments identically, because nothing settled in that gap. This is the
 *   round date inside it. If the real changeover turns out to be elsewhere,
 *   THIS LINE IS THE ONLY THING TO EDIT.
 */
export const ACADEMY_PRICES_EFFECTIVE_FROM = Date.UTC(2026, 5, 1);

/** A timestamp from whatever a caller has, or null when it cannot be read. */
function settlementTime(paidAt: unknown): number | null {
    if (paidAt instanceof Date) {
        return Number.isNaN(paidAt.getTime()) ? null : paidAt.getTime();
    }
    if (typeof paidAt === "number") {
        return Number.isFinite(paidAt) ? paidAt : null;
    }
    if (typeof paidAt === "string" && paidAt.trim()) {
        const parsed = Date.parse(paidAt);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

/**
 * Did this payment settle under the old price list?
 *
 *   False for an unknown date, deliberately — see the header above.
 */
export function isLegacyAcademyPayment(paidAt: unknown): boolean {
    const settled = settlementTime(paidAt);
    return settled !== null && settled < ACADEMY_PRICES_EFFECTIVE_FROM;
}

/**
 * What a plan costs, in naira, for a payment settled at a given moment.
 *
 *   Omit `paidAt` to ask what it costs TODAY — which is what the checkout path
 *   wants, and why `academyPlanFee` below is this function with no date.
 */
export function academyPlanFeeOn(plan: unknown, paidAt?: unknown): number {
    const normalised = normaliseAcademyPlan(plan) ?? DEFAULT_ACADEMY_PLAN;
    return isLegacyAcademyPayment(paidAt)
        ? LEGACY_ACADEMY_PLAN_FEES[normalised]
        : ACADEMY_CONFIG.plans[normalised].fee;
}

/**
 * What a plan costs today — the price a new learner is charged.
 *
 *   One implementation with the dated rule, rather than a second copy of the
 *   fee lookup that could drift from it.
 */
export function academyPlanFee(plan: unknown): number {
    return academyPlanFeeOn(plan);
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

/**
 *   #378 A COURSE CAN NOW BE BOUGHT ON ITS OWN, SO THE RULE HAS A SECOND WAY
 *        IN.
 *
 *        #368 recorded that per-course purchase was half-built: two initiators,
 *        neither reachable, both verifiers live. Wiring one of them is only
 *        half a fix, because this rule — the ONE rule, with three call sites —
 *        knew about plans and nothing else. A learner who paid for a single
 *        course would have been bounced off its page by the same check on their
 *        next visit, and the catalogue would have gone on filtering it out.
 *
 *        `purchased` is the fact that this learner bought THIS course, recorded
 *        on their progress row by the payment verifier. It is passed by the
 *        caller rather than read here because two of the three call sites are
 *        client components with the progress row already in hand, and this
 *        module must stay importable from the browser — the reason it exists at
 *        all (see the header above).
 *
 *        Defaulting to false keeps every existing call site's behaviour
 *        unchanged, which is what makes this safe to add to a rule that decides
 *        who sees paid content.
 */
export function checkCourseAccess(
    userPlan: unknown,
    courseTier: unknown,
    purchased: unknown = false,
): boolean {
    const tier = String(courseTier ?? "").trim().toLowerCase();

    // An absent or free tier is open to everybody, signed in or not.
    if (!tier || tier === "free") return true;

    // Bought outright. Strictly `true`, not truthy: a progress row carrying a
    // stray non-empty string under this key must not open a paid course.
    if (purchased === true) return true;

    const plan = normaliseAcademyPlan(userPlan);
    // Default deny. "Registered, no tier bought" is a real state — registration
    // itself is free — and it grants no paid content.
    if (!plan) return false;

    return ACADEMY_TIERS_OPENED[plan].includes(tier);
}

/**
 * Was this course bought outright by the learner whose progress row this is?
 *
 * One reader for the flag, so the three call sites cannot disagree about what
 * counts — the drift this module's header was written about.
 */
export function isPurchasedCourse(progress: { purchased?: unknown } | null | undefined): boolean {
    return progress?.purchased === true;
}

/** Naira of rounding slack, matching what the webhook already allowed. */
export const ACADEMY_AMOUNT_TOLERANCE = 1;

export type AcademyPaymentVerdict =
    | { ok: true; plan: AcademyPlan; fee: number; overpaidBy: number; grandfathered: boolean }
    | {
          ok: false;
          reason: "underpaid";
          plan: AcademyPlan;
          fee: number;
          shortfall: number;
          message: string;
          grandfathered: boolean;
      }
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
 *
 * WHICH PRICE IT IS MEASURED AGAINST DEPENDS ON `paidAt` — see
 * LEGACY_ACADEMY_PLAN_FEES. A payment settled before the current list took
 * effect is judged against the old one, so raising a price cannot retroactively
 * turn a settled registration into an underpaid one. Omit `paidAt` and today's
 * price applies, which is the strict reading and the safe default.
 */
export function checkAcademyPayment(
    amountPaid: unknown,
    plan: unknown,
    paidAt?: unknown,
): AcademyPaymentVerdict {
    const paid = Number(amountPaid);
    if (!Number.isFinite(paid) || paid <= 0) {
        return {
            ok: false,
            reason: "unreadable_amount",
            message: "No payment amount could be read for this registration.",
        };
    }

    const resolved = normaliseAcademyPlan(plan) ?? DEFAULT_ACADEMY_PLAN;
    const grandfathered = isLegacyAcademyPayment(paidAt);
    const fee = academyPlanFeeOn(resolved, paidAt);

    if (paid + ACADEMY_AMOUNT_TOLERANCE < fee) {
        return {
            ok: false,
            reason: "underpaid",
            plan: resolved,
            fee,
            shortfall: Number((fee - paid).toFixed(2)),
            message: `The amount paid is less than the ${ACADEMY_CONFIG.plans[resolved].name} fee.`,
            grandfathered,
        };
    }

    const surplus = paid - fee;
    return {
        ok: true,
        plan: resolved,
        fee,
        overpaidBy: surplus > ACADEMY_AMOUNT_TOLERANCE ? Number(surplus.toFixed(2)) : 0,
        grandfathered,
    };
}
