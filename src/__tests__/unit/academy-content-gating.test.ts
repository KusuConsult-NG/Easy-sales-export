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

        expect(fn).toContain('checkCourseAccess(viewerPlan,');
        expect(fn).toContain('stripLockedContent(formattedCourse)');
    });

    it('and the list does too, per course', () => {
        // Per course, because a listing mixes tiers: gating the whole list on
        // one verdict would either leak or over-hide.
        const src = code(CATALOG);
        const fn = src.slice(src.indexOf('async function _getCoursesAction'));

        expect(fn).toContain('raw.map((c) =>');
        expect(fn).toContain('checkCourseAccess(viewerPlan, (c as any)?.tier)');
        expect(fn).toContain('stripLockedContent(c)');
    });

    it('reading the plan from the session, not from an argument', () => {
        const src = code(CATALOG);
        const reads = src.match(/serviceRegistrations\?\.academy\?\.plan/g) || [];

        expect(reads.length).toBe(2);
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
