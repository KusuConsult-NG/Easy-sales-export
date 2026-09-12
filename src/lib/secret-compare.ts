import { timingSafeEqual } from "crypto";

/**
 * Constant-time comparison of two shared secrets.
 *
 *   #659 THE STRICT VERSION HAD REACHED ONE DOOR OF ELEVEN.
 *
 *   #645 changed the Africa's Talking webhook from `!==` to `timingSafeEqual`,
 *   and its own note says why:
 *
 *       "the idiom already exists in this codebase, the fix costs nothing, and
 *        'the strict version went to one of the two doors' is the defect this
 *        audit has found more than any other."
 *
 *   It named `revalidate-cache` in the same sentence — the sweep in
 *   every-api-route-has-a-door records "africastalking and revalidate-cache came
 *   back 'no auth'. Both compare a shared secret from process.env" — and
 *   hardened only one of them. A sweep then found EIGHT MORE: every cron route
 *   in this application compares `Authorization` against
 *   `` `Bearer ${cronSecret}` `` with plain `!==`, and those are the triggers
 *   that release escrow, pay sellers, purge accounts and reconcile Paystack.
 *
 *   Eleven doors, one of them strict.
 *
 * ── AND THE TWO STRICT COPIES DISAGREED WITH EACH OTHER ─────────────────────
 *
 *   There were two hand-written `secretsMatch` functions, and they were not the
 *   same function:
 *
 *     api/auth/health        pads both buffers to the longer length and runs
 *                            the comparison anyway, so a wrong LENGTH costs the
 *                            same as a wrong byte.
 *     webhooks/africastalking returns false immediately when the lengths differ,
 *                            documented as an accepted trade.
 *
 *   One contract, two statements of it, disagreeing about the thing the
 *   function exists to control. This is the version that does not short-circuit.
 *
 * ── HOW MUCH THIS IS WORTH, STATED PLAINLY ──────────────────────────────────
 *
 *   Over a network a byte-by-byte comparison is a poor oracle, and nobody is
 *   going to extract CRON_SECRET through it. That is not the argument. The
 *   argument is that the idiom exists, it costs nothing, and eight copies of a
 *   security check that differ from each other and from the codebase's own
 *   convention are how the next real difference goes unnoticed.
 */

/**
 * Is `provided` the same secret as `expected`?
 *
 * Takes the same time whether the secrets differ in one byte or in length, and
 * returns false for a missing value rather than throwing.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
    //   Both must actually exist. An unset secret matching an absent header
    //   would be the fail-open shape cron-secret-fail-closed was written for —
    //   there, `"Bearer undefined"` was a valid credential.
    if (!provided || !expected) return false;

    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");

    if (a.length !== b.length) {
        //   timingSafeEqual THROWS on a length mismatch, which is itself an
        //   oracle — the caller learns the length from whether it threw. Both
        //   are padded to the longer length and the comparison is run anyway,
        //   so the work is the same either way, and the result is false because
        //   the lengths differed.
        const width = Math.max(a.length, b.length);
        const a2 = Buffer.concat([a, Buffer.alloc(width)]).subarray(0, width);
        const b2 = Buffer.concat([b, Buffer.alloc(width)]).subarray(0, width);
        timingSafeEqual(a2, b2);
        return false;
    }

    return timingSafeEqual(a, b);
}

/**
 * The token out of an `Authorization: Bearer <token>` header, or null.
 *
 * Case-sensitive on the scheme, exactly as all eleven call sites were before
 * this module existed. Accepting `bearer` as well would WIDEN what the cron
 * endpoints accept, and a caller sending it is already being refused today, so
 * nothing is gained and something is risked.
 */
export function bearerToken(header: string | null | undefined): string | null {
    if (!header || !header.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length);
}
