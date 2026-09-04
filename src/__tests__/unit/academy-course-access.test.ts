/**
 * @jest-environment node
 */

/**
 * Three copies of the course-access rule, and the links that went nowhere.
 *
 * THREE COPIES
 * ------------
 * checkCourseAccess decides which course tiers a learner's plan opens. There
 * were three implementations of it, and the two client-side ones each carried
 * the comment
 *
 *     Helper client-side check replicated from checkCourseAccess inside
 *     _actions.ts
 *
 * _actions.ts no longer exists — the server copy had been moved to
 * _ac_enrollment.ts — and the replicas stayed where they were.
 *
 *   _ac_enrollment.ts                    the decision. Refuses the enrolment.
 *   academy/[courseId]/page.tsx          decides whether to redirect the learner.
 *   academy/(learner)/courses/page.tsx   decides which cards show a lock.
 *
 * They drifted the moment the server copy was normalised in this audit: the
 * server began accepting a plan carrying stray whitespace that the two replicas
 * still rejected, so the catalogue would have shown a lock on a course the
 * enrolment endpoint would grant. That is the divergence this pass created and
 * then removed, and it is exactly how the other five copies in this codebase
 * started.
 *
 * The rule lives in lib/academy-plan.ts rather than in _ac_enrollment.ts
 * because that file is "use server": every export of it must be an async server
 * action, so a client component cannot import a plain predicate from it. That
 * constraint is why the copies existed.
 *
 * FOUR LINKS TO ROUTES THAT DO NOT EXIST
 * --------------------------------------
 *   /dashboard/academy                   3x  every one a revalidatePath. The
 *                                            academy dashboard is
 *                                            /academy/dashboard, and
 *                                            revalidatePath on a path with no
 *                                            route is a silent no-op — so
 *                                            enrolling invalidated nothing.
 *   /academy/courses/{id}                2x  also revalidatePath. The course
 *                                            page is /academy/{id}.
 *   /academy/courses/{id}/quiz/results   1x  a router.push after a graded quiz
 *                                            submission, straight to a 404,
 *                                            taking the learner's score with it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { checkCourseAccess, ACADEMY_TIERS_OPENED, ACADEMY_PLANS } from '@/lib/academy-plan';

const ENROLMENT = 'src/app/actions/academy/_ac_enrollment.ts';
const COURSE_PAGE = 'src/app/academy/[courseId]/page.tsx';
const CATALOGUE = 'src/app/academy/(learner)/courses/page.tsx';
const COURSE_PAY = 'src/app/actions/academy/_ac_course_payment.ts';
const QUIZ_PAGE = 'src/app/academy/courses/[courseId]/quiz/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

describe('the access rule', () => {
    it('opens a free tier to everybody, plan or no plan', () => {
        for (const plan of [undefined, null, '', 'free', 'registration', 'elite']) {
            expect(checkCourseAccess(plan, 'free')).toBe(true);
            expect(checkCourseAccess(plan, '')).toBe(true);
            expect(checkCourseAccess(plan, undefined)).toBe(true);
        }
    });

    it('opens exactly the tiers each plan pays for', () => {
        expect(checkCourseAccess('foundation', 'foundation')).toBe(true);
        expect(checkCourseAccess('foundation', 'standard')).toBe(false);
        expect(checkCourseAccess('foundation', 'elite')).toBe(false);

        expect(checkCourseAccess('standard', 'foundation')).toBe(true);
        expect(checkCourseAccess('standard', 'standard')).toBe(true);
        expect(checkCourseAccess('standard', 'elite')).toBe(false);

        for (const tier of ['foundation', 'standard', 'elite']) {
            expect(checkCourseAccess('elite', tier)).toBe(true);
        }
    });

    it('treats the legacy "advanced" as standard, as every copy did', () => {
        expect(checkCourseAccess('advanced', 'standard')).toBe(true);
        expect(checkCourseAccess('advanced', 'elite')).toBe(false);
    });

    it('default-denies a plan it does not recognise', () => {
        // "Registered, no tier bought" is a real state — registration is free —
        // and it grants no paid content. Same answer every copy gave.
        expect(checkCourseAccess('registration', 'foundation')).toBe(false);
        expect(checkCourseAccess(undefined, 'foundation')).toBe(false);
        expect(checkCourseAccess('', 'foundation')).toBe(false);
    });

    it('and tolerates the spellings that made the copies disagree', () => {
        // THE test for the drift: the server copy was normalised in this audit
        // and the two replicas were not.
        expect(checkCourseAccess(' Elite ', 'elite')).toBe(true);
        expect(checkCourseAccess('ELITE', 'standard')).toBe(true);
        expect(checkCourseAccess('elite', ' Foundation ')).toBe(true);
    });

    it('covers every plan, so no plan silently opens nothing', () => {
        for (const plan of ACADEMY_PLANS) {
            expect(ACADEMY_TIERS_OPENED[plan].length).toBeGreaterThan(0);
            // Every plan at least opens its own tier.
            expect(ACADEMY_TIERS_OPENED[plan]).toContain(plan);
        }
    });
});

describe('there is one copy of it', () => {
    it.each([
        ['the server decision', ENROLMENT],
        ['the course page', COURSE_PAGE],
        ['the catalogue', CATALOGUE],
    ])('%s imports it rather than defining its own', (_label: string, rel: string) => {
        const src = source(rel);

        // #378 widened the import list on two of the three (isPurchasedCourse
        // travels with it), so the anchor is the NAME inside an import from
        // that module rather than the exact closing brace.
        expect(src).toMatch(
            /import\s*\{[^}]*\bcheckCourseAccess\b[^}]*\}\s*from\s*"@\/lib\/academy-plan"/);
        expect(src).not.toContain('function checkCourseAccess(');
    });

    it('and the stale comment naming a file that no longer exists is gone', () => {
        for (const rel of [COURSE_PAGE, CATALOGUE]) {
            expect(source(rel)).not.toContain('replicated from checkCourseAccess inside _actions.ts');
        }
        // _actions.ts really is gone — the comment was pointing at nothing.
        expect(existsSync(join(process.cwd(), 'src/app/actions/academy/_actions.ts'))).toBe(false);
    });

    it('all three still call it, so removing the copies removed no check', () => {
        expect(source(ENROLMENT)).toContain('checkCourseAccess(userPlan, courseTier)');
        expect(source(COURSE_PAGE)).toContain('checkCourseAccess(userPlan,');
        expect(source(CATALOGUE)).toContain('checkCourseAccess(userPlan,');
    });
});

describe('the links that went nowhere', () => {
    it('revalidates the academy dashboard that exists', () => {
        for (const rel of [ENROLMENT, COURSE_PAY]) {
            const src = source(rel);
            expect(src).not.toContain('revalidatePath("/dashboard/academy")');
            expect(src).toContain('revalidatePath("/academy/dashboard")');
        }
    });

    it('and the course page that exists', () => {
        for (const rel of [ENROLMENT, COURSE_PAY]) {
            const src = source(rel);
            expect(src).not.toContain('revalidatePath(`/academy/courses/${courseId}`)');
            expect(src).toContain('revalidatePath(`/academy/${courseId}`)');
        }
    });

    it('which are the routes actually on disk', () => {
        // The premise, checked rather than asserted.
        expect(existsSync(join(process.cwd(), 'src/app/academy/dashboard/page.tsx'))).toBe(true);
        expect(existsSync(join(process.cwd(), 'src/app/academy/[courseId]/page.tsx'))).toBe(true);
        expect(existsSync(join(process.cwd(), 'src/app/dashboard/academy'))).toBe(false);
        expect(existsSync(join(process.cwd(), 'src/app/academy/courses/[courseId]/page.tsx'))).toBe(false);
    });

    it('and a graded quiz no longer pushes the learner to a 404', () => {
        const src = source(QUIZ_PAGE);

        expect(src).not.toContain('/quiz/results?attemptId=');
        expect(src).toContain('router.push(`/academy/${params.courseId}`)');
    });

    it('showing the score the results page would have shown', () => {
        // Redirecting somewhere real while dropping the result would trade one
        // broken outcome for another.
        // Anchored inside submitQuiz — `if (data.success)` also appears in the
        // quiz FETCH further up, and matching that would prove nothing.
        const src = source(QUIZ_PAGE);
        const submit = src.slice(src.indexOf('const submitQuiz ='));

        expect(submit.slice(0, 1600)).toContain('data.score');
        expect(submit.slice(0, 1600)).toContain('data.passed');
    });

    it('and the submit endpoint really does return those', () => {
        // Vacuity guard: the toast is only honest if the API sends them.
        const api = source('src/app/api/academy/quiz/submit/route.ts');

        expect(api).toContain('score: scorePercentage');
        expect(api).toContain('passed');
    });
});
