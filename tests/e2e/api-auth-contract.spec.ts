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
 * Each route is called with NO cookies AND WITHOUT FOLLOWING REDIRECTS. It
 * must NOT answer 2xx, unless it is on the PUBLIC list below with a stated
 * reason. A 3xx redirect away, a 401/403/404/405/400, and even a 500 all mean
 * the caller was not served — the contract is simply that an anonymous caller
 * gets no data.
 *
 * Not following redirects is load-bearing. This file's first run reported
 * /api/academy/verify-payment as serving anonymous callers a 200. It does not:
 * it answers 307 to /academy?error=missing_reference, and following that lands
 * on the academy page, whose 200 the check then blamed on the API route.
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

    // ── Added after the first full run flagged them ───────────────────────────
    //
    // Three catalogue endpoints answered anonymous callers and were absent from
    // this list. Each was read before being added, and each is public BY DESIGN
    // with an explicit allow-list of the fields it returns — the whitelist above
    // was written from a partial reading of the API surface, not from these
    // routes changing.
    '/api/cooperative/loan-products':
        'public loan product catalogue: filters isActive and returns only PUBLIC_PRODUCT_FIELDS',
    '/api/export/catalog':
        'public export catalogue: filters isActive and returns only PUBLIC_CATALOG_FIELDS',
    '/api/farm-nation/listings':
        'public land listings, feeding /land and /farm-nation/map: filters on PUBLIC_LAND_STATUSES ' +
        'and runs stripInternalLandFields, which removes verifiedBy, rejectionReason, ' +
        'verificationNotes and the owner email',
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
                // maxRedirects: 0 — do NOT follow the redirect.
                //
                // Without it this check reports a hole that is not there. Its
                // first run flagged /api/academy/verify-payment as serving an
                // anonymous caller a 200. It does not: it answers
                // 307 -> /academy?error=missing_reference, a correct refusal,
                // and following that lands on the academy page whose 200 the
                // check then blamed on the API route. Verified by hand before
                // believing it — the body was the academy page's HTML, not
                // data.
                //
                // A redirect IS a refusal here, so the bar is 2xx, not 4xx.
                const response = await anonymous.get(route, { failOnStatusCode: false, maxRedirects: 0 });
                const status = response.status();

                if (isPublic) {
                    expect(status, `${route} is listed public (${PUBLIC_ROUTES[route]}) but answered ${status}`)
                        .toBeLessThan(300);

                    // Being on the list is permission to answer, NOT permission
                    // to answer with anything.
                    //
                    // Without this, adding a route above would be a blanket
                    // pass forever: a future change that started spreading the
                    // stored document instead of an allow-list would leak
                    // internal fields to strangers and this file would stay
                    // green. That is precisely what happened to
                    // /api/farm-nation/listings once already — it spread the
                    // document while land-actions.ts had been stripping these
                    // fields for months.
                    const body = await response.text();
                    for (const forbidden of [
                        'rejectionReason',
                        'verificationNotes',
                        'verifiedBy',
                        'internalNotes',
                        'passwordHash',
                        'bvn',
                        'accountNumber',
                    ]) {
                        expect(
                            body.includes(`"${forbidden}"`),
                            `${route} is public but its body contains "${forbidden}", which must not ` +
                            `reach an anonymous caller. Either strip it or the route is not public.`
                        ).toBe(false);
                    }
                    return;
                }

                // The assertion this file exists for: anything but a 2xx.
                // 3xx (redirected away), 4xx (refused) and 5xx (threw while
                // resolving the session) all mean the caller was not served.
                expect(
                    status,
                    `${route} answered ${status} to a signed-out caller and served a body. Either it ` +
                    `is missing a session check, or it is genuinely public and belongs in ` +
                    `PUBLIC_ROUTES with a reason.`
                ).toBeGreaterThanOrEqual(300);
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
