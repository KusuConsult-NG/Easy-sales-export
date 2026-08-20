/**
 * @jest-environment node
 */

/**
 * The tier gate was applied everywhere except where the content is served.
 *
 * checkCourseAccess decides which course tiers a learner's plan opens, and it is
 * consulted in three places:
 *
 *   _ac_enrollment.ts                    refuses the enrolment
 *   academy/[courseId]/page.tsx          redirects the learner away
 *   academy/(learner)/courses/page.tsx   draws a padlock on the card
 *
 * getCourseByIdAction consulted it nowhere. It returned the whole course
 * document — every lesson's videoUrl, documentUrl, excelUrl and body text — and
 * getCoursesAction returned up to `limit` of them the same way. Neither requires
 * a session at all.
 *
 * So the padlock and the redirect were drawn AFTER the browser already held the
 * material they were hiding, and a caller who loaded neither page could ask for
 * it directly. The tier a learner pays for gated the enrolment record, not the
 * videos.
 *
 * WHAT SURVIVES THE STRIP
 * -----------------------
 * The outline: module and lesson titles, ordering, durations, and the fact that
 * a quiz exists. That is the course description a prospective buyer is meant to
 * see, and it is what the catalogue renders. What goes is the material itself.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripLockedContent, stripAnswerKey } from '@/lib/academy-grading';

const CATALOG = 'src/app/actions/academy/_ac_catalog.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const course = () => ({
    id: 'c1',
    title: 'Export Mastery',
    tier: 'elite',
    price: 50000,
    modules: [
        {
            id: 'm1',
            title: 'Module One',
            order: 1,
            quiz: { id: 'q1', passingScore: 95, questions: [{ id: 'x', correctAnswer: 2 }] },
            lessons: [
                {
                    id: 'l1',
                    title: 'Lesson One',
                    order: 1,
                    duration: '12:00',
                    content: 'the actual body text',
                    videoUrl: 'https://videos.example/paid.mp4',
                    documentUrl: 'https://docs.example/paid.pdf',
                    excelUrl: 'https://docs.example/paid.xlsx',
                },
            ],
        },
    ],
});

describe('stripping locked content', () => {
    it('removes every piece of paid material from a lesson', () => {
        // THE test.
        const [lesson] = stripLockedContent(course()).modules[0].lessons as any[];

        expect(lesson.videoUrl).toBeUndefined();
        expect(lesson.documentUrl).toBeUndefined();
        expect(lesson.excelUrl).toBeUndefined();
        expect(lesson.content).toBeUndefined();
    });

    it('by DELETING the keys, not blanking them', () => {
        // A client reading `videoUrl` cannot tell an empty string from a
        // withheld one, and anything iterating keys would still see the field.
        const [lesson] = stripLockedContent(course()).modules[0].lessons as any[];

        expect(Object.keys(lesson)).not.toContain('videoUrl');
        expect(Object.keys(lesson)).not.toContain('content');
    });

    it('keeps the outline a prospective buyer is meant to see', () => {
        const stripped = stripLockedContent(course());
        const [lesson] = stripped.modules[0].lessons as any[];

        expect(stripped.title).toBe('Export Mastery');
        expect(stripped.modules[0].title).toBe('Module One');
        expect(lesson.title).toBe('Lesson One');
        expect(lesson.duration).toBe('12:00');
        expect(lesson.order).toBe(1);
        // And that a quiz exists at all.
        expect(stripped.modules[0].quiz).toBeDefined();
    });

    it('marks each lesson locked, so "no video" and "not yours" differ', () => {
        const [lesson] = stripLockedContent(course()).modules[0].lessons as any[];

        expect(lesson.locked).toBe(true);
    });

    it('does not mutate the course it was given', () => {
        // The write path has to keep the material it is stripping from a reader.
        const original = course();
        stripLockedContent(original);

        expect(original.modules[0].lessons[0].videoUrl).toBe('https://videos.example/paid.mp4');
    });

    it('survives a course with no modules or no lessons', () => {
        expect(stripLockedContent(null as any)).toBeNull();
        expect(stripLockedContent({ title: 'x' } as any)).toEqual({ title: 'x' });
        expect(stripLockedContent({ modules: [{ id: 'm' }] } as any).modules[0].id).toBe('m');
    });

    it('composes with the answer-key strip rather than replacing it', () => {
        // Both rules apply to a locked course: no material AND no answers.
        const both = stripAnswerKey(stripLockedContent(course()));
        const [lesson] = both.modules[0].lessons as any[];

        expect(lesson.videoUrl).toBeUndefined();
        expect(both.modules[0].quiz.questions[0].correctAnswer).toBeUndefined();
    });
});

describe('the readers apply it', () => {
    it('the single-course read gates on the viewer\'s plan', () => {
        const src = code(CATALOG);
        const fn = src.slice(src.indexOf('async function _getCourseByIdAction'));

        expect(fn).toContain('checkCourseAccessForRegistration(');
        expect(fn).toContain('stripLockedContent(formattedCourse)');
    });

    it('and the list does too, per course', () => {
        // Per course, because a listing mixes tiers: gating the whole list on
        // one verdict would either leak or over-hide.
        const src = code(CATALOG);
        const fn = src.slice(src.indexOf('async function _getCoursesAction'));

        expect(fn).toContain('raw.map((c) =>');
        expect(fn).toContain('checkCourseAccessForRegistration(viewerRegistration, (c as any)?.tier)');
        expect(fn).toContain('stripLockedContent(c)');
    });

    it('reading the registration from the session, not from an argument', () => {
        // It reads the whole `academy` registration rather than `...plan`,
        // because the status is half the answer — see the rejected-applicant
        // block at the foot of this file.
        const src = code(CATALOG);
        const reads = src.match(/serviceRegistrations\?\.academy;/g) || [];

        expect(reads.length).toBe(2);
        expect(src).not.toContain('serviceRegistrations?.academy?.plan');
        expect(src).toContain('sessionResult.session?.user as any');
    });

    it('and an admin still sees everything', () => {
        // The course editor cannot edit material it cannot see — the same
        // carve-out the answer key already has.
        const src = code(CATALOG);

        expect(src).toContain('viewerIsAdmin || opensThisTier');
    });

    it('while a free-tier course stays open to everyone', () => {
        // checkCourseAccess returns true for a free or absent tier, so a public
        // catalogue of free courses is unaffected.
        const { checkCourseAccess } = require('@/lib/academy-plan');

        expect(checkCourseAccess(undefined, 'free')).toBe(true);
        expect(checkCourseAccess(undefined, undefined)).toBe(true);
    });

    it('and a paying learner keeps the material they bought', () => {
        const { checkCourseAccess } = require('@/lib/academy-plan');

        expect(checkCourseAccess('elite', 'elite')).toBe(true);
        expect(checkCourseAccess('foundation', 'elite')).toBe(false);
    });
});

describe('the gate this makes redundant', () => {
    it('the page still redirects, but it is no longer the only check', () => {
        // Vacuity guard: the client-side redirect was the thing being relied on,
        // and it stays — it is a better experience than a stripped page. What
        // changed is that it is no longer what protects the content.
        const page = readFileSync(
            join(process.cwd(), 'src/app/academy/[courseId]/page.tsx'), 'utf-8'
        );

        expect(page).toContain('checkCourseAccess(userPlan,');
        expect(page).toContain('Upgrade your subscription to access this course');
    });
});

/**
 * AND THE GATE ASKED WHICH PLAN YOU BOUGHT, NEVER WHETHER YOU WERE REFUSED.
 *
 * Rejecting an Academy application writes
 * `serviceRegistrations.academy.status = "rejected"` and deliberately leaves
 * `...academy.plan` alone — the learner paid, and the payment happened. So a
 * rejected applicant who had bought the elite package carries `plan: "elite"`
 * for ever.
 *
 * Both readers in _ac_catalog.ts pulled that plan straight out of the session
 * and gated on it alone. Everything else the rejection touches held: the role
 * was revoked (#210), enrolment was refused (#225), and every page that checks
 * module access turned them away. The material itself did not, because these
 * two actions are addressable directly — which is the exact gap the header of
 * this file describes, reappearing one field over.
 *
 * checkCourseAccessForRegistration maps a decided-against registration onto NO
 * PLAN rather than refusing it outright, so a free-tier course stays open:
 * refusing a rejected applicant something an anonymous visitor is handed would
 * be a rule that reads backwards.
 */
describe('a rejected applicant does not keep the material their plan paid for', () => {
    const REJECTED = { plan: 'elite', status: 'rejected' };
    const APPROVED = { plan: 'elite', status: 'approved' };

    it('closes every paid tier the plan used to open', () => {
        const { checkCourseAccessForRegistration } = require('@/lib/academy-plan');

        for (const tier of ['foundation', 'standard', 'elite']) {
            expect(checkCourseAccessForRegistration(APPROVED, tier)).toBe(true);
            expect(checkCourseAccessForRegistration(REJECTED, tier)).toBe(false);
        }
    });

    it('and leaves the free tier open, as it is for everyone', () => {
        const { checkCourseAccessForRegistration } = require('@/lib/academy-plan');

        expect(checkCourseAccessForRegistration(REJECTED, 'free')).toBe(true);
        expect(checkCourseAccessForRegistration(REJECTED, undefined)).toBe(true);
        expect(checkCourseAccessForRegistration(null, 'free')).toBe(true);
    });

    it('for every way a registration can be decided against, not just rejection', () => {
        // isDecidedAgainst is the #207 vocabulary: rejected, suspended, revoked
        // and the rest all score zero, and "not approved" cannot tell them from
        // "not started".
        const { checkCourseAccessForRegistration } = require('@/lib/academy-plan');

        for (const status of ['rejected', 'suspended', 'revoked']) {
            expect(checkCourseAccessForRegistration({ plan: 'elite', status }, 'elite')).toBe(false);
        }
    });

    it('while an undecided registration is not treated as a refused one', () => {
        // Vacuity guard: "pending" must keep whatever the plan grants, or this
        // would lock out everyone mid-review.
        const { checkCourseAccessForRegistration } = require('@/lib/academy-plan');

        expect(checkCourseAccessForRegistration({ plan: 'elite', status: 'pending' }, 'elite')).toBe(true);
        expect(checkCourseAccessForRegistration({ plan: 'elite' }, 'elite')).toBe(true);
    });

    it('and the status is live, not whatever the JWT was minted with', () => {
        // The premise. requireSession force-syncs serviceRegistrations from the
        // database over the token before any of this runs, so a rejection takes
        // effect on the next request rather than on the next sign-in.
        const guard = readFileSync(join(process.cwd(), 'src/lib/session-guard.ts'), 'utf-8');

        expect(guard).toContain(
            'serviceRegistrations: data?.serviceRegistrations || (session.user as any).serviceRegistrations || null'
        );
    });
});

/**
 * The same rule, EXECUTED against the action that serves the videos.
 *
 * The assertions above are on the predicate and on the call site. This one
 * calls getCourseByIdAction and reads what comes back, which is the only form
 * of the question that cannot be satisfied by a correctly-shaped call to a
 * gate that is passed the wrong thing.
 */
describe('getCourseByIdAction, run', () => {
    const { installFakeDb } = require('@/lib/testing/fake-db');
    const { COLLECTIONS } = require('@/lib/types/firestore');

    let store: any;

    function actAs(academy: Record<string, unknown> | null, roles: string[] = ['academy_participant']) {
        (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: 'learner-1',
                    email: 'l@example.com',
                    roles,
                    serviceRegistrations: academy ? { academy } : {},
                },
            },
            error: null,
        }));
    }

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'elite-course', {
            title: 'Global Trade Finance',
            tier: 'elite',
            modules: [{
                id: 'm1',
                title: 'One',
                lessons: [{ id: 'l1', title: 'Intro', videoUrl: 'https://cdn/secret.mp4', content: 'body' }],
            }],
        });
    });

    async function lesson(): Promise<any> {
        const { getCourseByIdAction } = await import('@/app/actions/academy/_ac_catalog');
        const result: any = await getCourseByIdAction('elite-course');
        expect(result.success).toBe(true);
        return result.data.modules[0].lessons[0];
    }

    it('hands the elite videos to an approved elite learner', async () => {
        // Vacuity guard, and the control for the next case.
        actAs({ plan: 'elite', status: 'approved' });
        expect((await lesson()).videoUrl).toBe('https://cdn/secret.mp4');
    });

    it('and withholds them from the same learner once rejected', async () => {
        // THE test. Same plan, same course, same action — only the admin's
        // decision differs, and it used to make no difference at all here.
        actAs({ plan: 'elite', status: 'rejected' });

        const l = await lesson();
        expect(l.videoUrl).toBeUndefined();
        expect(l.content).toBeUndefined();
        expect(l.locked).toBe(true);
        // The outline survives the strip — that is what a locked card shows.
        expect(l.title).toBe('Intro');
    });

    it('and from a suspended one', async () => {
        actAs({ plan: 'elite', status: 'suspended' });
        expect((await lesson()).videoUrl).toBeUndefined();
    });

    it('while an admin still sees the material', async () => {
        // The course editor cannot edit what it cannot see.
        actAs({ plan: 'elite', status: 'rejected' }, ['super_admin']);
        expect((await lesson()).videoUrl).toBe('https://cdn/secret.mp4');
    });
});
