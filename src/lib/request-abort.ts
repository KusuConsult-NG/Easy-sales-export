/**
 * Telling "the connection went away" apart from "the application broke".
 *
 *   FROM THE OWNER'S PRODUCTION LOG, in bursts, always the same digest:
 *
 *       ⨯ Error: The destination stream closed early.
 *           at ignore-listed frames { digest: '2398141500' }
 *
 *   and, in an earlier window, interleaved with it:
 *
 *       Error: aborted
 *           at ignore-listed frames { code: 'ECONNRESET' }
 *
 *   Both say the same thing from two levels: the HTTP response stream was
 *   destroyed before the server had finished writing to it. Next throws the
 *   first while rendering into a socket that is no longer there; Node raises
 *   the second on the request itself.
 *
 * ── WHAT THE LOG COULD NOT TELL ANYBODY, AND WHY THIS EXISTS ────────────────
 *
 *   A closed stream has three plausible causes and the log distinguished none
 *   of them, because nothing recorded WHICH REQUEST it was:
 *
 *       a person navigated away, closed the tab, or lost signal mid-render
 *       a proxy or load balancer cut a response that took too long
 *       the container restarted while requests were in flight
 *
 *   Spread evenly across many routes, it is the first and it is ordinary
 *   internet. Concentrated on ONE route, it is the second, and that route is
 *   too slow. Clustered around a boot, it is the third.
 *
 *   Those need three different responses and the evidence to choose between
 *   them is `path` and `routePath` — which `onRequestError` has and the bare
 *   log line does not. So this module does not decide the cause. It marks the
 *   class, and instrumentation.ts records the route so the next log answers
 *   the question instead of posing it.
 *
 * ── AND IT IS NOT AN APPLICATION FAULT ──────────────────────────────────────
 *
 *   Whichever of the three it is, no stack trace helps: the render was fine
 *   until nobody was listening. Reported to Sentry it is worse than useless —
 *   at the volume above it buries the errors somebody could act on, which is
 *   how an error tracker stops being read.
 *
 * ── ON MATCHING A MESSAGE SOMEBODY ELSE OWNS ────────────────────────────────
 *
 *   The login lockout broke this week because a guard matched wording
 *   rate-limit.ts owned, that wording was improved, and the guard silently
 *   stopped firing. So doing it here needs a reason, not a habit.
 *
 *   THE DIFFERENCE IS WHICH WAY IT FAILS. That guard failed OPEN: brute-force
 *   protection turned off and nothing said so. This one fails NOISY — if Next
 *   rewords the message, aborts start reaching Sentry again, which is visible
 *   within a day and costs nothing but noise. There is no direction in which a
 *   stale match here admits anybody to anything.
 *
 *   And there is no structured alternative. Next offers a message and a
 *   `digest`, and the digest is a hash OF the message, so it is strictly more
 *   brittle. Node's `code` is stable and is used first, wherever it is present.
 */

/** Node error codes that mean the peer is gone, not that we are broken. */
const GONE_CODES = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"]);

/**
 * Next and Node phrasings for the same event, matched as SUBSTRINGS.
 *
 * Lower-cased before comparison so a capitalisation change alone cannot
 * silence this the way it silenced the lockout guard.
 *
 * Every entry here is a distinctive multi-word phrase that does not occur in
 * ordinary application prose. "client network socket disconnected" has to be a
 * substring because Node's message continues "...before secure TLS connection
 * was established"; the rest are whole messages today, and are kept here
 * rather than moved below so that a wrapper adding context — "fetch failed:
 * socket hang up" — still classifies.
 */
const GONE_PHRASES = [
    "the destination stream closed early",
    "premature close",
    "socket hang up",
    "client network socket disconnected",
    "request aborted",
];

/**
 * THE ONE WORD THAT CANNOT BE A SUBSTRING, AND WHY IT IS SEPARATED OUT.
 *
 *   `"aborted"` sat in the list above and was matched with `.includes`. So
 *   ANY server error whose message contained the word anywhere was classified
 *   as a dead connection and withheld from Sentry:
 *
 *       current transaction is aborted, commands ignored until end of
 *       transaction block                                    ← Postgres
 *       Payment aborted by provider
 *       Upload aborted: invalid file type
 *
 *   The first of those is a standard Postgres error and this platform talks to
 *   Postgres. A real fault, in the error tracker's blind spot, by a rule
 *   written to remove noise.
 *
 * AND IT FAILED IN THE DIRECTION THIS MODULE'S HEADER SAYS IT DOES NOT.
 *
 *   The note above on matching somebody else's message argues the risk is
 *   acceptable because "this one fails NOISY — if Next rewords the message,
 *   aborts start reaching Sentry again, which is visible within a day". That
 *   is true of a REWORD. It was never true of an over-match: a real error
 *   silently withheld produces nothing to notice, which is the lockout
 *   guard's failure mode, in the module written to learn from it.
 *
 *   Node emits this one as the COMPLETE message — `Error: aborted`, with
 *   ECONNRESET beside it, which the code check above catches first anyway. So
 *   an exact match loses nothing real and closes the hole. A wrapped variant
 *   would now reach Sentry, which is the direction that is safe to be wrong in.
 */
const GONE_EXACT_MESSAGES = new Set(["aborted"]);

/**
 * Trimmed and lower-cased, and nothing else.
 *
 *   A first version also stripped trailing `.` and `!`, on the theory that
 *   Next punctuates and Node does not. Nothing emits `aborted` with a full
 *   stop, so no test could reach that branch — a mutation run deleting it
 *   killed nothing — and an untested normalisation is the kind of line a
 *   later reader treats as load-bearing.
 *
 *   It would also have cost nothing to be without: a punctuated variant fails
 *   the exact match and reaches Sentry, which is the direction this module is
 *   safe to be wrong in. Next's own message DOES end in a full stop, and it is
 *   matched as a substring, where trailing punctuation never mattered.
 */
const normaliseMessage = (message: string): string => message.trim().toLowerCase();

/**
 * Did this error mean the caller stopped listening?
 *
 * Narrowed from `unknown` because that is what `onRequestError` is handed, and
 * because React may hand back something that is not the thrown value at all —
 * the Next documentation says so explicitly.
 */
export function isConnectionGoneAway(error: unknown): boolean {
    if (error === null || error === undefined) return false;

    const code = (error as { code?: unknown })?.code;
    //   The code first: it is Node's own, it is stable, and it does not depend
    //   on anybody's prose.
    if (typeof code === "string" && GONE_CODES.has(code)) return true;

    //   An AbortController on the caller's side reaches here as AbortError.
    const name = (error as { name?: unknown })?.name;
    if (name === "AbortError") return true;

    const message = (error as { message?: unknown })?.message;
    if (typeof message !== "string" || message === "") return false;

    const lowered = normaliseMessage(message);
    if (GONE_EXACT_MESSAGES.has(lowered)) return true;
    return GONE_PHRASES.some((phrase) => lowered.includes(phrase));
}
