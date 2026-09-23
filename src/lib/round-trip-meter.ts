import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

/**
 * What this request spent waiting on a network, broken down by which network.
 *
 *   THE OWNER, after seven merged read-count fixes: "i noticed the app is
 *   still slow. did you fix get to production or you dont know how to fix it?"
 *
 *   The first version of this module answered the READ-COUNT half and got two
 *   things wrong, both of which its own first log made obvious. This is the
 *   second version. Both defects are written down here because a meter nobody
 *   believes is worse than no meter, and the way to be believed is to say
 *   what it got wrong.
 *
 * ── DEFECT ONE: ACTIONS STOLE EACH OTHER'S NUMBERS ──────────────────────────
 *
 *   The tally was REQUEST-scoped and the report is PER ACTION, so safe-action
 *   took a delta around each call. Two actions running at once each measured
 *   the other's reads, and the log said so in a way that cannot be true:
 *
 *       checkAcademyStatusAction took 3235ms — 8 reads, 3806ms in the database
 *
 *   3,806ms of database inside 3,235ms of wall clock. Worse, the pair gave
 *   themselves IDENTICAL figures one millisecond apart:
 *
 *       17:37:27.040 checkAcademyPaymentStatusAction 1184ms — 6 reads, 1318ms
 *       17:37:27.041 checkAcademyStatusAction        1185ms — 6 reads, 1318ms
 *
 *   The old header called this an edge case affecting "a page that runs two
 *   actions concurrently". It was a third of the lines.
 *
 *   FIXED WITH AsyncLocalStorage, which is what actually scopes to an async
 *   call tree. safe-action opens a scope per action and reads it directly, so
 *   nothing is subtracted and nothing interleaves. No route in this app runs
 *   on the edge runtime, so node:async_hooks is available — and if it ever
 *   were not, every entry point below degrades to the request total rather
 *   than to a wrong number.
 *
 * ── DEFECT TWO: IT MEASURED ONE NETWORK OUT OF THREE ────────────────────────
 *
 *   Only the Supabase adapter was instrumented, and everything else was
 *   reported as time spent "elsewhere" — a word that sounds like this
 *   container doing work. It was usually more network.
 *
 *   requireSession() runs at the top of EVERY action and, on a cache hit,
 *   touches no database at all: it decodes a JWT locally and then asks Upstash
 *   over HTTPS. So the log carried lines like
 *
 *       checkCooperativeStatusAction took 1848ms — 0 reads, 0ms in the
 *       database, 1848ms elsewhere
 *
 *   which read as a mystery and was simply a network this could not see.
 *   Redis and the outbound calls on the hot path — Paystack's initialise and
 *   verify, ImageKit's upload — are measured now.
 *
 *   WHAT IS STILL NOT MEASURED IS CALLED `unmeasured`, NOT `elsewhere`. The
 *   remaining fetch sites in lib/ are reconcilers and sweeps that no page
 *   waits on. When one of them starts mattering, the fix is to wrap it in
 *   `measure()` — not to reinterpret a number that never covered it.
 *
 * ── WHAT ONE `db` ENTRY MEANS ───────────────────────────────────────────────
 *
 *   One `.get()` on a document reference or a query — the same unit
 *   lib/testing/fake-db counts, so the production number stays comparable with
 *   every "reads" figure in this audit.
 *
 *   A QUERY THAT PAGES IS STILL ONE ENTRY. SupabaseQuery.get() fetches
 *   1,000-row pages in a loop, so a large scan is one read whose time covers
 *   several HTTP calls. That is the right unit for "how many times did the
 *   caller ask" and it means `slowestMs` on an unbounded query is a scan, not
 *   a network hop.
 *
 *   WRITES ARE NOT COUNTED. They are rarer, they are not what the page waits
 *   on before it renders, and mixing them in would blur the comparison.
 *
 * ── AND IT CANNOT BREAK WHAT IT MEASURES ────────────────────────────────────
 *
 *   Every entry point swallows its own errors. A meter that can fail a read is
 *   worse than no meter — safe-action's own timer states the same rule:
 *   "Instrumentation that can break the thing it measures is worse than none."
 */

export type RoundTripKind = "db" | "cache" | "http";

export const ROUND_TRIP_KINDS: readonly RoundTripKind[] = ["db", "cache", "http"];

export interface KindTally {
    /** Completed calls of this kind. */
    calls: number;
    /** Milliseconds spent inside them. */
    ms: number;
    /** The slowest single one. */
    slowestMs: number;
}

export interface RoundTripTally {
    /** `.get()` calls — kept by name because it is the audit's unit. */
    reads: number;
    /** Milliseconds inside those `.get()` calls. */
    dbMs: number;
    /** The slowest single `.get()`. */
    slowestMs: number;
    byKind: Record<RoundTripKind, KindTally>;
}

/** The mutable accumulator. `RoundTripTally` is the read-only view of one. */
export interface RoundTripScope {
    byKind: Record<RoundTripKind, KindTally>;
}

const emptyKind = (): KindTally => ({ calls: 0, ms: 0, slowestMs: 0 });

export function newRoundTripScope(): RoundTripScope {
    return { byKind: { db: emptyKind(), cache: emptyKind(), http: emptyKind() } };
}

const ZERO: RoundTripTally = Object.freeze({
    reads: 0,
    dbMs: 0,
    slowestMs: 0,
    byKind: { db: emptyKind(), cache: emptyKind(), http: emptyKind() },
});

/*
 *   TWO ACCUMULATORS, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   The ACTION scope is what safe-action reports: correct under concurrency,
 *   because AsyncLocalStorage follows the async call tree rather than the
 *   request. The REQUEST tally is the honest total for one HTTP request, which
 *   is what a future page-level report would want. A read lands in both.
 */
const actionScope = new AsyncLocalStorage<RoundTripScope>();
const requestScope = cache(newRoundTripScope);

function view(scope: RoundTripScope): RoundTripTally {
    const byKind = {
        db: { ...scope.byKind.db },
        cache: { ...scope.byKind.cache },
        http: { ...scope.byKind.http },
    };
    return { reads: byKind.db.calls, dbMs: byKind.db.ms, slowestMs: byKind.db.slowestMs, byKind };
}

/** Record one completed call. Never throws. */
export function recordRoundTrip(elapsedMs: number, kind: RoundTripKind = "db"): void {
    try {
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
        //   Both, deliberately: see the two-accumulator note above.
        for (const scope of [actionScope.getStore(), safeRequestScope()]) {
            if (!scope) continue;
            const tally = scope.byKind[kind];
            if (!tally) continue;
            tally.calls += 1;
            tally.ms += elapsedMs;
            if (elapsedMs > tally.slowestMs) tally.slowestMs = elapsedMs;
        }
    } catch {
        //   See the header: this must never fail the call it is measuring.
    }
}

function safeRequestScope(): RoundTripScope | null {
    try {
        return requestScope();
    } catch {
        //   Outside a request — a cron, a script — cache() has nothing to hang
        //   this on. Degrade to silence rather than to a wrong number.
        return null;
    }
}

/**
 * Time `fn` and record it under `kind`.
 *
 *   The value and any thrown error pass through untouched. This is how a call
 *   site that is not the Supabase adapter gets counted: wrap it here rather
 *   than widening what "elsewhere" is taken to mean.
 */
export async function measure<T>(kind: RoundTripKind, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
        return await fn();
    } finally {
        recordRoundTrip(Date.now() - startedAt, kind);
    }
}

/**
 * Run `fn` with its own tally, so a concurrent sibling cannot touch it.
 *
 * The caller holds the scope and reads it afterwards — including after `fn`
 * throws, because a slow FAILURE is the line worth having.
 */
export function runInRoundTripScope<T>(scope: RoundTripScope, fn: () => T): T {
    try {
        return actionScope.run(scope, fn);
    } catch (error) {
        //   A scope that cannot be opened must not stop the action. The report
        //   then reads zero, which is visibly nothing rather than plausibly
        //   wrong.
        if (error instanceof TypeError || error instanceof ReferenceError) return fn();
        throw error;
    }
}

/** What landed in this scope. Never throws. */
export function scopeTally(scope: RoundTripScope): RoundTripTally {
    try {
        return view(scope);
    } catch {
        return { ...ZERO, byKind: { db: emptyKind(), cache: emptyKind(), http: emptyKind() } };
    }
}

/** The whole request's tally, across every action in it. Never throws. */
export function roundTripsSoFar(): RoundTripTally {
    const scope = safeRequestScope();
    if (!scope) return { ...ZERO, byKind: { db: emptyKind(), cache: emptyKind(), http: emptyKind() } };
    return scopeTally(scope);
}

/** Calls of every measured kind. */
export function measuredCalls(t: RoundTripTally): number {
    return ROUND_TRIP_KINDS.reduce((n, k) => n + t.byKind[k].calls, 0);
}

/** Milliseconds of every measured kind. */
export function measuredMs(t: RoundTripTally): number {
    return ROUND_TRIP_KINDS.reduce((n, k) => n + t.byKind[k].ms, 0);
}
