/**
 * Was this Academy place PAID for, or GRANTED? — two questions, one vocabulary.
 *
 *   THE OWNER: "fix the admin approval writing paymentStatus completed without
 *   a payment."
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 *   Two admin doors granted a place and recorded it as money:
 *
 *       approveAcademyApplicationAction    "serviceRegistrations.academy
 *       (admin/_academy.ts)                 .paymentStatus": "completed"
 *
 *       manualAcademyEnrollmentAction      the same, plus paymentStatus
 *       (admin/_academy.ts)                "completed" on every one of that
 *                                          learner's applications
 *
 *   Neither function mentions `amount`, `reference`, `processed_payments` or
 *   `verifyPaystackPayment` anywhere in its body. Approval simply WAS payment.
 *
 *   A Paystack reconciliation of the whole Academy cohort found six accounts
 *   marked `completed` with no transaction behind them, three of whose only
 *   trace at Paystack is an ABANDONED checkout attempt. A waiver, a bank
 *   transfer an admin eyeballed, and a misclick all wrote the identical record,
 *   so afterwards nothing could tell them apart — and since the module gate
 *   began reading payment as proof of entitlement, the record is load-bearing.
 *
 * ── THE SHAPE THE CODEBASE ALREADY HAD ──────────────────────────────────────
 *
 *   A third admin door got this right and was never copied:
 *
 *       _ac_admin_review's updateAcademyApplicationPaymentAction takes the
 *       amount as an argument and writes `paymentAmount`, `paymentVerifiedAt`
 *       and `paymentVerifiedBy` beside the status.
 *
 *   So "an admin says money arrived" was always meant to carry who said so and
 *   how much. The two doors above skipped all of it. This module is that
 *   distinction made explicit and shared, rather than a fourth spelling of it.
 *
 * ── WHY "waived" AND NOT A FLAG BESIDE "completed" ──────────────────────────
 *
 *   Leaving the value as `completed` and adding a marker alongside would keep
 *   every existing reader working and still be a lie in the field that says so.
 *   The next reconciliation would find new accounts asserting a payment nobody
 *   made — the defect still producing instances, merely annotated. The status
 *   has to stop claiming money it does not have.
 *
 * ── AND WHY UNIFYING TAKES THE UNION ────────────────────────────────────────
 *
 *   The readers of this field DISAGREED before this module existed:
 *
 *       module-access-check          ["completed", "paid"]
 *       checkAcademyPaymentStatus    === "completed"
 *       sms-broadcast                ["completed", "paid", "successful"]
 *       in-app-broadcast             ["completed", "paid", "successful"]
 *       admin applications screen    "completed" || "paid"
 *
 *   `successful` is written by nothing in this codebase, but two readers accept
 *   it. Unifying on the narrower set would REMOVE an acceptance those readers
 *   relied on, and the cost of being wrong in that direction is a paid learner
 *   refused. The union is the safe direction, so `successful` stays accepted
 *   and is pinned by a test asserting nothing writes it.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 *   IT DOES NOT MIGRATE THE SIX. They keep `completed` and keep their access,
 *   because relabelling a live entitlement on an inference about what an admin
 *   meant months ago is not a code change to make unattended. They stay
 *   findable: `completed` with no `paymentVerifiedBy` and no row in
 *   processed_payments is the query, and scripts/payments-that-nobody-made.sql
 *   is where that kind of sweep lives.
 */

// ─────────────────────────────────────────────────────────────────────────────
//   THE VOCABULARY

/** Money arrived — a settled charge, or an admin recording one they verified. */
export const ACADEMY_PAID_STATUSES = ["completed", "paid", "successful"] as const;

/**
 * A place an admin opened without a payment.
 *
 *   One spelling, deliberately. Every extra synonym is another `includes` that
 *   some reader will not have.
 */
export const ACADEMY_GRANTED_STATUSES = ["waived"] as const;

/** What the two admin doors record as the reason a place exists. */
export const ADMIN_GRANT_SOURCE = "admin_grant";

const normalise = (value: unknown): string =>
    typeof value === "string" ? value.trim().toLowerCase() : "";

/** Did money arrive for this place? Revenue counts this; access is wider. */
export function isAcademyPaid(status: unknown): boolean {
    return (ACADEMY_PAID_STATUSES as readonly string[]).includes(normalise(status));
}

/** Was this place granted by an admin without a payment? */
export function isAcademyGranted(status: unknown): boolean {
    return (ACADEMY_GRANTED_STATUSES as readonly string[]).includes(normalise(status));
}

/**
 * May this learner use the module?
 *
 *   Paid OR granted. A grant is a deliberate admin decision and opens the
 *   module exactly as a payment does — the point of the split is that it is
 *   not COUNTED as one, not that it is worth less to the learner.
 */
export function isAcademyEntitled(status: unknown): boolean {
    return isAcademyPaid(status) || isAcademyGranted(status);
}

/**
 * The fields an admin grant writes, so the two doors cannot drift apart.
 *
 *   Mirrors _ac_admin_review's `paymentVerifiedBy` / `paymentVerifiedAt`: who
 *   decided, and when. `paymentAmount: 0` is stated rather than left absent
 *   because the metrics service sums `Number(app.paymentAmount) || 0` over
 *   everything it counts, and an explicit zero says "no money" where a missing
 *   field says "nobody wrote this yet".
 */
export function academyGrantFields(adminUserId: string, now: unknown) {
    return {
        paymentStatus: ACADEMY_GRANTED_STATUSES[0],
        paymentAmount: 0,
        entitlementSource: ADMIN_GRANT_SOURCE,
        grantedBy: adminUserId,
        grantedAt: now,
        //   Explicitly null, not omitted: this is the field that says an admin
        //   verified money, and a grant is the case where none did. Leaving it
        //   absent would let a stale value from an earlier write survive.
        paymentVerifiedAt: null,
        paymentVerifiedBy: null,
    };
}
