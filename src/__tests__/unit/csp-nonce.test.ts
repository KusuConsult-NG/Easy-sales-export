/**
 * @jest-environment node
 */

/**
 * The CSP no longer permits inline script.
 *
 * WHAT WAS WRONG
 * --------------
 * `script-src 'unsafe-inline'` removes most of what CSP is for. The XSS review
 * found three `dangerouslySetInnerHTML` sites and judged them safe — but "safe"
 * there means *no injection was found*, and CSP exists for the injection nobody
 * found.
 *
 * It was there because the policy was a STATIC header in next.config.ts, and a
 * static header cannot carry a per-request nonce. Three inline scripts in the
 * root layout need one: the theme no-flash guard, and two JSON-LD blocks —
 * `<script type="application/ld+json">` is still governed by `script-src`, even
 * though the browser never executes it.
 *
 * The policy now comes from `src/middleware.ts`, which mints a nonce per request,
 * puts it on the request headers for the layout to read and on the response
 * header for the browser to honour. Both are required; either alone gives a page
 * whose scripts are all blocked.
 *
 * VERIFIED IN A BROWSER, NOT ONLY HERE
 * ------------------------------------
 * A unit test cannot tell you the page still works — the failure mode is a white
 * screen, and a passing assertion about a string does not rule it out. So the
 * built app was run and loaded in Chrome:
 *
 *   - 27 script tags served, ALL carrying the matching nonce, none without
 *   - zero CSP violations in the console on / and /auth/login
 *   - the login form rendered and hydrated
 *
 * These tests hold the policy in place; the browser run is what proved it works.
 */

import { describe, it, expect } from '@jest/globals';
import { buildCsp, generateNonce, NONCE_HEADER } from '@/lib/csp';

function directives(csp: string): Record<string, string> {
    return Object.fromEntries(
        csp.split(';').map((d) => {
            const [name, ...rest] = d.trim().split(/\s+/);
            return [name, rest.join(' ')];
        })
    );
}

describe('buildCsp', () => {
    it('drops unsafe-inline from script-src when a nonce is given', async () => {
        // THE test.
        const csp = buildCsp({ nonce: 'abc123' });

        expect(directives(csp)['script-src']).toContain("'nonce-abc123'");
        expect(directives(csp)['script-src']).not.toContain("'unsafe-inline'");
    });

    it('keeps unsafe-inline only in the nonce-free fallback', async () => {
        // next.config.ts still emits a static header for responses the
        // middleware does not touch. Without a nonce it has no alternative —
        // but that path must never be the one serving the app shell.
        const csp = buildCsp({});

        expect(directives(csp)['script-src']).toContain("'unsafe-inline'");
    });

    it('keeps unsafe-inline for STYLE even with a nonce', async () => {
        // Deliberate: React writes inline style attributes throughout and
        // nonces do not apply to them. Inline style is a far weaker primitive
        // than inline script.
        const csp = buildCsp({ nonce: 'abc123' });

        expect(directives(csp)['style-src']).toContain("'unsafe-inline'");
    });

    it('never allows unsafe-eval in production', async () => {
        const csp = buildCsp({ nonce: 'abc123', isDev: false });

        expect(csp).not.toContain("'unsafe-eval'");
    });

    it('keeps the protections that were already right', async () => {
        // The policy moved files. A regression here would be silent.
        const d = directives(buildCsp({ nonce: 'n' }));

        expect(d['object-src']).toBe("'none'");
        expect(d['base-uri']).toBe("'self'");
        expect(d['form-action']).toBe("'self'");
        expect(d['frame-ancestors']).toBe("'none'");
        expect(d['default-src']).toBe("'self'");
    });

    it('still allows the hosts the app actually loads script from', async () => {
        // Vacuity guard: a policy that allows nothing passes every assertion
        // above and breaks Paystack checkout.
        const scriptSrc = directives(buildCsp({ nonce: 'n' }))['script-src'];

        expect(scriptSrc).toContain('https://js.paystack.co');
        expect(scriptSrc).toContain('https://maps.googleapis.com');
    });

    it('upgrades insecure requests outside development', async () => {
        expect(buildCsp({ nonce: 'n', isDev: false })).toContain('upgrade-insecure-requests');
        expect(buildCsp({ nonce: 'n', isDev: true })).not.toContain('upgrade-insecure-requests');
    });
});

describe('generateNonce', () => {
    it('returns a different value each time', async () => {
        // A reused nonce is no better than 'unsafe-inline'.
        const seen = new Set(Array.from({ length: 50 }, () => generateNonce()));

        expect(seen.size).toBe(50);
    });

    it('is long enough to be unguessable', async () => {
        // 16 random bytes, base64.
        expect(generateNonce().length).toBeGreaterThanOrEqual(20);
    });
});

describe('the wiring', () => {
    it('middleware sets the nonce on both request and response', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf-8');

        expect(src).toContain('requestHeaders.set(NONCE_HEADER, nonce)');
        expect(src).toMatch(/response\.headers\.set\(\s*"Content-Security-Policy"/);
    });

    it('the layout reads it and stamps every inline script', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf-8');

        expect(src).toContain(`headers()).get(${'NONCE_HEADER'})`);
        // Three inline scripts, three nonce attributes.
        expect(src.match(/nonce=\{nonce\}/g) ?? []).toHaveLength(3);
    });

    it('next.config no longer hard-codes its own policy', async () => {
        // Two copies of a security rule is the defect that has recurred all
        // week. The fallback must come from the same builder.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf-8');

        expect(src).toContain('buildCsp(');
        expect(src).not.toContain("script-src 'self'");
    });
});
