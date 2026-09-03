/**
 * @jest-environment node
 */

/**
 *   #297 THE #291 FIX LANDED ON ONE OF THREE COPIES.
 *
 *        #291 found that MasterUploader retried EVERY failure three times —
 *        a 400 for a disallowed type, a 400 for an oversized file, a 401, and
 *        withRateLimit's 429 with its Retry-After of 60 seconds — and fixed it
 *        there.
 *
 *        There were three copies of that loop, all called uploadWithRetry, all
 *        the same shape:
 *
 *            components/shared/MasterUploader.tsx   fixed by #291
 *            hooks/use-storage.ts                   NOT fixed
 *            lib/storage-upload.ts                  NOT fixed
 *
 *        So after #291 shipped, a rejected 50MB video was still uploaded three
 *        times through the land-listing form and through every caller of the
 *        useStorage hook, and a 429 was still answered by hitting the limiter
 *        twice more inside three seconds.
 *
 *        THIS IS #83's SHAPE, COMMITTED BY ME, AND THE SECOND TIME IN THIS
 *        AUDIT. #83 was "the #36 email-claim fix landed on WAVE only"; #293
 *        was me correcting one half of a page and leaving the other standing.
 *        Here I read one file, fixed what was in it, and did not ask whether
 *        the code was written twice — in a codebase whose single most common
 *        defect class is exactly that.
 *
 * WHY ONE FUNCTION RATHER THAN THREE FIXES
 * ----------------------------------------
 * Patching the two stragglers would have left the class alive: three
 * implementations, correct today, diverging the next time one of them is
 * touched. lib/upload-request.ts is the only place that decides what a retry
 * is for, and the ratchet at the bottom of this file fails if a fourth copy
 * appears.
 *
 * HOW IT WAS FOUND
 * ----------------
 * Triaging the sweep's D5 bucket. The bucket itself was a dead end — of 55
 * swallowed catches, the two adjacent to a write turned out to be a
 * localStorage draft-clear and a course load that renders "not found", neither
 * a defect. The uploader turned up because a `Promise.all` over file uploads
 * matched a bulk-operation scan, and reading it showed the loop #291 was
 * supposed to have fixed.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { postUploadWithRetry, UploadRefused } from '@/lib/upload-request';
import { stripComments } from '@/lib/testing/strip-comments';

const CALLERS = [
    'src/components/shared/MasterUploader.tsx',
    'src/hooks/use-storage.ts',
    'src/lib/storage-upload.ts',
];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (!full.includes('__tests__')) walk(full, out);
        } else if (/\.tsx?$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * THE SHARED STRIPPER, NOT A LOCAL ONE.
 *
 * The first version of this file carried the usual inline
 * `.replace(/\/\*[\s\S]*?\*\//g, '')`, and it reported that MasterUploader does
 * not call postUploadWithRetry — because that component has
 * `accept = "image/*,application/pdf,…"`, and a `/*` inside a STRING opens a
 * block comment for the naive regex, which then ate everything down to the
 * next real `*\/` — including the call.
 *
 * That is exactly what lib/testing/strip-comments.ts exists for, and what
 * strip-comments.test.ts has been tracking as a KNOWN list of files the naive
 * version mangles. Writing another naive copy in a new suite is how that list
 * grows.
 */
function codeOnly(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const originalFetch = global.fetch;
const mockFetch = jest.fn() as jest.Mock<any>;

function response(status: number, body: any) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = mockFetch;
});

afterEach(() => {
    (global as any).fetch = originalFetch;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#297 — the one implementation', () => {
    it('A 429 IS ASKED ONCE', async () => {
        mockFetch.mockResolvedValue(response(429, { error: 'Too many requests' }));

        await expect(postUploadWithRetry(new FormData())).rejects.toThrow(/too many requests/i);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('and every other 4xx too, as a typed refusal', async () => {
        for (const status of [400, 401, 403, 413]) {
            mockFetch.mockReset();
            mockFetch.mockResolvedValue(response(status, { success: false, error: 'nope' }));

            await expect(postUploadWithRetry(new FormData())).rejects.toBeInstanceOf(UploadRefused);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        }
    });

    it('A 5xx IS RETRIED, which is what a retry is for', async () => {
        // Vacuity guard: refusing to retry anything would satisfy everything
        // above and make all three callers worse on a flaky connection.
        mockFetch
            .mockResolvedValueOnce(response(500, { success: false, error: 'boom' }))
            .mockResolvedValueOnce(response(200, { success: true, url: 'https://cdn/x', path: 'p/x' }));

        const r = await postUploadWithRetry(new FormData());

        expect(r.url).toBe('https://cdn/x');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('and a network fault, and a body that is not JSON', async () => {
        mockFetch
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('<'); } })
            .mockResolvedValueOnce(response(200, { success: true, url: 'https://cdn/x' }));

        await postUploadWithRetry(new FormData(), { attempts: 3 });

        expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 10000);

    it('an abort is never retried', async () => {
        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        mockFetch.mockRejectedValue(abortError);

        await expect(postUploadWithRetry(new FormData())).rejects.toThrow('aborted');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('onRetry reports the attempt, which is how the three callers show progress', async () => {
        const seen: number[] = [];
        mockFetch
            .mockResolvedValueOnce(response(500, {}))
            .mockResolvedValueOnce(response(200, { success: true, url: 'u' }));

        await postUploadWithRetry(new FormData(), { onRetry: (a) => seen.push(a) });

        expect(seen).toEqual([1]);
    }, 10000);

    it('and a success with no url is not a success', async () => {
        // The route can only be trusted when it returns what it promises.
        mockFetch.mockResolvedValue(response(200, { success: true }));

        await expect(postUploadWithRetry(new FormData(), { attempts: 1 })).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#297 — all three uploaders go through it', () => {
    for (const caller of CALLERS) {
        it(`${caller.split('/').pop()} calls postUploadWithRetry`, () => {
            expect(codeOnly(caller)).toContain('postUploadWithRetry(');
        });

        it(`${caller.split('/').pop()} no longer carries its own loop`, () => {
            const src = codeOnly(caller);

            expect(src).not.toContain('uploadWithRetry = async');
            expect(src).not.toMatch(/attempt < 3/);
        });
    }

    it('NOBODY ELSE POSTS TO /api/upload WITH A RETRY OF THEIR OWN', () => {
        /**
         * The ratchet, and the reason this is a module. A fourth copy is how
         * #291 came back as #297; the next one would come back the same way.
         *
         * Other files DO post to /api/upload — the profile photo, the ID card,
         * village market, the admin export orders page, and two XHR uploads
         * that need upload-progress events. Those are single attempts and are
         * not the defect; what this forbids is a new retry LOOP.
         */
        const offenders: string[] = [];

        for (const full of walk(join(process.cwd(), 'src'))) {
            const rel = full.slice(process.cwd().length + 1);
            if (rel === 'src/lib/upload-request.ts') continue;

            const src = readFileSync(full, 'utf-8');
            if (!/\/api\/upload/.test(src)) continue;

            const code = stripComments(src);

            if (/attempt\s*[<+]|uploadWithRetry|retryCount/.test(code)) {
                offenders.push(rel);
            }
        }

        // Was: MasterUploader.tsx, use-storage.ts, storage-upload.ts.
        expect(offenders).toEqual([]);
    });

    it('and the shared module is the only place a 4xx is judged final', () => {
        const src = codeOnly('src/lib/upload-request.ts');

        expect(src).toMatch(/res\.status >= 400 && res\.status < 500/);

        const elsewhere = walk(join(process.cwd(), 'src'))
            .map((f) => f.slice(process.cwd().length + 1))
            .filter((f) => f !== 'src/lib/upload-request.ts')
            .filter((f) => /status >= 400 && [\w.]*status < 500/.test(readFileSync(join(process.cwd(), f), 'utf-8')));

        expect(elsewhere).toEqual([]);
    });
});
