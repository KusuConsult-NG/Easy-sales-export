import "server-only";

import { cache } from "react";

/**
 * How long this request spent waiting on the database, and how many times.
 *
 *   THE OWNER, after seven merged read-count fixes: "i noticed the app is
 *   still slow. did you fix get to production or you dont know how to fix it?"
 *
 *   A fair question, and the honest answer was that every measurement in this
 *   audit counted READS and none of them measured TIME. #261 built a read
 *   meter and it lives in lib/testing/fake-db — it runs under jest and nowhere
 *   else. NOTHING IN PRODUCTION HAS EVER COUNTED A DATABASE ROUND TRIP.
 *
 *   So the one question that decides what to do next could only be guessed at:
 *
 *       IS THE PAGE SLOW BECAUSE IT ASKS TOO MANY TIMES,
 *       OR BECAUSE EACH ASK COSTS TOO MUCH?
 *
 *   Fitting the owner's own `[slow-action]` lines against the read counts this
 *   audit measured suggests about 120ms of fixed cost plus ~127ms per round
 *   trip — which would mean the second, and would make co-locating the app
 *   with the database worth more than all seven of those PRs together. That is
 *   three points fitted to a line from logs I did not generate. This module
 *   exists so the next log answers it instead.
 *
 * ── WHAT IT COUNTS, STATED PRECISELY ────────────────────────────────────────
 *
 *   One entry per `.get()` on a document reference or a query — the same unit
 *   lib/testing/fake-db counts, so the production number is comparable with
 *   every "reads" figure in this audit.
 *
 *   A QUERY THAT PAGES IS STILL ONE ENTRY. SupabaseQuery.get() fetches
 *   1,000-row pages in a loop, so a large scan is one read whose time covers
 *   several HTTP calls. That is the right unit for the question above — it is
 *   one thing the caller asked for — but it means `slowestMs` on an unbounded
 *   query is a scan, not a network hop.
 *
 *   WRITES ARE NOT COUNTED. They are rarer, they are not what the page waits
 *   on before it renders, and mixing them in would blur the one comparison
 *   this exists to make.
 *
 * ── AND IT CANNOT BREAK WHAT IT MEASURES ────────────────────────────────────
 *
 *   Every entry point swallows its own errors and returns a zeroed tally. A
 *   meter that can fail a read is worse than no meter — that is the rule
 *   safe-action's own timer already states: "Instrumentation that can break
 *   the thing it measures is worse than none."
 *
 *   Outside a request scope — a cron, a script — React's cache() has no store
 *   to hang this on, so each call gets a fresh tally and nothing aggregates.
 *   That degrades to silence rather than to a wrong number.
 */

export interface RoundTripTally {
    /** `.get()` calls completed. */
    reads: number;
    /** Milliseconds spent inside them. */
    dbMs: number;
    /** The slowest single one. */
    slowestMs: number;
}

const ZERO: RoundTripTally = { reads: 0, dbMs: 0, slowestMs: 0 };

const requestTally = cache((): RoundTripTally => ({ reads: 0, dbMs: 0, slowestMs: 0 }));

/** Record one completed read. Never throws. */
export function recordRoundTrip(elapsedMs: number): void {
    try {
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
        const tally = requestTally();
        tally.reads += 1;
        tally.dbMs += elapsedMs;
        if (elapsedMs > tally.slowestMs) tally.slowestMs = elapsedMs;
    } catch {
        //   See the header: this must never fail the read it is measuring.
    }
}

/** The tally as it stands. Never throws. */
export function roundTripsSoFar(): RoundTripTally {
    try {
        return { ...requestTally() };
    } catch {
        return { ...ZERO };
    }
}

/**
 * What happened between `before` and now.
 *
 * THE TALLY IS REQUEST-SCOPED AND ACTIONS ARE WHAT GETS REPORTED, so a caller
 * that wants one action's share takes a snapshot around it rather than reading
 * the total. A server action is its own request, so for the lines in the
 * owner's log the two are the same thing.
 *
 * WHERE A PAGE RUNS TWO ACTIONS CONCURRENTLY — /academy/application does,
 * deliberately — their reads interleave and neither delta is that action's
 * alone. The TOTAL stays honest, which is the figure the question above turns
 * on. `slowestMs` is taken as the larger of the two ends rather than
 * subtracted, because a maximum cannot be differenced.
 */
export function roundTripsSince(before: RoundTripTally): RoundTripTally {
    try {
        const now = requestTally();
        return {
            reads: Math.max(0, now.reads - before.reads),
            dbMs: Math.max(0, now.dbMs - before.dbMs),
            slowestMs: now.slowestMs,
        };
    } catch {
        return { ...ZERO };
    }
}
