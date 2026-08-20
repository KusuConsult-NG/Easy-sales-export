/**
 * @jest-environment node
 */

/**
 * One rule for where an uploaded file goes, in one file.
 *
 * THE HISTORY THIS GUARDS
 * -----------------------
 * The choice between Cloudinary and a local disk write was written out three
 * times, and every copy drifted:
 *
 *   src/app/api/upload/route.ts   Cloudinary, else local disk in development
 *   src/app/actions/upload.ts     the same rule, hand-copied
 *   src/lib/storage-admin.ts      no local branch at all, just a throw
 *
 * It cost three separate failures:
 *
 *   1. /api/upload was fixed to write locally; the Server Action was not, so
 *      the loan wizard's document step still could not upload.
 *   2. The e2e suite moved to a production build, `NODE_ENV !== "production"`
 *      stopped being true, and the route was widened to recognise a local
 *      stack — but the action was a separate copy and was missed, so the loan
 *      wizard 503'd again. It presented as a missing "Uploaded (1)" counter, not
 *      as "uploads are switched off".
 *   3. storage-admin.ts was never given a local branch at all, so certificates,
 *      marketplace product images, seller verification and marketplace
 *      onboarding could not upload locally either — a large hole in what could
 *      be tested without a real Cloudinary account.
 *
 * So this asserts the STRUCTURE, not just the behaviour: nothing outside
 * src/lib/storage-backend.ts may read the Cloudinary credentials to decide the
 * backend. A fourth copy fails here rather than in six months.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');
const OWNER = join('lib', 'storage-backend.ts');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter(line => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('the storage backend rule has exactly one definition', () => {
    const files = walk(SRC).map(f => ({ file: f, code: codeOf(f) }));

    it('found the source tree (sanity)', () => {
        // Without this a bad path empties every check below and the file passes
        // having asserted nothing.
        expect(files.length).toBeGreaterThan(100);
        expect(files.some(f => f.file.endsWith(OWNER))).toBe(true);
    });

    it('only storage-backend.ts DECIDES the backend', () => {
        // Reading the credentials is fine and necessary — the three upload paths
        // still need cloudName/apiKey/apiSecret to build and sign the Cloudinary
        // request. What must not be duplicated is the DECISION.
        //
        // So the offence is specifically a file that re-derives the choice: a
        // Cloudinary credential read in the same file as a NODE_ENV comparison,
        // which is precisely the shape all three drifting copies had.
        const offenders = files
            .filter(f => !f.file.endsWith(OWNER))
            .filter(f => !f.file.endsWith(join('lib', 'env-validator.ts')))
            .filter(f =>
                /process\.env\.CLOUDINARY_API_(KEY|SECRET)/.test(f.code) &&
                /NODE_ENV\s*!==?\s*["']production["']/.test(f.code)
            )
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(
            offenders.length === 0
                ? 'ok'
                : `These re-derive the storage backend from the environment, which is how the ` +
                  `rule ended up with three drifting copies. Call shouldUseLocalDiskStorage() ` +
                  `from @/lib/storage-backend instead: ${offenders.join(', ')}`
        ).toBe('ok');
    });

    it('no UPLOAD path re-implements the loopback test', () => {
        // The other half of the decision. A second copy of this test is how "is
        // the stack local" starts meaning two different things — and one of them
        // will be the one that accepts localhost.evil.example.com.
        //
        // Scoped to files that actually DECIDE or IMPLEMENT local storage.
        //
        // A looser filter on "mentions cloudinary" flagged src/lib/csp.ts, which
        // lists Cloudinary in its image-src allowlist and loopback in its
        // development CSP allowances — entirely unrelated, and exactly the kind
        // of false positive that gets a check deleted rather than fixed.
        const offenders = files
            .filter(f => !f.file.endsWith(OWNER))
            .filter(f => /useLocalDisk|writeToLocalDisk/.test(f.code))
            .filter(f => /127\.0\.0\.1|\[::1\]/.test(f.code))
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('every file that decides gets its answer from the helper', () => {
        // Belt and braces: wherever `useLocalDisk` is defined, it must come from
        // the shared function rather than from an inline expression.
        const offenders = files
            .filter(f => /useLocalDisk\s*=/.test(f.code))
            .filter(f => !/useLocalDisk\s*=\s*shouldUseLocalDiskStorage\s*\(\s*\)/.test(f.code))
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('nothing outside storage-backend.ts writes into public/uploads itself', () => {
        // The second half of the duplication: two hand-copied local-disk writers
        // that both had to get the absolute-URL contract right, and only did
        // because the bug was found twice.
        const offenders = files
            .filter(f => !f.file.endsWith(OWNER))
            .filter(f => /["'`]uploads["'`]\s*,\s*["'`]local["'`]/.test(f.code))
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('the three upload paths all go through the shared helper', () => {
        // Vacuity guard: the checks above would also pass if the local-disk
        // branch had simply been deleted everywhere.
        for (const rel of [
            join('app', 'api', 'upload', 'route.ts'),
            join('app', 'actions', 'upload.ts'),
            join('lib', 'storage-admin.ts'),
        ]) {
            const code = codeOf(join(SRC, rel));
            expect(
                /shouldUseLocalDiskStorage\s*\(/.test(code) ? 'ok' : `${rel} does not consult shouldUseLocalDiskStorage`
            ).toBe('ok');
            expect(
                /writeToLocalDisk\s*\(/.test(code) ? 'ok' : `${rel} never writes to local disk`
            ).toBe('ok');
        }
    });
});

describe('the rule itself', () => {
    const ORIGINAL = { ...process.env };

    function setEnv(env: Record<string, string | undefined>) {
        for (const [k, v] of Object.entries(env)) {
            if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
            else (process.env as Record<string, string>)[k] = v;
        }
    }

    beforeEach(() => {
        setEnv({
            NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: undefined,
            CLOUDINARY_API_KEY: undefined,
            CLOUDINARY_API_SECRET: undefined,
            NEXT_PUBLIC_SUPABASE_URL: undefined,
        });
    });

    afterEach(() => {
        for (const k of Object.keys(process.env)) {
            if (!(k in ORIGINAL)) delete (process.env as Record<string, string | undefined>)[k];
        }
        Object.assign(process.env, ORIGINAL);
    });

    /** Re-imported per case: the functions read process.env at call time. */
    async function load() {
        return await import('@/lib/storage-backend');
    }

    it('a configured Cloudinary always wins, even on a local stack', async () => {
        // The most important case. If this ever flips, a real deployment could
        // silently start writing customer files to a container disk.
        setEnv({
            NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'demo',
            CLOUDINARY_API_KEY: 'key',
            CLOUDINARY_API_SECRET: 'secret',
            NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
            NODE_ENV: 'development',
        });
        const { shouldUseLocalDiskStorage } = await load();

        expect(shouldUseLocalDiskStorage()).toBe(false);
    });

    it('a production build against a local database uses local disk', async () => {
        // The case the NODE_ENV-only gate got wrong, and the reason two e2e
        // specs failed: `next start` sets NODE_ENV=production.
        setEnv({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'production' });
        const { shouldUseLocalDiskStorage } = await load();

        expect(shouldUseLocalDiskStorage()).toBe(true);
    });

    it('a real deployment with no Cloudinary still refuses', async () => {
        // The behaviour that must never regress. Writing customer uploads onto
        // an ephemeral container filesystem looks like success and loses them at
        // the next deploy, so a missing credential has to stay loud.
        setEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefg.supabase.co', NODE_ENV: 'production' });
        const { shouldUseLocalDiskStorage } = await load();

        expect(shouldUseLocalDiskStorage()).toBe(false);
    });

    it.each([
        ['http://localhost:54321', true],
        ['http://127.0.0.1:54321', true],
        ['http://[::1]:54321', true],
        ['https://abcdefg.supabase.co', false],
        // The one that matters most: a hostname merely CONTAINING "localhost".
        ['https://localhost.evil.example.com', false],
        ['', false],
    ])('isLocalStack(%s) === %s', async (url, expected) => {
        setEnv({ NEXT_PUBLIC_SUPABASE_URL: url as string });
        const { isLocalStack } = await load();

        expect(isLocalStack()).toBe(expected);
    });
});
