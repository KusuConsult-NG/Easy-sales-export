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

/** Hosts that legitimately serve executable script. */
const SCRIPT_HOSTS = [
    "https://js.paystack.co",
    "https://www.googletagmanager.com",
    "https://meet.jit.si",
    "https://maps.googleapis.com",
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
    "https://maps.googleapis.com",
    "https://maps.google.com",
];

const FRAME_HOSTS = [
    "https://js.paystack.co",
    "https://checkout.paystack.com",
    "https://www.youtube.com",
    "https://youtube.com",
    "https://firebasestorage.googleapis.com",
    "https://docs.google.com",
    "https://*.jit.si",
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
        "media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com blob:",
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
