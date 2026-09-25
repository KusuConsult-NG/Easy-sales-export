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
 * The path if it is safe, otherwise the fallback — and the fallback is checked too.
 *
 * The fallback is required rather than defaulted: every caller already has a
 * destination in mind for the ordinary case, and a silent default is how a
 * redirect ends up somewhere nobody chose.
 *
 *   #917 IT TRUSTED ITS OWN SECOND ARGUMENT.
 *
 *   This was `isSafeInternalPath(value) ? … : fallback`, so the fallback went
 *   back to the caller unexamined. The whole point of the function is that a
 *   redirect destination has been through the rule; on the refusal path — the one
 *   that runs when somebody is attacking it — nothing had.
 *
 *   MEASURED before calling it live: all four call sites pass a safe literal or
 *   the empty sentinel today, so there is no open redirect to exploit. But
 *   LoginForm's fallback is `defaultCallbackUrl`, a PROP — /auth/login/admin
 *   passes "/admin" and the default is "/dashboard". A prop is the one kind of
 *   argument a future caller supplies without reading this function, and
 *   `<LoginForm defaultCallbackUrl="https://elsewhere.example" />` would have
 *   turned the guard into a pass-through for exactly the value it exists to
 *   refuse. The safety of every redirect rested on four callers each remembering
 *   a rule the guard was capable of enforcing.
 *
 *   THE EMPTY STRING STAYS ALLOWED, deliberately. ModuleRegisterPage passes ""
 *   and says why: "it is what lets the server action choose the module's own
 *   onboarding page rather than a module root." It is a documented "no
 *   destination" sentinel rather than a path, `isSafeInternalPath("")` is false
 *   for the right reason, and coercing it to "/" would change that page's
 *   behaviour. So it is permitted by name, not by accident.
 *
 *   Anything else unsafe fails closed to "/" and says so. "/" is the one
 *   destination that cannot be an attack: it is this origin's own root.
 */
export function safeInternalPath(
    value: string | null | undefined,
    fallback: string,
): string {
    if (isSafeInternalPath(value)) return value!.replace(LEADING_STRIPPED, "");

    //   The documented sentinel, and only it.
    if (fallback === "") return fallback;

    if (isSafeInternalPath(fallback)) return fallback.replace(LEADING_STRIPPED, "");

    //   No logger import: this module has none, and safe-redirect is reached from
    //   client components where a types-and-rules module should not drag one in
    //   (#911's lesson). `no-console` allows warn.
    console.warn(
        `[safeInternalPath] refused an unsafe fallback ${JSON.stringify(fallback)} — redirecting to "/"`,
    );
    return "/";
}
