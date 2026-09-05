/**
 * @jest-environment node
 */

/**
 * Two structural facts about the /verify-id pages, pinned so neither
 * regresses silently:
 *
 * 1. verify-id/page.tsx must not import the runtime `verifyDigitalIDQR`
 *    function from '@/lib/digital-id' — that module also imports Node's
 *    `crypto` via lib/security.ts, and this is a Client Component. Doing so
 *    ran signature verification in the browser, where QR_ENCRYPTION_KEY is
 *    never available, so it silently checked against the module's fallback
 *    secret instead — confirmed by grepping a production build's client
 *    chunk for that literal string. A type-only import is fine; a runtime one
 *    is the regression.
 *
 * 2. The scanner must read the fields /api/qr/verify actually returns
 *    (`valid`, `data`), not fields it has never returned (`success`, `user`) —
 *    the mismatch that made a correctly signed, unexpired ID report as invalid
 *    every time.
 *
 *    MERGE NOTE. This case was written against verify-id/scan/page.tsx. That
 *    page no longer scans: #384 measured the two ID scanners, found they had
 *    become identical once /verify-id was moved onto the server route, and
 *    retired the duplicate to a redirect so the URL keeps working. The fact
 *    being protected has not changed — it has moved to the page that now does
 *    the scanning, and is asserted there. The redirect itself is pinned below,
 *    so the retirement cannot silently become a second scanner again.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

describe('verify-id/page.tsx does not run QR verification in the browser', () => {
    const src = source('src/app/verify-id/page.tsx');

    it('imports digital-id, if at all, only as a type', () => {
        const runtimeImport = /import\s*\{[^}]*\bverifyDigitalIDQR\b[^}]*\}\s*from\s*["']@\/lib\/digital-id["']/;
        expect(src).not.toMatch(runtimeImport);
    });

    it('verifies through the server-side route instead', () => {
        expect(src).toContain('fetch("/api/qr/verify"');
    });
});

describe('the scanner reads the response shape the API actually sends', () => {
    const src = source('src/app/verify-id/page.tsx');

    it('branches on the response `valid` flag, not the never-returned `success`', () => {
        expect(src).toMatch(/response\.ok\s*&&\s*body\?\.valid/);
        expect(src).not.toMatch(/\bbody\.success\b|\bdata\.success\b/);
    });

    it('reads the payload from `data`, not the never-returned `user`', () => {
        expect(src).toMatch(/payload:\s*body\.data\b/);
        expect(src).not.toMatch(/\buser:\s*(?:body|data)\.user\b/);
    });
});

describe('verify-id/scan is retired to the one scanner, not a second one', () => {
    const src = source('src/app/verify-id/scan/page.tsx');

    it('REDIRECTS RATHER THAN SCANNING', () => {
        expect(src).toContain('redirect("/verify-id")');

        /**
         * The negatives read CODE, not the retirement note above them — which
         * explains what this page used to POST to and therefore names
         * /api/qr/verify in prose. A raw scan rediscovers the tombstone and
         * reports the page as still scanning. #383, #384, #392, #394 and #399
         * are all this same trap; it caught this assertion too, on its first run.
         */
        const code = stripComments(src, { label: 'verify-id/scan/page.tsx' });
        expect(code).not.toContain('/api/qr/verify');
        expect(code).not.toContain('verifyDigitalIDQR');
        // Control: the redirect itself is code, so the stripper has not eaten
        // the file wholesale.
        expect(code).toContain('redirect("/verify-id")');
    });
});
