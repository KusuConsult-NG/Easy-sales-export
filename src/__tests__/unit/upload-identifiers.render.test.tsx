/**
 * @jest-environment jsdom
 */

/**
 *   #291 THE UPLOADER RETRIED REFUSALS, INCLUDING THE RATE LIMITER'S.
 *   #292 AND MANUFACTURED THE STORAGE PATH, THROWING AWAY THE REAL ONE.
 *
 *        MasterUploader is the file control behind cooperative onboarding's ID
 *        documents, the legacy import's ID/passport/proof-of-address, and the
 *        academy's course material. It wrapped every upload in:
 *
 *            if (!res.ok || !resData.success || !resData.url) throw ...
 *            catch { if (attempt < 3) { backoff; retry } }
 *
 *        /api/upload refuses with 400 for a disallowed type and for a file over
 *        50MB, 401 when the session has gone, and — through withRateLimit — 429
 *        with `{ error }` and a Retry-After of 60 seconds. None of those change
 *        on a second ask.
 *
 *        So a 50MB video rejected for its type was uploaded THREE TIMES, 150MB
 *        of somebody's data allowance, before they were told the type was
 *        wrong. And a 429 was answered by hitting the limiter twice more inside
 *        three seconds — the one response guaranteed to keep them limited. #76
 *        was about eight rate-limit configs sharing one namespace; this is the
 *        client spending that budget on answers it already had.
 *
 *        #292: the route returns `path: publicId` — the Cloudinary public_id,
 *        which is the handle for transforming, restricting or DELETING the
 *        asset. The component ignored it:
 *
 *            const uploadId = crypto.randomUUID();
 *            const storagePath = `${uploadFolder}/${uploadId}_${file.name}`;
 *            onComplete({ url: result.url, path: storagePath, id: uploadId });
 *
 *        That string names nothing on any server. It is a random UUID and the
 *        name of a file on the uploader's own machine, handed to every caller
 *        in a field called `path`. #284's shape: a manufactured value sitting
 *        where a real one belongs, indistinguishable at the call site.
 *
 * WHAT IT DID NOT COST, STATED PLAINLY
 * ------------------------------------
 * Nothing in the database is wrong. All five call sites read `url` and ignore
 * `path`, so the fabricated string was never stored. This is a fix to what the
 * component ASSERTS, not a repair of bad data — and the pinned test at the
 * bottom is about what the missing identifier makes impossible.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const UPLOADER = 'src/components/shared/MasterUploader.tsx';
const ERASURE = 'src/lib/user-erasure.ts';

const showToast = jest.fn();
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
}));

import MasterUploader from '@/components/shared/MasterUploader';

const originalFetch = global.fetch;
const mockFetch = jest.fn() as jest.Mock<any>;

function jsonResponse(status: number, body: any) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

/** Renders the uploader and drops a small PDF on its file input. */
async function upload(onComplete = jest.fn(), onError = jest.fn()) {
    const user = userEvent.setup();
    const { container } = render(
        <MasterUploader
            label="Government-issued ID"
            folder="kyc/identity"
            moduleId="cooperative"
            onComplete={onComplete}
            onError={onError}
        />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    await user.upload(input, new File(['x'], 'id.pdf', { type: 'application/pdf' }));
    return { onComplete, onError };
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = mockFetch;
});

afterEach(() => {
    (global as any).fetch = originalFetch;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#291 — a refusal is not retried', () => {
    it('A 429 IS ASKED ONCE. Hitting a rate limiter again is the worst answer.', async () => {
        // The sharpest case. withRateLimit returns `{ error }` with
        // Retry-After: 60, and the old loop came back twice within three
        // seconds, guaranteeing the person stayed limited.
        mockFetch.mockResolvedValue(jsonResponse(429, { error: 'Too many requests' }));

        const { onError } = await upload();

        await waitFor(() => expect(onError).toHaveBeenCalled());
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(await screen.findByText(/too many requests/i)).toBeTruthy();
    });

    it('AND SO IS A REJECTED FILE TYPE — 50MB uploaded once, not three times', async () => {
        mockFetch.mockResolvedValue(jsonResponse(400, {
            success: false,
            error: 'Invalid file type. Allowed: JPG, PNG, WebP, PDF, MP4, MOV, WebM.',
        }));

        const { onError } = await upload();

        await waitFor(() => expect(onError).toHaveBeenCalled());
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('and a 401 — the session does not come back by asking twice', async () => {
        mockFetch.mockResolvedValue(jsonResponse(401, { success: false, error: 'Authentication required' }));

        const { onError } = await upload();

        await waitFor(() => expect(onError).toHaveBeenCalled());
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('the reason the server gave is what the person is shown', async () => {
        // Refusing to retry is only an improvement if the answer is surfaced.
        mockFetch.mockResolvedValue(jsonResponse(400, {
            success: false, error: 'File is too large. Maximum allowed size is 50MB.',
        }));

        await upload();

        expect(await screen.findByText(/maximum allowed size is 50MB/i)).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#291 — a fault IS retried, which is what the loop is for', () => {
    it('A 5xx IS TRIED AGAIN and can succeed on the second attempt', async () => {
        // Vacuity guard. Refusing to retry anything would pass every test above
        // and make the component worse on a flaky connection.
        mockFetch
            .mockResolvedValueOnce(jsonResponse(500, { success: false, error: 'server exploded' }))
            .mockResolvedValueOnce(jsonResponse(200, { success: true, url: 'https://cdn/x.pdf', path: 'kyc/identity/x' }));

        const { onComplete } = await upload();

        await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('and so is a network error, which has no status at all', async () => {
        mockFetch
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse(200, { success: true, url: 'https://cdn/x.pdf', path: 'kyc/identity/x' }));

        const { onComplete } = await upload();

        await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#292 — the identifier is the one the server stored under', () => {
    it('onComplete RECEIVES THE ROUTE\'S path, NOT A FABRICATED ONE', async () => {
        // Was: `${folder}/${crypto.randomUUID()}_${localFileName}` — a string
        // naming nothing, in a field called `path`.
        mockFetch.mockResolvedValue(jsonResponse(200, {
            success: true,
            url: 'https://res.cloudinary.com/demo/image/upload/v1/kyc/identity/id-172.pdf',
            path: 'kyc/identity/id-172',
        }));

        const { onComplete } = await upload();

        await waitFor(() => expect(onComplete).toHaveBeenCalled());
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://res.cloudinary.com/demo/image/upload/v1/kyc/identity/id-172.pdf',
            path: 'kyc/identity/id-172',
        }));
    });

    it('and `id` is that same handle, because there is only one identifier here', async () => {
        // Two fields holding two different made-up values is how a fabricated
        // path passed for a real one at five call sites.
        mockFetch.mockResolvedValue(jsonResponse(200, {
            success: true, url: 'https://cdn/x.pdf', path: 'kyc/identity/id-172',
        }));

        const { onComplete } = await upload();

        await waitFor(() => expect(onComplete).toHaveBeenCalled());
        const arg = onComplete.mock.calls[0][0] as any;
        expect(arg.id).toBe('kyc/identity/id-172');
    });

    it('a route that returns no path falls back to the URL, not to a random UUID', async () => {
        // An identifier that at least locates the asset beats one that locates
        // nothing. A UUID here would be the defect again with a fresh face.
        mockFetch.mockResolvedValue(jsonResponse(200, { success: true, url: 'https://cdn/x.pdf' }));

        const { onComplete } = await upload();

        await waitFor(() => expect(onComplete).toHaveBeenCalled());
        const arg = onComplete.mock.calls[0][0] as any;
        expect(arg.path).toBe('https://cdn/x.pdf');
        expect(arg.path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    });

    it('the component no longer mints an id of its own', async () => {
        const src = readFileSync(join(process.cwd(), UPLOADER), 'utf-8')
            .split('\n')
            .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
            .join('\n');

        expect(src).not.toContain('crypto.randomUUID()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#292 — what the missing identifier makes impossible, pinned as OPEN', () => {
    /**
     * NOTHING IN THIS CODEBASE EVER DELETES A CLOUDINARY ASSET.
     *
     * Every reference to api.cloudinary.com is an /upload call — in
     * actions/upload.ts, api/upload/route.ts and lib/storage-admin.ts. There is
     * no destroy, no admin API call, no lifecycle rule in the repository. So
     * every identity document, passport photo and proof of address ever
     * submitted is still there, and per #280 still publicly readable with no
     * expiry.
     *
     * AND #283 — MY OWN CHANGE THIS AUDIT — MAKES THEM UNFINDABLE.
     *
     * userErasurePatch deletes the `documents` field, which is correct as far
     * as it goes: the link stops being on the person's row. But the file does
     * not move, and that field was the platform's only record of WHICH assets
     * belonged to them. The public_id is derivable from a Cloudinary URL, so
     * before erasure a purge is possible by parsing the stored URLs. After
     * erasure it is not: the document stays public and nothing on the platform
     * can say whose it was.
     *
     * So a right-to-erasure request currently removes the evidence rather than
     * the data. That is worth stating precisely rather than softening.
     *
     * NOT FIXED HERE, DELIBERATELY. Deleting production assets is destructive,
     * irreversible, and there is no local Cloudinary to prove it against. The
     * order also matters — the assets have to be destroyed BEFORE the links are
     * dropped — which makes it a change to the erasure flow, not a cleanup
     * script. It belongs with the #280 decision the owner already has open.
     */
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/\.tsx?$/.test(full)) out.push(full);
        }
        return out;
    }

    it('every Cloudinary API call in this repository is still an upload', () => {
        // The measurement behind the note above, kept live. When somebody adds
        // a destroy call this fails, and that is the moment to revisit erasure.
        const endpoints: string[] = [];

        for (const f of walk(join(process.cwd(), 'src'))) {
            const rel = f.slice(process.cwd().length + 1);
            if (rel.includes('__tests__')) continue;
            readFileSync(f, 'utf-8').split('\n').forEach((line) => {
                if (!/api\.cloudinary\.com/.test(line)) return;
                if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
                endpoints.push(`${rel}: ${line.trim().slice(0, 90)}`);
            });
        }

        expect(endpoints.length).toBeGreaterThan(0);
        expect(endpoints.filter((e) => !/upload|csp/.test(e))).toEqual([]);
    });

    it('and the erasure module says so, so the gap is not rediscovered', () => {
        // The note travels with the code that has the gap, not only with this
        // suite.
        expect(readFileSync(join(process.cwd(), ERASURE), 'utf-8'))
            .toMatch(/#292/);
    });
});
