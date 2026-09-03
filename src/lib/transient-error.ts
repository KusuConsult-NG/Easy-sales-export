/**
 * Is this error the network failing, rather than the request being wrong?
 *
 * ONE QUESTION, SEVENTEEN HAND-WRITTEN ANSWERS, THREE OF THEM DIFFERENT
 * --------------------------------------------------------------------
 * This chain was pasted into seventeen places:
 *
 *     const isTransient = msg.includes("Premature close") ||
 *                         msg.includes("socket hang up") ||
 *                         ... eleven to sixteen more ...
 *
 * and had drifted into three distinct lists — 11 clauses, 13, and 16. The
 * drift is not cosmetic, because the short list and the long list sit on
 * OPPOSITE SIDES of the same request:
 *
 *   lib/firestore-utils.ts   runQueryWithRetry            16 clauses
 *   lib/safe-action.ts       the wrapper round every      11 clauses
 *                            server action
 *
 * runQueryWithRetry retries `getaddrinfo ENOTFOUND`, `network-error` and
 * `DEADLINE_EXCEEDED` as infrastructure faults. safe-action.ts does not have
 * them, and its branch reads:
 *
 *     const sanitizedMessage = isTransient
 *         ? "A temporary connection issue occurred. Please try again."
 *         : errorMessage;
 *
 * under a comment saying "Return safe string to client boundaries". So exactly
 * the errors the system retries as infrastructure faults are the ones it hands
 * to the browser VERBATIM — including the Supabase project hostname inside
 * `getaddrinfo ENOTFOUND db.<project-ref>.supabase.co`.
 *
 * The same split runs through the login flow. preValidateLoginAction has the
 * long list and answers "A temporary connection issue occurred"; authorize()
 * in lib/auth.ts has the short one, falls through to
 *
 *     userMessage = error.message
 *
 * for any message that is not ALL_CAPS and not in its map, and shows the raw
 * DNS error on the login screen. One sign-in, two classifications, and the
 * user is told the outage is their password.
 *
 * WHAT THIS LIST IS
 * -----------------
 * The 16-clause set, which is the union of every network-fault clause any copy
 * had. Two clauses are deliberately NOT here: paystack-server.ts also matched
 * the bare strings "timeout" and "exceeded". "exceeded" matches "Quota
 * exceeded" and "Rate limit exceeded", and calling a rate limit a temporary
 * connection issue would both mislead the user and make runQueryWithRetry
 * hammer a limiter. Those two stay at their call site, composed onto this.
 *
 * Substring matching is kept rather than improved. It is what every caller
 * already relied on, and widening the behaviour while consolidating seventeen
 * copies would make any regression impossible to attribute.
 */

/**
 * Every clause any of the three drifted copies carried, minus the two
 * payment-gateway-specific ones. Exported so a test can assert the list rather
 * than restate it.
 */
export const TRANSIENT_ERROR_MARKERS: readonly string[] = [
    // Node / undici socket teardown
    "Premature close",
    "socket hang up",
    "ECONNRESET",
    "Client network socket disconnected",
    "ERR_STREAM_PREMATURE_CLOSE",
    "Connection closed",
    "Socket closed",
    "stream terminated",
    // fetch
    "FetchError",
    "fetch failed",
    // DNS
    "ENOTFOUND",
    "getaddrinfo",
    "network-error",
    // gRPC / Postgres deadlines
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "deadline exceeded",
] as const;

/**
 * True when `error` looks like the connection failed rather than the request
 * being rejected. Accepts an Error, a string, or anything with a `message`,
 * because the seventeen call sites variously passed all three.
 */
export function isTransientError(error: unknown): boolean {
    const message =
        typeof error === "string"
            ? error
            : error && typeof error === "object" && "message" in error
                ? String((error as { message: unknown }).message ?? "")
                : String(error ?? "");

    if (!message) return false;
    return TRANSIENT_ERROR_MARKERS.some((marker) => message.includes(marker));
}
