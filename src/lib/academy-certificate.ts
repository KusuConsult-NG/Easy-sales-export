/**
 * The number on an academy course certificate — one, and the same everywhere.
 *
 * THREE SCHEMES, NONE OF THEM A CREDENTIAL
 * ----------------------------------------
 * A learner who finishes a course sees a certificate number in three places, and
 * they were three different strings:
 *
 *   the page          `ACAD-${new Date().getFullYear()}-${courseId.slice(0,6)}`
 *   the LinkedIn link the same, passed as certId and as /academy/verify/{certId}
 *   the PDF           `CRT-${courseId.slice(0,6)}-${Date.now().toString().slice(9)}`
 *
 * Two problems, and the first is the serious one.
 *
 * IT WAS THE SAME NUMBER FOR EVERYBODY
 * ------------------------------------
 * `ACAD-2026-ABC123` is derived from the course id and the current year alone.
 * Every learner who completed that course in that year was issued the identical
 * number. A certificate number that does not identify the holder is not a
 * credential; it is a course code. Two people showing an employer the "same"
 * certificate is the failure mode.
 *
 * The PDF's variant added `Date.now()` digits, which made it unique per
 * DOWNLOAD instead — the same learner re-downloading got a different number
 * from the one on the page they downloaded it from.
 *
 * AND THE YEAR WAS THE YEAR YOU LOOKED
 * ------------------------------------
 * `new Date().getFullYear()` is evaluated when the page renders. A learner who
 * completed a course in December and opened their certificate in January was
 * shown a number claiming the following year, and the LinkedIn entry they added
 * carried that wrong year as the issue date.
 *
 * WHAT THIS DOES NOT FIX
 * ----------------------
 * Nothing writes a row into COLLECTIONS.CERTIFICATES for an academy COURSE
 * completion — /api/academy/certificate/generate would, and has no caller. So
 * /api/academy/verify/{id} still cannot resolve one of these numbers, and the
 * LinkedIn "verify" link still lands on "Certificate not found". Making the
 * number stable and unique is the prerequisite for persisting it; whether these
 * are issued on completion or on first download is a product decision, not one
 * to make here.
 */

/** Uppercase alphanumerics only, padded so short ids do not collapse. */
function segment(value: string, length: number): string {
    const cleaned = String(value ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return (cleaned + "0".repeat(length)).slice(0, length);
}

/**
 * The certificate number for one learner's completion of one course.
 *
 * Stable: the same learner, course and completion date always produce the same
 * string, so the page, the PDF and the LinkedIn entry agree and a re-download
 * does not mint a new number.
 */
export function academyCertificateNumber(
    userId: string,
    courseId: string,
    completedAt?: Date | null,
): string {
    // The year of COMPLETION. Falling back to the current year only when the
    // record carries no date at all — not on every render.
    //
    // UTC, because "the same everywhere" is this function's whole point and
    // getFullYear() is the SERVER's year. A completion stamped
    // 2025-12-31T23:00:00Z is 2025 on a UTC host and 2026 in Lagos (UTC+1),
    // where this platform's users are — so the number printed on the PDF, shown
    // on the page and pasted into LinkedIn could differ by host or by a
    // deployment region change, for a string that is meant to be an identifier.
    // Derived from the stored instant instead, in a fixed zone.
    // Measured in src/__tests__/tz/, which runs under TZ=Africa/Lagos.
    const year = completedAt instanceof Date && !Number.isNaN(completedAt.getTime())
        ? completedAt.getUTCFullYear()
        : new Date().getUTCFullYear();

    return `ACAD-${year}-${segment(courseId, 6)}-${segment(userId, 6)}`;
}

/**
 * Reads whatever shape the progress record stored its completion date in.
 *
 * The JSONB writer serialises `new Date()` to an ISO string, so a record read
 * back does not necessarily carry a Timestamp with `.toDate()` — the assumption
 * that it does is what makes hand-rolled date coercion in this codebase return
 * the epoch.
 */
export function completionDateOf(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof (value as any)?.toDate === "function") {
        const d = (value as any).toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof (value as any)?.seconds === "number") {
        return new Date((value as any).seconds * 1000);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/**
 * The completion bar a certificate is issued against.
 *
 * The certificate page refuses to render below 100%; the PDF route applied no
 * bar at all. One number, so the download cannot disagree with the screen that
 * offered it.
 */
export const ACADEMY_CERTIFICATE_MIN_PROGRESS = 100;

export function hasEarnedAcademyCertificate(progress: unknown): boolean {
    const percent = Number((progress as any)?.overallProgress);
    return Number.isFinite(percent) && percent >= ACADEMY_CERTIFICATE_MIN_PROGRESS;
}
