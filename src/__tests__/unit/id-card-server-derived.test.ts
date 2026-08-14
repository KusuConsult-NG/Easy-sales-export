/**
 * @jest-environment node
 */

/**
 * Any signed-in account could have a cooperative ID card rendered in anyone's
 * name.
 *
 * /api/id-card/pdf requires a session and then used nothing from it. Every field
 * on the card came out of the request body:
 *
 *     const data = await req.json();
 *     const {
 *         fullName = "", memberNumber = "", membershipTier = "Member",
 *         gender = "", stateOfOrigin = "", joinedAt = "", validUntil = "",
 *         passportPhotoUrl = null,
 *     } = data;
 *
 * and the route composited them into a 900×567 PNG at print density. So a
 * caller could post someone else's name, an invented member number, a tier they
 * had not paid for and a validity date of their choosing, and download a card
 * that looks exactly like the real thing.
 *
 * The page happens to send the member's own data — it fetches
 * getCooperativeMemberIdCardAction and forwards the result — but the route did
 * not require that, and a "use server" endpoint is reachable whatever the
 * screen does. This is the caller-supplied-identity shape the audit has found
 * repeatedly, on the one endpoint whose entire output is an identity document.
 *
 * The route calls that same action itself now. It takes no arguments, derives
 * everything from the session, and already refuses when the membership fee is
 * unpaid — so the download cannot outrun the checks the screen enforces either.
 *
 * THE PHOTO WAS FETCHED FROM ANYWHERE
 * -----------------------------------
 *     const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
 *
 * No host check, no redirect handling, no size ceiling, no content-type check —
 * on a URL that came from the request body. A relative value was resolved
 * against req.url, so the server would fetch its own origin as well.
 *
 * It carries the rule #183 gave /api/proxy-image: https, an allowed Cloudinary
 * host AND this account's cloud name, no redirects, an image content type, and
 * a ceiling. The URL is server-derived now, so that is a second line rather
 * than the only one — but it is the line that stops a stored value written by
 * some other path becoming an outbound request from this server.
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

const route = source('src/app/api/id-card/pdf/route.ts');
const page = source('src/app/cooperatives/(member)/id-card/page.tsx');

describe('the card is the caller\'s own', () => {
    it('every field comes from the session-derived action', () => {
        // THE test.
        expect(route).toContain('const card = await getCooperativeMemberIdCardAction()');
        expect(route).toContain('} = card.data as Record<string, any>');
    });

    it('nothing is read out of the request body', () => {
        const code = codeOnly(route);

        expect(code).not.toContain('const data = await req.json()');
        expect(code).not.toContain('} = data;');
    });

    it('imports through the domain barrel', () => {
        // domain-barrels.test.ts ratchets on this and caught the first draft,
        // which reached into cooperative/_actions directly.
        expect(route).toContain('from "@/app/actions/cooperative"');
    });

    it('the action takes no arguments, so there is nothing to spoof', () => {
        // The property that makes this fix complete rather than a filter.
        expect(source('src/app/actions/cooperative/_coop_identity.ts'))
            .toContain('export async function getCooperativeMemberIdCardAction(): Promise<');
    });

    it('refuses when the caller has no card to print', () => {
        // The action already declines an unpaid membership, so the download
        // inherits the check the screen enforces.
        expect(route).toContain('if (!card.success || !card.data)');
        expect(route).toContain('{ status: 403 }');
    });

    it('a session is still required first', () => {
        const guardAt = route.indexOf('requireSession()');
        const cardAt = route.indexOf('getCooperativeMemberIdCardAction()');

        expect(guardAt).toBeGreaterThan(-1);
        expect(cardAt).toBeGreaterThan(guardAt);
    });

    it('still renders the card, which is the point of the route', () => {
        // Vacuity guard: a route that refuses everything passes the assertions
        // above and removes the download.
        expect(route).toContain('buildSVG({');
        expect(route).toContain('fullName, memberNumber, gender');
    });

    it('the page is unaffected — it already had the same data', () => {
        // Recorded because it explains why this is not a behaviour change for
        // an honest caller: the screen fetches the same action.
        expect(page).toContain('getCooperativeMemberIdCardAction()');
        expect(page).toContain('/api/id-card/pdf');
    });
});

describe('the passport photo is fetched from this account only', () => {
    it('checks the host and the cloud name', () => {
        expect(route).toContain('isAllowedPhotoUrl');
        expect(route).toContain('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
        expect(route).toContain("parsed.hostname === \"res.cloudinary.com\"");
    });

    it('requires https', () => {
        expect(route).toContain('parsed.protocol !== "https:"');
    });

    it('fails closed when the cloud name is unset', () => {
        expect(route).toContain('if (!cloudName) return false');
    });

    it('does not follow redirects', () => {
        expect(route).toContain('redirect: "manual"');
    });

    it('requires an image and bounds the size', () => {
        expect(route).toContain('!mime.startsWith("image/")');
        expect(route).toContain('MAX_PHOTO_BYTES');
        expect(route).toContain('buf.byteLength > MAX_PHOTO_BYTES');
    });

    it('no longer resolves a relative URL against this server', () => {
        // That turned any relative value into a request to our own origin.
        expect(codeOnly(route)).not.toContain('new URL(passportPhotoUrl, req.url)');
    });

    it('the check runs before the fetch', () => {
        const fn = route.slice(route.indexOf('async function fetchAsBase64'));
        const checkAt = fn.indexOf('isAllowedPhotoUrl(url)');
        const fetchAt = fn.indexOf('await fetch(url');

        expect(checkAt).toBeGreaterThan(-1);
        expect(fetchAt).toBeGreaterThan(checkAt);
    });

    it('a card without a photo still renders', () => {
        // Vacuity guard: refusing every photo must degrade, not break — the SVG
        // has a hasPhoto branch for exactly that.
        expect(route).toContain('hasPhoto: !!photoData');
    });

    it('matches the rule proxy-image was given', () => {
        // Same reasoning, same shape, so the two stay recognisable as one rule.
        const proxy = source('src/app/api/proxy-image/route.ts');

        expect(proxy).toContain('firstSegment === cloudName');
        expect(proxy).toContain('redirect: "manual"');
    });
});
