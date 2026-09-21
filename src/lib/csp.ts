/**
 * One Content-Security-Policy, built in one place.
 *
 * WHY IT MOVED OUT OF next.config.ts
 * ----------------------------------
 * The policy used to be a static header, which forced `script-src
 * 'unsafe-inline'` — a static header cannot carry a per-request nonce, and three
 * inline scripts in the root layout need one: the theme no-flash guard, and two
 * JSON-LD blocks (`<script type="application/ld+json">` is still governed by
 * `script-src`).
 *
 * `'unsafe-inline'` removes most of what CSP is for. The XSS review found three
 * `dangerouslySetInnerHTML` sites and judged them safe, but "safe" there means
 * *no injection was found* — and CSP exists for the injection nobody found.
 *
 * WHY A SHARED MODULE RATHER THAN A COPY IN THE MIDDLEWARE
 * -------------------------------------------------------
 * Two copies of a security rule is the defect that has recurred all week: a
 * guard applied to one path and not its sibling. The middleware sets the real,
 * nonced header; `next.config.ts` keeps a nonce-free fallback for any response
 * the middleware does not touch. Both call this function, so the allow-lists
 * cannot drift apart.
 */

/*
 *   GOOGLE MAPS IS GONE FROM ALL THREE DIRECTIVES.
 *
 *   `maps.googleapis.com` was on script-src and connect-src and
 *   `maps.google.com` on connect-src, for one caller: the checkout delivery
 *   address. The owner asked for OpenStreetMap there instead, and the
 *   replacement talks to this origin's own api/geocode — so the browser makes
 *   no cross-origin request at all and the hosts have no remaining use.
 *
 *   An allow-list entry with no caller is not harmless: it is standing
 *   permission for a script host that nothing on the platform needs, and the
 *   next person to read it will take it as evidence that Google Maps is in use
 *   somewhere. The Nominatim call is made server side (lib/nominatim explains
 *   why), which is also why nothing is added here to replace them.
 */

/** Hosts that legitimately serve executable script. */
const SCRIPT_HOSTS = [
    "https://js.paystack.co",
    "https://www.googletagmanager.com",
    "https://meet.jit.si",
];

const CONNECT_HOSTS = [
    "https://*.firebaseio.com",
    "https://firebaseinstallations.googleapis.com",
    "https://firestore.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://api.paystack.co",
    "https://api.cloudinary.com",
    "wss://*.firebaseio.com",
    "https://firebasestorage.googleapis.com",
    "https://storage.googleapis.com",
    "https://*.jit.si",
    "wss://*.jit.si",
];

const FRAME_HOSTS = [
    "https://js.paystack.co",
    "https://checkout.paystack.com",
    "https://www.youtube.com",
    "https://youtube.com",
    "https://firebasestorage.googleapis.com",
    "https://docs.google.com",
    "https://*.jit.si",
    //   The Academy lesson page embeds its course DOCUMENT and SPREADSHEET in
    //   iframes — the PDF straight from Cloudinary, the spreadsheet through
    //   Office's viewer. Neither host was listed, so both panes were blank for
    //   the same reason the video would not play. See MEDIA_HOSTS below.
    "https://res.cloudinary.com",
    "https://view.officeapps.live.com",
];

/**
 * Where audio and video may be LOADED FROM.
 *
 *   #!! THE ALLOW-LIST NAMED THE STORAGE THIS PROJECT DOES NOT HAVE.
 *
 *   media-src read, in full:
 *
 *       media-src 'self' https://firebasestorage.googleapis.com
 *                        https://storage.googleapis.com blob:
 *
 *   Both of those are Firebase Storage, and api/upload says of itself, at the
 *   top of the file: "Firebase Storage bucket doesn't exist on this project.
 *   Using Cloudinary instead." Every upload this platform has ever taken is
 *   served from res.cloudinary.com, and res.cloudinary.com was not on the
 *   list. So the policy permitted exactly the backend that was never
 *   provisioned and forbade the only one in use, and NO UPLOADED VIDEO COULD
 *   PLAY — an Academy lesson recording, a marketplace product demo, any of
 *   them. The browser blocks the load and the element sits there empty.
 *
 *   WHY IT WENT UNNOTICED FOR SO LONG, AND ONLY VIDEO BROKE. Look at the
 *   neighbouring directive: `img-src 'self' data: https: blob:` allows ANY
 *   https host. Images from Cloudinary were therefore fine, and images are
 *   most of what gets uploaded — so the allow-list looked right every day
 *   until somebody uploaded a video.
 *
 *   connect-src has `https://api.cloudinary.com`, which is the UPLOAD API.
 *   That is the half of Cloudinary a developer adds while making uploading
 *   work; res.cloudinary.com is the half you only need when something plays it
 *   back.
 */
const MEDIA_HOSTS = [
    //   Where this platform actually stores things.
    "https://res.cloudinary.com",
    //   Kept: harmless if unused, and a bucket may yet be provisioned. They are
    //   not the reason this directive exists any more, which is the point.
    "https://firebasestorage.googleapis.com",
    "https://storage.googleapis.com",
];

export interface CspOptions {
    /** Per-request nonce. Omitted only for the static fallback. */
    nonce?: string;
    isDev?: boolean;
}

export function buildCsp({ nonce, isDev = false }: CspOptions = {}): string {
    // With a nonce present, 'unsafe-inline' is dropped entirely.
    //
    // 'strict-dynamic' is deliberately NOT used. It would make the host
    // allow-list above inert, and Next's own bootstrap loads further chunks by
    // URL — the allow-list is doing real work here.
    const scriptSrc = [
        "'self'",
        ...(isDev ? ["'unsafe-eval'"] : []),
        ...(nonce ? [`'nonce-${nonce}'`] : ["'unsafe-inline'"]),
        ...SCRIPT_HOSTS,
    ].join(" ");

    const connectSrc = [
        "'self'",
        ...(isDev
            ? ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"]
            : []),
        ...CONNECT_HOSTS,
    ].join(" ");

    return [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        // style-src keeps 'unsafe-inline': React writes inline style attributes
        // throughout, and nonces do not apply to them. Inline STYLE is a far
        // weaker primitive than inline SCRIPT.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        `connect-src ${connectSrc}`,
        `frame-src 'self' ${FRAME_HOSTS.join(" ")}`,
        `media-src 'self' ${MEDIA_HOSTS.join(" ")} blob:`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
}

/**
 * A fresh nonce.
 *
 * Uses Web Crypto so it works in the Edge runtime, where `node:crypto` is not
 * guaranteed. Base64 of 16 random bytes.
 */
export function generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/** Header the middleware uses to hand the nonce to server components. */
export const NONCE_HEADER = "x-nonce";
