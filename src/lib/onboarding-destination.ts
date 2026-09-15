/**
 * Where an applicant goes when an onboarding form has been submitted.
 *
 *   #790 THREE FORMS SENT A JUST-SUBMITTED APPLICANT TO A DASHBOARD SHE COULD
 *        NOT OPEN.
 *
 *   The owner: "ensure that for the forms that are gated with auto-approval,
 *   they should also [be] redirected to dashboard automatically and for the
 *   forms without auto-approval, they should be redirected to a pending page
 *   with a home button on the page and once approved, they should have a direct
 *   access to their dashboard."
 *
 *   Measured, by reading what each submit action WRITES and what the gate then
 *   ALLOWS:
 *
 *     EXPORT             writes status "pending_approval", grants no role.
 *                        Submit did router.replace("/export/dashboard").
 *                        checkModuleAccess refuses, the member layout bounces
 *                        her to /export/onboarding, and that screen's own gate
 *                        then sends her to /export/onboarding/pending — where
 *                        she should have gone in the first place, two redirects
 *                        and a flash of the form she has just finished later.
 *
 *     MARKETPLACE seller writes "pending", grants no role. Same bounce.
 *     MARKETPLACE buyer  writes "active" AND grants marketplace_buyer, so she
 *                        IS auto-approved — and was sent to /marketplace/
 *                        dashboard rather than the buyer dashboard the gate
 *                        itself sends approved buyers to.
 *
 *     FARM NATION        writes status "pending" but grants `farmer`/`investor`
 *                        immediately, and those roles grant farm-nation at
 *                        Layer 1 of checkModuleAccess. So it auto-approves in
 *                        fact while its record says pending, and its own gate
 *                        reads that status and sends her to a page telling her
 *                        she is waiting — for a module she can already use.
 *                        One person, two answers, depending which door she used.
 *
 * ── WHY THIS ASKS ABOUT ACCESS AND NOT ABOUT STATUS ─────────────────────────
 *
 *   Because STATUS IS A LABEL AND ACCESS IS THE DECISION. Farm Nation is the
 *   proof: "pending" and fully admitted at the same time. A destination table
 *   keyed on status has to predict what checkModuleAccess will do, and any
 *   place where the prediction is wrong is a bounce — which is the defect.
 *
 *   So the caller asks the module the SAME question the layout will ask, and
 *   routes on the answer. The destination then cannot disagree with the gate
 *   that enforces it, because it is the same question. That is what makes this
 *   class of defect unreachable rather than fixing three instances of it.
 *
 *   The status-blind `router.replace("/<module>/dashboard")` in each submit
 *   handler is what this replaces, and it is deleted rather than corrected: a
 *   second copy of a routing rule is how the two came to disagree.
 */

export type OnboardingModule = "export" | "farm-nation" | "marketplace";

export interface OnboardingOutcome {
    /** What checkModuleAccess says — the gate's own answer, not a status string. */
    hasAccess: boolean;
    /** Marketplace only: "buyer", "seller" or "both". Ignored elsewhere. */
    accountType?: string | null;
}

/**
 * The screen a member should land on for `module` given that outcome.
 *
 * Every path returned here is a real route — the suite beside this asserts each
 * one resolves to a page file, because a redirect to a route that does not
 * exist is the same dead end wearing a 404.
 */
export function onboardingDestination(
    module: OnboardingModule,
    { hasAccess, accountType }: OnboardingOutcome,
): string {
    if (!hasAccess) return PENDING_PAGE[module];

    if (module === "marketplace") {
        //   The gate's own rule for an approved marketplace member, which the
        //   submit handler did not share: a seller's dashboard is not a buyer's.
        return accountType === "seller" || accountType === "both"
            ? "/marketplace/seller/dashboard"
            : "/marketplace/buyer/dashboard";
    }

    return DASHBOARD[module];
}

/**
 * Where a member waits when the module has NOT admitted her.
 *
 * #781 put a home button on every one of these, which is the other half of the
 * owner's sentence — an applicant with nothing to do on the screen must be able
 * to leave it.
 */
const PENDING_PAGE: Record<OnboardingModule, string> = {
    "export": "/export/onboarding/pending",
    "farm-nation": "/farm-nation/onboarding/pending",
    "marketplace": "/marketplace/onboarding/pending",
};

const DASHBOARD: Record<OnboardingModule, string> = {
    "export": "/export/dashboard",
    //   Farm Nation's member area opens on the properties list; it has a
    //   /farm-nation/dashboard too, and this is the one its own gate sends an
    //   approved member to.
    "farm-nation": "/farm-nation/properties",
    //   Never used — marketplace is answered above, by account type. Present so
    //   the record is total and a reader is not left wondering.
    "marketplace": "/marketplace/buyer/dashboard",
};

/** Exported for the suite, which checks every one of these is a real route. */
export const ALL_ONBOARDING_DESTINATIONS: readonly string[] = [
    ...Object.values(PENDING_PAGE),
    ...Object.values(DASHBOARD),
    "/marketplace/seller/dashboard",
];
