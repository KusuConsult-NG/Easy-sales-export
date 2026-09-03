/**
 * @jest-environment node
 */

/**
 *   #273 THE CERTIFICATE UPLOAD ROUTE ACCEPTED A FILE OF ANY SIZE, AND
 *        MATERIALISED IT IN MEMORY.
 *
 *        api/certificates/upload/route.ts does
 *
 *            const buffer = Buffer.from(await file.arrayBuffer());
 *
 *        with no size check anywhere before it — the whole upload is pulled
 *        into the Node process's heap. Any signed-in member can POST a
 *        multi-gigabyte body and take the process down, and there is no rate
 *        limit on the route either, so they can do it repeatedly.
 *
 *        SIX OF THE SEVEN CALLERS OF uploadFileToStorage BOUND THE SIZE. This
 *        one did not, and it is the live path: its OWN comment says so, about a
 *        different defect on the same line —
 *
 *            "#144 fixed the identical line in uploadCertificateAction — but
 *             that action has no callers, and THIS route is what
 *             /dashboard/certificates posts to, so the live path kept the
 *             defect while the audited one was corrected."
 *
 *        The same sentence applies to the size limit. actions/certificates.ts
 *        reads MAX_CERTIFICATE_SIZE_MB and refuses anything larger; the route
 *        beside it reads nothing. Twice now, on the same pair of files, for two
 *        different rules.
 *
 *        THE CEILING GOES IN THE SHARED UPLOADER TOO. Putting it only on the
 *        route fixes the seventh caller and leaves the eighth to be written
 *        without it — which is precisely how this happened. uploadFileToStorage
 *        now refuses an oversized file itself, and the route keeps the tighter
 *        certificate-specific limit its sibling action already applied.
 *
 *        CHECKED BEFORE arrayBuffer(). `file.size` is available without
 *        materialising anything, so the guard has to run first or it allocates
 *        the very thing it is meant to refuse.
 *
 *   #274 AND rateLimitConfig.fileUpload WAS DECLARED AND USED BY NOTHING.
 *
 *        20 uploads per hour, defined in rate-limits.config.ts, with zero live
 *        readers — the third configured control this audit has found switched
 *        off by never being wired up (maxOrderAmount in #272,
 *        additionalItemFee recorded there, this).
 *
 *        Unlike additionalItemFee this one costs nothing to apply and is
 *        plainly a control rather than a pricing choice, so it is wired to the
 *        upload route rather than left for a decision.
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
let uploaded = 0;

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    uploaded = 0;

    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';

    mockDetect.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });

    global.fetch = (async () => {
        uploaded += 1;
        return { ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/x' }) };
    }) as any;
});

afterEach(() => {
    process.env = { ...REAL_ENV };
    jest.restoreAllMocks();
});

/**
 * A File that REPORTS a size without allocating one.
 *
 * Allocating a real 60MB buffer in a unit test would be slow and would defeat
 * the point — the guard exists precisely so that nothing that large is ever
 * materialised, and it reads `file.size`.
 */
function fileOfSize(bytes: number, name = 'cert.pdf'): File {
    const f = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
    Object.defineProperty(f, 'size', { value: bytes, configurable: true });
    return f;
}

const upload = async (file: File) => {
    const { uploadFileToStorage } = await import('@/lib/storage-admin');
    return uploadFileToStorage(file, 'certificates/u1/cert.pdf');
};

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#273 — the shared uploader refuses an oversized file', () => {
    it('REFUSES 60MB, SO NO CALLER CAN OMIT THE CHECK', () => {
        // The point of putting it here: six of seven callers bounded the size
        // and the seventh did not. The eighth would have been written the same
        // way.
        return expect(upload(fileOfSize(60 * 1024 * 1024))).rejects.toThrow(/too large/i);
    });

    it('AND REFUSES BEFORE ANYTHING IS ALLOCATED OR SENT', async () => {
        // `file.size` needs no buffer. A guard that ran after arrayBuffer()
        // would allocate the very thing it exists to refuse.
        await expect(upload(fileOfSize(60 * 1024 * 1024))).rejects.toThrow();

        expect(uploaded).toBe(0);
        const src = codeOnly('src/lib/storage-admin.ts');
        expect(src.indexOf('file.size >')).toBeLessThan(src.indexOf('await file.arrayBuffer()'));
    });

    it('accepts an ordinary file, so the ceiling is not a wall', () => {
        // Vacuity guard: a limit of zero would satisfy every assertion above
        // and break every upload in the platform.
        return expect(upload(fileOfSize(2 * 1024 * 1024))).resolves.toContain('cloudinary');
    });

    it('the ceiling is configurable and defaults to the same 50MB /api/upload uses', async () => {
        process.env.MAX_UPLOAD_SIZE_MB = '1';
        jest.resetModules();

        await expect(upload(fileOfSize(2 * 1024 * 1024))).rejects.toThrow(/too large/i);
    });

    it('an unreadable size is refused rather than waved through', async () => {
        // #112's lesson again: a guard that cannot evaluate is not a guard.
        await expect(upload(fileOfSize(NaN as any))).rejects.toThrow();
        expect(uploaded).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#273 — the certificate route bounds it too, and earlier', () => {
    const ROUTE = 'src/app/api/certificates/upload/route.ts';

    it('READS THE SAME LIMIT ITS SIBLING ACTION ALREADY APPLIED', () => {
        // actions/certificates.ts reads MAX_CERTIFICATE_SIZE_MB; the route
        // beside it read nothing, and the route is the live path.
        const src = codeOnly(ROUTE);

        expect(src).toContain('MAX_CERTIFICATE_SIZE_MB');
        expect(codeOnly('src/app/actions/certificates.ts')).toContain('MAX_CERTIFICATE_SIZE_MB');
    });

    it('and checks it before reading the file into memory', () => {
        const src = codeOnly(ROUTE);
        const guard = src.indexOf('MAX_CERTIFICATE_SIZE_MB');
        const allocate = src.indexOf('await file.arrayBuffer()');

        expect(guard).toBeGreaterThan(-1);
        expect(allocate).toBeGreaterThan(guard);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#274 — the fileUpload rate limit is wired to something', () => {
    it('IS NO LONGER A CONFIG NOBODY READS', async () => {
        const { rateLimitConfig } = await import('@/lib/rate-limits.config');
        expect(rateLimitConfig.fileUpload.maxRequests).toBeGreaterThan(0);

        const src = codeOnly('src/app/api/certificates/upload/route.ts');
        expect(src).toContain('rateLimitConfig.fileUpload');
    });

    it('AND THE ROUTE ACTUALLY REFUSES ONCE THE BUCKET IS SPENT', async () => {
        //   Executed, not read.
        //
        //   The first version of this asserted only that the source CONTAINED
        //   `.check(` and `429`. Disabling the branch — `if (false)` in place
        //   of `if (!limit.success)` — left both strings in the file, so the
        //   test passed against a limiter that was wired up and switched off.
        //   It did not catch its own mutation.
        //
        //   A control that is present in the source and inert at runtime is
        //   the exact failure this whole finding is about, so reading source
        //   was the wrong instrument for it.
        jest.resetModules();

        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'cert-flooder', email: 'c@e.test', roles: ['general_user'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        installFakeDb();

        const { POST } = await import('@/app/api/certificates/upload/route');

        const post = () => POST({
            headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
            json: async () => ({}),
        } as any);

        // fileUpload is 20/hour. The 21st call must be refused BEFORE the
        // missing-fields 400 the body would otherwise earn — the limiter runs
        // first, which is the point.
        const statuses: number[] = [];
        for (let i = 0; i < 25; i++) statuses.push((await post()).status);

        expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
        expect(statuses).toContain(429);
    });
});
