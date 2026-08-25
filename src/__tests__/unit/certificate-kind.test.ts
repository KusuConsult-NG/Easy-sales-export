/**
 * @jest-environment node
 */

/**
 * The platform publicly vouched for any file a user chose to upload.
 *
 * THE COLLISION
 * -------------
 * `COLLECTIONS.CERTIFICATES` holds two unrelated kinds of record:
 *
 *   ACADEMY-ISSUED   /api/academy/certificate/generate writes these after a
 *                    course is completed — userName, courseId, courseTitle,
 *                    grade. A credential the platform vouches for.
 *
 *   USER-UPLOADED    uploadCertificateAction writes these — a PDF or image the
 *                    user attached to their own profile. The platform has
 *                    verified nothing about it beyond its file type.
 *
 * Three readers assumed every row was the first kind.
 *
 * THE PUBLIC ONE
 * --------------
 * /api/academy/verify/[certificateId] fetched any document by id and answered
 *
 *     { success: true, certificate: { ..., isValid: true } }
 *
 * with `isValid` hardcoded. uploadCertificateAction returns the id of the row it
 * creates to whoever uploaded the file. So the whole forgery is: attach any PDF,
 * read the certificateId out of the response, and hand someone
 * /academy/verify/<that id> — a real page, backed by a real endpoint, saying the
 * platform verified it.
 *
 * The rendered name and course come back blank, so it is a poor forgery. It is
 * still the platform answering "valid" about something it has never checked, on
 * an endpoint whose entire purpose is to be trusted by outsiders.
 *
 * THE OTHER TWO
 * -------------
 * /api/academy/dashboard counted every row for the user as certificatesEarned,
 * so uploading files inflated it.
 *
 * deleteCertificateAction checks that the row's userId matches the caller — and
 * an issued credential carries the learner's userId, so it passed. A learner
 * could delete a credential the platform issued, and that somebody else may be
 * verifying, through the attach-a-file screen.
 *
 * THE FIX
 * -------
 * A `recordType` written by both writers, and one predicate in
 * lib/certificate-kind that all three readers use. Rows predating it have no
 * recordType, so the predicate falls back to the shape that has always separated
 * them — an issued certificate has a courseId, an uploaded file does not — and
 * fails closed for anything that is neither.
 *
 * ALSO IN THE AUDITED FILE
 * ------------------------
 * The file-type allowlist was decorative. It tested `file.type`, a string the
 * client sends. uploadFileToStorage does sniff magic bytes, but against a
 * broader list that also permits video and Word documents — so an MP4 declared
 * as application/pdf passed both checks and was stored with
 * `fileType: "application/pdf"` recorded against it. The content type decides
 * now, and is what gets recorded.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { isIssuedCertificate, isUserUploadedDocument, ACADEMY_CERTIFICATE, USER_UPLOADED_DOCUMENT } from '@/lib/certificate-kind';

describe('telling the two kinds apart', () => {
    it('recognises an issued certificate by its recordType', () => {
        expect(isIssuedCertificate({ recordType: ACADEMY_CERTIFICATE })).toBe(true);
    });

    it('recognises an uploaded document by its recordType', () => {
        expect(isIssuedCertificate({ recordType: USER_UPLOADED_DOCUMENT })).toBe(false);
        expect(isUserUploadedDocument({ recordType: USER_UPLOADED_DOCUMENT })).toBe(true);
    });

    it('reads a legacy issued certificate by its courseId', () => {
        // Rows written before recordType existed. An issued certificate always
        // has a courseId.
        expect(isIssuedCertificate({ userId: 'u1', courseId: 'c1', courseTitle: 'T', userName: 'N' })).toBe(true);
    });

    it('reads a legacy uploaded document by having no courseId', () => {
        expect(isIssuedCertificate({ userId: 'u1', fileName: 'x.pdf', fileUrl: 'https://x/y.pdf' })).toBe(false);
        expect(isUserUploadedDocument({ userId: 'u1', fileName: 'x.pdf', fileUrl: 'https://x/y.pdf' })).toBe(true);
    });

    it('fails closed on a row that is neither', () => {
        // THE property that matters. An unrecognised row must not be verifiable.
        expect(isIssuedCertificate({})).toBe(false);
        expect(isIssuedCertificate(undefined)).toBe(false);
        expect(isIssuedCertificate(null)).toBe(false);
        expect(isIssuedCertificate({ userId: 'u1' })).toBe(false);
    });

    it('lets recordType override the legacy shape', () => {
        // An explicit mark beats an inferred one, so a future uploaded document
        // that happened to carry a courseId is still not a credential.
        expect(isIssuedCertificate({ recordType: USER_UPLOADED_DOCUMENT, courseId: 'c1' })).toBe(false);
    });

    it('does not call a row both kinds at once', () => {
        for (const row of [
            { recordType: ACADEMY_CERTIFICATE },
            { recordType: USER_UPLOADED_DOCUMENT },
            { courseId: 'c1' },
            { fileUrl: 'https://x/y.pdf' },
        ]) {
            expect(isIssuedCertificate(row) && isUserUploadedDocument(row)).toBe(false);
        }
    });
});

describe('the readers that treated every row as a credential', () => {
    async function source(rel: string): Promise<string> {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        return readFileSync(join(process.cwd(), rel), 'utf-8');
    }

    it('the public verify endpoint checks the kind before answering', async () => {
        // THE test for the forgery path. Asserted on the route source because a
        // Next.js route handler needs a NextRequest and the params promise, and
        // what matters is that the guard precedes the answer.
        const src = await source('src/app/api/academy/verify/[certificateId]/route.ts');

        const guardAt = src.indexOf('isIssuedCertificate');
        const validAt = src.indexOf('isValid: true');

        expect(guardAt).toBeGreaterThan(-1);
        expect(validAt).toBeGreaterThan(guardAt);
    });

    it('the verify endpoint answers "not found" rather than naming the reason', async () => {
        // A verifier does not need to be told "this id exists but is not a
        // certificate", and saying so would confirm which ids exist.
        const src = await source('src/app/api/academy/verify/[certificateId]/route.ts');
        const guarded = src.slice(src.indexOf('if (!isIssuedCertificate'));

        expect(guarded.slice(0, 300)).toMatch(/not found or invalid/i);
        expect(guarded.slice(0, 300)).toContain('404');
    });

    it('the academy dashboard counts only issued certificates', async () => {
        const src = await source('src/app/api/academy/dashboard/route.ts');

        expect(src).toContain('isIssuedCertificate');
        expect(src).toMatch(/\.filter\(doc => isIssuedCertificate\(doc\.data\(\)\)\)/);
    });

    it('the generate route stamps the issued kind', async () => {
        const src = await source('src/app/api/academy/certificate/generate/route.ts');

        expect(src).toContain('recordType: ACADEMY_CERTIFICATE');
    });

    it('the upload action stamps the uploaded kind', async () => {
        const src = await source('src/app/actions/certificates.ts');

        expect(src).toContain('recordType: USER_UPLOADED_DOCUMENT');
    });
});

const USER = 'user-1';
const OTHER = 'user-2';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
}));

const mockUpload = jest.fn(async () => 'https://cdn.example/cert.pdf') as jest.Mock<any>;
const mockDetect = jest.fn(async () => 'application/pdf') as jest.Mock<any>;
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (...a: any[]) => mockUpload(...a),
    detectFileType: (...a: any[]) => mockDetect(...a),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

/** A File whose declared type is whatever the caller claims. */
function fakeFile(declaredType: string, name = 'cert.pdf', size = 1024): any {
    return {
        name,
        type: declaredType,
        size,
        arrayBuffer: async () => new ArrayBuffer(8),
    };
}

function setStoredDoc(data: Record<string, any> | null) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: data !== null,
        empty: data === null,
        size: data ? 1 : 0,
        docs: data ? [{ id: 'cert-1', data: () => data }] : [],
        data: () => data ?? {},
    }));
}

describe('an uploaded file is recorded as what it actually is', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDetect.mockResolvedValue('application/pdf');
        mockUpload.mockResolvedValue('https://cdn.example/cert.pdf');
        setSession(USER);
        setStoredDoc(null);
    });

    async function upload(file: any, metadata: Record<string, any> = { certificateType: 'training' }) {
        const { uploadCertificateAction } = await import('@/app/actions/certificates');
        return uploadCertificateAction(USER, file, metadata as any) as any;
    }

    function written(): Record<string, any> | undefined {
        return (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'fileType' in d);
    }

    it('refuses a video declared as a PDF', async () => {
        // THE test. `file.type` is a client-supplied string, and the storage
        // layer's own sniffing permits video — so this passed both checks.
        mockDetect.mockResolvedValue('video/mp4');

        const r = await upload(fakeFile('application/pdf'));

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/invalid file type/i);
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it('records the detected type, not the declared one', async () => {
        // A PNG honestly uploaded but declared as a PDF is still a PNG.
        mockDetect.mockResolvedValue('image/png');

        const r = await upload(fakeFile('application/pdf'));

        expect(r.success).toBe(true);
        expect(written()?.fileType).toBe('image/png');
    });

    it('accepts a genuine PDF', async () => {
        // Vacuity guard: refusing everything would remove the feature.
        const r = await upload(fakeFile('application/pdf'));

        expect(r.success).toBe(true);
        expect(mockUpload).toHaveBeenCalled();
    });

    it('refuses a file whose type cannot be detected', async () => {
        // Fails closed. "Unrecognised" is not permission.
        mockDetect.mockResolvedValue(undefined);

        expect((await upload(fakeFile('application/pdf'))).success).toBe(false);
    });

    it('marks the row as a user upload, never as a credential', async () => {
        await upload(fakeFile('application/pdf'));

        expect(written()?.recordType).toBe(USER_UPLOADED_DOCUMENT);
        expect(isIssuedCertificate(written()!)).toBe(false);
    });

    it('refuses an unknown certificate type', async () => {
        const r = await upload(fakeFile('application/pdf'), { certificateType: 'nobel_prize' });

        expect(r.success).toBe(false);
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it('refuses an unparseable issue or expiry date', async () => {
        for (const bad of [{ issueDate: 'whenever' }, { expiryDate: 'never' }]) {
            jest.clearAllMocks();
            mockDetect.mockResolvedValue('application/pdf');
            const r = await upload(fakeFile('application/pdf'), { certificateType: 'training', ...bad });
            expect(r.success).toBe(false);
        }
    });

    it('still refuses uploading against another user', async () => {
        // Pre-existing guard, pinned.
        const { uploadCertificateAction } = await import('@/app/actions/certificates');

        const r: any = await uploadCertificateAction(OTHER, fakeFile('application/pdf'), { certificateType: 'training' } as any);

        expect(r.success).toBe(false);
    });
});

describe('an issued credential is not deletable through the upload screen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
    });

    async function del() {
        const { deleteCertificateAction } = await import('@/app/actions/certificates');
        return deleteCertificateAction('cert-1', USER) as any;
    }

    it('refuses to delete an academy certificate', async () => {
        // It carries the learner's own userId, so the ownership check passed.
        setStoredDoc({ recordType: ACADEMY_CERTIFICATE, userId: USER, courseId: 'c1', courseTitle: 'T' });

        const r = await del();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/issued certificates/i);
        expect((global as any).mockFirestoreDelete).not.toHaveBeenCalled();
    });

    it('refuses to delete a legacy academy certificate too', async () => {
        // No recordType, but a courseId — the shape that has always identified
        // one.
        setStoredDoc({ userId: USER, courseId: 'c1', courseTitle: 'T', userName: 'N' });

        expect((await del()).success).toBe(false);
    });

    it('still deletes a document the user uploaded', async () => {
        // Vacuity guard. This is what the endpoint is for.
        setStoredDoc({ recordType: USER_UPLOADED_DOCUMENT, userId: USER, fileName: 'x.pdf', fileUrl: '' });

        const r = await del();

        expect(r.success).toBe(true);
    });

    it('still refuses deleting somebody else\'s document', async () => {
        // Pre-existing guard, pinned.
        setStoredDoc({ recordType: USER_UPLOADED_DOCUMENT, userId: OTHER, fileName: 'x.pdf', fileUrl: '' });

        expect((await del()).success).toBe(false);
    });
});
