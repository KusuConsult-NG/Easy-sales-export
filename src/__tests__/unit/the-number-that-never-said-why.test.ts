/**
 *   THE OWNER, after seven merged read-count fixes: "i noticed the app is
 *   still slow. did you fix get to production or you dont know how to fix it?"
 *
 *   The honest answer was that this audit counted READS and never once
 *   measured TIME. #261's read meter lives in lib/testing/fake-db: it runs
 *   under jest and nowhere else, so NOTHING IN PRODUCTION HAS EVER COUNTED A
 *   DATABASE ROUND TRIP. The `[slow-action]` line has said "took 1840ms" since
 *   #261 and could not say why.
 *
 *   Which left the one question that decides what to do next answerable only
 *   by inference:
 *
 *       IS IT SLOW BECAUSE IT ASKS TOO MANY TIMES,
 *       OR BECAUSE EACH ASK COSTS TOO MUCH?
 *
 *   Fitting the owner's own log lines against the read counts this audit
 *   measured suggests ~120ms fixed plus ~127ms per round trip — which would
 *   mean the second, and would make co-locating the app with the database
 *   worth more than all seven of those PRs together. That is three points
 *   fitted to a line from logs I did not generate. The line answers it now:
 *
 *       [slow-action] checkCooperativeStatusAction took 1840ms
 *         — 7 reads, 890ms in the database (slowest 180ms), 950ms elsewhere
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/*
 *   A REAL PER-REQUEST MEMOISER. React's cache() is a PASS-THROUGH under
 *   jest, so `requestTally()` would hand back a FRESH object on every call and
 *   the accumulator would accumulate nothing — every assertion below would
 *   read zero and pass for the wrong reason. Same trap as every read-count
 *   suite in this audit.
 */
jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

jest.mock('@/app/actions/telemetry', () => ({ logTelemetryAction: jest.fn() }));
jest.mock('@/lib/logger-server', () => ({ logObservabilityTrace: jest.fn() }));

const meter = () => import('@/lib/round-trip-meter');

describe('the meter itself', () => {
    beforeEach(() => { jest.resetModules(); });

    it('COUNTS, TOTALS AND REMEMBERS THE WORST', async () => {
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(40);
        recordRoundTrip(180);
        recordRoundTrip(20);

        expect(roundTripsSoFar()).toEqual({ reads: 3, dbMs: 240, slowestMs: 180 });
    });

    it('reports a DELTA, because the tally is the request and the log line is one action', async () => {
        const { recordRoundTrip, roundTripsSoFar, roundTripsSince } = await meter();

        recordRoundTrip(100);
        const before = roundTripsSoFar();
        recordRoundTrip(30);
        recordRoundTrip(50);

        const since = roundTripsSince(before);
        expect(since.reads).toBe(2);
        expect(since.dbMs).toBe(80);
    });

    it('IGNORES A MEASUREMENT THAT IS NOT ONE', async () => {
        //   A clock that went backwards, or a NaN out of a mocked timer, must
        //   not turn the total into nonsense that an operator then acts on.
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(NaN);
        recordRoundTrip(-5);
        recordRoundTrip(Infinity);
        recordRoundTrip(10);

        expect(roundTripsSoFar()).toEqual({ reads: 1, dbMs: 10, slowestMs: 10 });
    });
});

describe('the slow-action line says where the time went', () => {
    const subject = () => import('@/lib/safe-action');
    const loggerModule = () => import('@/lib/logger');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let warn: any;
    const originalThreshold = process.env.SLOW_ACTION_MS;

    beforeEach(async () => {
        jest.resetModules();
        const { logger } = await loggerModule();
        warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    });

    afterEach(() => {
        warn.mockRestore();
        if (originalThreshold === undefined) delete process.env.SLOW_ACTION_MS;
        else process.env.SLOW_ACTION_MS = originalThreshold;
    });

    it('NAMES THE READS AND THE MILLISECONDS THEY COST', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const action = withSafeAction('checkCooperativeStatusAction', async () => {
            await sleep(20);
            recordRoundTrip(30);
            recordRoundTrip(90);
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        const call = warn.mock.calls.find((c: any[]) => String(c[0]).includes('[slow-action]'));
        expect(call).toBeDefined();

        //   Readable in a pasted log, which is how this platform's slowness
        //   has been reported all along.
        expect(String(call[0])).toContain('2 reads');
        expect(String(call[0])).toContain('120ms in the database');
        expect(String(call[0])).toContain('slowest 90ms');

        //   And structured, for anything that parses rather than reads.
        expect(call[1]).toMatchObject({
            actionName: 'checkCooperativeStatusAction',
            reads: 2,
            dbMs: 120,
            slowestReadMs: 90,
        });
    });

    it('SPLITS DATABASE TIME FROM EVERYTHING ELSE, which is the whole point', async () => {
        /*
         *   `appMs` is the time NOT spent waiting on the database — rendering,
         *   session work, Redis, and any time this single-replica container
         *   spent queueing. If THAT is what dominates, more read-count work is
         *   the wrong answer, and this is the field that says so.
         */
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const action = withSafeAction('somethingSlowInTheApp', async () => {
            await sleep(40);
            recordRoundTrip(1);
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        const call = warn.mock.calls.find((c: any[]) => String(c[0]).includes('[slow-action]'));
        const { elapsedMs, dbMs, appMs } = call[1];

        expect(dbMs).toBe(1);
        expect(appMs).toBe(elapsedMs - dbMs);
        //   The action slept; almost none of it was the database.
        expect(appMs).toBeGreaterThan(dbMs);
    });

    it('and a FAST action still says nothing — the log stays a shortlist', async () => {
        process.env.SLOW_ACTION_MS = '10000';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const action = withSafeAction('quick', async () => {
            recordRoundTrip(5);
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        expect(warn.mock.calls.filter((c: any[]) => String(c[0]).includes('[slow-action]'))).toHaveLength(0);
    });
});

describe('both ways of reading the database are timed', () => {
    it('THE DOCUMENT READ AND THE QUERY, and nothing in between', () => {
        /*
         *   Read from the source: the adapter's two `.get()` methods are the
         *   unit every "reads" figure in this audit counts, and a timer on one
         *   of them would make the production number quietly incomparable with
         *   all of those measurements.
         *
         *   Source, because installFakeDb replaces this adapter wholesale —
         *   the production code path cannot be driven from a unit test, which
         *   is exactly why it went uninstrumented for so long.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const adapter = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf8');

        const timed = [...adapter.matchAll(/^\s*recordRoundTrip\(Date\.now\(\) - startedAt\);/gm)];
        const entryPoints = [...adapter.matchAll(/^\s*private async _getTimed\(\)/gm)];

        expect({ timed: timed.length }).toEqual({ timed: 2 });
        expect({ entryPoints: entryPoints.length }).toEqual({ entryPoints: 2 });
        //   In a `finally`, so a read that FAILS slowly is counted too — a
        //   timeout is the thing a user actually sits through.
        expect(adapter).toContain('} finally {\n            recordRoundTrip(');
    });
});
