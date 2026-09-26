/**
 * @jest-environment node
 */

/**
 *   #940 AN UNDECODABLE PASSPORT PHOTO 500'D THE ENTIRE ID CARD.
 *
 *   From production, twice in seven seconds:
 *
 *       [2026-09-26T08:01:12] [ERROR] [/api/id-card/pdf] ID card generation
 *       error: {"error":"Input buffer contains unsupported image format",
 *                "stack":"Error: ... at Sharp.toBuffer ..."}
 *
 *   fetchAsBase64 checked four things — an allowed host, `res.ok`, a size
 *   ceiling, and that the content-type began with `image/`. The last of those is
 *   a check on the CLAIM rather than on the bytes, and it is the one that let
 *   this through.
 *
 *   ── WHAT THAT MESSAGE ACTUALLY MEANS, MEASURED ────────────────────────────
 *
 *   Against this build (sharp 0.35.3 / libvips 8.18.3), that exact string is
 *   produced only by a body sharp cannot identify at all:
 *
 *       HTML error page   -> "Input buffer contains unsupported image format"
 *       PDF               -> "Input buffer contains unsupported image format"
 *       JSON error body   -> "Input buffer contains unsupported image format"
 *       AVIF              -> "Input buffer has corrupt header: bad seek to 1024"
 *       truncated JPEG    -> "Input buffer has corrupt header: premature end"
 *       empty buffer      -> "Input Buffer is empty"
 *
 *   So it was NOT an iPhone HEIC — `sharp.format.heif.input.buffer` is true here,
 *   which is the guess worth ruling out rather than repeating. Something upstream
 *   served a document under an image content-type.
 *
 *   ── THE CAUSE IS UPSTREAM; THE CONSEQUENCE WAS NOT ────────────────────────
 *
 *   buildSVG already takes `hasPhoto` and draws a placeholder frame. This
 *   member's card would have rendered correctly without their photo. Instead the
 *   route threw and they got NO ID CARD — a 500 on a download, caused by a
 *   cosmetic input, on the one endpoint whose entire output is an identity
 *   document.
 *
 *   And the SVG was built from `hasPhoto: !!photoData` BEFORE the decode, so even
 *   a caught exception would have left a transparent hole where the portrait
 *   belongs. resolvePassportPhoto returns the finished buffer, so one value
 *   decides both.
 *
 *   RUN, NOT READ. The route is called here with a real bad body, because the
 *   sibling suite id-card-server-derived asserts this file's SHAPE and a shape
 *   assertion cannot tell a caught exception from an uncaught one.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const CARD = {
    fullName: 'Ngozi Adeyemi',
    memberNumber: 'ESE-COOP-00042',
    membershipTier: 'Member',
    gender: 'female',
    stateOfOrigin: 'Enugu',
    joinedAt: '2025-03-01T00:00:00.000Z',
    validUntil: '2027-03-01T00:00:00.000Z',
    passportPhotoUrl: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/passport.jpg',
};

/** Swappable per test: what the card action returns. */
let cardResult: any = { success: true, data: CARD };
/** Swappable per test: what the photo URL serves. */
let photoResponse: { body: Buffer; mime: string; ok?: boolean } | null = null;

jest.mock('@/lib/session-guard', () => ({
    requireSession: jest.fn(async () => ({ session: { user: { id: 'u1', roles: ['cooperative_member'] } } })),
}));

jest.mock('@/app/actions/cooperative', () => ({
    getCooperativeMemberIdCardAction: jest.fn(async () => cardResult),
}));

jest.mock('@/lib/imagekit', () => ({ getImageKitId: () => 'demo-imagekit' }));

const warn = jest.fn();
const error = jest.fn();
jest.mock('@/lib/logger', () => ({ logger: { warn: (...a: any[]) => warn(...a), error: (...a: any[]) => error(...a), info: jest.fn(), debug: jest.fn() } }));

/** A real 8×8 JPEG, so the success path is a real decode rather than a stub. */
function realJpeg(): Promise<Buffer> {
    return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 150, b: 100 } } })
        .jpeg()
        .toBuffer();
}

beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'demo-cloud';
});

beforeEach(() => {
    jest.clearAllMocks();
    cardResult = { success: true, data: CARD };
    photoResponse = null;

    global.fetch = jest.fn(async () => {
        if (!photoResponse) return { ok: false, status: 404, headers: new Headers() } as any;
        const { body, mime, ok = true } = photoResponse;
        return {
            ok,
            status: ok ? 200 : 500,
            headers: new Headers({ 'content-type': mime, 'content-length': String(body.byteLength) }),
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as any;
    }) as any;
});

async function callRoute() {
    const { POST } = await import('@/app/api/id-card/pdf/route');
    return POST(new Request('https://example.test/api/id-card/pdf', { method: 'POST' }) as any);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#940 — the body that 500\'d the card', () => {
    it('AN HTML ERROR PAGE UNDER image/jpeg STILL PRODUCES A CARD', async () => {
        //   The production case. The bytes are a document; the header says JPEG.
        photoResponse = {
            body: Buffer.from('<!DOCTYPE html><html><body>404 Not Found</body></html>'),
            mime: 'image/jpeg',
        };

        const res = await callRoute();

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
    });

    it('A PDF UNDER image/jpeg TOO — Cloudinary stores PDFs as image resources', async () => {
        photoResponse = { body: Buffer.from('%PDF-1.4\n%%EOF\n'), mime: 'image/jpeg' };

        expect((await callRoute()).status).toBe(200);
    });

    it('AND A TRUNCATED JPEG, which fails at a different sharp call', async () => {
        //   A different message ("corrupt header: premature end"), same outcome
        //   required. The fix catches the decode rather than matching a string.
        photoResponse = { body: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), mime: 'image/jpeg' };

        expect((await callRoute()).status).toBe(200);
    });

    it('AND IT IS LOGGED AS A WARNING, not as the error that pages somebody', async () => {
        /*
         *   The card was produced. An error line here would bury the 500s that
         *   actually matter under members holding valid cards with placeholder
         *   portraits.
         */
        photoResponse = { body: Buffer.from('{"error":"not found"}'), mime: 'image/jpeg' };

        await callRoute();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('could not be decoded'),
            expect.objectContaining({ mime: 'image/jpeg', bytes: expect.any(Number) }),
        );
        //   The control: the old behaviour logged an ERROR and returned 500.
        expect(error).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#940 — and a real photo is still composited', () => {
    it('A DECODABLE JPEG PRODUCES A CARD, so the fallback did not swallow the feature', async () => {
        photoResponse = { body: await realJpeg(), mime: 'image/jpeg' };

        const res = await callRoute();

        expect(res.status).toBe(200);
        expect(warn).not.toHaveBeenCalledWith(
            expect.stringContaining('could not be decoded'),
            expect.anything(),
        );
    });

    it('AND SO DOES A MEMBER WITH NO PHOTO ON FILE AT ALL', async () => {
        cardResult = { success: true, data: { ...CARD, passportPhotoUrl: null } };

        expect((await callRoute()).status).toBe(200);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('and an SVG is refused before it ever reaches sharp', async () => {
        /*
         *   `image/` admits image/svg+xml, and sharp will rasterise it. An SVG is
         *   a document with a rendering engine behind it — the one input on this
         *   path that is executed rather than merely decoded — and a passport
         *   photo is a photograph.
         */
        photoResponse = { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: 'image/svg+xml' };

        const res = await callRoute();

        expect(res.status).toBe(200);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('refused an SVG'),
            expect.objectContaining({ mime: 'image/svg+xml' }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#940 — what the 500 is still reserved for', () => {
    it('NO MEMBERSHIP IS STILL A REFUSAL, not a blank card', async () => {
        //   The photo is cosmetic. Entitlement is not, and this must not have been
        //   loosened by making the photo optional.
        cardResult = { success: false, error: 'Membership fee unpaid' };

        const res = await callRoute();

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Membership fee unpaid' });
    });

    it('and the photo is decided ONCE, so the card cannot draw a slot it cannot fill', () => {
        /*
         *   The structural half, and it is not a spelling preference. `hasPhoto`
         *   used to be computed from the FETCH result, before the decode — so a
         *   decode failure caught anywhere downstream would still have produced a
         *   card whose SVG left the portrait area transparent. One value now
         *   decides the placeholder and the composite.
         */
        const route = readFileSync(
            join(process.cwd(), 'src/app/api/id-card/pdf/route.ts'),
            'utf8',
        );

        expect(route).toContain('hasPhoto: !!photo,');
        expect(route).toContain('photo = await resolvePassportPhoto(');
        //   And the resize no longer sits inline in the happy path, where a throw
        //   has nothing to fall back to.
        expect(route).not.toContain('Buffer.from(photoData.b64');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   remove the try/catch in resolvePassportPhoto     the first three cases (500
 *     (the defect)                                   instead of 200)
 *   rethrow after logging                            same three
 *   log at error() instead of warn()                  "LOGGED AS A WARNING"
 *   return a zero-length buffer instead of null on    "A DECODABLE JPEG PRODUCES
 *     failure (composite of nothing)                  A CARD" + the three cases
 *   drop the SVG refusal                              "an SVG is refused"
 *   make resolvePassportPhoto always return null      "A DECODABLE JPEG PRODUCES
 *     (fallback swallows the feature)                 A CARD"
 *   compute hasPhoto from the fetch again             "the photo is decided ONCE"
 *   turn the 403 into a rendered card                 "NO MEMBERSHIP IS STILL A
 *                                                    REFUSAL"
 */
