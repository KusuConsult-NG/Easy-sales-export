/**
 * @jest-environment node
 */

/**
 *   #263 uploadFileToStorage SNIFFED THE FILE, THEN STORED IT AS WHATEVER THE
 *        CALLER SAID IT WAS.
 *
 *        The function reads the magic bytes and fails closed —
 *
 *            const buffer = Buffer.from(await file.arrayBuffer());
 *            await assertAllowedFileType(buffer, file.name);
 *
 *        — and then throws that answer away. Both decisions that depend on the
 *        type were taken from `file.type` and `file.name`, which the client
 *        writes:
 *
 *            const extension  = originalName.slice(originalName.lastIndexOf('.'));
 *            const publicId   = `${safeFolder}/${safeName}-${timestamp}${extension}`;
 *            const resourceType = file.type === 'application/pdf' ? 'raw'
 *                               : file.type.startsWith('video/')  ? 'video'
 *                               : 'image';
 *
 *        THIS IS THE THIRD COPY OF A RULE THAT WAS ALREADY FIXED TWICE.
 *
 *          api/upload/route.ts   EXTENSION_FOR_TYPE[detectedType], and
 *                                resourceType from detectedType — with a
 *                                comment naming this exact attack
 *          actions/upload.ts     `.${ALLOWED_TYPES[mimeType]}` after validating
 *                                mimeType against that same table (#244)
 *          lib/storage-admin.ts  neither. THIS ONE.
 *
 *        And it is not the least-travelled copy. It is the uploader behind
 *        marketplace product images and videos, certificates, export onboarding
 *        documents and the WAVE resource library.
 *
 *        WHAT IT COSTS, IN THE CODEBASE'S OWN WORDS
 *
 *        api/upload/route.ts:212 already wrote it down: "a name ends .html was
 *        stored with that extension, and Cloudinary serves a raw asset by its
 *        extension — so the business's own account served attacker-supplied
 *        HTML from a trusted-looking URL. A PDF only needs '%PDF-' near the
 *        start, so one file can satisfy the magic-byte check and still be a
 *        working HTML page."
 *
 *        Every clause of that applies here unchanged. Declare
 *        `application/pdf` to get resource_type `raw`, name the file `.html`
 *        to choose the Content-Type, and send bytes that begin `%PDF-` so the
 *        detector agrees. The magic-byte check passes, and the stored asset is
 *        an HTML page on the business's Cloudinary account.
 *
 *        The file's own comment claimed the opposite — "safeFolder and safeName
 *        are stripped to [a-zA-Z0-9-_], so publicId cannot traverse out of the
 *        uploads directory". True of both of those. The extension sitting
 *        between them was never stripped at all, and it is the only one of the
 *        three the caller controls.
 *
 *        There is a quieter cost too, and it is probably the one that has been
 *        breaking uploads: a File whose `type` is empty — which is what several
 *        clients send, and what a File reconstructed server-side has — takes
 *        the `else` branch and is uploaded to Cloudinary's IMAGE endpoint. A
 *        PDF posted that way is rejected by Cloudinary, and the member sees
 *        "File upload failed" for a document that is perfectly valid.
 *
 * WHY THE DETECTOR IS MOCKED HERE
 * -------------------------------
 * `file-type` is pure ESM and this jest setup is CJS, so the dynamic import
 * inside detectFileType throws under test and the function fails closed —
 * meaning an unmocked run rejects every file and the negative assertions below
 * would all pass for the wrong reason. upload-content-validation.test.ts
 * records the same constraint, and records that real magic-byte detection was
 * verified separately against the actual library.
 *
 * The positive cases here are the vacuity guard: if the upload path stopped
 * working entirely, "does not store .html" would still be true.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const mockDetect = jest.fn() as jest.Mock<any>;
jest.mock('file-type', () => ({
    fileTypeFromBuffer: (...a: any[]) => mockDetect(...a),
}), { virtual: true });

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const REAL_ENV = { ...process.env };

/** Captured from the request storage-admin actually sent to Cloudinary. */
interface Sent {
    url: string;
    publicId: string;
    blobType: string;
}

let sent: Sent | null = null;

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    sent = null;

    // Cloudinary configured, so shouldUseLocalDiskStorage() is false and the
    // remote branch — the one production takes — is what runs.
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';

    global.fetch = (async (url: any, init: any) => {
        const form = init.body as FormData;
        const file = form.get('file') as Blob;
        sent = {
            url: String(url),
            publicId: String(form.get('public_id')),
            blobType: file.type,
        };
        return {
            ok: true,
            json: async () => ({ secure_url: 'https://res.cloudinary.com/test-cloud/x' }),
        };
    }) as any;
});

afterEach(() => {
    process.env = { ...REAL_ENV };
    jest.restoreAllMocks();
});

/**
 * Upload a file whose CONTENT is `detected` while its declared type is
 * `declaredType` and its name is `fileName` — the disagreement is the point.
 */
async function upload(opts: {
    detected: string | undefined;
    declaredType: string;
    fileName: string;
    destination?: string;
}) {
    mockDetect.mockResolvedValue(
        opts.detected ? { ext: opts.detected.split('/')[1], mime: opts.detected } : undefined,
    );

    const { uploadFileToStorage } = await import('@/lib/storage-admin');
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], opts.fileName, {
        type: opts.declaredType,
    });

    return uploadFileToStorage(file, opts.destination ?? 'products/p1/image', true);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#263 — the stored extension comes from the bytes, not the filename', () => {
    it('DOES NOT STORE A PDF AS .html BECAUSE THE FILENAME SAID SO', async () => {
        // The attack, end to end: content really is a PDF (so the magic-byte
        // gate is satisfied), declared application/pdf (so resource_type is
        // raw), named .html (so Cloudinary serves it as a page).
        await upload({
            detected: 'application/pdf',
            declaredType: 'application/pdf',
            fileName: 'invoice.html',
        });

        // Was: products/p1/image-<ts>.html
        expect(sent!.publicId).not.toContain('.html');
        expect(sent!.publicId).toMatch(/\.pdf$/);
    });

    it.each([
        ['application/pdf', '.pdf'],
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['video/mp4', '.mp4'],
    ])('%s is stored with %s whatever the file is called', async (detected, ext) => {
        await upload({ detected, declaredType: detected, fileName: 'anything.exe' });

        expect(sent!.publicId.endsWith(ext)).toBe(true);
        expect(sent!.publicId).not.toContain('.exe');
    });

    it('a filename carrying separators cannot inject path segments', async () => {
        // safeFolder and safeName are stripped per segment; the extension was
        // appended raw between them, so it was the way past that sanitiser.
        await upload({
            detected: 'application/pdf',
            declaredType: 'application/pdf',
            fileName: 'doc.pdf/../../../../evil',
        });

        expect(sent!.publicId).not.toContain('..');
        expect(sent!.publicId).toBe(
            sent!.publicId.replace(/[^a-zA-Z0-9\-_./]/g, '!'),
        );
        expect(sent!.publicId.split('/')).toHaveLength(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#263 — the Cloudinary resource type comes from the bytes too', () => {
    it('A PNG DECLARED AS application/pdf IS NOT STORED AS A RAW ASSET', async () => {
        // Declaring pdf is what buys `raw`, and `raw` is what makes the
        // extension decide the Content-Type. Take the declaration away and the
        // whole route to serving HTML closes.
        await upload({
            detected: 'image/png',
            declaredType: 'application/pdf',
            fileName: 'photo.png',
        });

        expect(sent!.url).toContain('/image/upload');
        expect(sent!.url).not.toContain('/raw/upload');
    });

    it('A PDF WITH NO DECLARED TYPE STILL GOES TO THE raw ENDPOINT', async () => {
        // The quiet half of this defect. Several clients send an empty
        // Content-Type for a picked file, and a File reconstructed server-side
        // has none at all — so `file.type` was "" and the PDF was posted to
        // Cloudinary's image endpoint, which refuses it. The member saw
        // "File upload failed" on a perfectly valid document.
        await upload({ detected: 'application/pdf', declaredType: '', fileName: 'statement.pdf' });

        expect(sent!.url).toContain('/raw/upload');
    });

    it('a video declared as an image still goes to the video endpoint', async () => {
        await upload({ detected: 'video/mp4', declaredType: 'image/png', fileName: 'clip.mp4' });

        expect(sent!.url).toContain('/video/upload');
    });

    it('and the blob we send is labelled with the detected type', async () => {
        // Cloudinary reads this too. Sending the caller's label alongside a
        // corrected resource_type would just move the disagreement.
        await upload({ detected: 'image/png', declaredType: 'application/pdf', fileName: 'photo.png' });

        expect(sent!.blobType).toBe('image/png');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#263 — the uploads that should work still work', () => {
    // Vacuity guard. Every assertion above is about something NOT happening,
    // and a function that rejected everything would satisfy all of them.
    it('uploads an ordinary product image and returns the delivery URL', async () => {
        const url = await upload({
            detected: 'image/png',
            declaredType: 'image/png',
            fileName: 'tomatoes.png',
            destination: 'products/p1/tomatoes.png',
        });

        expect(url).toBe('https://res.cloudinary.com/test-cloud/x');
        expect(sent!.publicId).toMatch(/^products\/p1\/tomatoes-\d+\.png$/);
    });

    it('still refuses content that is not on the allow list', async () => {
        await expect(
            upload({ detected: 'text/html', declaredType: 'image/png', fileName: 'photo.png' }),
        ).rejects.toThrow(/not allowed/i);
        expect(sent).toBeNull();
    });

    it('still refuses content it cannot identify', async () => {
        await expect(
            upload({ detected: undefined, declaredType: 'image/png', fileName: 'photo.png' }),
        ).rejects.toThrow(/not allowed/i);
        expect(sent).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#263 — one table, not a fourth copy of it', () => {
    /**
     * The rule had three implementations and two of them were right, which is
     * exactly why the third survived two rounds of fixing it. A ratchet on the
     * line, not on the file: a per-file exemption is a hole the size of one
     * line, which is what #256 and #262 both found.
     */
    const UPLOADERS = [
        'src/lib/storage-admin.ts',
        'src/app/api/upload/route.ts',
        'src/app/actions/upload.ts',
    ];

    function codeOnly(rel: string): string {
        return readFileSync(join(process.cwd(), rel), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((l) => !l.trim().startsWith('//'))
            .map((l) => l.replace(/\s\/\/.*$/, ''))
            .join('\n');
    }

    it('finds every uploader, so the checks below are not vacuous', () => {
        for (const f of UPLOADERS) {
            expect(codeOnly(f).length).toBeGreaterThan(200);
        }
    });

    it('NO UPLOADER TAKES ITS STORED EXTENSION FROM THE FILENAME', () => {
        const offenders = UPLOADERS.flatMap((f) =>
            codeOnly(f)
                .split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line }))
                .filter(({ line }) => /lastIndexOf\(\s*["'`]\.["'`]\s*\)/.test(line)),
        ).map((o) => o.at);

        // Was: src/lib/storage-admin.ts, on the line that built `extension`.
        expect(offenders).toEqual([]);
    });

    it('NO UPLOADER PICKS ITS RESOURCE TYPE FROM A CLIENT-DECLARED TYPE', () => {
        const offenders = UPLOADERS.flatMap((f) =>
            codeOnly(f)
                .split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line }))
                // `file.type` is the multipart Content-Type the client wrote.
                // Reading it to LABEL something is fine; branching on it to
                // decide how the asset is stored is the defect.
                .filter(({ line }) =>
                    /file\.type\s*(===|==|\.startsWith)/.test(line)),
        ).map((o) => o.at);

        expect(offenders).toEqual([]);
    });

    it('and the extension table lives in one place', () => {
        // api/upload had its own EXTENSION_FOR_TYPE. Two tables drift; this
        // audit has watched it happen with the loan multiplier, the WAVE
        // commission rate and the eligibility rule.
        const route = codeOnly('src/app/api/upload/route.ts');

        expect(route).toContain('extensionForType');
        expect(route).not.toMatch(/const\s+EXTENSION_FOR_TYPE/);
    });
});
