/**
 * @jest-environment node
 */

/**
 * /api/upload trusted the file type the caller declared.
 *
 * WHAT WAS WRONG
 * --------------
 * The route validated `file.type` — the Content-Type the CLIENT wrote into the
 * multipart body. It is a claim, not a fact: arbitrary bytes can be posted as
 * "image/png" or "application/pdf".
 *
 * `src/lib/storage-admin.ts` has always read the magic bytes and failed closed,
 * and the marketplace product path goes through it. This route — the generic one
 * behind MasterUploader, and therefore the one most uploads actually use — did
 * not. **The stricter check was on the less-travelled path**, the same shape as
 * the vendor writers, the escrow confirm, and the delivery/receipt split.
 *
 * WHY IT MATTERS HERE SPECIFICALLY
 * --------------------------------
 * A file declared `application/pdf` goes to Cloudinary with resource_type "raw",
 * and the stored public_id keeps the caller's extension. So a PDF-declared file
 * named `.html` is served as HTML from the business's own Cloudinary account.
 *
 * WHY THE DETECTOR IS MOCKED HERE
 * -------------------------------
 * `file-type` is pure ESM (`"type": "module"`) and this jest setup is CJS, so
 * the dynamic import inside assertAllowedFileType throws under test. Since the
 * function fails closed, an unmocked test rejects EVERYTHING — including a real
 * PNG — and every negative assertion passes for the wrong reason.
 *
 * That is not hypothetical: the first version of this file asserted only
 * rejections and went green against a validator that blocked all uploads. The
 * positive cases are what caught it.
 *
 * So the detector is mocked and these tests cover the POLICY: what is on the
 * allow list, and what happens when detection fails. Real magic-byte detection
 * was verified separately against the actual library:
 *
 *     node -e "import('file-type').then(async m =>
 *       console.log(await m.fileTypeFromBuffer(Buffer.from([0x89,0x50,0x4e,0x47,...]))))"
 *     -> { ext: 'png', mime: 'image/png' }
 *
 * which is the part jest cannot reach, not a part that does not work.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDetect = jest.fn() as jest.Mock<any>;

jest.mock('file-type', () => ({
    fileTypeFromBuffer: (...a: any[]) => mockDetect(...a),
}), { virtual: true });

const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function assertType(mime: string | undefined, fileName = 'f.png') {
    mockDetect.mockResolvedValue(mime ? { ext: mime.split('/')[1], mime } : undefined);
    const { assertAllowedFileType } = await import('@/lib/storage-admin');
    return assertAllowedFileType(BYTES, fileName);
}

describe('assertAllowedFileType — the policy /api/upload was missing', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('accepts content that really is a PNG', async () => {
        // Vacuity guard, and the one that matters: without it, a validator that
        // rejects everything passes every test below while breaking all uploads.
        // Resolves to the DETECTED type as of #263 — it always knew it and
        // used to discard it, which is how storage-admin ended up deciding the
        // stored extension from the filename instead.
        await expect(assertType('image/png')).resolves.toBe('image/png');
    });

    it('accepts content that really is a PDF', async () => {
        await expect(assertType('application/pdf', 'statement.pdf')).resolves.toBe('application/pdf');
    });

    it('rejects HTML however it is declared', async () => {
        // THE case. The route's own allowlist passes this, because the caller
        // said "image/png" and the route believed them.
        await expect(assertType('text/html', 'photo.png')).rejects.toThrow(/not allowed/i);
    });

    it('rejects an executable named as a document', async () => {
        await expect(assertType('application/x-msdownload', 'invoice.pdf')).rejects.toThrow(/not allowed/i);
    });

    it('fails closed when the content cannot be identified', async () => {
        // An unrecognised buffer is not evidence of safety.
        await expect(assertType(undefined, 'notes.pdf')).rejects.toThrow(/not allowed/i);
    });

    it('fails closed when detection itself throws', async () => {
        // The previous implementation swallowed this, which silently disabled
        // content validation entirely — the failure mode that looks like
        // everything working.
        mockDetect.mockRejectedValue(new Error('module load failed'));
        const { assertAllowedFileType } = await import('@/lib/storage-admin');

        await expect(assertAllowedFileType(BYTES, 'x.png')).rejects.toThrow(/verify file contents/i);
    });

    it('decides on the bytes, not the filename', async () => {
        // A real PNG called .exe is still a PNG. Blocking it would be theatre,
        // and theatre is what the declared-type check already was.
        await expect(assertType('image/png', 'totally-a-virus.exe')).resolves.toBe('image/png');
    });
});

describe('the route actually calls it', () => {
    it('validates the content before signing or sending anything', async () => {
        // Order matters: validating after the upload is signed and sent would
        // reject the response, not the file.
        //
        // It looks for the CALL, `await assertAllowedFileType(`, not the bare
        // name. The first version searched for the name and matched the IMPORT
        // statement at the top of the file — so deleting the call left the test
        // green. Verified by deleting it.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/api/upload/route.ts'), 'utf-8');

        const callAt = src.indexOf('await assertAllowedFileType(');
        const signAt = src.indexOf('createHash');
        const sendAt = src.indexOf('api.cloudinary.com');

        expect(callAt).toBeGreaterThan(-1);
        expect(callAt).toBeLessThan(signAt);
        expect(callAt).toBeLessThan(sendAt);
    });
});
