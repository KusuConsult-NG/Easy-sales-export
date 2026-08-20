/**
 * Who may join WAVE — one definition.
 *
 * WHY THIS EXISTS
 * ---------------
 * WAVE is a programme for women, so "may this account enrol?" is an access rule
 * with a protected characteristic in it. It was implemented FOUR times:
 *
 *   _wv_membership.ts        _checkWaveEligibilityAction
 *   api/wave/check-eligibility/route.ts
 *                            an exact hand-copy of the above, down to the
 *                            CUTOFF_DATE literal
 *   _wv_applications.ts      _submitMultiStepWaveApplicationAction — a SHORTER
 *                            rule with no cutoff at all
 *   briefing.ts              a third shape, on a different input (see below)
 *
 * THE DIVERGENCE THAT MATTERED
 * ----------------------------
 * The first two block a male account created on or after the cutoff EVEN IF it
 * holds `wave_participant` or a wave registration. The submit action's rule
 * exempts anyone holding either, with no date test at all. So for a male account
 * registered after the cutoff that has somehow acquired the role:
 *
 *   /wave/application (the page)     says NOT eligible
 *   /api/wave/check-eligibility      says NOT eligible
 *   submitMultiStepWaveApplication   ACCEPTS the application
 *
 * A gate refusing what the action behind it allows is the worst arrangement of
 * the two: the screen looks closed, and the server action is reachable directly
 * regardless of what the screen shows.
 *
 * WHICH BEHAVIOUR IS CANONICAL, AND WHY
 * -------------------------------------
 * The stricter one — the cutoff applies. That is what the cutoff is evidently
 * for: a male account created after the date the programme closed to new male
 * participants cannot have a legitimate pre-existing claim, because there was no
 * pre-existing anything. Adopting it changes only the submit path, and tightens
 * it toward what three of the four call sites already enforced.
 *
 * WHY briefing.ts IS NOT CONVERTED
 * --------------------------------
 * It answers a different question against a different input: whether a
 * SUBMITTED form value describes a woman, for a caller who may not be logged in
 * and may have no profile at all. This function takes an account. Forcing one
 * function to cover both would mean inventing a null-account path, which is how
 * a rule ends up with branches nobody can reason about. Its string handling is
 * shared instead, through `describesAWoman`.
 */

/** The date WAVE closed to new male participants. */
export const WAVE_MALE_CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");

/**
 * Does this gender value describe a woman?
 *
 * Shared so the three spellings live rows hold — "Female" from the application
 * and briefing paths, "female" from registration, and the empty string — are read
 * the same way everywhere. An unrecognised or absent value is NOT a woman and is
 * also not a man; callers decide what to do with that, and none of them may treat
 * it as either.
 */
export function describesAWoman(gender: unknown): boolean {
    return typeof gender === "string" && gender.trim().toLowerCase() === "female";
}

/** Does this gender value describe a man? */
export function describesAMan(gender: unknown): boolean {
    return typeof gender === "string" && gender.trim().toLowerCase() === "male";
}

export interface WaveEligibility {
    eligible: boolean;
    /** Present when not eligible; safe to show a user. */
    reason?: string;
}

/**
 * Decides eligibility from a user document.
 *
 * Takes the document rather than the fields so a call site cannot pick out three
 * of the five inputs and get a subtly different answer — which is how the copies
 * drifted in the first place.
 */
export function checkWaveEligibility(userData: Record<string, any> | null | undefined): WaveEligibility {
    if (!userData) {
        return { eligible: false, reason: "User profile not found" };
    }

    const roles: string[] = Array.isArray(userData.roles) ? userData.roles : [];
    const isUserAdmin = roles.includes("admin") || roles.includes("super_admin");

    const academyReg = userData.serviceRegistrations?.academy;
    const isAcademyElite =
        academyReg?.plan === "elite" &&
        (academyReg?.status === "approved" || academyReg?.status === "active");

    // Admins and Academy Elite members are eligible regardless. Checked first so
    // the reasoning below is only about ordinary accounts.
    if (isUserAdmin || isAcademyElite) {
        return { eligible: true };
    }

    if (!describesAMan(userData.gender)) {
        // Female, or not recorded. Not recorded is admitted, which is the existing
        // behaviour of all four copies: the programme collects gender during
        // application and the block exists to stop men enrolling, not to refuse
        // anyone whose profile is incomplete.
        return { eligible: true };
    }

    const hasWaveRole = roles.includes("wave_participant");
    const hasWaveReg = userData.serviceRegistrations?.wave?.status !== undefined;

    if (registeredOnOrAfterCutoff(userData.createdAt)) {
        // The cutoff wins over a pre-existing role, because an account created
        // after the cutoff cannot have a pre-existing anything. The submit path
        // did not apply this and so accepted applications its own page refused.
        return {
            eligible: false,
            reason: "WAVE program is exclusively for women entrepreneurs",
        };
    }

    if (!hasWaveRole && !hasWaveReg) {
        return {
            eligible: false,
            reason: "WAVE program is exclusively for women entrepreneurs",
        };
    }

    // A male account from before the cutoff that already holds WAVE access keeps
    // it. Removing access from existing participants is not this function's call.
    return { eligible: true };
}

/**
 * Was the account created on or after the cutoff?
 *
 * Handles the four shapes `createdAt` arrives in — Timestamp, admin Timestamp,
 * seconds object, string — because the copies each handled a different subset and
 * a shape one of them missed silently answered "before the cutoff", which is the
 * permissive direction.
 */
function registeredOnOrAfterCutoff(createdAt: unknown): boolean {
    if (!createdAt) return false;

    let date: Date | null = null;
    const raw = createdAt as any;

    if (typeof raw.toDate === "function") {
        date = raw.toDate();
    } else if (typeof raw.seconds === "number") {
        date = new Date(raw.seconds * 1000);
    } else if (typeof raw._seconds === "number") {
        date = new Date(raw._seconds * 1000);
    } else {
        const parsed = new Date(raw);
        date = Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (!date || Number.isNaN(date.getTime())) return false;
    return date >= WAVE_MALE_CUTOFF_DATE;
}
