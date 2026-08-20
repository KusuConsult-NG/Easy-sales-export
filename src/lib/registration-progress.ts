/**
 * How far along a service registration is.
 *
 * ONE RULE, SEVEN COPIES, TWO OF THEM BEHAVIOURALLY DIFFERENT
 * -----------------------------------------------------------
 * Six files each declared their own `getProgressScore`, and they did not agree:
 *
 *                                    'verified'   'under_review'
 *   cooperative/_coop_membership.ts      0              0
 *   cooperative/_coop_registration.ts    0              0
 *   lib/schema-normalizer.ts (coop)      0              0
 *   lib/schema-normalizer.ts (farm)      4              0
 *   lib/module-access-check.ts (coop)    0              0
 *   lib/module-access-check.ts (farm)    4              0
 *   lib/user-migration.ts                4              3
 *
 * The score decides which of two registrations for the same module survives a
 * merge, and in module-access-check it decides whether somebody gets into the
 * module at all. A status scoring 0 loses to EVERYTHING, including
 * 'not_started', which scores 1.
 *
 * So a member whose cooperative registration says `verified` lost to a stale
 * `not_started` record and was refused the module — while a member whose FARM
 * NATION registration said `verified` was let in, from a copy of the same
 * function twenty lines further down the same file. And `under_review` scored 0
 * in six of the seven, so a member part-way through review ranked below one who
 * had not started.
 *
 * This is the union, which is what the fullest copy already had. Nothing is
 * demoted: every status that scored above 0 anywhere keeps that score. The two
 * that scored 0 in some copies are the ones being corrected, and both are
 * unambiguous — `verified` is a terminal positive state everywhere in this
 * codebase, and `under_review` belongs with the other pending spellings.
 *
 * Same treatment as #26 (five hand-written approvable status sets) and #38
 * (four copies of the WAVE eligibility rule, three of them different).
 */

/** Terminal positive: the member is in. */
const ACTIVE_STATUSES = ['active', 'approved', 'verified'] as const;

/** Submitted and awaiting a decision. */
const PENDING_STATUSES = [
    'pending',
    'pending_review',
    'under_review',
    'revision_required',
] as const;

/** Recorded but not yet a real submission. */
const PROVISIONAL_STATUSES = ['pending_repair', 'legacy_pending_onboarding'] as const;

/**
 * Statuses that record a DECISION AGAINST the member.
 *
 * Separate from the scoring above, which answers "how far along". These answer
 * "was this refused", and the difference matters because they all score 0 — the
 * same as an unrecognised value — so any rule phrased as "heal anything that
 * scores low" reverses them.
 *
 * That is exactly what happened. schema-normalizer's role-based self-heal ran
 * on every login and wrote back:
 *
 *     if (roles.includes("wave_participant")) {
 *         if (sr.wave.status !== "approved") sr.wave.status = "approved";
 *     }
 *
 * The WAVE and Academy rejection paths write `status: "rejected"` and do NOT
 * strip the corresponding role, so a rejected applicant logging in had the
 * rejection silently overwritten with "approved" — and persisted. The
 * cooperative was safe only because its suspend path revokes the role too.
 *
 * A decision is a decision. Nothing derived may overwrite one.
 */
const DECIDED_AGAINST = [
    'rejected',
    'declined',
    'denied',
    'suspended',
    'revoked',
    'cancelled',
    'canceled',
    'banned',
    'withdrawn',
    'terminated',
] as const;

/** Has a person decided against this registration? */
export function isDecidedAgainst(status: string | undefined | null): boolean {
    return (DECIDED_AGAINST as readonly string[])
        .includes(String(status ?? '').trim().toLowerCase());
}

export const REGISTRATION_PROGRESS = {
    ACTIVE: 4,
    PENDING: 3,
    PROVISIONAL: 2,
    NOT_STARTED: 1,
    UNKNOWN: 0,
} as const;

/**
 * A comparable score for a registration status. Higher is further along.
 *
 * An unrecognised status scores 0 and therefore loses every comparison — which
 * is the right default for a merge (keep the side you understand) and the reason
 * the divergence above mattered so much.
 */
export function registrationProgressScore(status: string | undefined | null): number {
    const s = String(status ?? '').toLowerCase();

    if ((ACTIVE_STATUSES as readonly string[]).includes(s)) return REGISTRATION_PROGRESS.ACTIVE;
    if ((PENDING_STATUSES as readonly string[]).includes(s)) return REGISTRATION_PROGRESS.PENDING;
    if ((PROVISIONAL_STATUSES as readonly string[]).includes(s)) return REGISTRATION_PROGRESS.PROVISIONAL;
    if (s === 'not_started') return REGISTRATION_PROGRESS.NOT_STARTED;

    return REGISTRATION_PROGRESS.UNKNOWN;
}

/**
 * Is `candidate` strictly further along than `current`?
 *
 * Strict on purpose: equal scores mean "no reason to prefer the newcomer", and a
 * merge that overwrites on a tie churns data for nothing.
 */
export function isFurtherAlong(
    candidate: string | undefined | null,
    current: string | undefined | null,
): boolean {
    return registrationProgressScore(candidate) > registrationProgressScore(current);
}
