/**
 * Which academy fulfilment a Paystack payment belongs to, and what a purchase
 * stamps on the learner's progress row.
 *
 *   #378 TWO VERIFIERS ACCEPT THE SAME PAYMENT TYPE AND FULFIL IT DIFFERENTLY.
 *
 *        `type: "academy_enrollment"` is written by both per-course initiators,
 *        and two live verifiers accept it:
 *
 *          verifyCoursePaymentAction      writes user_progress/<uid>/courses/<cid>
 *          (_ac_course_payment.ts)        — the row a learner's ACCESS is read
 *                                         from
 *
 *          verifyEnrollmentPaymentAction  writes an ENROLLMENTS row — what the
 *          (_payment.ts)                  admin enrolment report is read from
 *
 *        claimPaymentOnce guarantees only one of them ever runs for a given
 *        reference. While #368 held — neither initiator reachable — that was
 *        harmless. Wiring one of them puts real references in the wild, and
 *        /api/academy/verify-payment is reachable, so a course purchase
 *        verified through the wrong door leaves the learner enrolled in the
 *        admin's report and locked out of the course. Permanently: the payment
 *        is claimed, and no later call can claim it again.
 *
 *        So the payment says which fulfilment it is, and each verifier refuses
 *        the other's. A reference carrying NO marker is accepted by both,
 *        exactly as before — nothing already in flight is stranded by this.
 *
 * WHY A MODULE AND NOT A CONSTANT IN EITHER FILE
 * ---------------------------------------------
 * Both are "use server" files, and every export of one of those must be an
 * async server action — the same constraint that put checkCourseAccess in
 * lib/academy-plan.ts rather than beside the decision it belongs to. A shared
 * string that each side declared for itself is how two doors meant to disagree
 * quietly start agreeing.
 */

/** The marker a per-course purchase carries on its Paystack metadata. */
export const COURSE_PURCHASE_FLOW = "course_purchase";

/**
 * The marker the ENROLLMENTS-writing flow claims.
 *
 * Its initiator is superseded and unreachable, so nothing writes this today —
 * it exists so that verifyEnrollmentPaymentAction states which flow it fulfils
 * rather than being defined only by what it refuses. A door that says "not that
 * one" and never says "this one" is how the next flow gets added to the wrong
 * side of the check.
 */
export const ENROLLMENT_FLOW = "course_enrollment";

/**
 * Should this verifier refuse the payment in front of it?
 *
 * `mine` is the flow the calling verifier fulfils. An absent or empty marker
 * belongs to nobody and is accepted, which is what keeps references created
 * before #378 working.
 */
export function isForeignPaymentFlow(metadataFlow: unknown, mine: string): boolean {
    const flow = String(metadataFlow ?? "").trim();
    if (!flow) return false;
    return flow !== mine;
}

/**
 * What a completed per-course purchase records on the progress row.
 *
 *   #378 BUYING A COURSE HAD TO BE VISIBLE TO THE ACCESS RULE, OR IT BOUGHT
 *        NOTHING.
 *
 *        The verifier already created the progress row, and that was taken to
 *        be the enrolment. It is not what grants access: checkCourseAccess
 *        decides that, from the learner's PLAN against the course TIER, and it
 *        runs on the course page before the progress row is ever consulted. A
 *        learner who bought a single elite course on a foundation plan would
 *        have been redirected off its page on their next visit, and the
 *        catalogue would have gone on filtering it out of the list.
 *
 *        A progress row is not itself proof of purchase — enrollInCourseAction
 *        writes one for plan-granted access too — so the fact is recorded
 *        explicitly rather than inferred from the row's existence. Inferring it
 *        would silently widen access to every course a learner had ever been
 *        enrolled on, including after a plan downgrade.
 */
export function coursePurchaseStamp(reference: string, amountPaid: number): Record<string, unknown> {
    return {
        purchased: true,
        purchasedAt: new Date().toISOString(),
        purchaseReference: reference,
        purchaseAmount: amountPaid,
    };
}
