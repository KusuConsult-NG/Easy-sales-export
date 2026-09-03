/**
 * @jest-environment node
 */

/**
 *   #264 THE ACADEMY ADMIN COULD NOT OPEN OR SAVE AN ACADEMY QUIZ.
 *
 *        Both quiz actions gate on a hand-written pair:
 *
 *            if (!session?.user?.roles?.includes("admin") &&
 *                !session?.user?.roles?.includes("super_admin")) {
 *                return { success: false, error: "Unauthorized: Admin access required" };
 *            }
 *
 *        `academy_admin` is in neither, and /admin is a protected area that
 *        role reaches — so the academy admin opens
 *        /admin/academy/[courseId]/quiz/[quizId], the load fails with
 *        "Unauthorized: Admin access required", and Save fails the same way.
 *
 *        THE PERMISSION FOR THIS JOB ALREADY EXISTS, AND IS HELD BY THAT ROLE.
 *
 *        admin-permissions.ts declares `academy:manage_quizzes` and grants it
 *        to super_admin, admin AND academy_admin. Exactly one place in the
 *        codebase asks for it:
 *
 *            api/admin/academy/quiz/create/route.ts
 *
 *        which is not the editor. So the academy admin can create a quiz
 *        through the API route and cannot save or reopen one through the only
 *        quiz-authoring screen the admin UI links to. Two paths for one job,
 *        disagreeing about who may do it, with the permission that names the
 *        job used by the path that is not the front door.
 *
 *        THE SIBLING FILE WAS ALREADY FIXED FOR THIS. _ac_catalog.ts's
 *        _updateCourseAction carries the correction and the reasoning —
 *        "The ACADEMY admin could not edit an Academy course... Same
 *        correction as #115, #122, #158 and #195" — and _ac_quiz.ts, two files
 *        away in the same directory, kept the pair. The fix pass found the
 *        instances it went looking for and not the ones it didn't.
 *
 *        WHY IT LOOKED LIKE NOTHING WAS WRONG: an `admin` or `super_admin`
 *        testing the screen sees it work perfectly. Only the role the module
 *        was built for is refused.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ALL_ADMIN_ROLES, hasAdminPermission } from '@/lib/admin-permissions';

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const COURSE = 'course-1';
const LESSON = 'lesson-quiz-1';

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/academy/_ac_quiz');

function signedInAs(...roles: string[]) {
    mockRequireSession.mockResolvedValue({
        session: { user: { id: `u-${roles.join('-')}`, email: 'a@e.test', roles } },
        error: null,
    });
}

/** One question, exactly one correct answer — what the editor sends. */
const QUESTIONS = [{
    id: 'q1',
    text: 'Which document accompanies an export consignment?',
    options: [
        { id: 'o1', text: 'Bill of lading', isCorrect: true },
        { id: 'o2', text: 'Payslip', isCorrect: false },
    ],
}];

const save = async (title = 'Module Quiz') =>
    (await actions()).saveQuizAction(COURSE, LESSON, title, QUESTIONS as any) as any;

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();

    // A course whose first module carries the lesson the quiz belongs to, so
    // the learner-facing half of saveQuizAction has somewhere to write.
    store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, {
        id: COURSE,
        title: 'Export Fundamentals',
        modules: [{
            id: 'module-1',
            title: 'Documentation',
            lessons: [{ id: LESSON, title: 'Module quiz', type: 'quiz' }],
        }],
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#264 — the academy admin can author an academy quiz', () => {
    it('SAVES THE QUIZ FOR AN academy_admin', async () => {
        // The whole defect. This returned
        // "Unauthorized: Admin access required".
        signedInAs('academy_admin');

        const res = await save();

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.ACADEMY_QUIZZES, LESSON)).toBeTruthy();
    });

    it('AND SERVES IT BACK, SO THE EDITOR CAN BE REOPENED', async () => {
        signedInAs('academy_admin');
        await save('Documentation quiz');

        const res = await (await actions()).getQuizAction(LESSON) as any;

        expect(res.success).toBe(true);
        expect(res.data?.title).toBe('Documentation quiz');
        expect(res.data?.questions).toHaveLength(1);
    });

    it('and the learner-facing copy is written too, not just the editor store', async () => {
        // The other half of this action, fixed earlier: the editor's own
        // collection is read by nothing but the editor, so a save that reaches
        // only there serves the learners nothing.
        signedInAs('academy_admin');
        await save();

        const course = store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)!;
        expect(course.modules[0].quiz?.questions).toHaveLength(1);
        expect(course.modules[0].quiz?.questions[0].correctAnswer).toBe(0);
    });

    it.each(['admin', 'super_admin'])('%s still works, unchanged', async (role) => {
        signedInAs(role);
        expect((await save()).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#264 — and nobody else can', () => {
    it('REFUSES A LEARNER, BECAUSE THE DOCUMENT IS THE ANSWER KEY', async () => {
        // The questions carry options[].isCorrect. A signed-in learner reading
        // this reads the answers to the quiz they are about to sit — the read
        // guard that an earlier pass tightened, and which must survive widening
        // the write guard.
        signedInAs('general_user');

        expect((await (await actions()).getQuizAction(LESSON) as any).success).toBe(false);
        expect((await save()).success).toBe(false);
        expect(store.get(COLLECTIONS.ACADEMY_QUIZZES, LESSON)).toBeUndefined();
    });

    it.each(['marketplace_admin', 'wave_admin', 'farm_nation_admin', 'moderator', 'support'])(
        'refuses %s, who does not hold academy:manage_quizzes',
        async (role) => {
            signedInAs(role);

            expect((await save()).success).toBe(false);
            expect((await (await actions()).getQuizAction(LESSON) as any).success).toBe(false);
        },
    );

    it('refuses an unauthenticated caller', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });

        expect((await save()).success).toBe(false);
        expect(store.get(COLLECTIONS.ACADEMY_QUIZZES, LESSON)).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#264 — the guard is the matrix, not a role list', () => {
    it('exactly the roles holding academy:manage_quizzes may save', async () => {
        // Read out of the matrix rather than repeating a list here, so granting
        // or revoking the permission moves this test with it. That is the point
        // of the correction: a named permission has one definition, and a
        // hand-written pair has as many as there are copies.
        const holders = ALL_ADMIN_ROLES
            .filter((role) => hasAdminPermission([role], 'academy:manage_quizzes'));

        expect([...holders].sort()).toEqual(['academy_admin', 'admin', 'super_admin']);

        for (const role of holders) {
            store = installFakeDb();
            store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, { id: COURSE, modules: [] });
            signedInAs(role);
            expect({ role, ok: (await save()).success }).toEqual({ role, ok: true });
        }
    });

    it('and the create route and the editor now agree', async () => {
        // api/admin/academy/quiz/create/route.ts was the ONLY caller of
        // academy:manage_quizzes. The academy admin could create a quiz there
        // and not save one here, which is two answers to one question.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');

        const editor = readFileSync(join(process.cwd(), 'src/app/actions/academy/_ac_quiz.ts'), 'utf-8');
        const route = readFileSync(join(process.cwd(), 'src/app/api/admin/academy/quiz/create/route.ts'), 'utf-8');

        for (const src of [editor, route]) {
            expect(src).toContain('academy:manage_quizzes');
        }
        // Was: two hand-written `admin || super_admin` pairs in the editor.
        expect(editor).not.toMatch(/includes\(["']super_admin["']\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#264 — re-saving a quiz does not restamp its creation date', () => {
    /**
     * The same shape as #257, in this file: `createdAt: serverTimestamp()`
     * inside a `set(..., { merge: true })` that runs on every save, so the
     * field means "last saved" rather than "created".
     *
     * Nothing reads it today — getQuizAction returns title and questions only —
     * which is exactly why it is worth correcting now rather than after
     * something does.
     */
    it('keeps the createdAt a previous save wrote', async () => {
        // Seeded rather than written by a first save, DELIBERATELY. The first
        // version of this test saved twice and compared the two timestamps —
        // and both landed in the same millisecond, so it passed against the
        // unfixed code. A known prior value cannot collide with a fresh one.
        const CREATED = '2020-01-01T00:00:00.000Z';
        store.seed(COLLECTIONS.ACADEMY_QUIZZES, LESSON, {
            courseId: COURSE, title: 'First', questions: [], createdAt: CREATED,
        });

        signedInAs('academy_admin');
        await save('Second');

        const after = store.get(COLLECTIONS.ACADEMY_QUIZZES, LESSON)!;

        expect(after.createdAt).toBe(CREATED);
        expect(after.title).toBe('Second');
        // And updatedAt still moves, or the field would be meaningless.
        expect(after.updatedAt).not.toBe(CREATED);
    });

    it('stamps a createdAt on the first save, so it is not simply absent', async () => {
        signedInAs('academy_admin');
        await save('First');

        expect(store.get(COLLECTIONS.ACADEMY_QUIZZES, LESSON)!.createdAt).toBeTruthy();
    });
});
