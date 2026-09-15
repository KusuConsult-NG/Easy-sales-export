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
