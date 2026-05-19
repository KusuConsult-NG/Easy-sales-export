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
} from "./_actions";

// Payment types
export type {
    PaymentInitState,
} from "./_payment";

// ─── Learner-facing actions (_actions.ts) ─────────────────────────────────────
export {
    checkAcademyStatusAction,
    getCoursesAction,
    getCourseByIdAction,
    initializeCoursePaymentAction,
    verifyCoursePaymentAction,
    enrollInCourseAction,
    completeLessonAction,
    submitQuizScoreAction,
    getUserProgressAction,
    getUserAggregateProgressAction,
    getLiveSessionsAction,
    submitAcademyApplicationAction,
    createCourseAction,
    updateCourseAction,
    updateCourseModulesAction,
    deleteCourseAction,
    getEnrolledCoursesWithDetailsAction,
    saveQuizAction,
    getQuizAction,
    logLessonActivityAction,
    calculateStreakAction,
    getAcademyApplicationAction,
    requestAcademyRevisionAction,
    resubmitAcademyApplicationAction,
} from "./_actions";

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
