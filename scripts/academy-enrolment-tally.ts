/**
 * Counting who is actually enrolled on an academy course.
 *
 *   #427 THE REPAIR #336 RECORDED AS OUTSTANDING, AND THE TWO WAYS OF GETTING
 *   IT WRONG.
 *
 *   #336 found one enrolment tally kept under four names and made
 *   `enrolledCount` the one the code maintains. It recorded that courses
 *   enrolled before that commit have their paid enrolments only in `students`,
 *   so `enrolledCount` under-counts them until a one-off backfill. This is that
 *   backfill's arithmetic, kept separate from the runner so it can be tested
 *   without a database.
 *
 *   WRONG WAY ONE: enrolledCount + students. That is the obvious repair and it
 *   double-counts. Since #336 the paid path increments BOTH counters on the
 *   same enrolment, so every paid enrolment after that commit would be added
 *   twice. A counter cannot tell you when it was incremented, so no arithmetic
 *   on the two counters can separate the eras.
 *
 *   WRONG WAY TWO: count every row in the enrolment collections. ENROLLMENTS
 *   rows are created at CHECKOUT INITIATION, before any money moves:
 *
 *       status: "pending_payment", // pending_payment | active | completed | dropped
 *
 *   Only a verified payment turns one into "active". Counting rows blindly adds
 *   every abandoned checkout to the course's enrolment figure — a number the
 *   product would then report as demand.
 *
 *   SO IT COUNTS DISTINCT LEARNERS, FROM ROWS, BY STATUS. Rows come from the
 *   three collections #424 mapped — course_enrollments (free, auto and
 *   per-course purchase), enrollments (the paid enrolment flow) and
 *   academy_enrollments (the admin-reporting mirror of the same enrolmentId).
 *   Deduplicating on (courseId, userId) makes the mirror harmless and means a
 *   learner who arrived by two routes is one enrolment.
 *
 *   IT REFUSES TO GUESS. A row whose status is not in the known vocabulary, or
 *   which carries no courseId or userId, is EXCLUDED and REPORTED rather than
 *   assumed to be an enrolment. Silently counting an unrecognised row is how a
 *   repair becomes the next defect.
 */

/** Statuses that mean the learner is on the course. */
export const ENROLLED_STATUSES: readonly string[] = ["active", "completed"];

/**
 * Statuses that mean they are not.
 *
 * "pending_payment" is the one that matters: it is written before the money
 * moves, so it is an intention to enrol, not an enrolment.
 */
export const NOT_ENROLLED_STATUSES: readonly string[] = [
    "pending_payment",
    "dropped",
    "cancelled",
    "refunded",
];

export type EnrolmentRow = {
    courseId?: unknown;
    userId?: unknown;
    status?: unknown;
};

export type RowVerdict =
    | { counts: true; courseId: string; userId: string }
    | { counts: false; reason: string };

/** Whether one row is evidence that one learner is on one course. */
export function classifyRow(row: EnrolmentRow): RowVerdict {
    const courseId = typeof row?.courseId === "string" ? row.courseId.trim() : "";
    const userId = typeof row?.userId === "string" ? row.userId.trim() : "";

    if (!courseId) return { counts: false, reason: "no courseId" };
    if (!userId) return { counts: false, reason: "no userId" };

    const status = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
    if (!status) return { counts: false, reason: "no status" };
    if (NOT_ENROLLED_STATUSES.includes(status)) return { counts: false, reason: `status "${status}"` };
    if (!ENROLLED_STATUSES.includes(status)) {
        // Not assumed either way. An unknown status is reported so a human
        // decides whether the vocabulary has grown.
        return { counts: false, reason: `unrecognised status "${status}"` };
    }

    return { counts: true, courseId, userId };
}

export type Tally = {
    /** courseId -> the distinct learners on it. */
    byCourse: Map<string, Set<string>>;
    /** Why rows were left out, counted by reason. */
    excluded: Map<string, number>;
};

/** Distinct learners per course, across however many collections are supplied. */
export function tallyEnrolments(rows: Iterable<EnrolmentRow>): Tally {
    const byCourse = new Map<string, Set<string>>();
    const excluded = new Map<string, number>();

    for (const row of rows) {
        const verdict = classifyRow(row);
        if (!verdict.counts) {
            excluded.set(verdict.reason, (excluded.get(verdict.reason) ?? 0) + 1);
            continue;
        }
        let set = byCourse.get(verdict.courseId);
        if (!set) { set = new Set<string>(); byCourse.set(verdict.courseId, set); }
        // Deduplicated: the admin mirror repeats the same enrolment, and a
        // learner can hold a row in two collections.
        set.add(verdict.userId);
    }

    return { byCourse, excluded };
}

export type CourseDecision =
    | { action: "unchanged"; stored: number; counted: number }
    | { action: "update"; stored: number; counted: number }
    | { action: "refuse"; stored: number; counted: number; reason: string };

/**
 * What to do about one course.
 *
 * FAIL CLOSED ON THE ONE CASE THAT LOOKS LIKE BLINDNESS. A recount of zero on a
 * course whose stored count is above zero is the exact signature of "the rows
 * were not visible to this script" — a renamed field, a collection not read, a
 * query that matched nothing. It is indistinguishable from "everybody
 * un-enrolled", and one of those two readings destroys a real number. So it is
 * refused and reported rather than written. #245's rule.
 */
export function decideForCourse(storedRaw: unknown, counted: number): CourseDecision {
    const stored = Number(storedRaw);
    const known = Number.isFinite(stored) && stored >= 0 ? stored : 0;

    if (counted === 0 && known > 0) {
        return {
            action: "refuse",
            stored: known,
            counted,
            reason: "recount is 0 but the stored count is not — refusing to zero a live figure",
        };
    }

    if (known === counted) return { action: "unchanged", stored: known, counted };
    return { action: "update", stored: known, counted };
}
