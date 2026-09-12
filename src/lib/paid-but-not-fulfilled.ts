/**
 * What to tell somebody whose money was taken and whose access was not granted.
 *
 *   #668 THE ONE CASE WHERE A MEMBER MUST NOT PAY AGAIN WAS THE CASE THAT TOLD
 *   THEM TO.
 *
 *   All three academy payment verifiers follow the same shape: claim the
 *   Paystack reference, then fulfil. The claim is the point at which THIS CALL
 *   owes the delivery — `claimPaymentOnce` has banked the reference and the
 *   money is ours. A failure after that means the member has paid and has
 *   nothing.
 *
 *   All three handled it in the catch. Only one said so:
 *
 *     verifyEnrollmentPaymentAction  "Failed to verify payment. Please contact
 *                                     support with reference: <ref>"   ✅
 *     verifyAcademyPaymentAction     "Failed to verify payment"        ❌
 *     verifyCoursePaymentAction      "Failed to verify payment"        ❌
 *
 *   AND THE SCREEN DISCARDED ALL THREE. academy/payment/callback does
 *   `setStatus(result.success ? "success" : "failed")` and renders one fixed
 *   panel: a red cross, "Payment Verification Failed", "We couldn't verify your
 *   payment. Please try again or contact support", and a button labelled TRY
 *   AGAIN pointing back at the payment flow.
 *
 *   So a member who has been charged, whose reference is banked, and whose
 *   enrolment failed, is shown the most emphatic possible instruction to pay a
 *   second time — and is not told the reference, so they cannot tell support
 *   which payment they mean. The careful message the enrollment flow already
 *   wrote never reached them either.
 *
 * ── WHY THIS IS A MODULE AND NOT THREE STRINGS ──────────────────────────────
 *
 *   Because it was three strings, and one of them was right. That is this
 *   audit's fourth-most-common finding and it has a cure: state the contract
 *   once. The screen needs to BRANCH on this case rather than match a sentence,
 *   so the code travels in `meta` — a field ActionResponse already carries —
 *   rather than being parsed back out of prose.
 */

/** The code the callback screen branches on. */
export const PAID_FULFILMENT_FAILED = "PAID_FULFILMENT_FAILED";

export interface PaidButNotFulfilled {
    success: false;
    error: string;
    data: null;
    meta: { code: typeof PAID_FULFILMENT_FAILED; reference: string };
}

/**
 * The refusal to return when the reference was claimed and fulfilment then
 * failed.
 *
 * The wording is deliberate and it is the whole finding:
 *
 *   · it says WE HAVE THE PAYMENT, so the member is not left believing the
 *     charge failed;
 *   · it says DO NOT PAY AGAIN, because the screen's own button used to say the
 *     opposite;
 *   · it carries the REFERENCE, because support cannot act without it and the
 *     member has no other copy.
 */
export function paidButNotFulfilled(reference: string): PaidButNotFulfilled {
    return {
        success: false,
        error:
            `We have received your payment (reference ${reference}), but something went wrong `
            + `while setting up your access. Please do NOT pay again — contact support with this `
            + `reference and it will be completed for you.`,
        data: null,
        meta: { code: PAID_FULFILMENT_FAILED, reference },
    };
}
