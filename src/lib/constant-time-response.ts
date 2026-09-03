/**
 * Hold a reply until a fixed floor has elapsed, so that HOW LONG an answer took
 * stops being part of the answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * registerAction and preValidateLoginAction were both made to return identical
 * replies whether or not an address is registered. That closes what the reply
 * SAYS. It does not close what the reply's timing says, and the two paths do
 * genuinely different work:
 *
 *   registration, free address    createUser (a password hash), profile write
 *   registration, taken address   createUser fails, signInWithPassword (another
 *                                 hash), a notification email
 *
 * An attacker who cannot read a difference in the body can still measure one in
 * the clock, and with enough samples the noise averages out. Padding both paths
 * to a common floor removes that, for as long as the floor is above what either
 * path actually takes.
 *
 * WHAT THIS DOES NOT DO — READ BEFORE TRUSTING IT
 * -----------------------------------------------
 * This is a floor, not a fixed cost. A path that naturally runs LONGER than the
 * floor is not padded at all and leaks exactly as much as it did before. That
 * failure is silent by nature, so it is logged: `floorMs` wants to sit above
 * the p99 of every path it covers, and the log is how you find out it no longer
 * does.
 *
 * It also cannot equalise anything upstream of the handler — TLS, the CDN, or
 * variance inside the auth provider itself. The claim is bounded: the work THIS
 * codebase does is no longer visible in the response time.
 *
 * The delay is deliberately not randomised. Jitter feels like a defence and is
 * not one: averaging over samples removes zero-mean noise, while a hard floor
 * removes the signal itself.
 */

import { logger } from "@/lib/logger";

/**
 * How long an enumeration-sensitive reply is held for, in milliseconds.
 *
 * Sized to sit above a registration's real cost — a phone-uniqueness query, a
 * Supabase round-trip that hashes a password, and a profile write — with
 * headroom. Registration and a failed login are both rare enough per user that
 * a fixed second and a half is not felt; it is not applied to a SUCCESSFUL
 * login, which is the hot path.
 *
 * Overridable so a deployment on slower infrastructure can raise it, and so
 * tests can lower it rather than sleeping for real.
 */
export const RESPONSE_FLOOR_MS = Number(
    process.env.AUTH_RESPONSE_FLOOR_MS
    // Zero under test unless a suite asks for a floor. Every other auth suite
    // calls registerAction several times, and at 1500ms each they added ~18
    // seconds to the run — a padding helper that makes the test suite slow
    // enough to be skipped protects nothing. auth-timing.test.ts sets the
    // variable before importing, so the behaviour is still exercised for real.
    ?? (process.env.NODE_ENV === "test" ? 0 : 1500),
);

/** Resolve after `ms`, or immediately if there is nothing to wait for. */
function sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Run `work` and hold its result — or its exception — until `floorMs` has
 * passed since the call started.
 *
 * The pad is in a `finally` so a thrown error is delayed too. A path that
 * fails fast and one that fails slowly are as good an oracle as two different
 * messages, and an exception is exactly where an unpadded early return tends
 * to hide.
 */
export async function withResponseFloor<T>(
    work: () => Promise<T>,
    floorMs: number = RESPONSE_FLOOR_MS,
    label = "response",
): Promise<T> {
    const startedAt = Date.now();
    try {
        return await work();
    } finally {
        const elapsed = Date.now() - startedAt;
        if (elapsed > floorMs) {
            // The guard has stopped guarding. Silence here would mean the
            // protection decayed as the system got slower and nobody noticed.
            logger.warn(
                `[timing] ${label} took ${elapsed}ms, over the ${floorMs}ms floor — `
                + "timing is no longer equalised for this path; raise AUTH_RESPONSE_FLOOR_MS",
            );
        }
        await sleep(floorMs - elapsed);
    }
}

/**
 * Await `work`, but never for longer than `capMs`.
 *
 * For best-effort side work on a padded path — sending the "someone tried to
 * register with your address" notice, say. Without a cap, one slow send pushes
 * that path past the floor and the padding stops covering it. The promise is
 * not cancelled, only stopped being waited on, so the send still gets its
 * chance; a rejection is swallowed because this is by definition work whose
 * failure must not change the reply.
 */
export async function atMost(work: Promise<unknown>, capMs: number): Promise<void> {
    await Promise.race([
        work.catch(() => undefined),
        sleep(capMs),
    ]);
}
