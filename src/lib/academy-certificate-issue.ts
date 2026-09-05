import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ACADEMY_CERTIFICATE } from "@/lib/certificate-kind";
import { courseGradeFromQuizScores } from "@/lib/academy-grading";
import { academyCertificateNumber, completionDateOf } from "@/lib/academy-certificate";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";

/**
 * Issuing an academy course certificate — once, from one place.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * #430. The academy has never issued a certificate.
 *
 * /api/academy/certificate/generate does everything correctly — it verifies
 * completion against the progress record, computes the grade from the recorded
 * per-module scores rather than from the caller (#321), marks the row as an
 * issued credential rather than an attached file (certificate-kind), and keys
 * the document on (userId, courseId) so a concurrent second call is idempotent
 * instead of minting a duplicate credential.
 *
 * NOTHING CALLS IT. Not the completion action, not the certificate page, not
 * the PDF route. So COLLECTIONS.CERTIFICATES has never held an academy course
 * certificate, and three things followed from that:
 *
 *   - /api/academy/dashboard reports `certificatesEarned: certificates.length`,
 *     which is structurally 0 for every learner who ever finished a course.
 *   - /api/academy/verify/{id} — the public verifier, the endpoint a third
 *     party is meant to trust — has nothing to resolve, so the "Add to
 *     LinkedIn" button on the certificate page produces an entry whose
 *     verification link answers "Certificate not found".
 *   - the learner's own certificates list had nothing to list, which #425
 *     worked around by reading completion records instead.
 *
 * lib/academy-certificate.ts recorded this and stopped short of it: "whether
 * these are issued on completion or on first download is a product decision,
 * not one to make here."
 *
 * ISSUED ON COMPLETION. That decision is made here, and the reasons are:
 *
 *   - the certificates LIST (#425) already reads completion, so issuing at
 *     completion makes the row, the list and the number agree instead of
 *     describing the same event from three stores;
 *   - a credential that exists only once its holder happens to open a page is
 *     not a record the platform keeps, and the verifier needs a row to exist
 *     before anybody asks about it, not after;
 *   - download then becomes a pure render of something already issued, which is
 *     what the PDF route and the page already assume when they compute the
 *     number themselves.
 *
 * THE NUMBER IS STORED, WHICH IS WHAT MAKES VERIFICATION POSSIBLE. The learner
 * is shown `ACAD-{year}-{course}-{user}` and the LinkedIn entry carries it, but
 * the document id is `{userId}_{courseId}`. Verifying by the number a holder
 * actually has therefore needs the number ON the row — otherwise issuing the
 * certificate would fix the count and leave the link 404ing exactly as before,
 * which is this repository's signature failure: the fix reaching one of the
 * places that needed it.
 *
 * NOTHING IS DELETED OR OVERWRITTEN. The write is a merge onto a deterministic
 * id, so re-running it on a learner who already holds a certificate returns the
 * existing one rather than re-minting it with a new grade or date.
 */

export type IssueOutcome =
    | { status: "issued"; certificateId: string; certificateNumber: string }
    | { status: "already"; certificateId: string; certificateNumber: string }
    // `missing` is the record's fault (no such progress row, no such user) and
    // `refused` the caller's (not finished yet). Kept apart because the HTTP
    // door answers 404 for one and 400 for the other, and a test pinned that
    // distinction deliberately. Collapsing them would have been a behaviour
    // change smuggled in under a refactor.
    | { status: "missing"; reason: string }
    | { status: "refused"; reason: string };

/**
 * Issue the certificate for one learner's completion of one course.
 *
 * Refuses rather than issuing when completion cannot be confirmed from the
 * stored record. It never takes the caller's word for completion — that is
 * exactly the hole completeCourse was closed against, and an endpoint that
 * issued a credential on request would reopen it one file over.
 */
export async function issueAcademyCertificate(
    userId: string,
    courseId: string,
): Promise<IssueOutcome> {
    if (!userId || !courseId) return { status: "missing", reason: "Missing learner or course" };

    const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${userId}_${courseId}`);
    const progressDoc = await progressRef.get();
    if (!progressDoc.exists) return { status: "missing", reason: "Course progress not found" };

    const progress = progressDoc.data();
    if (!progress) return { status: "missing", reason: "Course progress data is corrupted" };

    /**
     * `completed` is the authority; the percentage is a cross-check only when
     * the row carries one.
     *
     * The two old doors disagreed. The route required
     * `completionPercentage >= 100 && completed`; the action required only
     * `completed`. Taking the route's rule wholesale would refuse any row that
     * records completion without a percentage — which is what
     * `completionPercentage ?? 0` does to a legacy row, turning "this field was
     * never written" into "0% complete" and denying a credential somebody
     * earned. #245's rule: an absent value is not a failing one.
     *
     * So: not completed, refuse. Completed but carrying a percentage that
     * contradicts it, refuse — a row saying `completed: true, 40%` is
     * inconsistent and issuing on it would be taking the more convenient half.
     * Completed with no percentage recorded, issue.
     */
    if (!progress.completed) {
        return { status: "refused", reason: "Course not yet completed" };
    }
    const recordedPercent = progress.completionPercentage ?? progress.progressPercent;
    if (recordedPercent !== undefined && recordedPercent !== null) {
        const percent = Number(recordedPercent);
        if (!Number.isFinite(percent) || percent < 100) {
            return { status: "refused", reason: "Course not yet completed" };
        }
    }

    const completedAt = completionDateOf(progress.completedAt);
    const certificateNumber = academyCertificateNumber(userId, courseId, completedAt);
    const certificateRef = db.collection(COLLECTIONS.CERTIFICATES).doc(`${userId}_${courseId}`);

    // ALREADY HELD — and the STAMP WINS when there is one.
    //
    // A progress record carrying a certificateId names the credential this
    // learner was actually given, which may sit at an auto-generated id from
    // before the deterministic key. Returning the id this function would mint
    // instead could hand back a row that does not exist. The old route read the
    // stamp first and a test pinned that; it is kept.
    if (progress.certificateId) {
        return {
            status: "already",
            certificateId: String(progress.certificateId),
            certificateNumber: String(progress.certificateNumber || certificateNumber),
        };
    }

    // No stamp, but the row may still be there — the stamp and the row are two
    // writes, and a run that wrote one and failed before the other must repair
    // rather than report a credential that is not there.
    const existing = await certificateRef.get();
    if (existing.exists) {
        // Put the stamp back. This is what makes a half-finished earlier run
        // self-heal rather than staying invisible to every reader of the
        // progress record.
        try {
            await progressRef.update({
                certificateId: certificateRef.id,
                certificateNumber,
                updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (stampError) {
            logger.warn("[issueAcademyCertificate] could not restore the progress stamp", {
                userId, courseId, error: String(stampError),
            });
        }
        return {
            status: "already",
            certificateId: certificateRef.id,
            certificateNumber: String(existing.data()?.certificateNumber || certificateNumber),
        };
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const userData = userDoc.data();
    if (!userDoc.exists || !userData) return { status: "missing", reason: "User not found" };

    /**
     * A COURSE THAT CANNOT BE READ REFUSES, rather than being certified under
     * an invented title.
     *
     * The route defaulted to the literal "Course Completion" when the course
     * document was missing; the action refused. The refusal is the right half
     * and a test pinned it: these certificates are numbered, stored and shown
     * to third parties, so issuing one that names no course is worse than
     * issuing none. Taking the route's default here would have been a
     * regression hidden inside a consolidation.
     */
    const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
    const courseData = courseDoc.data();
    if (!courseDoc.exists || !courseData?.title) {
        return { status: "missing", reason: "Course not found" };
    }
    const courseTitle = courseData.title;

    await certificateRef.set({
        // Distinguishes this from a file the user attached to their own
        // profile. Both live in this collection; only this kind may be publicly
        // verified or counted as earned. See lib/certificate-kind.
        recordType: ACADEMY_CERTIFICATE,
        userId,
        userName: userData.name || userData.email,
        courseId,
        courseTitle,
        // The number the holder is shown, so the public verifier can resolve
        // what a third party is actually given.
        certificateNumber,
        completionDate: progress.completedAt || FieldValue.serverTimestamp(),
        // Computed from the recorded per-module scores, in the module that
        // decides what a score means — never from the caller (#321).
        grade: courseGradeFromQuizScores(progress.quizScores),
        issuedAt: FieldValue.serverTimestamp(),
        qrCodeUrl: "",
        pdfUrl: "",
    });

    await progressRef.update({
        certificateId: certificateRef.id,
        certificateNumber,
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { status: "issued", certificateId: certificateRef.id, certificateNumber };
}
