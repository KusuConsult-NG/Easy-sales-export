"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { gradeModuleQuiz } from "@/lib/academy-grading";
import { isIssuedCertificate } from "@/lib/certificate-kind";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Course, Lesson, Quiz, UserProgress } from "@/lib/types/academy-actions";

/**
 * Mark lesson as complete
 */
async function _completeLessonAction(
    userId: string,
    courseId: string,
    lessonId: string,
    expectedVersion?: number
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course", data: null };
        }

        /**
         *   #283 COMPLETION IS SELF-REPORTED, AND THIS FILE USED TO SAY THE
         *        OPPOSITE.
         *
         *        A 24-line "watch to complete" gate sat here under a padlocked
         *        SECURITY FIX banner — entirely inside a block comment,
         *        disabled, annotated as bypassed for self-paced manual
         *        completion, with three unresolved authoring questions left in
         *        it. A reader saw a security banner and a check; neither ran.
         *        That is #314's shape exactly: a file named for a control it
         *        does not perform.
         *
         *        The banner and the refusal messages are DESCRIBED rather than
         *        quoted here. Reproducing them would put the exact strings back
         *        in the file, and the test that proves they are gone reads the
         *        raw text — the tombstone trap, which this audit has now walked
         *        into more than a dozen times.
         *
         *        AND IT IS NOT ENFORCED IN THE BROWSER EITHER. handleMarkComplete
         *        in the lesson page calls this action unconditionally, with no
         *        watch check of any kind. The rule is enforced NOWHERE, which is
         *        a correction to how this was first recorded.
         *
         *   THE DECISION: SELF-PACED STAYS, AND THE EVIDENCE IS RECORDED.
         *
         *        Re-enabling the gate would refuse completion to every learner
         *        whose video-progress row is missing — every lesson completed
         *        before that pipeline existed, anyone on a connection too poor
         *        to stream, anyone whose heartbeat dropped. On a live platform
         *        that is a lockout, and the bypass was a deliberate product
         *        choice with a stated reason.
         *
         *        But a self-report presented as a verified fact is the defect
         *        #321 fixed for certificate grades. So completion now CARRIES
         *        the watch figure it was measured against: `watchedPercentAt
         *        Completion` on the progress row, and `selfReported` when there
         *        is no measurement at all. Nobody is refused, nothing is
         *        pretended, and an admin can see a lesson completed on 4% watched.
         *
         *        This also stops the watch data being write-only.
         *        updateLessonProgress already clamps it against a watch-rate
         *        anomaly (2.0x playback + 10s grace) so a client cannot
         *        fast-forward the counter — a real, working control whose output
         *        nothing read.
         *
         *        WHAT WOULD BE NEEDED TO ENFORCE IT, stated so the next person
         *        does not re-derive it: a per-course flag, so the rule applies
         *        to courses authored under it rather than retroactively to
         *        every learner mid-course.
         */
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found", data: null };

        const course = courseDoc.data() as Course;
        let targetLesson: Lesson | null = null;

        // Find the lesson
        for (const mod of course.modules) {
            const found = mod.lessons.find(l => l.id === lessonId);
            if (found) {
                targetLesson = found;
                break;
            }
        }

        if (!targetLesson) return { success: false as const, error: "Lesson not found", data: null };

        /**
         * #283 — what the learner had actually watched when they marked it
         * complete. Read, never enforced; see the note above.
         *
         * A lesson with no video has nothing to measure, so it records nothing
         * rather than a misleading 0. A read failure is left undefined for the
         * same reason it is not a refusal here: "we could not measure" is not
         * "they watched none of it" (#313).
         */
        let watchedPercent: number | undefined;
        if (targetLesson.videoUrl) {
            try {
                const videoProgressDoc = await db
                    .collection(COLLECTIONS.LESSON_VIDEO_PROGRESS)
                    .doc(`${userId}_${lessonId}`)
                    .get();
                const percent = Number(videoProgressDoc.data()?.progressPercent);
                if (Number.isFinite(percent)) watchedPercent = Math.round(percent);
            } catch (readError) {
                logger.warn("[completeLesson] could not read watch progress", {
                    userId, lessonId, error: String(readError),
                });
            }
        }

        // Use transaction to prevent concurrent lesson completions from overwriting each other
        await db.runTransaction(async (t) => {
            const tProgressDoc = await t.get(progressRef);
            if (!tProgressDoc.exists) throw new Error("Not enrolled");
            const progress = tProgressDoc.data() as UserProgress;

            if (!progress.completedLessons.includes(lessonId)) {
                // Concurrency Guard: Optimistic Locking
                if (expectedVersion !== undefined && progress._version !== undefined && progress._version !== expectedVersion) {
                    throw new Error("STALE_DATA: Progress has been updated elsewhere.");
                }

                progress.completedLessons.push(lessonId);
                progress.lastAccessedAt = FieldValue.serverTimestamp();

                /**
                 * #283 — the completion carries what it was measured against.
                 * `selfReported` when there was nothing to measure, so a reader
                 * can tell an unmeasured completion from an unwatched one; the
                 * two are different and collapsing them is what made this look
                 * enforced in the first place.
                 */
                const evidence = (progress as any).lessonWatchEvidence ?? {};
                evidence[lessonId] = watchedPercent === undefined
                    ? { selfReported: true }
                    : { selfReported: true, watchedPercentAtCompletion: watchedPercent };
                (progress as any).lessonWatchEvidence = evidence;

                // Calculate overall progress using weighted formula (70% Lessons, 30% Quizzes)
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                const lessonProgressPercent = totalLessons > 0 ? (progress.completedLessons.length / totalLessons) * 100 : 0;

                const modulesWithQuizzes = course.modules.filter(m => m.quiz);
                const totalQuizzes = modulesWithQuizzes.length;
                let passedQuizzesCount = 0;
                modulesWithQuizzes.forEach(m => {
                    if (progress.completedModules?.includes(m.id)) {
                        passedQuizzesCount++;
                    }
                });
                const quizProgressPercent = totalQuizzes > 0 ? (passedQuizzesCount / totalQuizzes) * 100 : 0;

                let overallProgress = 0;
                if (totalQuizzes > 0) {
                    overallProgress = Math.round((lessonProgressPercent * 0.7) + (quizProgressPercent * 0.3));
                } else {
                    overallProgress = Math.round(lessonProgressPercent);
                }
                progress.overallProgress = overallProgress;

                // Check if course is complete
                if (overallProgress >= 100) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }

                // Increment version
                progress._version = (progress._version || 0) + 1;

                t.set(progressRef, progress);
            }
        });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Lesson completion error:", {
            userId,
            courseId,
            lessonId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to mark lesson as complete", data: null };
    }
}


export const completeLessonAction = withFlexibleSafeAction("completeLessonAction", _completeLessonAction);


/**
 * Submit quiz score
 */
/**
 * Submit quiz ANSWERS. The score is computed here.
 *
 * This took `score: number` and stored it. Being a "use server" export it is a
 * reachable endpoint regardless of the UI, so
 * submitQuizScoreAction(me, course, module, 100) was a passing grade on any
 * module without a quiz being involved at all — and the browser was computing
 * the number anyway, against an answer key the course loader had sent it.
 *
 * Answers are graded by the shared helper in @/lib/academy-grading, which is
 * also what the API-route path uses, so the two cannot disagree about what a
 * pass is.
 */
async function _submitQuizScoreAction(
    userId: string,
    courseId: string,
    moduleId: string,
    answers: Record<string, number>,
    expectedVersion?: number
): Promise<ActionResponse<{ passed: boolean; score: number; results: Record<string, boolean> }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course", data: null };
        }

        let userPassed = false;
        let score = 0;
        let results: Record<string, boolean> = {};
        await db.runTransaction(async (t) => {
            const tProgressDoc = await t.get(progressRef);
            if (!tProgressDoc.exists) throw new Error("Not enrolled");
            const progress = tProgressDoc.data() as UserProgress;

            // Concurrency Guard: Optimistic Locking
            if (expectedVersion !== undefined && progress._version !== undefined && progress._version !== expectedVersion) {
                throw new Error("STALE_DATA: Progress has been updated elsewhere.");
            }

            progress.lastAccessedAt = FieldValue.serverTimestamp();

            // Check if module is complete (quiz passed)
            const academyCourseDoc = await t.get(db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId));
            if (academyCourseDoc.exists) {
                const course = academyCourseDoc.data() as Course;
                const courseModule = course.modules?.find((m) => m.id === moduleId);

                // Graded from the stored questions, inside the transaction that
                // reads them, so the quiz being scored is the quiz that exists.
                const passingScore = courseModule?.quiz?.passingScore ?? 95;
                const graded = gradeModuleQuiz(
                    (courseModule?.quiz?.questions ?? []) as any[],
                    answers ?? {},
                    passingScore
                );
                score = graded.scorePercentage;
                results = graded.results;

                progress.quizScores = progress.quizScores || {};
                progress.quizScores[moduleId] = score;

                if (!progress.completedModules) progress.completedModules = [];

                if (courseModule?.quiz && graded.passed) {
                    if (!progress.completedModules.includes(moduleId)) {
                        progress.completedModules.push(moduleId);
                    }
                    userPassed = true;
                }

                // Calculate overall progress using weighted formula (70% Lessons, 30% Quizzes)
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                const lessonProgressPercent = totalLessons > 0 ? (progress.completedLessons.length / totalLessons) * 100 : 0;

                const modulesWithQuizzes = course.modules.filter(m => m.quiz);
                const totalQuizzes = modulesWithQuizzes.length;
                let passedQuizzesCount = 0;
                modulesWithQuizzes.forEach(m => {
                    if (progress.completedModules?.includes(m.id)) {
                        passedQuizzesCount++;
                    }
                });
                const quizProgressPercent = totalQuizzes > 0 ? (passedQuizzesCount / totalQuizzes) * 100 : 0;

                let overallProgress = 0;
                if (totalQuizzes > 0) {
                    overallProgress = Math.round((lessonProgressPercent * 0.7) + (quizProgressPercent * 0.3));
                } else {
                    overallProgress = Math.round(lessonProgressPercent);
                }
                progress.overallProgress = overallProgress;

                // Check if course is complete
                if (overallProgress >= 100) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }
            }
            // Increment version
            progress._version = (progress._version || 0) + 1;

            t.set(progressRef, progress);
        });

        return { success: true, error: null, data: { passed: userPassed, score, results } };
    } catch (error) {
        logger.error("Quiz submission error:", {
            userId,
            courseId,
            moduleId,
            // The score is computed inside the transaction now, so there is
            // none to log when the transaction is what failed. The count of
            // answers is the useful thing.
            answerCount: Object.keys(answers ?? {}).length,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to submit quiz", data: null };
    }
}


export const submitQuizScoreAction = withFlexibleSafeAction("submitQuizScoreAction", _submitQuizScoreAction);


/**
 * Get user progress
 */
async function _getUserProgressAction(
    userId: string,
    courseId: string
): Promise<ActionResponse<any>> {
    try {
        // Whose progress this is, decided by the session and not by the caller.
        //
        // This function had no session check of any kind. It is a "use server"
        // export re-exported through academy/index.ts, so it is a reachable HTTP
        // endpoint whatever the UI does — and it took the user id as its first
        // argument. getUserProgressAction(anyone, anyCourse) returned that
        // learner's completed lessons, their quiz SCORES and their completion
        // date, to an unauthenticated caller.
        //
        // Its five siblings in this file all check `session.user.id !== userId`.
        // It was the one that did not, and it was parked in
        // action-auth-baseline.json — whose own header says that list is a
        // ratchet and "must never become a place to park things quietly".
        //
        // All eight call sites already pass session.user.id, so nothing
        // legitimate changes.
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const progressDoc = await db.doc(`user_progress/${userId}/courses/${courseId}`).get();

        if (!progressDoc.exists) {
            return { success: true, error: null, data: null };
        }

        const data = progressDoc.data();
        return { success: true, error: null, data: serializeValue(data) };
    } catch (error) {
        logger.error("Failed to fetch progress:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Fetch failed", data: null };
    }
}


export const getUserProgressAction = withFlexibleSafeAction("getUserProgressAction", _getUserProgressAction);


/**
 * Get user's aggregate progress across all courses
 */
async function _getUserAggregateProgressAction(userId: string): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return {
                error: "Action failed", success: false as const, data: null };
        }

        // Fetch all course progress records
        const progressQuery = db.collection(`user_progress/${userId}/courses`);
        const snapshot = await progressQuery.get();
        const enrolledCourses = snapshot.docs.map(doc => doc.data() as UserProgress);

        const completedCourses = enrolledCourses.filter(p => p.completedAt).length;
        const inProgressCourses = enrolledCourses.filter(p => !p.completedAt && (p.completedLessons?.length || 0) > 0).length;
        const totalCompletedLessons = enrolledCourses.reduce((sum, p) => sum + p.completedLessons.length, 0);

        // Calculate total lessons: batch all course reads in parallel (N+1 → 1 burst)
        const courseSnapshots = await Promise.all(
            enrolledCourses.map(p =>
                db.collection(COLLECTIONS.ACADEMY_COURSES).doc(p.courseId).get()
            )
        );
        let totalLessons = 0;
        for (const courseDoc of courseSnapshots) {
            if (courseDoc.exists) {
                const course = courseDoc.data() as Course;
                totalLessons += course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
            }
        }

        const overallProgress = totalLessons > 0 ? Math.round((totalCompletedLessons / totalLessons) * 100) : 0;

        /**
         *   #430 — TWO FIGURES ON THIS SCREEN WERE INVENTED, NOT MEASURED.
         *
         *   CERTIFICATES. This read `certificatesEarned: completedCourses`,
         *   commented "One certificate per completed course". That is a fourth
         *   reader of "earned", and the only one that never looks at a
         *   certificate: /api/academy/dashboard counts issued rows, the public
         *   verifier resolves them, and certificate-kind exists precisely to
         *   say which rows may be COUNTED AS EARNED. That rule named three
         *   readers and this was not one of them — the fix reaching all but one
         *   copy, again.
         *
         *   The two screens therefore disagreed under one label: /academy/
         *   dashboard said 0 for everybody (nothing issued certificates until
         *   #430), and this screen said "however many courses you finished".
         *
         *   LEARNING TIME. `totalCompletedLessons * 0.5`, commented "Estimate 30
         *   min per lesson", rendered as a bold "12h" under a clock icon
         *   labelled "Learning Time". A learner who spent forty hours and one
         *   who skimmed saw the same number, and neither number came from
         *   anything either of them did.
         *
         *   The real measurement was already there and already defended:
         *   updateLessonProgress records lastWatchedSecond per lesson and
         *   CLAMPS anything faster than 2x playback as a watch-rate anomaly.
         *   Somebody took care that watch time cannot be inflated, and the
         *   screen reporting watch time ignored it. #283's shape — a figure
         *   presented as measured that nothing measures.
         *
         *   Both now come from stored records, and both fail to 0 rather than
         *   to a guess when they cannot be read: "we could not measure" must
         *   not be dressed up as a measurement (#313).
         */
        let certificatesEarned = 0;
        try {
            const certSnapshot = await db.collection(COLLECTIONS.CERTIFICATES)
                .where("userId", "==", userId)
                .get();
            // Only credentials the platform issued. A file the learner attached
            // to their own profile lives in this collection too, and counting
            // it would let anybody inflate their own figure by uploading a PDF.
            certificatesEarned = certSnapshot.docs.filter((d) => isIssuedCertificate(d.data())).length;
        } catch (certError) {
            logger.warn("[aggregateProgress] could not count certificates", {
                userId, error: String(certError),
            });
        }

        let totalHoursLearned = 0;
        try {
            const watchSnapshot = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS)
                .where("userId", "==", userId)
                .get();
            const seconds = watchSnapshot.docs.reduce((sum, d) => {
                const watched = Number(d.data()?.lastWatchedSecond);
                // A row whose figure is unreadable contributes nothing rather
                // than NaN, which would render as "NaNh".
                return sum + (Number.isFinite(watched) && watched > 0 ? watched : 0);
            }, 0);
            totalHoursLearned = seconds / 3600;
        } catch (watchError) {
            logger.warn("[aggregateProgress] could not total watch time", {
                userId, error: String(watchError),
            });
        }

        return {
            error: null, success: true as const,
            data: {
                totalCourses: enrolledCourses.length,
                completedCourses,
                inProgressCourses,
                totalHoursLearned,
                certificatesEarned,
                totalLessons,
                completedLessons: totalCompletedLessons,
                overallProgress,
                enrolledCourses: serializeValue(enrolledCourses),
            }
        };
    } catch (error) {
        logger.error("Failed to fetch aggregate progress:", {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            success: false as const,
            error: error instanceof Error ? error.message : "Fetch failed",
            data: null
        };
    }
}


export const getUserAggregateProgressAction = withFlexibleSafeAction("getUserAggregateProgressAction", _getUserAggregateProgressAction);


// ============================================================================
// LEARNING STREAK TRACKING
// ============================================================================

/**
 * Record that the current user completed at least one lesson today.
 * Call this whenever a lesson is marked complete.
 * Collection: user_activity_logs/{userId}/days/{YYYY-MM-DD}
 */
async function _logLessonActivityAction(): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(session.user.id)
            .collection("days")
            .doc(today)
            .set({
                date: today,
                lessonsCompletedCount: FieldValue.increment(1),
                lastUpdated: FieldValue.serverTimestamp(),
            }, { merge: true });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("logLessonActivityAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Action failed", success: false as const , data: null };
    }
}


export const logLessonActivityAction = withFlexibleSafeAction("logLessonActivityAction", _logLessonActivityAction);


/**
 * Calculate the current consecutive-day learning streak for a given user.
 * A streak day = any day with at least one lesson logged.
 * Returns { streak } — count of consecutive days ending today (or yesterday if today not yet active).
 */
async function _calculateStreakAction(userId: string): Promise<ActionResponse<any>> {
    try {
        // Same as getUserProgressAction above: the caller named the user.
        //
        // No session check at all, and the id came from the argument, so
        // calculateStreakAction(anyone) returned that learner's day-by-day
        // activity record. Its writing counterpart, logLessonActivityAction,
        // takes no id precisely because it derives one from the session.
        //
        // Its single call site passes the session user's id.
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Fetch the last 90 days of activity (enough for any realistic streak)
        const snap = await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(userId)
            .collection("days")
            .orderBy("date", "desc")
            .limit(90)
            .get();

        if (snap.empty) return { error: null, success: true as const, data: null };

        const activeDays = new Set(snap.docs.map(d => d.id)); // Set of "YYYY-MM-DD" strings

        let streak = 0;
        // Start from today and walk back.
        //
        // UTC throughout, because the day ids being matched are UTC days.
        // logLessonActivityAction names each document
        // `new Date().toISOString().split("T")[0]` — the UTC calendar date — and
        // this loop used to walk the LOCAL one: `setHours(0,0,0,0)` then
        // `toISOString()`, which is local midnight expressed in UTC.
        //
        // On a UTC server the two agree and nothing shows. On a server east of
        // UTC they do not: local midnight in Lagos (UTC+1) is 23:00 the previous
        // day in UTC, so the walk started one day BEHIND the id the writer had
        // just created. Today's lesson never counted, and a learner who studied
        // today but not yesterday was told their streak was 0 — on the very day
        // they earned it.
        //
        // Fixed on the reading side rather than the writing side: the ids
        // already in the database are UTC days, and changing the writer would
        // split the collection into two calendars.
        const cursor = new Date();
        cursor.setUTCHours(0, 0, 0, 0);

        while (true) {
            const dateStr = cursor.toISOString().split("T")[0];
            if (activeDays.has(dateStr)) {
                streak++;
                cursor.setUTCDate(cursor.getUTCDate() - 1);
            } else if (streak === 0) {
                // Allow one day gap at the start (e.g. user completed lessons yesterday but not today yet)
                cursor.setUTCDate(cursor.getUTCDate() - 1);
                const yesterdayStr = cursor.toISOString().split("T")[0];
                if (activeDays.has(yesterdayStr)) {
                    streak++;
                    cursor.setUTCDate(cursor.getUTCDate() - 1);
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return { error: null, success: true as const, data: { streak } };
    } catch (error) {
        logger.error("calculateStreakAction error:", {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: error instanceof Error ? error.message : "Streak calculation failed" };
    }
}


export const calculateStreakAction = withFlexibleSafeAction("calculateStreakAction", _calculateStreakAction);
