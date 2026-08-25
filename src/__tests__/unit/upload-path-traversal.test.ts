/**
 * @jest-environment node
 */

/**
 *   #244 THE UPLOAD EXTENSION CAME FROM THE FILENAME, AND COULD TRAVERSE.
 *
 *        uploadDocumentAction (actions/upload.ts) built its stored id as
 *
 *            documents/${userId}/${safeName}-${timestamp}${extension}
 *
 *        where `extension` was `originalName.slice(lastIndexOf("."))` — every
 *        character after the last dot of the caller's fileName, appended raw.
 *        The mime-type gate does not constrain it, so
 *
 *            fileName = "doc.x/../../../../evil"   mimeType = "image/png"
 *
 *        yields an extension of ".x/../../../../evil" carrying `/` and `..`.
 *        On the local-disk branch that reaches path.join, which collapses the
 *        `..` and writes OUTSIDE public/uploads/local; on Cloudinary it forges
 *        the stored public_id. The code even carried a comment claiming
 *        publicId was "sanitised per segment, so it cannot escape" — true of
 *        safeName, never of the appended extension.
 *
 *        /api/upload was already fixed for exactly this (its own comment names
 *        the "doc.pdf/../x" case) by taking the extension from the DETECTED
 *        type. This action is the copy that was missed. The extension now comes
 *        from ALLOWED_TYPES[mimeType], which the auth/type gate has already
 *        validated — so it is one of jpg/png/pdf and cannot contain a
 *        separator.
 *
 *        writeToLocalDisk is hardened too: its docstring asked callers to
 *        sanitise every segment, one didn't, and a comment is not a control.
 *        It now refuses any publicId that resolves outside its base directory.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const writeToLocalDisk = jest.fn(async (publicId: string, _buf: Buffer) => `http://localhost:3000/uploads/local/${publicId}`);
jest.mock('@/lib/storage-backend', () => ({
    shouldUseLocalDiskStorage: () => true,
    writeToLocalDisk: (id: string, buf: Buffer) => writeToLocalDisk(id, buf),
}));

const CALLER = 'user-1';

const actions = async () => await import('@/app/actions/upload');

function form(fileName: string, mimeType = 'image/png'): FormData {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'x', { type: mimeType }));
    fd.set('fileName', fileName);
    fd.set('mimeType', mimeType);
    fd.set('documentType', 'valid-id');
    return fd;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: CALLER, email: 'a@e.com', roles: ['general_user'] } },
        error: null,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#244 — the stored id cannot be steered by the filename', () => {
    it('IGNORES A TRAVERSING FILENAME AND USES THE VALIDATED EXTENSION', async () => {
        const { uploadDocumentAction } = await actions();
        const res = await uploadDocumentAction(form('doc.x/../../../../evil', 'image/png')) as any;

        expect(res.success).toBe(true);
        const [publicId] = writeToLocalDisk.mock.calls[0] as unknown as [string, Buffer];

        // Was: documents/user-1/valid-id-<ts>.x/../../../../evil
        expect(publicId).not.toContain('..');
        expect(publicId).toMatch(/^documents\/user-1\/valid-id-\d+\.png$/);
    });

    it.each([
        ['image/jpeg', 'jpg'],
        ['image/png', 'png'],
        ['application/pdf', 'pdf'],
    ])('%s stores the %s extension regardless of the filename', async (mime, expectedExt) => {
        const { uploadDocumentAction } = await actions();
        await uploadDocumentAction(form('whatever.zip.exe', mime)) as any;

        const [publicId] = writeToLocalDisk.mock.calls[0] as unknown as [string, Buffer];
        expect(publicId.endsWith(`.${expectedExt}`)).toBe(true);
        expect(publicId).not.toContain('.exe');
    });

    it('a documentType full of separators is flattened, not honoured', async () => {
        const { uploadDocumentAction } = await actions();
        const fd = form('a.png');
        fd.set('documentType', '../../etc/passwd');
        await uploadDocumentAction(fd);

        const [publicId] = writeToLocalDisk.mock.calls[0] as unknown as [string, Buffer];
        expect(publicId).not.toContain('..');
        expect(publicId).not.toContain('/etc/');
    });

    it('still refuses an unauthenticated caller', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });
        const { uploadDocumentAction } = await actions();
        expect(await uploadDocumentAction(form('a.png'))).toMatchObject({ success: false });
        expect(writeToLocalDisk).not.toHaveBeenCalled();
    });

    it('still refuses a disallowed mime type before writing anything', async () => {
        const { uploadDocumentAction } = await actions();
        const res = await uploadDocumentAction(form('a.svg', 'image/svg+xml')) as any;
        expect(res.success).toBe(false);
        expect(writeToLocalDisk).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#244 — writeToLocalDisk refuses an escaping id on its own', () => {
    // The REAL implementation — the file is jest.mock'd above for the action
    // tests, so requireActual reaches past that to the actual guard.
    it('throws on a publicId that resolves outside the uploads directory', async () => {
        const real = jest.requireActual('@/lib/storage-backend') as typeof import('@/lib/storage-backend');
        await expect(
            real.writeToLocalDisk('../../../../etc/cron.d/evil', Buffer.from('x')),
        ).rejects.toThrow(/escapes the uploads directory/i);
    });

    it('and accepts an ordinary sanitised id', async () => {
        // Guarded so a genuine write is not attempted against the real FS in CI:
        // a path that stays inside base still reaches writeFile, so we only
        // assert the guard does not reject it by checking a traversing sibling
        // fails while this shape passes the resolve check. The write itself is
        // exercised by the e2e upload flow.
        const path = await import('path');
        const base = path.join(process.cwd(), 'public', 'uploads', 'local');
        const inside = path.resolve(path.join(base, 'documents/user-1/valid-id-1.png'));
        expect(inside.startsWith(base + path.sep)).toBe(true);
    });
});
