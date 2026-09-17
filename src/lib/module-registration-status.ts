/**
 * Which module-registration statuses count as "this person is in this module".
 *
 *   #756 THE ACCEPTED LIST AND THE VOCABULARY ACTUALLY WRITTEN HAD DRIFTED, AND
 *        THE DASHBOARD REPORTED ZERO FOR A MODULE WITH APPLICANTS IN IT.
 *
 *   Reported by the owner from the live dashboard: Academy 0, Farm Nation 0,
 *   Export Hub 0, Export Onboarding 0, beside WAVE at 20,200 and Cooperatives
 *   at 2,239.
 *
 *   `getModuleRegistrationStats` spelled the accepted statuses out inline, once
 *   per module, seven times over:
 *
 *       status.in.(pending,under_review,approved,active,paid,completed,suspended)
 *
 *   Measured against every `serviceRegistrations.<module>.status` write in the
 *   codebase, that list is wrong in both directions:
 *
 *     WRITTEN AND NOT ACCEPTED
 *       pending_approval    _ex_onboarding.ts writes it on BOTH of its paths —
 *                           lines 177 and 729 — and it is the ONLY status an
 *                           export applicant gets before approval. So every
 *                           pending export registration was invisible, which is
 *                           exactly the "Export Hub 0" in the report.
 *       revision_required   written by export, cooperatives, WAVE and academy
 *                           when an admin asks an applicant for corrections. A
 *                           live application in the middle of review counted as
 *                           no registration at all.
 *
 *     ACCEPTED AND WRITTEN BY NOBODY
 *       under_review, paid, completed — three values in the filter that no
 *       writer in src/ produces. Harmless to match, but they are why the list
 *       LOOKED thorough: it is long, and length reads as coverage.
 *
 *   Two lists maintained by hand in different files, which is the shape this
 *   audit keeps meeting. One list now, derived from what the code writes, with
 *   the exclusions stated rather than implied.
 */

/**
 * A registration that means the person is IN the module — including one still
 * being reviewed.
 *
 * "Registered" is not "approved". The dashboard tile says "Breakdown of total
 * participants across all platform modules", and somebody halfway through an
 * application is a participant the platform is obliged to. The admin queues
 * that act on `pending` exist precisely because those people are there.
 */
export const ACTIVE_REGISTRATION_STATUSES = [
    "approved",
    "active",
    "pending",
    //   #756 — the two that were written and not accepted.
    "pending_approval",
    "revision_required",
    "suspended",
    /*
     *   #840 A THIRD ONE THAT IS WRITTEN AND WAS NOT ACCEPTED — and it is where
     *   the legacy members were.
     *
     *   The owner, of the admin dashboard: "that will include the legacy
     *   members". It did not, everywhere except one hardcoded query.
     *
     *   `legacy_pending_onboarding` is written by THREE LIVE PATHS:
     *
     *       infrastructure/payments/service.ts:815
     *       api/cooperative/verify-payment/route.ts:57 and :392
     *       actions/cooperative/_coop_membership.ts:297 and :357
     *
     *   — a member who has PAID and is mid-onboarding. She is in the module by
     *   any reading: money has changed hands and the platform owes her a place.
     *
     *   #756's own rule is that this list is "derived from what the code
     *   writes", and by that rule it belonged here from the start. It was
     *   missed because the one place that needed it — analytics.service's Co-op
     *   Onboarding tile — SPELLED IT OUT INLINE instead, which is the exact
     *   habit #756 was written to end. A hardcoded list that works is how a
     *   shared list stays wrong: nothing fails, so nobody looks.
     *
     *   WHAT THIS CHANGES. Every module's `reg()` filter now counts these
     *   members, and lib/module-applicant-count files them under `pending`
     *   rather than dropping them into the unnamed `other` bucket where nobody
     *   could see them. The cooperative pair is unaffected — its two queries
     *   name their statuses directly and remain disjoint.
     */
    "legacy_pending_onboarding",
    /*
     *   Kept although nothing in src/ writes them. They are plausible values
     *   for rows written by earlier generations of this platform or by an
     *   import, and matching a status that does not occur costs nothing, while
     *   dropping one that does is what this finding is about.
     */
    "under_review",
    "paid",
    "completed",
] as const;

/**
 * "This account has not begun this module."
 *
 *   #841 SEVENTEEN THOUSAND PEOPLE WHO HAD NOT APPLIED WERE COUNTED AS
 *   APPLICANTS, BECAUSE THIS VALUE WAS IN NEITHER LIST.
 *
 *   The owner ran the breakdown against production:
 *
 *       approved       14,668
 *       pending         5,083
 *       not_started    16,997   <-- counted as applicants
 *                      ------
 *                      36,748   = exactly what the compliance card reported
 *
 *   `not_started` is what lib/canonical/normalizer writes as the DEFAULT when an
 *   account has no status for a module — `sData?.status || "not_started"`. It is
 *   the absence of an application expressed as a value, which is why a filter of
 *   `status IS NOT NULL` counts it and should not.
 *
 *   FIVE PLACES ALREADY KNEW. broadcast-logic says it in as many words —
 *   "Must not count 'not_started' users as enrolled" — and profile-choice,
 *   duplicate-profile-resolution, registration-progress and broadcast-logic's
 *   `hasStartedAny` each special-case it inline. Every one of them is right and
 *   none of them is this list, so the knowledge existed five times and was
 *   available nowhere. That is the exact condition #756 created this module to
 *   end, surviving in the one file meant to have ended it.
 *
 *   KEPT SEPARATE FROM INACTIVE_REGISTRATION_STATUSES, which is not a tidying
 *   detail: `rejected` and `revoked` mean somebody APPLIED and was refused or
 *   removed — they belong in an application count. `not_started` means there was
 *   never an application at all. Folding the two together would make a rejected
 *   applicant disappear from the funnel, which is the opposite defect.
 */
export const NOT_STARTED_STATUSES = ["not_started"] as const;

/**
 * Statuses that mean the person is NOT in the module.
 *
 * Stated as a list rather than left as "everything else", so that adding a new
 * status is a decision about which list it joins instead of a silent exclusion.
 */
export const INACTIVE_REGISTRATION_STATUSES = [
    "rejected",
    "revoked",
] as const;

/** The `in.(…)` fragment for a PostgREST filter. */
export function registrationStatusFilter(): string {
    return `(${ACTIVE_REGISTRATION_STATUSES.join(",")})`;
}
