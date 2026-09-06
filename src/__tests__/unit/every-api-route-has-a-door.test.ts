/**
 * @jest-environment node
 */

/**
 *   #437 EVERY API ROUTE HAS A DOOR — a sweep that came back CLEAN, made
 *   durable.
 *
 *   #436 put src/app/api into the coverage denominator and showed 87 of the 121
 *   route files at 0%. Unexercised is not the same as unguarded, so the next
 *   question was the one that actually matters: does each of those 121 routes
 *   check WHO is calling?
 *
 *   THE ANSWER IS YES, FOR ALL 121. That is the finding, and it is worth
 *   recording as plainly as a defect would be.
 *
 *   MY INSTRUMENT WAS WRONG FOUR TIMES BEFORE IT WAS RIGHT, and every one of
 *   those would have been a false report if I had trusted the first output:
 *
 *     1. africastalking and revalidate-cache came back "no auth". Both compare
 *        a shared secret from process.env and FAIL CLOSED when it is unset. My
 *        pattern list knew CRON_SECRET and API_KEY and not the general shape.
 *     2. kyc/verify-id came back "no auth, mutating POST". It is retired and
 *        returns 410 to everyone; there is nothing to guard.
 *     3. webhooks/resend came back "no auth, writes". It verifies with svix and
 *        refuses when RESEND_WEBHOOK_SECRET is unset — an earlier finding had
 *        already fixed exactly the fail-open shape I thought I was seeing. Its
 *        own comment says so.
 *     4. Worst: "46 of 48 admin routes do not call requireAdmin". They call
 *        requireSession() plus hasAdminPermission(session.user.roles, "x:y") —
 *        a SECOND hardening convention my grep did not know. And those session
 *        roles are not the stale JWT they look like: lib/auth.ts re-reads them
 *        from the database every SYNC_INTERVAL, which is TWO MINUTES, and the
 *        session callback blocks a banned or revoked token immediately.
 *
 *   So the codebase has two admin conventions and both are sound:
 *
 *     requireAdmin("x:y")        re-reads roles from the database on the call,
 *                                checks banned/suspended, fails closed.  2 routes.
 *     requireSession() +         roles at most two minutes stale, named
 *     hasAdminPermission(...)    permission, ban handled in the session
 *                                callback.                             34 routes.
 *
 *   WHAT THIS TEST IS FOR. A sweep that finds nothing protects nothing — the
 *   122nd route is the one at risk. This enumerates every route file and
 *   requires each to carry a recognised control or be named in a public list
 *   WITH ITS REASON, so a new endpoint cannot arrive ungated without somebody
 *   writing down why.
 *
 *   STILL OPEN, MEASURED AND NOT FIXED HERE. Twelve admin routes gate on
 *   isAdmin(roles) — an admin/not-admin check — without naming a permission,
 *   where #375's rule is that every admin gate names one. They are gated; what
 *   they lack is the granularity. That is a separate change to a separate rule
 *   and it is recorded rather than bundled in.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const routeFiles = execSync('find src/app/api -name route.ts', { cwd: ROOT })
    .toString().trim().split('\n').sort();

const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });
const routeName = (f: string) => f.replace('src/app/api/', '').replace('/route.ts', '');

/**
 * Every control this codebase actually uses to decide who may call a route.
 *
 * Corrected four times against the source; see the header. Each entry is a
 * control I read and confirmed, not one I assumed.
 */
const CONTROLS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'requireAdmin', pattern: /requireAdmin\s*\(/ },
    { name: 'requireSession', pattern: /requireSession\s*\(/ },
    { name: 'auth()', pattern: /\bauth\s*\(\s*\)/ },
    { name: 'getServerSession', pattern: /getServerSession\s*\(/ },
    { name: 'getToken', pattern: /getToken\s*\(/ },
    { name: 'session.user', pattern: /session\??\.user/ },
    // A shared secret compared against the environment — the cron routes, the
    // Africa's Talking webhook and the cache revalidator all use this shape,
    // and all three fail closed when the variable is unset.
    { name: 'shared secret', pattern: /process\.env\.[A-Z0-9_]*SECRET/ },
    // Provider webhook signatures.
    { name: 'svix', pattern: /new Webhook\s*\(/ },
    { name: 'hmac', pattern: /createHmac\s*\(/ },
    { name: 'paystack signature', pattern: /x-paystack-signature/i },
];

/**
 * Routes that are PUBLIC ON PURPOSE, each with the reason.
 *
 * Being on this list is a claim someone has to make in writing. The test below
 * also refuses an entry for a file that no longer exists, so the list cannot
 * quietly stop describing the routes.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
    'auth/register': 'the sign-up endpoint — there is no session yet, by definition',
    'auth/[...nextauth]': 'NextAuth itself; it IS the authentication',
    'health': 'liveness probe for the platform; returns status only, reads no user data',
    'contact': 'the public contact form; metered by the rate limiter instead',
    'farm-nation/listings': 'the public land catalogue a buyer browses before signing in',
    'marketplace/products': 'the public product catalogue',
    'marketplace/sellers/[sellerId]': 'a public seller profile; the projection is pinned by #105',
    'export/catalog': 'the public export-opportunity catalogue',
    'cooperative/loan-products': 'published loan terms, shown before joining',
    'academy/verify/[certificateId]': 'the public certificate verifier — a third party with a certificate number, and no account, is the whole point (#430)',
    'academy/verify-payment': 'the post-checkout return URL Paystack sends the payer to',
    'wallet/verify': 'the post-checkout return URL; it delegates to confirmWalletFundingAction, which does its own session check',
    'whatsapp-invite': 'the token IN the URL is the credential; redemption is claimed exactly once through claimIdempotencyKey',
    'kyc/verify-id': 'retired — returns 410 to every caller',
};

function controlsIn(rel: string): string[] {
    const src = code(rel);
    return CONTROLS.filter((c) => c.pattern.test(src)).map((c) => c.name);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#437 — every API route checks who is calling', () => {
    it('THE SWEEP IS OVER EVERY ROUTE FILE, not a sample', () => {
        // If this number moves, the sweep moved with it — the point of finding
        // the files rather than listing them.
        expect(routeFiles.length).toBeGreaterThanOrEqual(121);
        expect(routeFiles.every((f) => f.startsWith('src/app/api/'))).toBe(true);
    });

    it('EVERY ROUTE CARRIES A CONTROL OR IS PUBLIC BY DESIGN, WITH A REASON', () => {
        const ungated = routeFiles
            .map((f) => routeName(f))
            .filter((name) => !(name in PUBLIC_BY_DESIGN))
            .filter((name) => controlsIn(`src/app/api/${name}/route.ts`).length === 0);

        expect({ ungated }).toEqual({ ungated: [] });
    });

    it('and every entry on the public list names a route that still exists', () => {
        // An exemption for a renamed file stops exempting anything and starts
        // hiding the next one.
        const present = new Set(routeFiles.map(routeName));
        const stale = Object.keys(PUBLIC_BY_DESIGN).filter((name) => !present.has(name));
        expect({ stale }).toEqual({ stale: [] });
    });

    it('and every exemption carries a reason, not just a name', () => {
        for (const [name, reason] of Object.entries(PUBLIC_BY_DESIGN)) {
            expect({ name, explained: reason.trim().length > 25 }).toEqual({ name, explained: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#437 — the two admin conventions, both sound', () => {
    const adminRoutes = routeFiles.filter((f) => f.startsWith('src/app/api/admin/'));

    it('EVERY admin route is gated by one of them', () => {
        const ungated = adminRoutes.filter((f) => {
            const src = code(f);
            return !/requireAdmin\s*\(/.test(src)
                && !(/requireSession\s*\(|session\??\.user/.test(src));
        }).map(routeName);

        expect({ ungated }).toEqual({ ungated: [] });
    });

    it('and the session-roles convention is NOT the stale JWT it looks like', () => {
        // The claim the 34 routes rest on, checked at its source rather than
        // assumed: lib/auth.ts re-reads roles from the database on a two-minute
        // interval, and blocks a banned or revoked token in the session
        // callback. Without this, those routes would be deciding on an
        // eight-hour-old answer.
        const auth = code('src/lib/auth.ts');
        expect(auth).toMatch(/const SYNC_INTERVAL = 2 \* 60 \* 1000;/);
        expect(auth).toMatch(/if \(trigger === "update" \|\| !lastSynced \|\| \(now - lastSynced\) > SYNC_INTERVAL\)/);
        expect(auth).toMatch(/if \(token\.isBanned \|\| token\.sessionRevoked\)/);
    });

    it('and requireAdmin re-reads roles live and fails closed', () => {
        const src = code('src/lib/require-admin.ts');
        expect(src).toMatch(/\.collection\(COLLECTIONS\.USERS\)/);
        expect(src).toMatch(/isBanned === true \|\| data\?\.status === "banned"/);
        // The catch must deny, not forgive.
        expect(src).toMatch(/return \{ error: "Authorization check failed/);
    });
});
