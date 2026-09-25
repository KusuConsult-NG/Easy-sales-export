/**
 * Who is inside the WAVE programme.
 *
 * WHY THIS IS A SHARED MODULE
 * ---------------------------
 * The rule existed once, in src/middleware.ts, where it gates PAGES under
 * /wave. It stops a male account that is not already in the programme from
 * reaching them:
 *
 *     const hasWaveAccess = hasWaveRole ||
 *                          waveRegStatus === "approved" ||
 *                          waveRegStatus === "active" ||
 *                          waveRegStatus === "pending" ||
 *                          waveRegStatus === "under_review" ||
 *                          waveRegStatus === "revision_required";
 *
 *     const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccess);
 *
 * Middleware does not run for the programme's API routes in the way it runs for
 * its pages — /api/wave/training-sessions asked only for a session, and returned
 * every session document to any signed-in account, meeting link included.
 *
 * Rather than write the same list of statuses a second time, both read this.
 * The statuses are deliberately generous — pending and under_review are in the
 * programme's pipeline, and someone waiting on a decision still attends the
 * training.
 *
 * Edge-safe: no imports, no I/O, pure functions. middleware.ts runs in the edge
 * runtime and cannot pull in the database layer.
 */

/**
 * Statuses that mean the programme has ADMITTED this account — the dashboard
 * is theirs.
 *
 * Only "approved" is written by the current code; "active" is kept because a
 * legacy row may carry it and dropping a status from an ACCEPTING list locks
 * somebody out, which is the direction that costs a member her place.
 */
export const WAVE_IN_PROGRAMME_STATUSES = ["approved", "active"] as const;

/** Statuses that mean a decision is owed to them, and they need only wait. */
export const WAVE_AWAITING_REVIEW_STATUSES = ["pending", "under_review"] as const;

/**
 * The status that means the platform is waiting on THEM — #929.
 *
 * `requestWaveRevisionAction` writes it, records the reviewer's note beside it,
 * and sends no email. So the applicant learns of it by coming to the site,
 * which makes where the site sends her the whole of the message.
 */
export const WAVE_REVISION_STATUS = "revision_required";

/**
 * Statuses on serviceRegistrations.wave that mean "in the programme".
 *
 * COMPOSED, not re-listed. This is what the middleware gate admits, and #929
 * was the front door knowing three of the five it lets through: a fourth
 * spelled out here and forgotten in a screen is exactly what happened.
 */
export const WAVE_ACCESS_STATUSES = [
    ...WAVE_IN_PROGRAMME_STATUSES,
    ...WAVE_AWAITING_REVIEW_STATUSES,
    WAVE_REVISION_STATUS,
] as const;

/**
 * Is this account inside the WAVE programme?
 *
 * The role or a live registration. Says nothing about gender — that is a
 * separate question the middleware asks alongside this one, and conflating them
 * here would mean a male administrator of the programme could not read it.
 */
export function hasWaveAccess(params: {
    roles?: string[] | null;
    waveRegStatus?: string | null;
}): boolean {
    const roles = params.roles ?? [];
    if (roles.includes("wave_participant")) return true;

    const status = params.waveRegStatus ?? null;
    return status !== null && (WAVE_ACCESS_STATUSES as readonly string[]).includes(status);
}

/**
 * May this account read the programme's own material — schedules, meeting
 * links, room names?
 *
 * Admins included: they run it. Everyone else has to be in it.
 */
export function canReadWaveProgramme(params: {
    roles?: string[] | null;
    waveRegStatus?: string | null;
}): boolean {
    const roles = params.roles ?? [];
    if (roles.includes("admin") || roles.includes("super_admin") || roles.includes("wave_admin")) {
        return true;
    }
    return hasWaveAccess(params);
}

/**
 * Has the programme ADMITTED this account? — #929.
 *
 * Narrower than hasWaveAccess on purpose, and the distinction is the one three
 * screens were making by hand: hasWaveAccess answers "may she through the door"
 * and admits everyone in the pipeline, including an applicant awaiting a
 * decision. This answers "is she in", which is what a dashboard link and a
 * member heal are asking.
 */
export function isInWaveProgramme(params: {
    roles?: string[] | null;
    waveRegStatus?: string | null;
}): boolean {
    const roles = params.roles ?? [];
    if (roles.includes("wave_participant")) return true;

    const status = params.waveRegStatus ?? null;
    return status !== null && (WAVE_IN_PROGRAMME_STATUSES as readonly string[]).includes(status);
}

/** Where a WAVE visitor belongs, given what the platform knows about them. */
export type WaveDestination =
    | "/wave/dashboard"
    | "/wave/application"
    | "/wave/application/review-pending"
    | "/wave/landing";

/**
 * The module's front door, decided once — #929.
 *
 *   THE PLATFORM ASKED AN APPLICANT FOR CHANGES AND THEN TOLD HER TO APPLY.
 *
 *   `requestWaveRevisionAction` writes `revision_required` on the user with the
 *   reviewer's note, and sends nothing. Three screens decided where a visitor
 *   goes, each with its own hand-written list of statuses, and not one of them
 *   named that status:
 *
 *       /wave              pending | under_review -> review-pending, else landing
 *       /wave/landing      approved | active      -> dashboard,
 *                          pending | under_review -> review-pending
 *       DashboardNav       approved | active      -> dashboard,
 *                          pending | under_review | pending_review -> pending
 *
 *   So she reached /wave, fell through every branch, and read "Begin Here -
 *   Apply Now!" on the marketing page — while /wave/application was already
 *   waiting with her reviewer's note in an amber panel. The dashboard nav sent
 *   her to the right place by ACCIDENT, through its else-branch, which is why
 *   this was invisible from the one screen most people start on.
 *
 *   THE GATE KNEW ALL FIVE. WAVE_ACCESS_STATUSES lists revision_required and
 *   middleware admits her on it. Only the screens deciding where she should GO
 *   had a smaller list, three times over.
 *
 * Says nothing about gender or the cutoff — lib/wave-eligibility owns who may
 * APPLY, and conflating the two here would answer a question this cannot see.
 */
export function waveDestinationFor(params: {
    roles?: string[] | null;
    waveRegStatus?: string | null;
}): WaveDestination {
    if (isInWaveProgramme(params)) return "/wave/dashboard";

    const status = params.waveRegStatus ?? null;
    if (status === null) return "/wave/landing";

    //   Before the awaiting-review branch: an application sent back for changes
    //   is not waiting on us, and "we will let you know" is the wrong sentence
    //   to show somebody the platform is itself waiting on.
    if (status === WAVE_REVISION_STATUS) return "/wave/application";
    if ((WAVE_AWAITING_REVIEW_STATUSES as readonly string[]).includes(status)) {
        return "/wave/application/review-pending";
    }

    //   Rejected, not_started, or anything a future writer invents: the public
    //   page, which is the honest answer for an account the programme has no
    //   live relationship with.
    return "/wave/landing";
}
