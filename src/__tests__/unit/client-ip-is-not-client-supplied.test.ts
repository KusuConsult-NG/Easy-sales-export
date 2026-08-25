/**
 * @jest-environment node
 */

/**
 *   #260 THE CLIENT IP WAS WHATEVER THE CLIENT SAID IT WAS.
 *
 *        Four copies of one rule, all of them taking the LEFTMOST entry:
 *
 *          rate-limiter.ts  getClientIp        forwarded.split(',')[0]
 *          rate-limiter.ts  getActionClientIp  forwarded.split(',')[0]
 *          rate-limit.ts    apiRateLimit       ...split(',')[0] || 'anonymous'
 *          audit-log.ts     getSecurityContext ...split(',')[0]
 *
 *        `X-Forwarded-For` is an APPEND-ONLY list. Each proxy appends the
 *        address it received the connection from, so the header arriving at the
 *        app reads
 *
 *            <whatever the client sent>, <what our proxy actually saw>
 *
 *        The leftmost entry is the one the ORIGINAL CALLER wrote. It is not
 *        evidence of anything: a request carrying `X-Forwarded-For: 1.2.3.4`
 *        reaches us as `1.2.3.4, <their real address>`, and every one of those
 *        four readers returned `1.2.3.4`.
 *
 *        WHAT THAT COSTS
 *
 *        Every IP-based rate limit becomes a formality — change the header per
 *        request and each attempt lands in its own bucket. That covers the login
 *        limiter (brute-force protection), the contact form, the academy payment
 *        verifier, and the bank-account oracle metered in #243, which exists
 *        precisely to stop somebody enumerating account numbers.
 *
 *        And the ADMIN AUDIT LOG records that address. An audit trail that
 *        writes down whatever IP the caller chose is worse than one with no IP
 *        field: it reads as evidence. Same shape as #129, where the dispute
 *        audit row named whichever admin the caller passed.
 *
 *        x-real-ip was read FIRST and taken whole, which is the same problem
 *        with none of the structure — a proxy that sets it makes it
 *        trustworthy, and one that merely forwards it does not, and the reader
 *        could not tell.
 *
 *        THE RULE NOW: the rightmost XFF entry — the hop closest to us, which
 *        is the only one our own infrastructure wrote. TRUSTED_PROXY_HOPS says
 *        how many proxies sit in front of the app when that is not 1.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';

const realHops = process.env.TRUSTED_PROXY_HOPS;

beforeEach(() => { delete process.env.TRUSTED_PROXY_HOPS; });
afterAll(() => {
    if (realHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = realHops;
});

const clientIp = async (headers: Record<string, string>) => {
    const { clientIpFromHeaders } = await import('@/lib/client-ip');
    return clientIpFromHeaders(new Headers(headers));
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#260 — the address our own proxy observed', () => {
    it('TAKES THE RIGHTMOST ENTRY, NOT THE ONE THE CALLER WROTE', async () => {
        // The attack, exactly: the caller sent "1.2.3.4" and the platform
        // appended what it actually saw.
        expect(await clientIp({ 'x-forwarded-for': '1.2.3.4, 41.58.100.7' }))
            .toBe('41.58.100.7');
    });

    it('SO ROTATING THE HEADER NO LONGER BUYS A FRESH BUCKET', async () => {
        // Same real client, three different spoofs. All three must resolve to
        // one identifier or the rate limit counts them separately.
        const seen = await Promise.all([
            clientIp({ 'x-forwarded-for': '1.1.1.1, 41.58.100.7' }),
            clientIp({ 'x-forwarded-for': '2.2.2.2, 41.58.100.7' }),
            clientIp({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 41.58.100.7' }),
        ]);

        expect(new Set(seen).size).toBe(1);
        expect(seen[0]).toBe('41.58.100.7');
    });

    it('handles a single-entry header — no proxy in front, or a direct hop', async () => {
        expect(await clientIp({ 'x-forwarded-for': '41.58.100.7' })).toBe('41.58.100.7');
    });

    it('tolerates the whitespace real proxies emit', async () => {
        expect(await clientIp({ 'x-forwarded-for': '1.2.3.4,   41.58.100.7  ' }))
            .toBe('41.58.100.7');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#260 — more than one proxy in front', () => {
    it('TRUSTED_PROXY_HOPS=2 skips the CDN and takes the hop before it', async () => {
        // CDN in front of the platform: the rightmost entry is the CDN's own
        // address, which every visitor would share.
        process.env.TRUSTED_PROXY_HOPS = '2';

        expect(await clientIp({ 'x-forwarded-for': '1.2.3.4, 41.58.100.7, 10.0.0.9' }))
            .toBe('41.58.100.7');
    });

    it('and never walks past the left edge into caller-supplied territory', async () => {
        // Configured for two hops but only one is present. Returning entry [0]
        // here would hand back exactly the value this whole change exists to
        // stop trusting, so it refuses instead.
        process.env.TRUSTED_PROXY_HOPS = '2';

        expect(await clientIp({ 'x-forwarded-for': '1.2.3.4' })).toBeNull();
    });

    it('ignores a nonsensical hop count rather than obeying it', async () => {
        for (const bad of ['0', '-1', 'many', '']) {
            process.env.TRUSTED_PROXY_HOPS = bad;
            expect(await clientIp({ 'x-forwarded-for': '1.2.3.4, 41.58.100.7' }))
                .toBe('41.58.100.7');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#260 — what is not an address', () => {
    it('REFUSES A HEADER THAT IS NOT AN IP RATHER THAN KEYING ON IT', async () => {
        // A rate-limit key built from arbitrary caller text is a bucket the
        // caller names, which is the same bypass by another route.
        for (const junk of ['not-an-ip', '<script>', '999.999.999.999', 'a, b']) {
            expect(await clientIp({ 'x-forwarded-for': junk })).toBeNull();
        }
    });

    it('accepts IPv6, which real clients do send', async () => {
        expect(await clientIp({ 'x-forwarded-for': '1.2.3.4, 2001:db8::1' })).toBe('2001:db8::1');
        expect(await clientIp({ 'x-forwarded-for': '::1' })).toBe('::1');
    });

    it('returns null when there is no forwarding header at all', async () => {
        expect(await clientIp({})).toBeNull();
    });

    it('falls back to x-real-ip ONLY when x-forwarded-for is absent', async () => {
        // A proxy that sets x-real-ip overwrites any caller value; one that
        // merely forwards it does not, and we cannot tell which. It is used
        // only when there is nothing better, and never preferred OVER the
        // structured header — which is what the old readers did.
        expect(await clientIp({ 'x-real-ip': '41.58.100.7' })).toBe('41.58.100.7');
        expect(await clientIp({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 41.58.100.7' }))
            .toBe('41.58.100.7');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#260 — every reader uses the one rule', () => {
    it('getClientIp does', async () => {
        const { getClientIp } = await import('@/lib/rate-limiter');
        const request = new Request('https://e.test', {
            headers: { 'x-forwarded-for': '1.2.3.4, 41.58.100.7' },
        });

        // Was: "1.2.3.4".
        expect(getClientIp(request)).toBe('41.58.100.7');
    });

    it('and reports "unknown" rather than a caller-chosen string when it cannot tell', async () => {
        const { getClientIp } = await import('@/lib/rate-limiter');
        expect(getClientIp(new Request('https://e.test'))).toBe('unknown');
        expect(getClientIp(new Request('https://e.test', { headers: { 'x-forwarded-for': 'nonsense' } })))
            .toBe('unknown');
    });

    // requireActual: jest.setup.js mocks @/lib/audit-log globally, and a mock
    // cannot tell us which header the real reader trusts.
    const auditLog = () =>
        jest.requireActual('@/lib/audit-log') as typeof import('@/lib/audit-log');

    it('the audit log records the observed address, not the supplied one', async () => {
        const { getSecurityContextFromHeaders } = auditLog();

        const ctx = getSecurityContextFromHeaders(new Headers({
            'x-forwarded-for': '1.2.3.4, 41.58.100.7',
            'user-agent': 'curl/8',
        }));

        // Was: "1.2.3.4" — an audit trail writing down whatever the caller
        // chose, which reads as evidence (#129's shape).
        expect(ctx.ipAddress).toBe('41.58.100.7');
        expect(ctx.userAgent).toBe('curl/8');
    });

    it('and leaves the field undefined rather than recording something false', async () => {
        const { getSecurityContextFromHeaders } = auditLog();

        expect(getSecurityContextFromHeaders(new Headers({ 'x-forwarded-for': 'nope' })).ipAddress)
            .toBeUndefined();
        expect(getSecurityContextFromHeaders(undefined)).toEqual({});
    });
});
