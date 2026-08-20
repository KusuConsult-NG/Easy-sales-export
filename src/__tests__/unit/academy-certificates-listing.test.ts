/**
 * @jest-environment node
 */

/**
 * THE ACADEMY CERTIFICATE LIST QUERIED A STATE NOTHING EVER WROTE.
 *
 * /api/academy/certificates is fetched by exactly one screen — the Academy tab
 * of /dashboard/certificates — and its academy half was
 *
 *     .collection(COURSE_ENROLLMENTS)
 *     .where("userId", "==", userId)
 *     .where("status", "==", "completed")
 *     ...
 *     if (d.certificateIssuedAt || d.completedAt)
 *
 * course_enrollments has exactly two writers — enrollInCourse in
 * course-actions.ts and autoEnrollPaidUser in _ac_enrollment.ts — and both
 * write `status: "active"`. Nothing anywhere updates that field afterwards.
 * `certificateIssuedAt` occurs in this codebase only on that one line: no
 * writer, no other reader.
 *
 * So the branch returned nothing, for everybody, always, and the tab read "No
 * Academy certificates yet" for a learner who had finished every course on the
 * platform. It is the same defect as the WAVE branch ten lines below it, whose
 * own comment records four field names none of which matched its writer — that
 * half was found and fixed, and this one was left.
 *
 * AND TWO MORE REASONS THE SAME TAB COULD NOT WORK
 * -----------------------------------------------
 * The route answers `{ success, data: { certificates }, meta }`. The page read
 * `acData.certificates` — a key that is not in the payload — so it set the tab
 * to [] on every load regardless of what came back. Fixing either half alone
 * still leaves an empty tab.
 *
 * And the View button linked to `/academy/certificate/${cert.id}` built from a
 * document id, while that route reads its `[certificateId]` segment as a
 * COURSE id. Even a listed certificate could not be opened. The route supplies
 * `viewUrl` now, so the caller does not guess; WAVE rows have no such page and
 * omit it rather than linking to `/academy/certificate/wave`.
 *
 * WHERE A COMPLETION ACTUALLY LIVES
 * ---------------------------------
 * COLLECTIONS.CERTIFICATES holds rows the platform issued — the store
 * /api/academy/dashboard counts and /api/academy/verify/{id} verifies, both
 * through isIssuedCertificate, because uploadCertificateAction writes
 * user-attached files into the same collection.
 *
 * And lib/academy-certificate.ts states plainly that nothing currently writes
 * an issued row for an academy COURSE, deliberately leaving WHEN to persist one
 * as a product decision. So today every real academy certificate exists only as
 * a completed progress record — which is what /academy/certificate/{courseId}
 * renders and what /api/academy/certificate/{courseId} prints. Deriving the
 * LIST the way those two derive the CERTIFICATE persists nothing and decides
 * nothing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { academyCertificateNumber } from '@/lib/academy-certificate';
import { ACADEMY_CERTIFICATE, USER_UPLOADED_DOCUMENT } from '@/lib/certificate-kind';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Unauthorized' } }
                : { session: { user: { id, roles: ['academy_participant'], email: `${id}@example.com` } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

async function GET(url = 'http://localhost/api/academy/certificates'): Promise<any> {
    const { GET: handler } = await import('@/app/api/academy/certificates/route');
    const response = await handler(new Request(url) as any);
    return response.json();
}

/** A course the learner has finished, as the academy module records it. */
function seedFinishedCourse(courseId: string, title: string, completedAt: string): void {
    store.seed(COLLECTIONS.ACADEMY_COURSES, courseId, {
        title,
        modules: [{ id: 'm1', title: 'One', lessons: [{ id: 'l1', title: 'Intro' }] }],
    });
    store.seed(`user_progress/${LEARNER}/courses`, courseId, {
        userId: LEARNER,
        courseId,
        overallProgress: 100,
        completedLessons: ['l1'],
        completedAt,
    });
}

// ─── the branch that returned nothing ────────────────────────────────────────

describe('a learner who has finished a course', () => {
    it('sees it listed', async () => {
        // THE test. This returned an empty list for every learner on the
        // platform.
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');

        const body = await GET();

        expect(body.success).toBe(true);
        expect(body.data.certificates).toHaveLength(1);
        expect(body.data.certificates[0]).toMatchObject({
            courseId: 'c-1',
            courseName: 'Export Fundamentals',
            source: 'academy',
        });
    });

    it('dated when they finished, not when they looked', async () => {
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');

        const [cert] = (await GET()).data.certificates;
        expect(cert.issuedAt).toBe('2026-03-01T10:00:00.000Z');
    });

    it('carrying the same certificate number the certificate itself shows', async () => {
        // academyCertificateNumber is stable per learner, course and completion
        // date — the page, the PDF and the LinkedIn entry all print it. A
        // listing showing a database row id instead would not match any of them.
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');

        const [cert] = (await GET()).data.certificates;
        expect(cert.id).toBe(
            academyCertificateNumber(LEARNER, 'c-1', new Date('2026-03-01T10:00:00.000Z')),
        );
    });

    it('and a View link the certificate page can actually resolve', async () => {
        // That route reads its [certificateId] segment as a course id.
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');

        const [cert] = (await GET()).data.certificates;
        expect(cert.viewUrl).toBe('/academy/certificate/c-1');
        expect(cert.certificateUrl).toBe('/api/academy/certificate/c-1');
    });
});

describe('a learner who has not finished', () => {
    it('is listed nothing for a course still in progress', async () => {
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'c-1', { title: 'Export Fundamentals', modules: [] });
        store.seed(`user_progress/${LEARNER}/courses`, 'c-1', {
            userId: LEARNER, courseId: 'c-1', overallProgress: 60,
        });

        expect((await GET()).data.certificates).toEqual([]);
    });

    it('and the bar is the shared 100%, not "has a progress row"', async () => {
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'c-1', { title: 'Nearly', modules: [] });
        store.seed(`user_progress/${LEARNER}/courses`, 'c-1', {
            userId: LEARNER, courseId: 'c-1', overallProgress: 99, completedAt: '2026-03-01T10:00:00.000Z',
        });

        expect((await GET()).data.certificates).toEqual([]);
    });

    it('and a progress row whose course was deleted names nothing', async () => {
        store.seed(`user_progress/${LEARNER}/courses`, 'gone', {
            userId: LEARNER, courseId: 'gone', overallProgress: 100, completedAt: '2026-03-01T10:00:00.000Z',
        });

        expect((await GET()).data.certificates).toEqual([]);
    });
});

// ─── issued rows ─────────────────────────────────────────────────────────────

describe('rows the platform issued', () => {
    it('are listed, with the file they carry', async () => {
        store.seed(COLLECTIONS.CERTIFICATES, 'cert-1', {
            recordType: ACADEMY_CERTIFICATE,
            userId: LEARNER,
            courseId: 'c-1',
            courseTitle: 'Export Fundamentals',
            certificateNumber: 'ACAD-2026-C1-LEARNE',
            certificateUrl: 'https://cdn/cert-1.pdf',
            issuedAt: '2026-03-05T09:00:00.000Z',
        });

        const [cert] = (await GET()).data.certificates;
        expect(cert).toMatchObject({
            id: 'ACAD-2026-C1-LEARNE',
            courseId: 'c-1',
            courseName: 'Export Fundamentals',
            certificateUrl: 'https://cdn/cert-1.pdf',
            issuedAt: '2026-03-05T09:00:00.000Z',
            viewUrl: '/academy/certificate/c-1',
        });
    });

    it('and win over the derived one for the same course', async () => {
        // An issued row carries a real file; the derived one is generated on
        // request. Listing both would show the learner two certificates for one
        // course.
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');
        store.seed(COLLECTIONS.CERTIFICATES, 'cert-1', {
            recordType: ACADEMY_CERTIFICATE,
            userId: LEARNER, courseId: 'c-1', courseTitle: 'Export Fundamentals',
            certificateUrl: 'https://cdn/cert-1.pdf', issuedAt: '2026-03-05T09:00:00.000Z',
        });

        const certs = (await GET()).data.certificates;
        expect(certs).toHaveLength(1);
        expect(certs[0].certificateUrl).toBe('https://cdn/cert-1.pdf');
    });

    it('but a file the user uploaded is not a certificate the platform issued', async () => {
        // uploadCertificateAction writes into this same collection. The public
        // verifier and the dashboard count both learned to tell them apart;
        // this listing asks the same predicate.
        store.seed(COLLECTIONS.CERTIFICATES, 'upload-1', {
            recordType: USER_UPLOADED_DOCUMENT,
            userId: LEARNER,
            fileName: 'my-diploma.pdf',
            fileUrl: 'https://cdn/my-diploma.pdf',
        });

        expect((await GET()).data.certificates).toEqual([]);
    });

    it('and recordType decides that, not the presence of a courseId', async () => {
        // The row shape alone is what isIssuedCertificate falls back to for
        // LEGACY rows; for a row that declares itself, the declaration wins.
        // Without the shared predicate an uploaded row carrying any courseId at
        // all — a field this endpoint does not control — would be listed as a
        // credential the platform vouches for.
        store.seed(COLLECTIONS.CERTIFICATES, 'upload-2', {
            recordType: USER_UPLOADED_DOCUMENT,
            userId: LEARNER,
            courseId: 'c-1',
            courseTitle: 'Definitely Mine',
            fileName: 'looks-official.pdf',
            fileUrl: 'https://cdn/looks-official.pdf',
        });

        expect((await GET()).data.certificates).toEqual([]);
    });

    it('and a legacy row with no recordType is judged by its shape', async () => {
        store.seed(COLLECTIONS.CERTIFICATES, 'legacy', {
            userId: LEARNER, courseId: 'c-1', courseTitle: 'Legacy Course',
            issuedAt: '2026-02-01T00:00:00.000Z',
        });

        const certs = (await GET()).data.certificates;
        expect(certs).toHaveLength(1);
        expect(certs[0].courseName).toBe('Legacy Course');
    });

    it('and another learner\'s certificate is not listed', async () => {
        store.seed(COLLECTIONS.CERTIFICATES, 'theirs', {
            recordType: ACADEMY_CERTIFICATE,
            userId: 'someone-else', courseId: 'c-9', courseTitle: 'Not Yours',
        });

        expect((await GET()).data.certificates).toEqual([]);
    });
});

// ─── the WAVE half, which must keep working ──────────────────────────────────

describe('WAVE certificates', () => {
    it('are still listed beside the academy ones', async () => {
        seedFinishedCourse('c-1', 'Export Fundamentals', '2026-03-01T10:00:00.000Z');
        store.seed(COLLECTIONS.WAVE_CERTIFICATES, 'wave-1', {
            memberId: LEARNER,
            certificateType: 'completion',
            programName: 'WAVE Export Programme',
            issuedDate: '2026-04-01T00:00:00.000Z',
        });

        const certs = (await GET()).data.certificates;
        expect(certs.map((c: any) => c.source).sort()).toEqual(['academy', 'wave']);
    });

    it('and carry no View link, because there is no page for them', async () => {
        // It used to render `/academy/certificate/${doc.id}` for these too.
        store.seed(COLLECTIONS.WAVE_CERTIFICATES, 'wave-1', {
            memberId: LEARNER, certificateType: 'completion', issuedDate: '2026-04-01T00:00:00.000Z',
        });

        const [cert] = (await GET()).data.certificates;
        expect(cert.source).toBe('wave');
        expect(cert.viewUrl).toBeUndefined();
    });
});

// ─── ordering, paging and the guard ──────────────────────────────────────────

describe('the listing itself', () => {
    it('is newest first', async () => {
        seedFinishedCourse('older', 'Older', '2026-01-01T00:00:00.000Z');
        seedFinishedCourse('newer', 'Newer', '2026-06-01T00:00:00.000Z');

        const certs = (await GET()).data.certificates;
        expect(certs.map((c: any) => c.courseName)).toEqual(['Newer', 'Older']);
    });

    it('pages, and reports whether there is more', async () => {
        seedFinishedCourse('a', 'A', '2026-01-01T00:00:00.000Z');
        seedFinishedCourse('b', 'B', '2026-02-01T00:00:00.000Z');
        seedFinishedCourse('c', 'C', '2026-03-01T00:00:00.000Z');

        const first = await GET('http://localhost/api/academy/certificates?limit=2');
        expect(first.data.certificates).toHaveLength(2);
        expect(first.meta.hasMore).toBe(true);

        const next = await GET(
            `http://localhost/api/academy/certificates?limit=2&cursor=${encodeURIComponent(first.meta.cursor)}`,
        );
        expect(next.data.certificates.map((c: any) => c.courseName)).toEqual(['A']);
        expect(next.meta.hasMore).toBe(false);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        const body = await GET();

        expect(body.success).toBe(false);
        expect(body.error).toBe('Unauthorized');
    });
});

// ─── the caller ──────────────────────────────────────────────────────────────

describe('the page that reads it', () => {
    it('reads the key the route actually returns', () => {
        // `acData.certificates` is not in the payload. The tab was set to [] on
        // every load whatever the route said, so fixing the query alone would
        // have changed nothing on screen.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const page = readFileSync(join(process.cwd(), 'src/app/dashboard/certificates/page.tsx'), 'utf-8');

        expect(page).toContain('setAcademyCerts(acData.data?.certificates || [])');
        expect(page).not.toContain('setAcademyCerts(acData.certificates || [])');
    });

    it('and links View where the route says, not to a document id', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const page = readFileSync(join(process.cwd(), 'src/app/dashboard/certificates/page.tsx'), 'utf-8');

        expect(page).toContain('href={cert.viewUrl}');
        expect(page).not.toContain('href={`/academy/certificate/${cert.id}`}');
    });
});
