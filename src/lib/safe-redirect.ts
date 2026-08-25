/**
 * Is this a destination on THIS site, or somewhere else wearing a leading slash?
 *
 *   #262 THE POST-LOGIN REDIRECT ACCEPTED "//evil.example".
 *
 *        LoginForm.tsx guarded its callbackUrl with
 *
 *            rawCallback.startsWith("/")
 *
 *        under a comment reading "SECURITY: Only accept relative paths as
 *        callbackUrl". A protocol-relative URL starts with "/" and is ABSOLUTE
 *        to a browser, so "//evil.example" passed — and the redirect is
 *
 *            window.location.assign(rawCallback);
 *
 *        a direct navigation with the raw value. (Not NextAuth, which would
 *        have concatenated it onto the base URL and neutralised it.)
 *
 *        So /auth/login?callbackUrl=//evil.example is a link on the real
 *        domain, with the real certificate and the real login form. The member
 *        signs in successfully and is then handed to evil.example, which is
 *        free to say "your session expired, please sign in again". A
 *        post-authentication open redirect borrows our credibility for somebody
 *        else's page.
 *
 *        THE RULE ALREADY EXISTED, TWICE, AND CORRECTLY:
 *
 *          actions/notifications.ts  startsWith("/") && !startsWith("//")
 *          actions/reviews.ts        refuses "//" with a comment noting it
 *                                    "reads as a path and behaves as a URL"
 *
 *        Both authors saw it. The login path — the one place the value comes
 *        from a query string an attacker writes — did not. One copy now, and a
 *        ratchet in safe-redirect-path.test.ts that fails on a new naive guard.
 *
 * WHAT A BROWSER ACTUALLY DOES
 * ----------------------------
 * Three shapes get past `startsWith("/")`:
 *
 *   //evil.example    protocol-relative; absolute to a browser
 *   /\evil.example    a backslash is accepted as the authority delimiter
 *   \t//evil.example  leading control characters are STRIPPED before parsing,
 *                     so the check and the browser see different strings
 *
 * All three are refused here.
 */

/** Characters a browser strips from the front of a URL before parsing it. */
const LEADING_STRIPPED = /^[\u0000-\u0020]+/;

export function isSafeInternalPath(value: string | null | undefined): value is string {
    if (!value) return false;

    // Strip what the browser strips, so this check and the navigation agree on
    // what the string is.
    const v = value.replace(LEADING_STRIPPED, "");
    if (!v.startsWith("/")) return false;

    // "//host" and "/\host" both name an authority. A backslash counts because
    // browsers normalise it to a slash in this position.
    if (v.length > 1 && (v[1] === "/" || v[1] === "\\")) return false;

    return true;
}

/**
 * The path if it is safe, otherwise the fallback.
 *
 * The fallback is required rather than defaulted: every caller already has a
 * destination in mind for the ordinary case, and a silent default is how a
 * redirect ends up somewhere nobody chose.
 */
export function safeInternalPath(
    value: string | null | undefined,
    fallback: string,
): string {
    return isSafeInternalPath(value) ? value!.replace(LEADING_STRIPPED, "") : fallback;
}
