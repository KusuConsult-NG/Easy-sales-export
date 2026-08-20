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
 * 2. verify-id/scan/page.tsx must read the fields /api/qr/verify actually
 *    returns (`valid`, `data`), not fields it has never returned (`success`,
 *    `user`) — the mismatch that made a correctly signed, unexpired ID report
 *    as invalid every time.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

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

describe('verify-id/scan/page.tsx reads the response shape the API actually sends', () => {
    const src = source('src/app/verify-id/scan/page.tsx');

    it('branches on `data.valid`, not the never-returned `data.success`', () => {
        expect(src).toContain('if (response.ok && data.valid)');
        expect(src).not.toMatch(/if\s*\(\s*data\.success\s*\)/);
    });

    it('reads member fields from `data.data`, not the never-returned `data.user`', () => {
        expect(src).not.toMatch(/\buser:\s*data\.user\b/);
        expect(src).toContain('data.data?.fullName');
    });
});
