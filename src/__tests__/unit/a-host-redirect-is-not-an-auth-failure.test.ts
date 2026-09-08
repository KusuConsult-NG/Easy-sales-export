/**
 * @jest-environment node
 */

/**
 *   #521 THE MIDDLEWARE ANSWERED "Unauthorized" TO A REQUEST ON THE WRONG
 *        HOSTNAME, AND SIGNED PEOPLE OUT FOR VISITING THE APEX.
 *
 *   src/middleware.ts runs on every request the matcher admits, and no test
 *   imported it. Two blocks at the bottom treat ANY 3xx response as an
 *   authentication failure — and the FIRST thing the middleware emits is a
 *   canonical-host redirect.
 *
 * ── 1. A WEBHOOK ON THE APEX GOT 401 ────────────────────────────────────────
 *
 *       if (pathname.startsWith('/api/') && res.status >= 300 && res.status <= 399) {
 *           return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *       }
 *
 *   The intent is sound: an API caller redirected to an HTML login page loops,
 *   so answer 401 instead. The condition was not. canonicalHostFor maps
 *   `easysalesexport.com` to `www.easysalesexport.com`, so
 *
 *       POST https://easysalesexport.com/api/webhooks/paystack
 *
 *   produced a 308 to the www host and left the middleware as
 *
 *       401 { "success": false, "error": "Unauthorized" }
 *
 *   with the Location header discarded, so the caller was not even told where to
 *   go. The same held for every module's www host — six of them.
 *
 *   THE COST IS THE DIAGNOSIS AS MUCH AS THE FAILURE. An operator whose webhook
 *   is failing reads "Unauthorized", goes looking for a signing secret, and
 *   finds nothing wrong with it. The cause is the hostname and nothing in the
 *   response says so. That is the shape of "we fix it and it breaks again".
 *
 * ── 2. AND THE APEX LOGIN URL SIGNED YOU OUT ────────────────────────────────
 *
 *   The zombie-session block clears the session cookies when a 3xx points at
 *   /auth/login — written for a genuinely dead token. The canonical redirect
 *   KEEPS THE PATH, so a signed-in member opening
 *   `easysalesexport.com/auth/login` got a 308 whose Location contains
 *   "/auth/login", and had their cookies cleared on the way past. A working
 *   session, destroyed by visiting a URL.
 *
 *   Both blocks now read a header the canonical redirect sets, so they can tell
 *   "you are on the wrong hostname" from "you are not signed in". The 401 also
 *   requires the redirect to actually point at an auth page, which is the case
 *   it was written for.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   I expected the same 401 conversion to break the Paystack payment callbacks —
 *   /api/wallet/verify and /api/academy/verify-payment both answer with a
 *   redirect to a dashboard. It does NOT: middleware runs BEFORE the route
 *   handler, so `res` here is the middleware's own decision, never the route's
 *   response. Those redirects are produced after this code has finished and are
 *   untouched. I checked the order before reporting it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the 401 conversion back to "any 3xx"            KILLED
 *     the canonical marker never set                  KILLED
 *     the zombie clear ignoring the marker            KILLED
 *     a real auth redirect no longer answering 401    KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { canonicalHostFor } from '@/lib/canonical-host';

const ROOT = process.cwd();
const code = () => stripComments(
    readFileSync(join(ROOT, 'src/middleware.ts'), 'utf-8'),
    { label: 'middleware.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#521 — the premise: the apex really does redirect', () => {
    it('THE APEX IS NOT THE CANONICAL HOST', () => {
        //   The fact the whole finding rests on, asserted rather than assumed.
        //   If this ever stops being true the finding stops applying, and this
        //   is where that would show up.
        expect(canonicalHostFor('easysalesexport.com')).toBe('www.easysalesexport.com');
    });

    it('AND SO A MODULE www HOST REDIRECTS TOO', () => {
        //   Six module domains take the opposite direction — www to apex — so
        //   the same 3xx reaches the same two blocks from six more hosts.
        const someModuleWww = Object.keys(
            require('@/lib/canonical-host').MODULE_WWW_REDIRECTS as Record<string, string>,
        )[0];

        expect(someModuleWww).toBeDefined();
        expect(canonicalHostFor(someModuleWww)).toBe(someModuleWww.replace(/^www\./, ''));
    });

    it('and the canonical host itself does not redirect', () => {
        //   The vacuity guard: a canonicalHostFor that answered for everything
        //   would loop, and would make every assertion here meaningless.
        expect(canonicalHostFor('www.easysalesexport.com')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#521 — a host redirect is not an auth failure', () => {
    /**
     * These are pinned on source, and the reason is worth stating rather than
     * apologising for: middleware.ts constructs NextAuth at module scope
     * (`NextAuth(authConfig)`) and exports an edge handler. Importing it under
     * jest pulls in the whole auth stack and a runtime this environment does not
     * provide, and a test that mocked all of it would be asserting on the mocks
     * rather than on the routing. What can be checked honestly is that the two
     * conditions carry the distinction they were missing — which is exactly what
     * a future edit would drop.
     */
    it('THE 401 REQUIRES THE REDIRECT TO POINT AT AN AUTH PAGE', () => {
        const body = code();

        expect(body).toContain('const isAuthRedirect = location.includes("/auth/login")');
        expect(body).toMatch(/if \(isAuthRedirect\) \{\s*\n\s*return NextResponse\.json/);
        // The bare "any 3xx on /api/" form is gone.
        expect(body).not.toMatch(
            /startsWith\('\/api\/'\) && res && res\.status >= 300 && res\.status <= 399\) \{\s*\n\s*return NextResponse\.json/,
        );
    });

    it('AND THE CANONICAL REDIRECT MARKS ITSELF', () => {
        const body = code();

        expect(body).toContain('const CANONICAL_REDIRECT_HEADER = "x-canonical-redirect"');
        expect(body).toContain('canonicalRes.headers.set(CANONICAL_REDIRECT_HEADER, "1")');
    });

    it('AND THE ZOMBIE-SESSION CLEAR SKIPS IT', () => {
        //   The block that signed people out for opening the apex login URL.
        const body = code();

        expect(body).toContain('const isCanonicalRedirect = res?.headers?.get(CANONICAL_REDIRECT_HEADER) === "1"');
        expect(body).toContain('hasSessionCookie && res && !isCanonicalRedirect');
    });

    it('and the marker is set before either block reads it', () => {
        //   Order matters here: the canonical redirect is the first thing the
        //   middleware emits, and both consumers are in the proxy below it.
        const body = code();
        const marks = body.indexOf('canonicalRes.headers.set(CANONICAL_REDIRECT_HEADER');
        const zombie = body.indexOf('const isCanonicalRedirect =');
        const api = body.indexOf('const isAuthRedirect =');

        expect(marks).toBeGreaterThan(0);
        expect(zombie).toBeGreaterThan(marks);
        expect(api).toBeGreaterThan(marks);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#521 — what the 401 was written for still works', () => {
    it('AN API PATH REDIRECTED TO LOGIN STILL ANSWERS 401', () => {
        //   The control. A fix that simply deleted the conversion would satisfy
        //   every assertion above and reintroduce the HTML-redirect loop in
        //   mobile clients that the conversion exists to prevent.
        const body = code();

        expect(body).toContain('{ success: false, error: "Unauthorized" }');
        expect(body).toContain('{ status: 401 }');
    });

    it('and the auth gate that produces that redirect is untouched', () => {
        //   isProtectedPath + !isLoggedIn -> redirect to /auth/login is the
        //   source of the 3xx the 401 converts. If that changed, the conversion
        //   would have nothing to convert.
        const body = code();

        expect(body).toContain('isProtectedPath(pathname) && !isLoggedIn');
        expect(body).toContain('loginUrl.searchParams.set("callbackUrl"');
    });
});
