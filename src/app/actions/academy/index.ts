
/**
 * Academy Domain Action Barrel
 *
 * Single import point for ALL Academy server actions AND types.
 *
 * Private files (_actions, _admin, _payment) must never be imported directly.
 * All consumers import from "@/app/actions/academy".
 *
 * Duplicate note: approveAcademyApplicationAction exists in both _actions.ts
 * and _admin.ts — the _admin version is canonical (full email workflow).
 * The _actions version is a legacy duplicate, excluded from this barrel.
 */

// ─── Domain types (view-layer shapes used by pages) ───────────────────────────
export type {
    Course,
    CourseModule,
    Lesson,
    Quiz,
    QuizQuestion,
    UserProgress,
    LiveSession,
    AcademyApplicationData,
    EnrolledCourseWithDetails,
    QuizEditorQuestion,
} from "@/lib/types/academy-actions";

// Payment types
export type {
    PaymentInitState,
} from "./_payment";

// ─── Course catalogue (_ac_catalog.ts) ───────────────────────────────────────
export {
    getCoursesAction,
    getCourseByIdAction,
    createCourseAction,
    updateCourseAction,
    updateCourseModulesAction,
    deleteCourseAction,
} from "./_ac_catalog";

// ─── Enrolment and access (_ac_enrollment.ts) ────────────────────────────────
export {
    checkAcademyStatusAction,
    enrollInCourseAction,
    getEnrolledCoursesWithDetailsAction,
    autoEnrollPaidUser,
} from "./_ac_enrollment";

// ─── Per-course payment (_ac_course_payment.ts) ──────────────────────────────
export {
    initializeCoursePaymentAction,
    verifyCoursePaymentAction,
} from "./_ac_course_payment";

// ─── Learner progress (_ac_progress.ts) ──────────────────────────────────────
export {
    completeLessonAction,
    submitQuizScoreAction,
    getUserProgressAction,
    getUserAggregateProgressAction,
    logLessonActivityAction,
    calculateStreakAction,
} from "./_ac_progress";

// ─── Quizzes (_ac_quiz.ts) ───────────────────────────────────────────────────
export {
    saveQuizAction,
    getQuizAction,
} from "./_ac_quiz";

// ─── Live sessions (_ac_live.ts) ─────────────────────────────────────────────
export {
    getLiveSessionsAction,
    startAcademyLiveSessionAction,
    endAcademyLiveSessionAction,
} from "./_ac_live";

// ─── Applications (_ac_applications.ts) ──────────────────────────────────────
// NOTE: approveAcademyApplicationAction from _admin.ts is canonical, so the
// copy in _ac_applications.ts is deliberately not re-exported here — the same
// arrangement _actions.ts had.
export {
    submitAcademyApplicationAction,
    getAcademyApplicationAction,
    requestAcademyRevisionAction,
    resubmitAcademyApplicationAction,
} from "./_ac_applications";

// ─── Admin actions (_admin.ts) ────────────────────────────────────────────────
// NOTE: approveAcademyApplicationAction from _admin.ts is canonical
export {
    approveAcademyApplicationAction,
    rejectAcademyApplicationAction,
    updateAcademyApplicationPaymentAction,
    getPendingAcademyApplicationsAction,
    getAcademyEnrollmentsAction,
    getAcademyInstructorsAction,
    getAcademyCoursesAction,
    getAcademyStatsAction,
    getAcademyApplicationStatsAction,
    upsertAcademyCourseAction,
    getStandardAcademyApplicationsAction,
    logAcademyExportAction,
} from "./_admin";

// ─── Payment actions (_payment.ts) ────────────────────────────────────────────
export {
    initializeEnrollmentPaymentAction,
    verifyEnrollmentPaymentAction,
    initiateAcademyPaymentAction,
    verifyAcademyPaymentAction,
    checkAcademyPaymentStatusAction,
} from "./_payment";
