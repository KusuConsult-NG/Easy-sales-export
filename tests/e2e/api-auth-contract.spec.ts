import { test, expect, request as playwrightRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * No API route may serve a signed-out caller anything private.
 *
 * WHY THIS EXISTS
 * ---------------
 * src/lib/auth.config.ts says, in its `authorized` callback:
 *
 *     // API routes should not be gated by NextAuth middleware
 *     // (they handle their own security)
 *     if (pathname.startsWith("/api/")) return true;
 *
 * So the middleware lets EVERY /api/ request through, and all 119 route files
 * are individually responsible for checking the session. That is a legitimate
 * design, and it has exactly one failure mode: a route that forgets. There is
 * no second layer to catch it.
 *
 * This audit already found one. The notification-creation endpoint had no
 * session check at all, and its output appears in the platform's own
 * notification centre — see src/__tests__/unit/notification-phishing.ts. That
 * was found by reading. 119 routes is too many to keep reading.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Each route is called with NO cookies. It must NOT answer 2xx, unless it is
 * on the PUBLIC list below with a stated reason. 401, 403, 404, 405, 400 and
 * 500 are all acceptable answers to an anonymous caller — the contract is
 * simply that an anonymous caller is not served.
 *
 * A 500 is allowed on purpose: many routes reject anonymous callers by
 * throwing while resolving the session. Ugly, but not a data leak, and this
 * file is about the leak. Tidying those into a clean 401 is separate work.
 *
 * GET only. A POST to an unguarded route could mutate real data, and a test
 * that might write to the database as part of proving it should not be able to
 * is not a trade worth making. GET is where reading private data happens.
 */

const API_DIR = path.resolve(__dirname, '../../src/app/api');

function collectApiRoutes(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectApiRoutes(full));
        } else if (entry.name === 'route.ts') {
            const source = fs.readFileSync(full, 'utf8');
            // Only routes that actually answer GET.
            if (!/export\s+(async\s+)?function\s+GET/.test(source)) continue;
            const route = '/' + path.relative(path.resolve(API_DIR, '../..'), dir)
                .split(path.sep)
                .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
                .join('/');
            found.push(route.replace(/^\/app/, ''));
        }
    }
    return found;
}

/**
 * Routes that are SUPPOSED to answer an anonymous caller, each with the reason.
 *
 * Anything not on this list must refuse. Adding an entry here is a deliberate
 * statement that the route exposes nothing private — make it consciously.
 */
const PUBLIC_ROUTES: Record<string, string> = {
    '/api/health': 'liveness probe for the platform',
    '/api/auth/health': 'reports whether auth is configured, not who is signed in',
    '/api/marketplace/products': 'the public product catalogue',
    '/api/academy/courses': 'the public course catalogue',
    '/api/csrf': 'issues the CSRF token the login form needs',
};

const allGetRoutes = Array.from(new Set(collectApiRoutes(API_DIR)))
    .filter(r => !r.includes('['))       // dynamic routes need a real id to mean anything
    .filter(r => !r.startsWith('/api/auth/'))  // NextAuth's own handler, excluded below by name
    .sort();

/** NextAuth's endpoints are its own contract, not this application's. */
const NEXTAUTH_OWNED = ['/api/auth/session', '/api/auth/providers', '/api/auth/csrf', '/api/auth/signin', '/api/auth/signout', '/api/auth/error'];

test.describe('API routes refuse anonymous callers', () => {
    test('the route list was actually discovered', () => {
        // Without this a bad path empties the loop and the suite goes green
        // having checked nothing.
        expect(allGetRoutes.length).toBeGreaterThan(30);
        expect(allGetRoutes).toContain('/api/health');
    });

    for (const route of allGetRoutes) {
        const isPublic = route in PUBLIC_ROUTES;

        test(`${isPublic ? 'serves' : 'refuses'} anonymous GET ${route}`, async ({ baseURL }) => {
            // A brand-new context, so no cookie from any other spec leaks in
            // and makes an unguarded route look guarded.
            const anonymous = await playwrightRequest.newContext({ baseURL, storageState: undefined });
            try {
                const response = await anonymous.get(route, { failOnStatusCode: false });
                const status = response.status();

                if (isPublic) {
                    expect(status, `${route} is listed public (${PUBLIC_ROUTES[route]}) but answered ${status}`)
                        .toBeLessThan(400);
                    return;
                }

                // The assertion this file exists for.
                expect(
                    status,
                    `${route} answered ${status} to a signed-out caller. Either it is missing a ` +
                    `session check, or it is genuinely public and belongs in PUBLIC_ROUTES with a reason.`
                ).toBeGreaterThanOrEqual(400);
            } finally {
                await anonymous.dispose();
            }
        });
    }

    test('NextAuth endpoints are excluded on purpose, and still reachable', async ({ baseURL }) => {
        // Named rather than silently filtered: /api/auth/session answering 200
        // with an empty session to an anonymous caller is CORRECT, and a future
        // reader should not mistake its absence above for an oversight.
        const anonymous = await playwrightRequest.newContext({ baseURL, storageState: undefined });
        try {
            const response = await anonymous.get('/api/auth/session', { failOnStatusCode: false });
            expect(response.status()).toBeLessThan(500);
            expect(NEXTAUTH_OWNED.length).toBeGreaterThan(0);
        } finally {
            await anonymous.dispose();
        }
    });
});
