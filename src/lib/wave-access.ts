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

/** Statuses on serviceRegistrations.wave that mean "in the programme". */
export const WAVE_ACCESS_STATUSES = [
    "approved",
    "active",
    "pending",
    "under_review",
    "revision_required",
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
