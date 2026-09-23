import "server-only";

/**
 * A read that has already left, read back only where it is needed.
 *
 *   THE OWNER: "fix the cooperative status one next."
 *
 *       checkCooperativeStatusAction took 1496ms / 1691ms / 1848ms / 2596ms
 *
 *   #275 and #276 took that action from fourteen reads to seven and it was
 *   still taking seconds, because READ COUNT IS NOT WHAT LATENCY IS MADE OF.
 *   Measured with a fake database that makes every read take a tick: SEVEN
 *   READS IN SIX WAVES. The reads were already few. The action waited for them
 *   almost one at a time, and six serial hops at a few hundred milliseconds
 *   each is the figure in the log.
 *
 *   Some of those hops were a chain only in the source. Three lookups about
 *   one person — is there a membership row, is there one at their address, did
 *   they pay — need nothing from each other, and the last two are reached only
 *   when the first finds nothing.
 *
 * ── WHY NOT JUST HOLD THE PROMISE ───────────────────────────────────────────
 *
 *   Because a promise nobody awaits still rejects. Start a query early, return
 *   before you need it, and its failure becomes an unhandled rejection — which
 *   in a Node server is a process-level event, not a local one. That is a
 *   worse bug than the latency being fixed.
 *
 *   So the outcome is captured the moment it settles and re-raised only when
 *   somebody actually asks. A caller that never asks sees nothing; a caller
 *   that asks gets exactly the value or exactly the error it would have got
 *   from awaiting in place. NOTHING IS SWALLOWED AND NOTHING IS INVENTED.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 *   IT IS NOT A GATE AND IT DOES NOT MOVE ONE. Issuing a query early is not
 *   reading its rows into an answer: in the cooperative action the by-address
 *   result still passes `mayClaimMembershipByEmail` before any of it is used,
 *   unchanged and in the same place. Only the waiting moved.
 *
 *   It also buys a wave with a read. A caller that returns early has paid for
 *   work it did not use — worth it exactly when a round trip is mostly waiting,
 *   which is what this platform measured, and not worth it for an expensive
 *   query on a path that usually skips it.
 */
export function startedEarly<T>(work: Promise<T>): () => Promise<T> {
    /*
     *   HANDLED HERE, IMMEDIATELY — this is the line that stops an unawaited
     *   rejection reaching the process. `failure` is a sentinel rather than a
     *   truthiness test so that a rejection with a falsy value is still a
     *   rejection.
     */
    const settled: Promise<{ ok: true; value: T } | { ok: false; failure: unknown }> =
        work.then(
            (value) => ({ ok: true as const, value }),
            (failure: unknown) => ({ ok: false as const, failure }),
        );

    return async (): Promise<T> => {
        const outcome = await settled;
        if (!outcome.ok) throw outcome.failure;
        return outcome.value;
    };
}
