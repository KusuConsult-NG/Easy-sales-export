/*
 *   NO `server-only` DIRECTIVE, DELIBERATELY.
 *
 *   It was the first instinct and it costs more than it buys here. This module
 *   imports `fs`, which already cannot be bundled for a browser — Next fails
 *   the build if it is ever pulled into a client component, which is the
 *   protection `server-only` exists to give.
 *
 *   What the directive DOES do is make the module unimportable from a plain
 *   Node context, which breaks both the unit tests and the script that renders
 *   a sample certificate to look at. A guard that blocks the people checking
 *   the work, while duplicating one the bundler already applies, is the wrong
 *   trade.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";

/**
 * The company logo, as bytes, for documents that must always carry it.
 *
 *   #809 THE CERTIFICATE FETCHED ITS OWN LOGO OVER HTTP, AND FAILED SILENTLY.
 *
 *   CertificateDocument rendered the logo as
 *
 *       <Image src={`${baseUrl}/images/logo.jpg`} />
 *
 *   where baseUrl is built from the request's own `x-forwarded-host`. So
 *   generating a certificate made the server open an HTTP connection to itself
 *   to collect a file already sitting on its disk.
 *
 *   MEASURED. Rendering the same one-image document four ways:
 *
 *       local path                       OK   57,018 bytes
 *       absolute path                    OK   57,018 bytes
 *       data URI                         OK   57,018 bytes
 *       remote URL (production shape)    OK    1,215 bytes   <- no image
 *
 *   The remote attempt DID NOT THROW. @react-pdf logs "Not valid image
 *   extension" and renders the page anyway, so a failed fetch produces a
 *   certificate with no logo, issued and stored, with nothing to tell anyone.
 *   The 1,215 bytes is the whole tell.
 *
 *   The owner spotted it on the sample and asked why — which is how it should
 *   have been found, and was not.
 *
 * ── WHY A NETWORK ROUND TRIP WAS ALWAYS THE WRONG SHAPE ─────────────────────
 *
 *   The logo is in this repository. It is deployed with the application. It
 *   does not change between requests. Fetching it over HTTP made a credential
 *   depend on the server being able to resolve and reach its own public
 *   hostname — through whatever proxy, DNS and egress rules sit in front of it
 *   — at the moment somebody finishes a course.
 *
 *   Read from disk it cannot fail for any of those reasons, it is faster, and
 *   if it somehow does fail it now SAYS SO in the log rather than quietly
 *   printing a blank space where the company's mark belongs.
 *
 *   Cached after the first read: the bytes are identical for every certificate
 *   this process renders.
 */

/** Where the logo lives, relative to the deployed application root. */
const LOGO_PATH = "public/images/logo.jpg";

let cached: string | null | undefined;

/**
 * The logo as a data URI, or null when it genuinely cannot be read.
 *
 * Callers should render it when present and omit it when null — a document
 * that draws nothing is better than one that draws a broken-image box, and the
 * failure is in the log either way.
 */
export function brandLogoDataUri(): string | null {
    if (cached !== undefined) return cached;

    try {
        const bytes = readFileSync(join(process.cwd(), LOGO_PATH));
        cached = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } catch (error) {
        /*
         *   NOT SILENT, which is the whole point of this module. The previous
         *   failure mode was a certificate quietly missing its logo; this one
         *   is a line naming the path that could not be read.
         */
        logger.error("[brand-logo] the company logo could not be read from disk", {
            path: LOGO_PATH,
            cwd: process.cwd(),
            error: String(error),
        });
        cached = null;
    }

    return cached;
}

/**
 * The logo as a watermark, ready to drop into an SVG under everything else.
 *
 *   #810 THE ID CARD CARRIED NO LOGO AT ALL.
 *
 *   The membership card printed "EASY SALES EXPORT LTD" as text and nothing
 *   else — the company's actual mark appeared nowhere on the credential it
 *   issues to its members. The owner asked for it as a watermark.
 *
 * ── WHY A PLAIN <image> WOULD HAVE LOOKED BROKEN ────────────────────────────
 *
 *   MEASURED, not assumed. public/images/logo.jpg is a 571×581 JPEG with NO
 *   ALPHA CHANNEL: a blue disc on a solid white square. Its four corners are
 *   pure #FFFFFF. Dropping it on the card's purple ground at any opacity
 *   therefore paints a WHITE BOX with a logo in it, not a watermark.
 *
 *   The first instinct — build an alpha mask from luminance — is worse here
 *   than it sounds. The lettering INSIDE the disc is white too, so a
 *   luminance mask punches the words out along with the background and the
 *   mark stops being the logo.
 *
 *   Clipping to the disc is what actually fits the image. Sweeping the
 *   midline for non-white pixels puts the disc at x 19..550 of 0..570 —
 *   centre 285, radius 266 — so a circle of that radius keeps the whole mark
 *   and takes only the white corners with it.
 *
 * ── AND IT IS EMBEDDED, NOT COMPOSITED ──────────────────────────────────────
 *
 *   sharp composites ON TOP of a rendered SVG, so a watermark added that way
 *   would sit over the member's name rather than behind it. Verified that
 *   librsvg resolves an inline `data:` URI — rendering a probe card and
 *   sampling inside the disc gave [122,81,183] against a [126,34,206] ground,
 *   so the image genuinely lands — which lets the watermark go into the SVG
 *   itself, immediately after the background and beneath every piece of text.
 *
 * @param opts.cx      centre X on the target SVG canvas
 * @param opts.cy      centre Y on the target SVG canvas
 * @param opts.size    rendered width and height, in the canvas' units
 * @param opts.opacity 0..1 — low enough that text over it stays readable
 * @param opts.id      unique clipPath id, since one SVG may carry two marks
 * @returns SVG markup, or "" when the logo cannot be read
 */
export function brandLogoWatermarkSvg(opts: {
    cx: number;
    cy: number;
    size: number;
    opacity: number;
    id?: string;
}): string {
    const src = brandLogoDataUri();
    //   Omitted rather than drawn broken, and lib/brand-logo has already
    //   logged the reason. A card without a watermark is still a valid card.
    if (!src) return "";

    const { cx, cy, size, opacity, id = "logoWatermark" } = opts;

    /*
     *   The disc, as measured above, expressed as a fraction of the source so
     *   it survives being scaled to any size on the target canvas.
     */
    const DISC_CENTRE = 285 / 571;
    const DISC_RADIUS = 266 / 571;

    const x = cx - size / 2;
    const y = cy - size / 2;

    return `
  <defs>
    <clipPath id="${id}">
      <circle cx="${x + size * DISC_CENTRE}" cy="${y + size * DISC_CENTRE}" r="${size * DISC_RADIUS}"/>
    </clipPath>
  </defs>
  <image x="${x}" y="${y}" width="${size}" height="${size}" opacity="${opacity}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice" xlink:href="${src}"/>`;
}
