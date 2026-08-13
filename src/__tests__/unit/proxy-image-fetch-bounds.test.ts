/**
 * @jest-environment node
 */

/**
 * The image proxy checked where the caller pointed it, not where it ended up.
 *
 * /api/proxy-image takes a URL from a logged-in caller, fetches it server-side
 * and returns the bytes as a base64 data URI, so html2canvas can render an
 * image without tainting the canvas. It had a host allow-list, which is the
 * right idea, and three ways round or through it.
 *
 * 1. THE HOSTNAME WAS THE WHOLE CHECK
 * -----------------------------------
 *     const { hostname } = new URL(raw);
 *     return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
 *
 * #168 fixed exactly this on the certificate upload route and said why:
 *
 *     res.cloudinary.com is Cloudinary's SHARED delivery domain — every
 *     customer serves from it, under /<cloud_name>/. Allowing the hostname
 *     allowed any file hosted by anyone on Cloudinary, so the check read as a
 *     restriction and was close to none.
 *
 * That fix pinned the cloud name. This route kept the hostname check, so the
 * server would fetch any Cloudinary customer's content and hand it back
 * base64-encoded. The fifth time in this audit that a fix landed on one path
 * and the sibling kept the defect.
 *
 * 2. REDIRECTS WERE FOLLOWED
 * --------------------------
 * The allow-list is applied to the URL the caller supplied, and fetch follows
 * redirects by default, so the host actually retrieved from did not have to be
 * an allowed one. A check on the first hop is not a check on the destination.
 * Refused now rather than followed — a redirect on a direct image URL is not a
 * case this proxy needs to serve.
 *
 * 3. NOTHING WAS BOUNDED
 * ----------------------
 * arrayBuffer() then base64, which inflates by a third, with no ceiling and no
 * content-type check. Any file reachable on an allowed host could be pulled
 * whole into memory, and "image proxy" was a description rather than a
 * constraint.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const route = source('src/app/api/proxy-image/route.ts');

describe('the allow-list names this account, not just Cloudinary', () => {
    it('pins the cloud name as well as the host', () => {
        // THE test, and the same one #168 applied to the certificate route.
        expect(route).toContain('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
        expect(route).toContain('firstSegment === cloudName');
    });

    it('still requires an allowed host', () => {
        // Vacuity guard: checking only the path segment would accept
        // evil.example/<cloudname>/...
        expect(route).toContain('ALLOWED_HOSTS.some(');
        expect(route).toContain('res.cloudinary.com');
    });

    it('refuses when the cloud name is not configured', () => {
        // Fails closed rather than treating an unset variable as a match for
        // whatever the first path segment happens to be.
        expect(route).toContain('if (!cloudName) return false');
    });

    it('requires https', () => {
        // The scheme was never checked, so http:// to an allowed host was
        // proxied — and a plaintext hop is where a redirect gets inserted.
        expect(route).toContain('parsed.protocol !== "https:"');
    });

    it('matches the check the certificate route already had', () => {
        // Recorded so the two stay recognisably the same rule.
        const cert = source('src/app/api/certificates/upload/route.ts');

        expect(cert).toContain('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
        expect(cert).toContain('firstSegment !== cloudName');
    });
});

describe('the request ends where the check looked', () => {
    it('does not follow redirects', () => {
        expect(route).toContain('redirect: "manual"');
    });

    it('reports a redirect rather than treating it as a failure to fetch', () => {
        // A 3xx is not !response.ok in manual mode, so without this the body of
        // a redirect response would have been encoded and returned.
        expect(route).toContain('response.status >= 300 && response.status < 400');
        expect(route).toContain('only direct image URLs are proxied');
    });

    it('the redirect check precedes reading the body', () => {
        const redirectAt = route.indexOf('response.status >= 300');
        const bufferAt = route.indexOf('await response.arrayBuffer()');

        expect(redirectAt).toBeGreaterThan(-1);
        expect(bufferAt).toBeGreaterThan(redirectAt);
    });
});

describe('what comes back is a bounded image', () => {
    it('rejects a non-image content type', () => {
        expect(route).toContain('!contentType.startsWith("image/")');
    });

    it('bounds the response', () => {
        expect(route).toContain('const MAX_IMAGE_BYTES');
        expect(route).toContain('buffer.byteLength > MAX_IMAGE_BYTES');
    });

    it('checks the declared length too, and does not trust it alone', () => {
        // Content-Length is optional and a server may lie, so the header check
        // is an early exit and the real check is on what arrived.
        expect(route).toContain('response.headers.get("content-length")');
        expect(route).toContain('Number.isFinite(declared) && declared > MAX_IMAGE_BYTES');
    });

    it('the ceiling is large enough for a real photograph', () => {
        // Vacuity guard: a limit of zero satisfies every assertion above.
        expect(route).toContain('10 * 1024 * 1024');
    });
});

describe('what was already right', () => {
    it('requires a session', () => {
        const guardAt = route.indexOf('requireSession()');
        const fetchAt = route.indexOf('await fetch(decoded');

        expect(guardAt).toBeGreaterThan(-1);
        expect(fetchAt).toBeGreaterThan(guardAt);
    });

    it('validates before fetching, not after', () => {
        const checkAt = route.indexOf('isAllowedUrl(decoded)');
        const fetchAt = route.indexOf('await fetch(decoded');

        expect(checkAt).toBeGreaterThan(-1);
        expect(fetchAt).toBeGreaterThan(checkAt);
    });

    it('still returns a data URI, which is the point of the route', () => {
        // Vacuity guard: a proxy that refuses everything passes the whole file
        // above and breaks certificate rendering.
        expect(codeOnly(route)).toContain('const dataUri = `data:${contentType};base64,${base64}`');
        expect(codeOnly(route)).toContain('NextResponse.json({ dataUri })');
    });
});
