/**
 * @jest-environment node
 */

/**
 *   #808 THE TWO CREDENTIALS THIS PLATFORM ISSUES LOOKED NOTHING ALIKE.
 *   #810 AND THE ID CARD DID NOT CARRY THE COMPANY'S MARK AT ALL.
 *
 *   The owner asked for the certificate to carry the same branding as the
 *   membership ID card. Measured across the three documents that draw a
 *   credential, what was actually there:
 *
 *       api/id-card/pdf                purple → indigo gradient    the ID card
 *       components/pdf/Certificate…    #7C3AED violet              the live cert
 *       components/CertificateGener…   #10b981 emerald             an orphan
 *
 *   Three colour schemes across two credentials, every value hard-coded at its
 *   own call site.
 *
 * ── WHY THE OBVIOUS FIX WAS THE WRONG ONE ───────────────────────────────────
 *
 *   Recolouring the certificate to match the card would have gone green and
 *   left the cause untouched: three files that agree today and drift on the
 *   next edit. That is the dominant defect class this whole audit keeps
 *   finding — a correct rule applied at some of the places it names — and it
 *   has caught my own fixes twice.
 *
 *   So the palette lives in lib/credential-brand and all three import it. The
 *   assertions below are about THAT, not about a hex: a test pinning "the
 *   certificate contains #7e22ce" would pass just as happily against three
 *   files that each spell it out separately, which is the state being fixed.
 *
 * ── AND ABOUT A CORRECTION I GOT WRONG FIRST ────────────────────────────────
 *
 *   An earlier pass recoloured the certificate to `--primary` (#2E519F), the
 *   app's blue, reasoning from the logo. The owner's answer was that the purple
 *   one was better — the correct call, and the useful correction: the printed
 *   credentials are a deliberate second family, not a drifted copy of the web
 *   palette. The CONTROL at the bottom records that divergence so nobody
 *   "fixes" it by accident.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the certificate given back its own #7C3AED                       KILLED
 *     the orphan given back its own #10b981                            KILLED
 *     the certificate hard-coding #7e22ce instead of importing         KILLED
 *     one accent of four left off the shared palette                   KILLED
 *     the gradient bar rendered with a single flat stop                KILLED
 *     the ID card's watermark dropped from the front                   KILLED
 *     the ID card's watermark dropped from the back                    KILLED
 *     the watermark's circular clip removed (the white-box defect)     KILLED
 *     the watermark's clip-path pointed at a missing id                KILLED
 *     the watermark's opacity raised to 1                              KILLED
 *     credential-brand's purple edited to an off-palette value         KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { stripComments } from '@/lib/testing/strip-comments';
import { CREDENTIAL_BRAND, CREDENTIAL_GRADIENT } from '@/lib/credential-brand';
import { brandLogoDataUri, brandLogoWatermarkSvg } from '@/lib/brand-logo';

const ID_CARD = 'src/app/api/id-card/pdf/route.ts';

const raw = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripped = (p: string) => stripComments(raw(p));

/**
 * How to read each credential's source.
 *
 *   THE ID CARD ROUTE IS READ RAW, DELIBERATELY, and this is not a shortcut.
 *
 *   lib/testing/strip-comments — the good one — IS DEFEATED BY THAT FILE. Its
 *   esc() helper contains
 *
 *       .replace(/"/g, "&quot;")
 *
 *   a regex literal holding a double quote, and the stripper loses its place
 *   there and stops removing comments for much of the rest of the file.
 *   MEASURED: of its 76 comment lines, 27 survive stripping.
 *
 *   strip-comments.test.ts names this exact combination as the dangerous one —
 *   stripped text plus a negative assertion — and the remedy it already
 *   settled on for csp.ts is to read raw and say why. Same remedy here.
 *
 *   Reading raw is SAFE for these assertions specifically, checked rather than
 *   assumed: the only hexes anywhere in that file, comments included, are
 *   #ffffff, #1e293b, #0f172a, #000000, #e2e8f0, #94a3b8 and #64748b — the
 *   white and slate of the card's back. None of the abandoned schemes and none
 *   of the palette values appear in its prose, so there is nothing for a
 *   comment to trigger a false failure on.
 */
const read = (p: string) => (p === ID_CARD ? raw(p) : stripped(p));

const LIVE_CERT = 'src/components/pdf/CertificateDocument.tsx';
const ORPHAN_CERT = 'src/components/CertificateGenerator.tsx';
const PALETTE = 'src/lib/credential-brand.ts';

/** Every document that draws a credential somebody is handed. */
const CREDENTIALS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'the ID card', file: ID_CARD },
    { name: 'the live certificate', file: LIVE_CERT },
    { name: 'the orphaned certificate generator', file: ORPHAN_CERT },
];

/** Schemes that were on these documents and must not come back. */
const ABANDONED = [
    ['the certificate violet', /#7C3AED/i],
    ['the orphan emerald', /#10b981/i],
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#808 — the palette is one thing, in one place', () => {
    it('THE PALETTE IS THE CARD THAT WAS ALREADY IN PRODUCTION', () => {
        /*
         *   These are the exact values `/api/id-card/pdf` drew BEFORE any of
         *   this, read out of the route and pinned here. That is the whole
         *   warrant for the change: members already hold cards in these
         *   colours, so the certificate moved to them and the card did not
         *   move at all.
         *
         *   PINNED, NOT DERIVED, and deliberately so. The first draft of this
         *   assertion read the hexes back out of the ID card route and checked
         *   `card.includes(stop) || card.includes('CREDENTIAL_BRAND')` — which
         *   CANNOT FAIL once the route imports the module, so it would have
         *   passed against a palette quietly edited to any colour at all. An
         *   assertion whose disjunction is permanently true is the #741 trap
         *   wearing a different hat, and it was in my own test.
         *
         *   Changing a value here means changing the card people already have.
         *   That should be a deliberate edit to this list, not a side effect.
         */
        expect(CREDENTIAL_BRAND).toEqual({
            purpleDeep: '#6b21a8',
            purple: '#7e22ce',
            indigo: '#3730a3',
            purpleInk: '#581c87',
            lavender: '#c4b5fd',
            lavenderMuted: '#a088d8',
        });

        //   And the gradient is the card's three stops, in the card's order.
        expect(CREDENTIAL_GRADIENT).toEqual(['#6b21a8', '#7e22ce', '#3730a3']);
    });

    it.each(CREDENTIALS)('$name TAKES ITS COLOUR FROM THE SHARED PALETTE', ({ name, file }) => {
        expect({ name, imports: read(file).includes('credential-brand') })
            .toEqual({ name, imports: true });
    });

    it.each(CREDENTIALS)('$name CARRIES NONE OF THE ABANDONED SCHEMES', ({ name, file }) => {
        const src = read(file);
        const offenders = ABANDONED.filter(([, re]) => re.test(src)).map(([label]) => label);
        expect({ name, offenders }).toEqual({ name, offenders: [] });
    });

    it('AND NO CREDENTIAL RESPELLS A PALETTE VALUE AS A LITERAL', () => {
        /*
         *   THE assertion, and the one that separates this fix from the
         *   symptom-level version of it. Three files each containing the
         *   string "#7e22ce" would satisfy "they all use the brand colour" and
         *   would drift apart on the very next edit.
         *
         *   The palette module is the only place these hexes may appear.
         */
        const values = Object.values(CREDENTIAL_BRAND);
        const respelt: string[] = [];

        for (const { name, file } of CREDENTIALS) {
            const src = read(file).toLowerCase();
            for (const hex of values) {
                if (src.includes(hex.toLowerCase())) respelt.push(`${name} hard-codes ${hex}`);
            }
        }

        expect(respelt).toEqual([]);
        //   Vacuity guard: the palette module itself must of course contain them,
        //   or the loop above is passing because the values are empty strings.
        const palette = read(PALETTE).toLowerCase();
        for (const hex of values) {
            expect({ hex, declared: palette.includes(hex.toLowerCase()) }).toEqual({ hex, declared: true });
        }
    });

    it('THE CERTIFICATE DRAWS THE CARD\'S GRADIENT, not one flat stop', () => {
        /*
         *   A first attempt drew this as three flat segments and it rendered as
         *   hard-edged blocks — visibly not the card. It is a real gradient
         *   with all three of the card's stops; a bar with one stop is not the
         *   card's sweep and must not pass as it.
         */
        const src = read(LIVE_CERT);
        expect(src).toMatch(/LinearGradient/);

        const stops = (src.match(/<Stop\b/g) ?? []).length;
        expect({ stopsPerBar: stops }).toEqual({ stopsPerBar: 3 });

        //   Both bars must actually render the gradient component — a stripe
        //   View with no child is an invisible bar, not a purple one.
        const bars = (src.match(/<GradientBar\b/g) ?? []).length;
        expect({ bars }).toEqual({ bars: 2 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#810 — the ID card carries the company mark', () => {
    it('BOTH SIDES OF THE CARD DRAW THE WATERMARK', () => {
        /*
         *   Counted, not sampled. "The file mentions the watermark" is the
         *   weakest assertion in this codebase's vocabulary — it is what let
         *   two earlier findings look complete — and one call would satisfy it
         *   while leaving the back bare.
         */
        const calls = (read(ID_CARD).match(/brandLogoWatermarkSvg\(/g) ?? []).length;
        expect({ sidesWatermarked: calls }).toEqual({ sidesWatermarked: 2 });
    });

    it('THE MARK IS EXECUTED, AND IT CLIPS TO THE DISC', () => {
        /*
         *   Executed rather than read. logo.jpg is a blue disc on a SOLID WHITE
         *   SQUARE with no alpha channel, so an unclipped <image> paints a
         *   white box on the card's purple — the defect this clip exists to
         *   prevent.
         */
        const svg = brandLogoWatermarkSvg({ cx: 100, cy: 100, size: 200, opacity: 0.07, id: 'probe' });

        expect(svg).toContain('clip-path="url(#probe)"');
        expect(svg).toContain('<circle');
        expect(svg).toContain('data:image/jpeg;base64,');
    });

    it('AND IT IS FAINT ENOUGH TO READ THROUGH', () => {
        //   A watermark at full strength is not a watermark; the member's name
        //   is printed over this.
        const svg = brandLogoWatermarkSvg({ cx: 100, cy: 100, size: 200, opacity: 0.07, id: 'probe' });
        const opacity = Number(/opacity="([\d.]+)"/.exec(svg)?.[1]);

        expect(Number.isFinite(opacity)).toBe(true);
        expect(opacity).toBeGreaterThan(0);
        expect(opacity).toBeLessThanOrEqual(0.15);
    });

    it('THE MARK ACTUALLY LANDS WHEN RENDERED — and leaves no white box', async () => {
        /*
         *   The strongest assertion here, because it is the rendered pixels
         *   rather than the markup. Two things are checked at once on the
         *   card's own purple ground:
         *
         *     1. the watermark CHANGES the image  (it is drawn at all)
         *     2. the CORNERS of its bounding box are untouched  (it is clipped
         *        to the disc, so the JPEG's white square never appears)
         *
         *   Silent failure is the exact shape of #809, where a logo that did
         *   not load produced a valid-looking document with nothing in it.
         */
        const GROUND = { r: 0x7e, g: 0x22, b: 0xce, alpha: 1 };
        const SIZE = 300;
        const CX = 250, CY = 150;

        const swatch = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="500" height="300">
            <rect width="500" height="300" fill="rgb(${GROUND.r},${GROUND.g},${GROUND.b})"/>${inner}</svg>`;

        const mark = brandLogoWatermarkSvg({ cx: CX, cy: CY, size: SIZE, opacity: 0.35, id: 'render' });
        expect(mark).not.toBe('');

        const withMark = await sharp(Buffer.from(swatch(mark))).raw().toBuffer({ resolveWithObject: true });
        const px = (x: number, y: number) => {
            const i = (y * withMark.info.width + x) * withMark.info.channels;
            return [withMark.data[i], withMark.data[i + 1], withMark.data[i + 2]];
        };
        const isGround = ([r, g, b]: number[]) => r === GROUND.r && g === GROUND.g && b === GROUND.b;

        //   1. The centre of the disc is no longer the bare ground.
        expect({ centreDrawn: !isGround(px(CX, CY)) }).toEqual({ centreDrawn: true });

        //   2. The corners of the mark's SQUARE bounding box still are — which
        //      is only true if the circular clip is doing its job.
        const inset = 6;
        const corners: Array<[string, number, number]> = [
            ['top-left', CX - SIZE / 2 + inset, CY - SIZE / 2 + inset],
            ['top-right', CX + SIZE / 2 - inset, CY - SIZE / 2 + inset],
            ['bottom-left', CX - SIZE / 2 + inset, CY + SIZE / 2 - inset],
            ['bottom-right', CX + SIZE / 2 - inset, CY + SIZE / 2 - inset],
        ];
        for (const [label, x, y] of corners) {
            expect({ corner: label, stillGround: isGround(px(Math.round(x), Math.round(y))) })
                .toEqual({ corner: label, stillGround: true });
        }
    });

    it('CONTROL: the logo is readable from disk at all', () => {
        //   If this ever fails, every assertion above about the watermark is
        //   testing the empty-string path and proving nothing.
        const uri = brandLogoDataUri();
        expect(uri).toMatch(/^data:image\/jpeg;base64,/);
        expect((uri ?? '').length).toBeGreaterThan(10_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#808 — the app palette and the credential palette are different on purpose', () => {
    it('CONTROL: globals.css still declares the app blue, and the credentials are not it', () => {
        /*
         *   Recorded rather than reconciled. The app is #2E519F and the printed
         *   credentials are purple → indigo; the owner chose the purple when
         *   shown both. If somebody later decides the two families should
         *   merge, that is a decision about the ID CARD as much as the
         *   certificate, and this is where they are made to notice.
         */
        const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
        expect(css).toMatch(/--primary:\s*#2E519F/i);

        const appBlue = '#2e519f';
        for (const value of Object.values(CREDENTIAL_BRAND)) {
            expect(value.toLowerCase()).not.toBe(appBlue);
        }
    });
});
