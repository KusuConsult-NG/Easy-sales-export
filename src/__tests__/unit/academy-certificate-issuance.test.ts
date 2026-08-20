/**
 * @jest-environment node
 */

/**
 * Who gets an academy certificate, what number is on it, and where it links.
 *
 * 1. ANY SIGNED-IN USER COULD DOWNLOAD ONE FOR ANY COURSE
 *
 *    /api/academy/certificate/[certificateId] — the route that renders the PDF —
 *    checked that the course exists and that somebody is signed in, then
 *    rendered a completion certificate. It never looked at whether the caller
 *    had finished the course, or opened it, or enrolled.
 *
 *    The certificate PAGE does gate on it (`progress.overallProgress !== 100`),
 *    but that is a client-side check on a different surface. The route is
 *    reachable on its own, and it is the one producing the document a third
 *    party is shown.
 *
 * 2. THE DATE ON IT CAME FROM THE URL
 *
 *    `searchParams.get("date")`. The studentName beside it had already been
 *    fixed to come from the session "to prevent spoofing"; the date had not.
 *
 * 3. THE NUMBER WAS THE SAME FOR EVERYBODY
 *
 *    The page showed `ACAD-${new Date().getFullYear()}-${courseId.slice(0,6)}` —
 *    derived from the course and the current year alone, so every learner who
 *    completed that course was issued the identical number. A number that does
 *    not identify the holder is a course code, not a credential.
 *
 *    The year was the year the PAGE WAS OPENED, so a course finished in December
 *    and viewed in January claimed the following year — including in the
 *    LinkedIn entry the learner added.
 *
 *    And the PDF used a third scheme, `CRT-{course}-{Date.now() digits}`, which
 *    changed on every download: the saved file disagreed with the page it was
 *    saved from.
 *
 * 4. THE CERTIFICATE NOTIFICATION LINKED TO A 404
 *
 *    generateCourseCertificate notified the learner with
 *    `/courses/${courseId}/certificate`. There is no `/courses` route segment
 *    anywhere in the app.
 *
 * 5. THE AUDIT LOG RECORDED A DIFFERENT NUMBER FROM THE CERTIFICATE
 *
 *    Built twice from two separate Date.now() calls, so the entry could not be
 *    matched to the document it records.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    academyCertificateNumber,
    completionDateOf,
    hasEarnedAcademyCertificate,
    ACADEMY_CERTIFICATE_MIN_PROGRESS,
} from '@/lib/academy-certificate';

const PDF_ROUTE = 'src/app/api/academy/certificate/[certificateId]/route.tsx';
const CERT_PAGE = 'src/app/academy/certificate/[certificateId]/page.tsx';
const COURSE_ACTIONS = 'src/app/actions/course-actions.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the certificate number', () => {
    const march = new Date('2026-03-04T00:00:00.000Z');

    it('differs between two learners on the same course', () => {
        // THE test. The old scheme gave both of them the same string.
        const a = academyCertificateNumber('user-aaaaaa', 'course-zzzzzz', march);
        const b = academyCertificateNumber('user-bbbbbb', 'course-zzzzzz', march);

        expect(a).not.toBe(b);
    });

    it('and is stable for the same learner and course', () => {
        // The PDF minted a new one on every download.
        const first = academyCertificateNumber('user-1', 'course-1', march);
        const second = academyCertificateNumber('user-1', 'course-1', march);

        expect(first).toBe(second);
    });

    it('carries the year of COMPLETION, not the year it is looked at', () => {
        const december = new Date('2025-12-31T23:00:00.000Z');

        expect(academyCertificateNumber('u', 'c', december)).toContain('-2025-');
        expect(academyCertificateNumber('u', 'c', march)).toContain('-2026-');
    });

    it('reads every shape the progress record stores a date in', () => {
        const ms = Date.parse('2026-03-04T00:00:00.000Z');

        expect(completionDateOf(new Date(ms))?.getTime()).toBe(ms);
        expect(completionDateOf({ toDate: () => new Date(ms) })?.getTime()).toBe(ms);
        expect(completionDateOf({ seconds: ms / 1000 })?.getTime()).toBe(ms);
        // The JSONB writer serialises a Date to an ISO string.
        expect(completionDateOf('2026-03-04T00:00:00.000Z')?.getTime()).toBe(ms);
    });

    it('and returns null rather than the epoch for an unreadable one', () => {
        expect(completionDateOf(null)).toBeNull();
        expect(completionDateOf(undefined)).toBeNull();
        expect(completionDateOf('not a date')).toBeNull();
        expect(completionDateOf(new Date('nonsense'))).toBeNull();
    });

    it('survives short or punctuated ids without collapsing', () => {
        const a = academyCertificateNumber('a', 'b', march);
        const b = academyCertificateNumber('c', 'd', march);

        expect(a).not.toBe(b);
        expect(a).toMatch(/^ACAD-\d{4}-[A-Z0-9]{6}-[A-Z0-9]{6}$/);
    });
});

describe('who has earned one', () => {
    it('is the same bar the page applies', () => {
        expect(ACADEMY_CERTIFICATE_MIN_PROGRESS).toBe(100);
        expect(source(CERT_PAGE)).toContain('progress.overallProgress !== 100');
    });

    it('refuses anything short of it', () => {
        expect(hasEarnedAcademyCertificate({ overallProgress: 100 })).toBe(true);
        expect(hasEarnedAcademyCertificate({ overallProgress: 99 })).toBe(false);
        expect(hasEarnedAcademyCertificate({ overallProgress: 0 })).toBe(false);
    });

    it('and refuses a record that is missing or unreadable', () => {
        // The case that matters: no progress document at all means the learner
        // never enrolled.
        expect(hasEarnedAcademyCertificate(null)).toBe(false);
        expect(hasEarnedAcademyCertificate(undefined)).toBe(false);
        expect(hasEarnedAcademyCertificate({})).toBe(false);
        expect(hasEarnedAcademyCertificate({ overallProgress: 'lots' })).toBe(false);
    });
});

describe('the PDF route', () => {
    it('checks completion before it renders anything', () => {
        // THE test.
        //
        // Asserting the exact guard form, not merely that the call appears
        // somewhere: an ordering-only assertion is satisfied by
        // `if (false && !hasEarnedAcademyCertificate(...))`, which is precisely
        // the mutation this needs to catch. That was the first version of this
        // test and it passed against a disabled guard.
        const src = code(PDF_ROUTE);

        expect(src).toContain('if (!hasEarnedAcademyCertificate(progressData)) {');

        // …and the block it opens must refuse, not fall through.
        const block = src.slice(src.indexOf('if (!hasEarnedAcademyCertificate(progressData)) {'));
        expect(block.slice(0, 300)).toContain('return NextResponse.json(');
        expect(block.slice(0, 300)).toContain('status: 403');

        // The CALL, not the import — `renderToStream` first appears on line 3.
        const guard = src.indexOf('if (!hasEarnedAcademyCertificate(progressData)) {');
        const render = src.indexOf('await renderToStream(');
        expect(render).toBeGreaterThan(guard);
    });

    it('reads the caller\'s own progress, not a caller-supplied one', () => {
        const src = code(PDF_ROUTE);

        expect(src).toContain('`user_progress/${session.user.id}/courses/${courseId}`');
    });

    it('takes the date from the record instead of the query string', () => {
        const src = code(PDF_ROUTE);

        expect(src).not.toContain('searchParams.get("date")');
        expect(src).toContain('completionDateOf(progressData?.completedAt)');
    });

    it('and stamps the shared number rather than a per-download one', () => {
        const src = code(PDF_ROUTE);

        expect(src).not.toContain('Date.now().toString().substring(9)');
        expect(src).toContain('academyCertificateNumber(session.user.id, courseId, completedAt)');
    });

    it('while still taking the name from the session', () => {
        // Vacuity guard: the fix next door must not have undone this one.
        const src = code(PDF_ROUTE);

        expect(src).toContain('session.user.name');
        expect(src).not.toContain('searchParams.get("name")');
    });
});

describe('the certificate page', () => {
    it('shows the same number the PDF does', () => {
        const src = code(CERT_PAGE);

        expect(src).not.toContain('`ACAD-${new Date().getFullYear()}-${courseId.substring(0, 6).toUpperCase()}`');
        expect(src).toContain('academyCertificateNumber(session?.user?.id ?? "", courseId, completionDate)');
    });

    it('and sends the LinkedIn entry that same number', () => {
        const src = code(CERT_PAGE);
        const handler = src.slice(src.indexOf('function handleAddToLinkedIn'));

        expect(handler.slice(0, 1200)).toContain('academyCertificateNumber(');
    });

    it('and stops passing a name and date the route no longer trusts', () => {
        const src = code(CERT_PAGE);

        expect(src).not.toContain('?name=${name}&date=${date}');
        expect(src).toContain('`/api/academy/certificate/${courseId}`');
    });

    it('reading the completion date through the shared coercion', () => {
        const src = code(CERT_PAGE);

        expect(src).toContain('completionDateOf(progress.completedAt)');
    });
});

describe('generateCourseCertificate', () => {
    it('links the notification to a route that exists', () => {
        const src = code(COURSE_ACTIONS);

        expect(src).not.toContain('`/courses/${courseId}/certificate`');
        expect(src).toContain('`/academy/certificate/${courseId}`');
    });

    it('and /courses really is not a route', () => {
        // The premise, checked rather than asserted.
        expect(existsSync(join(process.cwd(), 'src/app/courses'))).toBe(false);
        expect(existsSync(join(process.cwd(), CERT_PAGE))).toBe(true);
    });

    it('records the number it actually issued', () => {
        const src = code(COURSE_ACTIONS);
        const fn = src.slice(src.indexOf('export async function generateCourseCertificate'));

        // Computed once, used twice — not built twice from two Date.now() calls.
        const built = fn.match(/`CERT-\$\{Date\.now\(\)\}/g) || [];
        expect(built.length).toBe(1);
        expect(fn).toContain('const certificateNumber = ');
    });

    it('and returns the certificate the learner already holds', () => {
        const src = code(COURSE_ACTIONS);
        const branch = src.slice(src.indexOf('if (!certSnapshot.empty)'));

        expect(branch.slice(0, 500)).toContain('certificateId: existingCert.id');
        expect(branch.slice(0, 500)).not.toContain('data: null');
    });
});
