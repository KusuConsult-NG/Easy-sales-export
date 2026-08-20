/**
 * @jest-environment node
 */

/**
 * uploadDocumentAction trusted the file type the caller declared.
 *
 * WHAT WAS WRONG
 * --------------
 * The action validated the `mimeType` form field — a string the CLIENT wrote,
 * not a fact about the bytes. Arbitrary content posted as "image/png" or
 * "application/pdf" passed. This is the same defect
 * upload-content-validation.test.ts found and fixed on /api/upload: "the
 * stricter check was on the less-travelled path". This action is a THIRD
 * sibling of that path — reached by the loan wizard's document step
 * (LoanWizard.tsx) and marketplace onboarding's business verification step
 * (BusinessVerificationStep.tsx) — and it was the one still missed.
 *
 * WHY THE DETECTOR IS MOCKED HERE
 * -------------------------------
 * Same reason as upload-content-validation.test.ts: `file-type` is pure ESM
 * and this jest setup is CJS, so an unmocked call throws and every upload
 * would fail closed, including a real PNG — making every negative assertion
 * pass for the wrong reason. detectFileType itself is mocked directly (one
 * layer below assertAllowedFileType) since that is what this action now
 * calls, to enforce ITS OWN narrower allow list (jpg/png/pdf only, not
 * assertAllowedFileType's broader one that also permits video and Word
 * documents).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDetectFileType = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/storage-admin', () => ({
    detectFileType: (...a: any[]) => mockDetectFileType(...a),
}));

const mockWriteToLocalDisk = jest.fn(
    async (publicId: string) => `https://local.test/${publicId}`
) as jest.Mock<any>;
jest.mock('@/lib/storage-backend', () => ({
    shouldUseLocalDiskStorage: () => true,
    writeToLocalDisk: (...a: any[]) => mockWriteToLocalDisk(...a),
}));

function actAs(userId: string | null) {
    (globalThis as unknown as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        userId === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id: userId, roles: ['user'], email: 'a@e.com', name: 'Ada' } }, error: null }
    ));
}

function submission(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], overrides.fileName ?? 'photo.png', {
        type: overrides.mimeType ?? 'image/png',
    }));
    fd.append('fileName', overrides.fileName ?? 'photo.png');
    fd.append('mimeType', overrides.mimeType ?? 'image/png');
    fd.append('documentType', overrides.documentType ?? 'kyc-photo');
    return fd;
}

describe('uploadDocumentAction — validates by real content, not the claimed mimeType', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        actAs('user-1');
    });

    it('accepts content that really is a PNG', async () => {
        // Vacuity guard: without it, a validator that rejects everything
        // passes every negative test below while breaking every real upload.
        mockDetectFileType.mockResolvedValue('image/png');
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(submission());

        expect(result.success).toBe(true);
        expect(mockWriteToLocalDisk).toHaveBeenCalled();
    });

    it('THE case: rejects HTML content declared as image/png', async () => {
        // The action's own allow-list check on the form field would have
        // passed this — the caller said "image/png" and it was believed.
        mockDetectFileType.mockResolvedValue('text/html');
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(
            submission({ mimeType: 'image/png', fileName: 'photo.png' })
        );

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid file type/i);
        expect(mockWriteToLocalDisk).not.toHaveBeenCalled();
    });

    it('rejects an executable named and declared as a document', async () => {
        mockDetectFileType.mockResolvedValue('application/x-msdownload');
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(
            submission({ mimeType: 'application/pdf', fileName: 'invoice.pdf' })
        );

        expect(result.success).toBe(false);
        expect(mockWriteToLocalDisk).not.toHaveBeenCalled();
    });

    it('rejects real content this action does not allow, even though storage-admin\'s broader policy would', async () => {
        // assertAllowedFileType's ALLOWED_MIMES also permits video and Word
        // documents. This action's own policy is narrower (jpg/png/pdf) and
        // must stay that way — calling the broader check would have been the
        // wrong fix.
        mockDetectFileType.mockResolvedValue('video/mp4');
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(
            submission({ mimeType: 'image/png', fileName: 'clip.mp4' })
        );

        expect(result.success).toBe(false);
    });

    it('fails closed when the content cannot be identified', async () => {
        mockDetectFileType.mockResolvedValue(undefined);
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(submission());

        expect(result.success).toBe(false);
        expect(mockWriteToLocalDisk).not.toHaveBeenCalled();
    });

    it('fails closed when the detector itself throws', async () => {
        mockDetectFileType.mockRejectedValue(new Error('Security Error: unable to verify file contents.'));
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(submission());

        expect(result.success).toBe(false);
        expect(mockWriteToLocalDisk).not.toHaveBeenCalled();
    });

    it('still refuses an unauthenticated caller before any file inspection', async () => {
        actAs(null);
        mockDetectFileType.mockResolvedValue('image/png');
        const { uploadDocumentAction } = await import('@/app/actions/upload');

        const result: any = await uploadDocumentAction(submission());

        expect(result.success).toBe(false);
        expect(mockDetectFileType).not.toHaveBeenCalled();
    });
});
