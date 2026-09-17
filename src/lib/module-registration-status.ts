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
     *   #847 A FOURTH ONE THAT IS WRITTEN AND WAS NOT ACCEPTED — thirty-one
     *   cooperative members, measured in production:
     *
     *       not_started                 33,576
     *       pending                      1,639
     *       active                       1,255
     *       approved                       169
     *       pending_repair                  31   <-- in no list at all
     *       legacy_pending_onboarding        8
     *
     *   `pending_repair` is written by cooperatives/(member)/layout.tsx:118-119,
     *   which flags a membership record whose stored name is the literal string
     *   "undefined" and sets BOTH spellings to this value so the member is sent
     *   back to fix it. It is a live path, it deliberately preserves her BVN,
     *   next-of-kin and documents rather than deleting the record, and
     *   _coop_registration.ts:722 then lets her re-submit:
     *
     *       const allowedStatuses = ['pending', 'revision_required', 'pending_repair'];
     *
     *   So the code already treats it as a live application beside
     *   `revision_required` — in one file. It is absent here, which meant the
     *   dashboard pie's filter dropped those thirty-one entirely while
     *   lib/module-applicant-count's `total` (anything that is not
     *   `not_started`) kept them. Two surfaces, the same thirty-one people, a
     *   difference of exactly 31 — the disagreement item A3.1 of
     *   docs/module-audit-checklist.md was written to look for.
     *
     *   AND THE KNOWLEDGE EXISTED ALREADY, in lib/registration-progress:
     *
     *       const PROVISIONAL_STATUSES = ['pending_repair', 'legacy_pending_onboarding'];
     *
     *   — the same pair, in the same order, one of which #840 already had to
     *   move here for the same reason. That is #841's finding exactly: a rule
     *   known correctly in one file and unavailable in the file that exists to
     *   hold it. Both halves of that pair now live here.
     */
    "pending_repair",
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

/**
 * ACTIVE_REGISTRATION_STATUSES, split into "decided" and "still in review".
 *
 *   #846 THE COOPERATIVE PAIR KEPT ITS OWN TWO LISTS, AND THEIR EXHAUSTIVENESS
 *   WAS A COINCIDENCE.
 *
 *   analytics.service draws cooperatives as TWO slices — "Cooperatives" and
 *   "Co-op Onboarding" — because a member mid-onboarding is worth seeing
 *   separately from a settled one. That split is right and the single ACTIVE
 *   list cannot express it, so the queries spelled their statuses out inline:
 *
 *       Cooperatives      approved, active, paid, completed, suspended
 *       Co-op Onboarding  pending, pending_approval, revision_required,
 *                         legacy_pending_onboarding
 *
 *   Their union covers everything the cooperative flow writes TODAY. It does not
 *   cover `under_review`, which is in the canonical ACTIVE list — and nothing
 *   writes that for cooperative, so no member is currently lost.
 *
 *   THAT IS EXACTLY THE PROBLEM. The lists are exhaustive by coincidence rather
 *   than by construction, so the day a status is added to the canonical list —
 *   as `legacy_pending_onboarding` was, in #840, four commits ago — a
 *   cooperative member carrying it appears in NEITHER slice and vanishes from
 *   the dashboard with nothing failing.
 *
 *   Derived from ACTIVE_REGISTRATION_STATUSES by subtraction, so the union is
 *   that list BY DEFINITION. A new status lands in IN_REVIEW by default —
 *   visible — which is the same choice lib/module-applicant-count makes for its
 *   `pending` bucket, and for the same reason: #824's lesson that an enumerated
 *   list cannot catch a value nobody has invented yet.
 */
export const SETTLED_REGISTRATION_STATUSES = ACTIVE_REGISTRATION_STATUSES.filter(
    (s) => ["approved", "active", "completed", "paid", "suspended"].includes(s),
);

/** Everything active that is not yet decided. See the note above. */
export const IN_REVIEW_REGISTRATION_STATUSES = ACTIVE_REGISTRATION_STATUSES.filter(
    (s) => !(SETTLED_REGISTRATION_STATUSES as readonly string[]).includes(s),
);

/** The `in.(…)` fragment for the settled half. */
export function settledStatusFilter(): string {
    return `(${SETTLED_REGISTRATION_STATUSES.join(",")})`;
}

/** The `in.(…)` fragment for the in-review half. */
export function inReviewStatusFilter(): string {
    return `(${IN_REVIEW_REGISTRATION_STATUSES.join(",")})`;
}

/** The `in.(…)` fragment for a PostgREST filter. */
export function registrationStatusFilter(): string {
    return `(${ACTIVE_REGISTRATION_STATUSES.join(",")})`;
}
