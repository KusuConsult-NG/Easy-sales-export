/**
 * @jest-environment node
 */

/**
 *   #430 THE ACADEMY HAD THREE CERTIFICATE SYSTEMS AND HAD NEVER ISSUED A
 *   CERTIFICATE.
 *
 *   Found from a money-arithmetic sweep that came up almost empty. The one
 *   surviving literal was `totalCompletedLessons * 0.5` — "Estimate 30 min per
 *   lesson" — which is not money, and pulling on it opened this.
 *
 *   THREE SYSTEMS, THREE COLLECTIONS, NO CREDENTIAL
 *   ------------------------------------------------
 *     CERTIFICATES         written by /api/academy/certificate/generate; read
 *                          by the PUBLIC VERIFIER and counted by
 *                          /api/academy/dashboard. THE ROUTE HAD NO CALLER.
 *     COURSE_CERTIFICATES  written by generateCourseCertificate, whose only
 *                          caller is CourseProgressCard — which #428 had
 *                          already registered as an orphan — and read by
 *                          getCourseCertificate, which has no caller at all.
 *                          Both ends unreachable.
 *     the number on screen academyCertificateNumber(...), computed at render
 *                          time and stored nowhere.
 *
 *   And the two numbering schemes disagreed: `CERT-{Date.now()}-{uid8}` in one,
 *   `ACAD-{year}-{course}-{user}` on the page the learner actually sees.
 *
 *   So a learner who finished a course was shown a certificate number that
 *   resolved nowhere, and an "Add to LinkedIn" button whose verification link
 *   answered "Certificate not found" — the link being the part a third party is
 *   meant to trust. lib/academy-certificate.ts recorded exactly this and
 *   stopped: "whether these are issued on completion or on first download is a
 *   product decision, not one to make here."
 *
 *   ISSUED ON COMPLETION. That decision is made now, and the reasons are in
 *   lib/academy-certificate-issue's header. One issuer, three doors into it.
 *
 *   AND TWO COUNTERS THAT MEASURED NOTHING
 *   ---------------------------------------
 *   The learner's progress screen showed:
 *
 *       certificatesEarned: completedCourses     "One certificate per completed course"
 *       totalHoursLearned:  completedLessons*0.5 "Estimate 30 min per lesson"
 *
 *   The first is a FOURTH reader of "earned" and the only one that never looks
 *   at a certificate. lib/certificate-kind exists to say which rows may be
 *   counted as earned and names three readers; this was not among them. So the
 *   two academy screens disagreed under one label — the dashboard said 0 for
 *   everybody, this screen said "however many courses you finished".
 *
 *   The second rendered as a bold "12h" beneath a clock icon labelled "Learning
 *   Time". A learner who spent forty hours and one who skimmed saw the same
 *   number. The real measurement existed and was already defended:
 *   updateLessonProgress records lastWatchedSecond and CLAMPS anything faster
 *   than 2x playback as a watch-rate anomaly. Somebody took care that watch
 *   time cannot be inflated, and the screen reporting watch time ignored it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     completion stops issuing the certificate         KILLED
 *     the issuer stops requiring completion            KILLED
 *     the issuer invents a title for a missing course  KILLED
 *     an absent percentage is read as 0%               KILLED
 *     the issuer stops storing the number              KILLED
 *     the verifier stops resolving by number           KILLED
 *     the verifier trusts an uploaded file found by number  KILLED
 *     the progress screen counts courses again         KILLED
 *     the hours figure returns to lessons * 0.5        KILLED
 *     the certificate count stops filtering uploads    KILLED
 *     reword the header prose                          SURVIVED, as intended
 *
 *   TWO OF THOSE SURVIVED THE FIRST RUN, AND BOTH WERE MY GAPS.
 *
 *   "stops storing the number" survived because the assertion matched
 *   `certificateNumber` ANYWHERE in the module — which the progress-record
 *   stamp satisfies on its own. Scoped to the row being written, it dies.
 *
 *   "invents a title" survived because I had not asserted it at all: the
 *   consolidation adopted the route's default of the literal "Course
 *   Completion" where the action refused, which is a regression hidden inside
 *   a refactor. The behaviour suite caught it; the assertion is here now.
 *
 *   WHAT CONSOLIDATING TWO DOORS ACTUALLY COST, RECORDED HONESTLY. Merging
 *   them surfaced four places where they had silently disagreed, and in three
 *   of them my first draft picked the weaker half:
 *
 *     completion rule   route: percentage >= 100 AND completed
 *                       action: completed alone
 *                       → completed is the authority; a recorded percentage
 *                         that contradicts it refuses; an ABSENT one is not
 *                         read as 0% (#245 — an absent value is not a failing
 *                         one), which would have denied legacy rows.
 *     missing course    route: default to "Course Completion"
 *                       action: refuse
 *                       → refuse. A stored, numbered credential naming no
 *                         course is worse than none.
 *     already issued    route: return the deterministic id
 *                       action: return the stamp on the progress record
 *                       → the stamp wins. It names the credential the learner
 *                         was actually given; the minted id might name a row
 *                         that does not exist.
 *     refusal wording   route: "Course not yet completed"
 *                       action: "Course not completed yet"
 *                       → the route's, because it is an asserted public
 *                         response body. One refusal cannot have two strings,
 *                         and each was pinned by its own test.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const ISSUER = 'src/lib/academy-certificate-issue.ts';
const COMPLETE = 'src/app/actions/course-actions.ts';
const GENERATE = 'src/app/api/academy/certificate/generate/route.ts';
const VERIFY = 'src/app/api/academy/verify/[certificateId]/route.ts';
const AGGREGATE = 'src/app/actions/academy/_ac_progress.ts';
const DASHBOARD = 'src/app/api/academy/dashboard/route.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#430 — finishing a course issues the credential', () => {
    it('COMPLETION CALLS THE ISSUER', () => {
        // The whole defect in one assertion: nothing did.
        const src = code(COMPLETE);
        expect(src).toMatch(/issueAcademyCertificate\(session\.user\.id, courseId\)/);
    });

    it('and it does so OUTSIDE the completion transaction', () => {
        // A completion the learner earned — every lesson verified against the
        // per-lesson watch records — must not roll back because a certificate
        // row could not be written. #424's reasoning, same shape.
        const src = code(COMPLETE);
        // Anchored on CODE, not on the "// Audit log" comment beside it —
        // stripComments removes comments, so a comment anchor is an index of
        // -1 and the ordering assertion then measures nothing. That trap has
        // fired repeatedly in this audit; it fired here too, on the first run.
        const insideTx = src.indexOf('transaction.update(progressRef');
        const issue = src.indexOf('issueAcademyCertificate(session.user.id, courseId)');
        // Searched FORWARD from the issue site. A bare indexOf finds an earlier
        // function's audit call — that anchor was wrong on the first run and
        // the ordering assertion passed for the wrong reason.
        const auditAfter = src.indexOf("targetType: 'course'", issue);
        for (const [name, i] of Object.entries({ insideTx, issue, auditAfter })) {
            expect({ name, found: i > -1 }).toEqual({ name, found: true });
        }
        // After the transaction's last statement, before the audit row.
        expect(issue).toBeGreaterThan(insideTx);
        expect(auditAfter).toBeGreaterThan(issue);
        // And a failure is logged, not thrown.
        expect(src).toMatch(/catch \(certificateError\)/);
    });

    it('and the issuer REFUSES a course that is not finished', () => {
        // The hole completeCourse was closed against. An issuer that took the
        // caller's word would reopen it one file over.
        const src = code(ISSUER);
        expect(src).toMatch(/if \(!progress\.completed\) \{/);
        expect(src).toMatch(/status: "refused", reason: "Course not yet completed"/);
    });

    it('and a recorded percentage that CONTRADICTS completion also refuses', () => {
        // `completed: true, 40%` is an inconsistent row. Issuing on it would be
        // taking the more convenient half.
        expect(code(ISSUER)).toMatch(/if \(!Number\.isFinite\(percent\) \|\| percent < 100\)/);
    });

    it('and an ABSENT percentage is not read as 0%', () => {
        /**
         * The two old doors disagreed: the route required
         * completionPercentage >= 100, the action required only `completed`.
         * Adopting `?? 0` would turn "this field was never written" into "0%
         * complete" and deny a credential a legacy row says was earned —
         * #245's rule, an absent value is not a failing one.
         */
        const src = code(ISSUER);
        expect(src).toMatch(/recordedPercent !== undefined && recordedPercent !== null/);
        expect(src).not.toMatch(/progress\.progressPercent \?\? 0/);
    });

    it('and a course that cannot be read REFUSES rather than being given a made-up title', () => {
        /**
         * The two old doors disagreed here too: the route defaulted to the
         * literal "Course Completion", the action refused. The refusal is the
         * right half — these certificates are numbered, stored and shown to
         * third parties, so issuing one that names no course is worse than
         * issuing none. Taking the route's default would have been a regression
         * hidden inside a consolidation; mutation testing put it here after the
         * behaviour suite caught it.
         */
        const src = code(ISSUER);
        expect(src).toMatch(/if \(!courseDoc\.exists \|\| !courseData\?\.title\)/);
        expect(src).toMatch(/status: "missing", reason: "Course not found"/);
        expect(src).not.toMatch(/"Course Completion"/);
    });

    it('and issuing twice returns the SAME credential, not a second one', () => {
        // A deterministic id is what makes this idempotent without a lock —
        // supabaseDb.runTransaction does not take one (#249–#251).
        const src = code(ISSUER);
        expect(src).toMatch(/COLLECTIONS\.CERTIFICATES\)\.doc\(`\$\{userId\}_\$\{courseId\}`\)/);
        expect(src).toMatch(/status: "already"/);
    });

    it('and it marks the row as ISSUED, so an upload cannot pass for one', () => {
        expect(code(ISSUER)).toMatch(/recordType: ACADEMY_CERTIFICATE/);
    });

    it('and the grade comes from the recorded scores, never the caller — #321 still holding', () => {
        expect(code(ISSUER)).toMatch(/grade: courseGradeFromQuizScores\(progress\.quizScores\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#430 — the number the holder was given is the number that resolves', () => {
    it('THE ISSUER STORES THE CERTIFICATE NUMBER', () => {
        // Without this the verifier has nothing to match: the document id is
        // {userId}_{courseId} and the holder has ACAD-{year}-{course}-{user}.
        const src = code(ISSUER);
        expect(src).toMatch(/const certificateNumber = academyCertificateNumber\(userId, courseId, completedAt\)/);
        /**
         * Scoped to the CERTIFICATE ROW, not the file.
         *
         * The first draft asserted `/certificateNumber,/` anywhere in the
         * module — which the progress-record stamp satisfies on its own, so
         * deleting the field from the row being written SURVIVED. Mutation
         * testing caught it. Without the number on the row, the verifier's
         * lookup above can never match and the whole chain is decorative.
         */
        const write = src.slice(src.indexOf('certificateRef.set({'));
        const payload = write.slice(0, write.indexOf('});'));
        expect(payload).toMatch(/^\s*certificateNumber,\s*$/m);
    });

    it('and the PUBLIC VERIFIER resolves by that number', () => {
        expect(code(VERIFY)).toMatch(
            /\.where\("certificateNumber", "==", certificateId\)/);
    });

    it('and a row found BY NUMBER is checked exactly as one found by id', () => {
        /**
         * The gap a number lookup could open. isIssuedCertificate is what stops
         * a PDF somebody attached to their own profile from being publicly
         * vouched for, and a second lookup path that skipped it would reopen
         * that hole through the new door.
         */
        const src = code(VERIFY);
        const numbered = src.slice(src.indexOf('certificateNumber", "=='));
        const guardInBranch = numbered.slice(0, numbered.indexOf('if (!certificateDoc.exists && !waveDoc'));
        expect(guardInBranch).toMatch(/isIssuedCertificate\(numberedData\)/);
    });

    it('and the number is taken from the completion date, not from today — #82 still holding', () => {
        expect(code(ISSUER)).toMatch(/completionDateOf\(progress\.completedAt\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#430 — one issuer, not a copy per door', () => {
    it('THE GENERATE ROUTE DELEGATES RATHER THAN KEEPING ITS OWN COPY', () => {
        const src = code(GENERATE);
        expect(src).toMatch(/issueAcademyCertificate\(session\.user\.id, courseId\)/);
        // The body that used to live here must be gone, not duplicated.
        expect(src).not.toMatch(/recordType: ACADEMY_CERTIFICATE/);
        expect(src).not.toMatch(/courseGradeFromQuizScores/);
    });

    it('and the second action delegates too, instead of writing a dead collection', () => {
        const src = code(COMPLETE);
        // generateCourseCertificate wrote COURSE_CERTIFICATES, which the
        // verifier does not read and the dashboard does not count.
        const fn = src.slice(src.indexOf('export async function generateCourseCertificate'));
        const body = fn.slice(0, fn.indexOf('export async function getCourseCertificate'));
        expect(body).toMatch(/issueAcademyCertificate\(session\.user\.id, courseId\)/);
        expect(body).not.toMatch(/COURSE_CERTIFICATES\)\.add\(/);
        // And the notification, the one part of that path that was right, stays.
        expect(body).toMatch(/Certificate Issued!/);
    });

    it('and there is exactly ONE place that writes an academy certificate row', () => {
        // The count that makes "the fix reaches one of N copies" fail here
        // rather than in production.
        for (const f of [GENERATE, COMPLETE]) {
            expect({ f, writes: /COLLECTIONS\.CERTIFICATES\)\.doc\([^)]*\)\.set\(/.test(code(f)) })
                .toEqual({ f, writes: false });
        }
        expect(code(ISSUER)).toMatch(/certificateRef\.set\(/);
    });

    it('and the audit entry carries the number the document actually has', () => {
        // It was built from a second Date.now(), so the two disagreed by
        // however many milliseconds separated them.
        const src = code(COMPLETE);
        expect(src).toMatch(/certificateNumber: result\.certificateNumber/);
        expect(src).not.toMatch(/`CERT-\$\{Date\.now\(\)\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#430 — the two counters measure something', () => {
    it('CERTIFICATES EARNED COUNTS ISSUED ROWS, NOT COMPLETED COURSES', () => {
        const src = code(AGGREGATE);
        expect(src).not.toMatch(/certificatesEarned: completedCourses/);
        expect(src).toMatch(/isIssuedCertificate\(d\.data\(\)\)/);
    });

    it('and it agrees with the OTHER screen, which already counted them properly', () => {
        // The two academy screens disagreed under one label. Both now filter
        // the same way, through the same predicate.
        expect(code(DASHBOARD)).toMatch(/isIssuedCertificate\(doc\.data\(\)\)/);
        expect(code(AGGREGATE)).toMatch(/isIssuedCertificate\(/);
    });

    it('and LEARNING TIME comes from recorded watch seconds', () => {
        const src = code(AGGREGATE);
        expect(src).not.toMatch(/totalCompletedLessons \* 0\.5/);
        expect(src).toMatch(/COLLECTIONS\.LESSON_VIDEO_PROGRESS/);
        expect(src).toMatch(/lastWatchedSecond/);
        expect(src).toMatch(/totalHoursLearned = seconds \/ 3600/);
    });

    it('and an unreadable watch figure contributes 0, never NaN', () => {
        // "NaNh" under a clock icon is the failure this prevents.
        expect(code(AGGREGATE)).toMatch(/Number\.isFinite\(watched\) && watched > 0 \? watched : 0/);
    });

    it('and neither counter turns "could not read" into a figure — #313', () => {
        const src = code(AGGREGATE);
        expect(src).toMatch(/could not count certificates/);
        expect(src).toMatch(/could not total watch time/);
    });

    it('and the premise holds — watch seconds really are recorded, and guarded', () => {
        /**
         * If updateLessonProgress ever stops recording lastWatchedSecond, the
         * hours figure becomes 0 for everybody and this rule should be re-read
         * rather than silently kept. The clamp is asserted too: it is the
         * reason this figure can be trusted at all.
         */
        const src = code(COMPLETE);
        expect(src).toMatch(/lastWatchedSecond/);
        expect(src).toMatch(/maxSpeedMultiplier = 2\.0/);
        expect(src).toMatch(/finalLastWatchedSecond = \(existing\?\.lastWatchedSecond \|\| 0\) \+ maxAllowedIncrease/);
    });
});
