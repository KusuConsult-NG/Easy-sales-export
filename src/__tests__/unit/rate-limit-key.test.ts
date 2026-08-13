/**
 * @jest-environment node
 */

/**
 * Money endpoints rate-limited by IP, on a platform whose own config says not to.
 *
 * THE DEFECT
 * ----------
 * Five authenticated API routes throttled by client IP:
 *
 *     const clientIp = getClientIp(request);
 *     const rateLimitResult = await withdrawalLimiter.check(clientIp);
 *
 * rate-limits.config.ts already argues, at length, why that unit is wrong here:
 *
 *     Sized for CGNAT, deliberately. Nigerian mobile networks share IPs heavily,
 *     so a limit tuned as though an IP were a person locks out real users.
 *
 * That note was written for the PUBLIC contact form, where an IP is the only
 * identifier available. It applies with more force to a signed-in endpoint,
 * where the account is right there and the limit is tighter: `withdrawal` is
 * five per minute. Behind a carrier NAT, five members submitting withdrawals in
 * a minute blocked everyone else sharing that address — a control meant to
 * protect a money feature denying it instead.
 *
 * ONE CONVENTION WAS ALREADY CORRECT
 * ----------------------------------
 * The four payment ACTIONS — farm-nation-payment, cooperative/_payment,
 * academy/_payment, marketplace/_payment — all key on session.user.id, as does
 * the AI chat limiter added in #159. The API routes doing the same work did not.
 * Two conventions for one operation, and the routes had the wrong one.
 *
 * WHAT DELIBERATELY STAYS ON AN IP
 * --------------------------------
 *   api/contact              unauthenticated, and the config's CGNAT sizing was
 *                            written for exactly this endpoint
 *   api/academy/verify-payment  a callback with no session at all
 *   auth.ts login            pre-auth: there is no user yet, which is the point
 *
 * A blanket rewrite would have broken all three. They are asserted below so it
 * cannot happen later either.
 *
 * THE TRADE, STATED
 * -----------------
 * The check moves below the session guard, because that is where the user id
 * exists. So an unauthenticated flood now reaches requireSession() before being
 * refused — which reads a token and returns 401 without touching the database.
 * It is the cheap path either way, and volumetric protection belongs at the edge
 * rather than in a route handler.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Authenticated routes that were keyed on an IP. */
const AUTHENTICATED_ROUTES = [
    'src/app/api/cooperative/withdraw/route.ts',
    'src/app/api/cooperative/contribute/route.ts',
    'src/app/api/cooperative/verify-payment/route.ts',
    'src/app/api/marketplace/submit-verification/route.ts',
    'src/app/api/admin/marketplace/approve-seller/route.ts',
];

/** Endpoints where an IP is the only identifier there is. */
const UNAUTHENTICATED_ENDPOINTS = [
    'src/app/api/contact/route.ts',
    'src/app/api/academy/verify-payment/route.ts',
];

describe('authenticated endpoints throttle the account', () => {
    it.each(AUTHENTICATED_ROUTES)('%s keys on the session user', (rel) => {
        const src = source(rel);

        expect(src).toContain('.check(session.user.id)');
        expect(src).not.toContain('.check(clientIp)');
    });

    it.each(AUTHENTICATED_ROUTES)('%s checks the limit after the session', (rel) => {
        // The user id does not exist before the session, so this ordering is not
        // a preference — it is what makes the key available at all. Asserted so
        // a later edit cannot move it back above and silently fall to an IP.
        const src = source(rel);
        const sessionAt = src.indexOf('await requireSession()');
        const limitAt = src.indexOf('.check(session.user.id)');

        expect(sessionAt).toBeGreaterThan(-1);
        expect(limitAt).toBeGreaterThan(sessionAt);
    });

    it.each(AUTHENTICATED_ROUTES)('%s still refuses when the limit is reached', (rel) => {
        // A limiter whose result is not acted on is the same as none.
        const src = source(rel);
        const after = src.slice(src.indexOf('.check(session.user.id)'));

        expect(after.slice(0, 300)).toContain('if (!rateLimitResult.success)');
        expect(after.slice(0, 300)).toContain('createRateLimitResponse(rateLimitResult)');
    });
});

describe('endpoints with no account still use the IP', () => {
    it.each(UNAUTHENTICATED_ENDPOINTS)('%s keys on the client IP', (rel) => {
        // Vacuity guard for the block above. Rewriting every limiter to a user
        // key would break the public contact form and the payment callback,
        // neither of which has a user — and would satisfy a naive "no
        // check(clientIp) anywhere" assertion.
        const src = source(rel);

        expect(src).toMatch(/\.check\((?:clientIp|getClientIp\(request\))\)/);
    });

    it('login keys on the IP, because there is no user yet', () => {
        // The clearest case: the whole point of the login limiter is to throttle
        // attempts by someone who has not proved who they are.
        expect(source('src/app/actions/auth.ts')).toContain('loginLimiter.check(ip)');
    });
});

describe('the two conventions now agree', () => {
    it('no authenticated route is left on an IP key', () => {
        const { execSync } = require('child_process') as typeof import('child_process');
        const ipKeyed = execSync(
            'grep -rln "check(clientIp)\\|check(getClientIp" src/app/api || true',
            { encoding: 'utf-8', cwd: process.cwd() }
        )
            .split('\n')
            .filter(Boolean)
            .filter((f) => !UNAUTHENTICATED_ENDPOINTS.includes(f));

        expect(ipKeyed).toEqual([]);
    });

    it('the payment actions that were already right are unchanged', () => {
        // These are where the correct convention came from. If they ever move to
        // an IP key, this file should be the thing that notices.
        for (const rel of [
            'src/app/actions/marketplace/_payment.ts',
            'src/app/actions/cooperative/_payment.ts',
            'src/app/actions/academy/_payment.ts',
            'src/app/actions/farm-nation-payment.ts',
        ]) {
            expect(source(rel)).toMatch(/paymentLimiter\.check\((?:session\.user\.id|userId)\)/);
        }
    });

    it('the config note that makes an IP key wrong here is still there', () => {
        // The argument this change rests on. If somebody decides IPs are fine
        // after all, this is where they have to say so.
        expect(source('src/lib/rate-limits.config.ts'))
            .toContain('Nigerian mobile networks share IPs heavily');
    });
});
