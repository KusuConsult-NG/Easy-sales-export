/**
 * @jest-environment node
 */

/**
 * /api/contact was an unauthenticated, unthrottled email sender.
 *
 * WHAT IT IS
 * ----------
 * A public form that calls `resend.emails.send()`. No session, no limit. So it
 * was a spam relay pointed at the company's own domain, a way to burn the
 * Resend quota, and a bill — all reachable with curl.
 *
 * WHY THE LIMIT IS DELIBERATELY GENEROUS
 * --------------------------------------
 * security-review-2026-08-10.md records the caveat that matters more than the
 * number:
 *
 *   "Nigerian mobile networks use CGNAT heavily, so many legitimate users share
 *    an IP. A per-IP limit tuned as if IPs were users will lock out real
 *    members — the login config's 5-per-15-minutes would be too strict."
 *
 * So this is 30 per hour per IP, not the login tier. A carrier NAT pool or an
 * office can sit behind one address and still work; a script cannot. Nobody
 * legitimately submits a contact form thirty times an hour.
 *
 * WHAT WAS CHECKED AND LEFT ALONE
 * -------------------------------
 * The other unauthenticated POST routes are not gaps:
 *
 *   webhooks (4)        signature-verified, and throttling them would drop
 *                       legitimate provider retries
 *   auth/register       returns 404 in production
 *   kyc/verify-id       410 stub
 *   hub/telemetry       authenticated via auth(); missed by the first filter,
 *                       which looked only for requireSession
 *
 * `/api/cooperatives/register` was named in the review as the priority. It
 * requires a session, so it was never the unauthenticated vector it looked like.
 */

import { describe, it, expect } from '@jest/globals';
import { rateLimitConfig } from '@/lib/rate-limits.config';

describe('the contact form limit', () => {
    it('exists', async () => {
        expect(rateLimitConfig.contactForm).toBeDefined();
    });

    it('is more permissive than the login limit, sustained', async () => {
        // THE point, and this assertion earned its place: the first attempt set
        // contact to 20/hour, and login's 5-per-15-minutes is ALSO 20/hour. The
        // number looked generous and delivered none of the headroom it was for.
        const contact = rateLimitConfig.contactForm;
        const login = rateLimitConfig.login;

        const perHour = (c: { maxRequests: number; interval: number }) =>
            c.maxRequests / (c.interval / 3_600_000);

        expect(perHour(contact)).toBeGreaterThan(perHour(login));
    });

    it('tolerates a burst, which is the actual CGNAT concern', async () => {
        // A carrier NAT does not produce a steady trickle; it produces a
        // cluster. The login window refuses a sixth attempt within fifteen
        // minutes however quiet the rest of the hour was.
        const contact = rateLimitConfig.contactForm;
        const login = rateLimitConfig.login;

        expect(contact.maxRequests).toBeGreaterThan(login.maxRequests);
        expect(contact.interval).toBeGreaterThan(login.interval);
    });

    it('is still low enough to stop a script', async () => {
        // Vacuity guard: "generous" must not mean "absent". A limit of 10,000
        // would satisfy the assertion above and protect nothing.
        expect(rateLimitConfig.contactForm.maxRequests).toBeLessThanOrEqual(50);
    });

    it('measures over a window long enough to matter', async () => {
        // A per-minute window resets sixty times an hour, so a patient script
        // gets 60× the quota. An hour is the shortest window that bounds
        // sustained abuse.
        expect(rateLimitConfig.contactForm.interval).toBeGreaterThanOrEqual(60 * 60 * 1000);
    });
});

describe('the route applies it', () => {
    it('checks the limit before parsing the body or sending anything', async () => {
        // Order matters: a limit applied after the send throttles the
        // response, not the email.
        //
        // #394. The marker was `emails.send` — this route built its own Resend
        // client. It now calls the shared sender, so the marker moved with it.
        // Read with comments stripped: the route's own repair note names the
        // old call, and a raw scan would find the tombstone rather than the
        // send. Same trap as #383/#384/#392.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');
        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/api/contact/route.ts'), 'utf-8'),
            { label: 'contact route' },
        );

        const limitAt = src.indexOf('contactLimiter.check(');
        const parseAt = src.indexOf('await request.json()');
        const sendAt = src.indexOf('sendEmailNotification(');

        expect(limitAt).toBeGreaterThan(-1);
        expect(limitAt).toBeLessThan(parseAt);
        expect(limitAt).toBeLessThan(sendAt);
    });

    it('keys the limit on the client IP', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/api/contact/route.ts'), 'utf-8');

        expect(src).toContain('getClientIp(request)');
    });

    it('returns a 429 rather than falling through', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/api/contact/route.ts'), 'utf-8');

        expect(src).toContain('createRateLimitResponse(rateLimitResult)');
    });
});
