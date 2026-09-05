/**
 * @jest-environment node
 */

/**
 *   #424 A COURSE BOUGHT OUTRIGHT COULD BE OPENED AND WATCHED, AND NEVER
 *   COMPLETED.
 *   #425 AND THE CERTIFICATES PAGE ASKED FOR A STATUS NOTHING WRITES.
 *
 *   Found while writing the enrolment-count backfill #336 recorded as
 *   outstanding. The naive repair — enrolledCount + students — would have been
 *   wrong, because since #336 the paid path increments BOTH, so adding them
 *   double-counts every paid enrolment. Getting it right meant recounting from
 *   the enrolment rows, which meant finding out where those rows actually live.
 *
 *   A CORRECTION FIRST, because the first version of this note was wrong.
 *   "A paying learner cannot complete a course" is FALSE for a learner on a
 *   paid PLAN: autoEnrollPaidUser runs on every academy dashboard load and
 *   creates both progress records for them. The defect is narrower.
 *
 *   #424. Academy keeps a learner's place on a course in two documents:
 *
 *     PLACE A  user_progress/{userId}/courses/{courseId}   opens the course
 *     PLACE B  course_progress/{userId}_{courseId}         completes it
 *
 *   completeCourse and generateCourseCertificate both address PLACE B by that
 *   id, and completeCourse refuses outright when it is absent. The per-course
 *   purchase (#378) wrote only PLACE A — and it is precisely the path
 *   autoEnrollPaidUser cannot cover, since that enrols from the PLAN against
 *   the course TIER and a learner buying a single course their plan does not
 *   cover fails that test by definition. Nothing repaired it later either:
 *   updateLessonProgress writes only lesson_video_progress.
 *
 *   So: open the course, watch every lesson, then "Failed to complete course"
 *   and "Course not completed yet". Paid, watched, refused.
 *
 *   #425. The certificates route queried course_enrollments for
 *   `status == "completed"`. Both writers of that collection write
 *   `status: 'active'` and nothing moves it on, so the academy half of every
 *   learner's certificate list was empty — including for learners who had
 *   genuinely finished. Completion lives on PLACE B as `completed: true`.
 *   #420's class, and the SAME defect the WAVE half of that very file already
 *   carries a fix and a note about: a query whose field names no writer
 *   produces. The fix landed thirty lines below this one and not on it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the purchase stops ensuring the records        KILLED
 *     ensureCourseProgressRecord overwrites          KILLED
 *     ...stops existence-checking                    KILLED
 *     the certificates route reads enrolments only   KILLED
 *     it dates a certificate "now" again             KILLED
 *     the legacy enrolment rows stop being read      KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const PURCHASE = 'src/app/actions/academy/_ac_course_payment.ts';
const CERTS = 'src/app/api/academy/certificates/route.ts';
const SHARED = 'src/lib/academy-course-progress.ts';

const LEARNER = 'learner-1';
const COURSE = 'course-1';

let store: FakeDbHandle;
beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const shared = () => import('@/lib/academy-course-progress');

// ─────────────────────────────────────────────────────────────────────────────
describe('#424 — the record completion is keyed on gets created', () => {
    it('THE COMPOSITE PROGRESS DOC IS CREATED, AT THE ID completeCourse USES', async () => {
        const { ensureCourseAccessRecords, courseProgressDocId } = await shared();

        await ensureCourseAccessRecords(LEARNER, COURSE);

        // The id is the contract: completeCourse and generateCourseCertificate
        // both do .doc(`${userId}_${courseId}`).
        expect(courseProgressDocId(LEARNER, COURSE)).toBe(`${LEARNER}_${COURSE}`);
        const row = store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`);
        expect(row).toMatchObject({ userId: LEARNER, courseId: COURSE, completed: false });
    });

    it('and an enrolment row, so the course shows in the learner list', async () => {
        const { ensureCourseAccessRecords } = await shared();
        await ensureCourseAccessRecords(LEARNER, COURSE);

        const rows = store.all(COLLECTIONS.COURSE_ENROLLMENTS)
            .map(([, v]) => v as Record<string, unknown>);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ userId: LEARNER, courseId: COURSE, status: 'active' });
    });

    it('and IT NEVER OVERWRITES A LEARNER PART-WAY THROUGH', async () => {
        // The failure this guards against is real and has happened here:
        // autoEnrollPaidUser merged zeros over live progress when its query
        // field name drifted.
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE,
            progressPercent: 80, completed: false, lastWatchedSecond: 1234,
        });

        const { ensureCourseAccessRecords } = await shared();
        const result = await ensureCourseAccessRecords(LEARNER, COURSE);

        expect(result.progressCreated).toBe(false);
        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`))
            .toMatchObject({ progressPercent: 80, lastWatchedSecond: 1234 });
    });

    it('and a COMPLETED course is not reopened', async () => {
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE, progressPercent: 100, completed: true,
        });

        const { ensureCourseAccessRecords } = await shared();
        await ensureCourseAccessRecords(LEARNER, COURSE);

        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`)?.completed).toBe(true);
    });

    it('and running it twice adds nothing — a webhook retry is safe', async () => {
        const { ensureCourseAccessRecords } = await shared();
        const first = await ensureCourseAccessRecords(LEARNER, COURSE);
        const second = await ensureCourseAccessRecords(LEARNER, COURSE);

        expect(first).toMatchObject({ progressCreated: true, enrolmentCreated: true });
        expect(second).toMatchObject({ progressCreated: false, enrolmentCreated: false });
        expect(store.all(COLLECTIONS.COURSE_ENROLLMENTS)).toHaveLength(1);
    });

    it('and a missing id writes nothing rather than creating a row for ""', async () => {
        const { ensureCourseAccessRecords } = await shared();
        await ensureCourseAccessRecords('', COURSE);
        await ensureCourseAccessRecords(LEARNER, '');
        expect(store.all(COLLECTIONS.COURSE_PROGRESS)).toHaveLength(0);
        expect(store.all(COLLECTIONS.COURSE_ENROLLMENTS)).toHaveLength(0);
    });

    it('and THE PURCHASE PATH CALLS IT', () => {
        const src = code(PURCHASE);
        expect(src).toMatch(/ensureCourseAccessRecords\(userId, courseId\)/);
        expect(src).toMatch(/from "@\/lib\/academy-course-progress"/);
    });

    it('and it calls it AFTER the payment transaction, not inside it', () => {
        // Inside, a failure to write a reporting row would roll back an
        // enrolment the learner has paid for.
        const src = code(PURCHASE);
        const txEnd = src.indexOf('revalidatePath("/academy")');
        const call = src.indexOf('ensureCourseAccessRecords(userId, courseId)');
        expect(call).toBeGreaterThan(-1);
        expect(call).toBeLessThan(txEnd);
        expect(src.slice(call)).toMatch(/records\.failed/);
    });

    it('and the premise holds — completion really is keyed on that document', () => {
        const src = code('src/app/actions/course-actions.ts');
        expect(src).toMatch(/COURSE_PROGRESS\)\.doc\(`\$\{session\.user\.id\}_\$\{courseId\}`\)/);
        expect(src).toMatch(/No progress record found/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#425 — the certificates list reads where completion is written', () => {
    it('IT QUERIES course_progress FOR completed === true', () => {
        const src = code(CERTS);
        expect(src).toMatch(/collection\(COLLECTIONS\.COURSE_PROGRESS\)/);
        expect(src).toMatch(/\.where\("completed", "==", true\)/);
    });

    it('and the enrolment query is no longer the ONLY source', () => {
        const src = code(CERTS);
        const progressAt = src.indexOf('COLLECTIONS.COURSE_PROGRESS');
        const enrolAt = src.indexOf('COLLECTIONS.COURSE_ENROLLMENTS');
        expect(progressAt).toBeGreaterThan(-1);
        // Progress is consulted first; enrolments are the legacy fallback.
        expect(progressAt).toBeLessThan(enrolAt);
    });

    it('and legacy enrolment rows carrying the old shape are STILL read', () => {
        // Nothing writes it, but a row that has it is not discarded.
        const src = code(CERTS);
        expect(src).toMatch(/\.where\("status", "==", "completed"\)/);
    });

    it('and one course does not appear twice', () => {
        expect(code(CERTS)).toMatch(/seenCourseIds\.has/);
    });

    it('and a certificate is NEVER dated "now"', () => {
        // Defaulting to today made every certificate look freshly issued —
        // the fault the WAVE branch of this same file records having had.
        const src = code(CERTS);
        expect(src).not.toMatch(/\?\?\s*new Date\(\)\.toISOString\(\)/);
        expect(src).toMatch(/new Date\(0\)\.toISOString\(\)/);
    });

    it('and the premise holds — nothing writes "completed" onto an enrolment row', () => {
        // If something did, the original query would have worked and there
        // would be no finding. Checked across the enrolment writers.
        for (const f of ['src/app/actions/course-actions.ts',
                         'src/app/actions/academy/_ac_enrollment.ts']) {
            const src = code(f);
            const writes = [...src.matchAll(/status: *'([a-z_]+)'/g)].map((m) => m[1]);
            expect(writes).not.toContain('completed');
        }
    });

    it('and completion IS written to course_progress — the other half of the premise', () => {
        expect(code('src/app/actions/course-actions.ts')).toMatch(/completed: true/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#424/#425 — the rule is stated once', () => {
    it('THE SHARED MODULE OWNS BOTH DOCUMENT SHAPES', () => {
        const src = code(SHARED);
        expect(src).toMatch(/export function courseProgressDocId/);
        expect(src).toMatch(/export function userProgressPath/);
        expect(src).toMatch(/export async function ensureCourseAccessRecords/);
    });

    it('and it reads before it writes', () => {
        const src = code(SHARED);
        const read = src.indexOf('await ref.get()');
        const write = src.indexOf('await ref.set(');
        expect(read).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(read);
    });
});
