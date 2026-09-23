/**
 * @jest-environment node
 */

/**
 *   THE OWNER, after seven merged read-count fixes: "i noticed the app is
 *   still slow. did you fix get to production or you dont know how to fix it?"
 *
 *   The honest answer was that this audit counted READS and never once
 *   measured TIME. #261's read meter lives in lib/testing/fake-db: it runs
 *   under jest and nowhere else, so nothing in production had ever counted a
 *   database round trip, and the `[slow-action]` line could say "took 1840ms"
 *   and not say why.
 *
 *   The first meter answered that and got two things wrong. THE OWNER'S FIRST
 *   LOG SHOWED BOTH, which is the best outcome available to a measurement —
 *   and the reason this file now leads with the two tests that would have
 *   caught them.
 *
 * ── ONE: ACTIONS STOLE EACH OTHER'S NUMBERS ─────────────────────────────────
 *
 *       checkAcademyStatusAction took 3235ms — 8 reads, 3806ms in the database
 *
 *   3,806ms of database inside 3,235ms of wall clock, which cannot happen. The
 *   tally was REQUEST-scoped and the line is PER ACTION, so safe-action took a
 *   delta around each call and two concurrent actions each measured the
 *   other's reads. The pair gave themselves identical figures one millisecond
 *   apart:
 *
 *       17:37:27.040 checkAcademyPaymentStatusAction 1184ms — 6 reads, 1318ms
 *       17:37:27.041 checkAcademyStatusAction        1185ms — 6 reads, 1318ms
 *
 *   The old header called that an edge case. It was a third of the lines.
 *
 * ── TWO: IT MEASURED ONE NETWORK OUT OF THREE ───────────────────────────────
 *
 *       checkCooperativeStatusAction took 1848ms — 0 reads, 0ms in the
 *       database, 1848ms elsewhere
 *
 *   Not a mystery: requireSession() runs at the top of every action and, on a
 *   cache hit, touches no database at all — it asks Upstash over HTTPS. The
 *   word "elsewhere" sounded like this container doing work and was another
 *   network. Redis, Paystack and ImageKit are measured now, and what is left
 *   is called `unmeasured`.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/*
 *   A REAL PER-REQUEST MEMOISER. React's cache() is a PASS-THROUGH under
 *   jest, so the request tally would be a FRESH object on every call and the
 *   accumulator would accumulate nothing — every assertion below would read
 *   zero and pass for the wrong reason. Same trap as every read-count suite in
 *   this audit.
 *
 *   The ACTION tally does not need this: AsyncLocalStorage is real under jest,
 *   which is precisely why it is the right tool for the job cache() was doing
 *   badly.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the meter itself', () => {
    beforeEach(() => { jest.resetModules(); });

    it('COUNTS, TOTALS AND REMEMBERS THE WORST', async () => {
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(40);
        recordRoundTrip(180);
        recordRoundTrip(20);

        const t = roundTripsSoFar();
        expect({ reads: t.reads, dbMs: t.dbMs, slowestMs: t.slowestMs })
            .toEqual({ reads: 3, dbMs: 240, slowestMs: 180 });
    });

    it('KEEPS THE THREE NETWORKS APART', async () => {
        //   A Redis round trip is not a database read and must never be added
        //   to the figure this audit has been comparing across seven PRs.
        const { recordRoundTrip, roundTripsSoFar, measuredMs, measuredCalls } = await meter();

        recordRoundTrip(100, 'db');
        recordRoundTrip(20, 'cache');
        recordRoundTrip(30, 'cache');
        recordRoundTrip(500, 'http');

        const t = roundTripsSoFar();
        expect(t.byKind.db).toEqual({ calls: 1, ms: 100, slowestMs: 100 });
        expect(t.byKind.cache).toEqual({ calls: 2, ms: 50, slowestMs: 30 });
        expect(t.byKind.http).toEqual({ calls: 1, ms: 500, slowestMs: 500 });
        //   `reads` stays the DATABASE count, or every earlier measurement in
        //   this audit stops being comparable with the production number.
        expect(t.reads).toBe(1);
        expect(measuredCalls(t)).toBe(4);
        expect(measuredMs(t)).toBe(650);
    });

    it('defaults an untagged call to the database, so the adapter needs no change', async () => {
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(7);

        expect(roundTripsSoFar().byKind.db.calls).toBe(1);
    });

    it('IGNORES A MEASUREMENT THAT IS NOT ONE', async () => {
        //   A clock that went backwards, or a NaN out of a mocked timer, must
        //   not turn the total into nonsense that an operator then acts on.
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(NaN);
        recordRoundTrip(-5);
        recordRoundTrip(Infinity);
        recordRoundTrip(10);

        const t = roundTripsSoFar();
        expect({ reads: t.reads, dbMs: t.dbMs }).toEqual({ reads: 1, dbMs: 10 });
    });

    it('measure() returns the value and counts a call that THREW', async () => {
        //   A nine-second failure is the interesting one. A meter that only
        //   counts successes hides exactly the calls worth finding.
        const { measure, roundTripsSoFar } = await meter();

        await expect(measure('http', async () => 'ok')).resolves.toBe('ok');
        await expect(measure('http', async () => { throw new Error('upstream down'); }))
            .rejects.toThrow('upstream down');

        expect(roundTripsSoFar().byKind.http.calls).toBe(2);
    });
});

describe('the slow-action line says where the time went', () => {
    const subject = () => import('@/lib/safe-action');
    const loggerModule = () => import('@/lib/logger');

    let warn: any;
    const originalThreshold = process.env.SLOW_ACTION_MS;

    const lineFor = (name: string) =>
        warn.mock.calls.find((c: any[]) =>
            String(c[0]).includes('[slow-action]') && String(c[0]).includes(name));

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

        const call = lineFor('checkCooperativeStatusAction');
        expect(call).toBeDefined();

        //   Readable in a pasted log, which is how this platform's slowness
        //   has been reported all along.
        expect(String(call[0])).toContain('2 reads 120ms');
        expect(String(call[0])).toContain('slowest 90ms');

        //   And structured, for anything that parses rather than reads.
        expect(call[1]).toMatchObject({
            actionName: 'checkCooperativeStatusAction',
            reads: 2,
            dbMs: 120,
            slowestReadMs: 90,
        });
    });

    it('TWO ACTIONS AT ONCE DO NOT TAKE EACH OTHER\'S READS', async () => {
        /*
         *   THE TEST THE FIRST VERSION DID NOT HAVE, and the defect production
         *   found within an hour.
         *
         *   With one request-scoped tally and a delta around each call, the
         *   busy action's eight reads land inside the slow action's window and
         *   BOTH report ten. That is how the owner's log came to contain
         *   3,806ms of database inside 3,235ms of wall clock, and two
         *   different actions reporting identical figures a millisecond apart.
         *
         *   AsyncLocalStorage follows the async call tree, so each action sees
         *   only its own.
         */
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const patient = withSafeAction('checkAcademyStatusAction', async () => {
            recordRoundTrip(10);
            await sleep(40);
            recordRoundTrip(10);
            return { success: true as const, error: null, data: 'ok' };
        });

        const busy = withSafeAction('getWalletAction', async () => {
            for (let i = 0; i < 8; i++) {
                recordRoundTrip(50);
                await sleep(2);
            }
            return { success: true as const, error: null, data: 'ok' };
        });

        await Promise.all([patient(), busy()]);

        expect(lineFor('checkAcademyStatusAction')[1]).toMatchObject({ reads: 2, dbMs: 20 });
        expect(lineFor('getWalletAction')[1]).toMatchObject({ reads: 8, dbMs: 400 });
    });

    it('SO THE IMPOSSIBLE LINE CANNOT BE PRINTED — dbMs never exceeds the wall clock', async () => {
        //   The shape of the bug, asserted directly rather than by proxy: no
        //   action can claim more database time than it existed for.
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const noisy = withSafeAction('noisyNeighbour', async () => {
            for (let i = 0; i < 20; i++) {
                recordRoundTrip(500);
                await sleep(1);
            }
            return { success: true as const, error: null, data: 'ok' };
        });
        const quiet = withSafeAction('quietOne', async () => {
            await sleep(30);
            return { success: true as const, error: null, data: 'ok' };
        });

        await Promise.all([noisy(), quiet()]);

        const { elapsedMs, dbMs, unmeasuredMs } = lineFor('quietOne')[1];
        expect(dbMs).toBe(0);
        expect(dbMs).toBeLessThanOrEqual(elapsedMs);
        expect(unmeasuredMs).toBe(elapsedMs);
    });

    it('SPLITS THE NETWORKS, AND CALLS THE REST `unmeasured` RATHER THAN `elsewhere`', async () => {
        /*
         *   `checkCooperativeStatusAction took 1848ms — 0 reads, 0ms in the
         *   database, 1848ms elsewhere` was an Upstash round trip inside
         *   requireSession, reported in a word that sounds like local work.
         *   The kinds are separate and the remainder claims nothing.
         */
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        //   The sleep is longer than the synthetic 52ms recorded below, so
        //   the remainder is a real subtraction rather than the floor at zero.
        const action = withSafeAction('checkCooperativeStatusAction', async () => {
            await sleep(80);
            recordRoundTrip(12, 'cache');
            recordRoundTrip(40, 'http');
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        const call = lineFor('checkCooperativeStatusAction');
        expect(String(call[0])).toContain('0 reads 0ms');
        expect(String(call[0])).toContain('1 cache 12ms');
        expect(String(call[0])).toContain('1 http 40ms');
        expect(String(call[0])).toContain('unmeasured');
        //   The banned word, because its replacement is the whole point.
        expect(String(call[0])).not.toContain('elsewhere');

        const { elapsedMs, cacheMs, httpMs, unmeasuredMs } = call[1];
        expect({ cacheMs, httpMs }).toEqual({ cacheMs: 12, httpMs: 40 });
        expect(unmeasuredMs).toBe(elapsedMs - 52);
    });

    it('leaves a kind out of the line entirely when it did not happen', async () => {
        //   A line per call buries the answer in the evidence; so does a line
        //   full of zeroes.
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const action = withSafeAction('onlyTheDatabase', async () => {
            await sleep(20);
            recordRoundTrip(15);
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        const line = String(lineFor('onlyTheDatabase')[0]);
        expect(line).toContain('1 reads 15ms');
        expect(line).not.toContain('cache');
        expect(line).not.toContain('http');
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

    it('still reports a SLOW FAILURE, with the reads it managed first', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const { recordRoundTrip } = await meter();
        const { withSafeAction } = await subject();

        const action = withSafeAction('checkoutAction', async () => {
            recordRoundTrip(25);
            await sleep(20);
            throw new Error('upstream timed out');
        });

        const result = await action();

        expect(lineFor('checkoutAction')[1]).toMatchObject({ reads: 1, dbMs: 25 });
        expect(result.success).toBe(false);
    });
});

describe('the request total is still the request', () => {
    it('AGGREGATES ACROSS EVERY ACTION IN IT, which the per-action scope does not', async () => {
        /*
         *   Two accumulators answering different questions. The action scope is
         *   what the log line reports; the request tally is the honest total
         *   for one HTTP request, which is what a page-level report would want.
         *   A read lands in both.
         */
        jest.resetModules();
        const { recordRoundTrip, roundTripsSoFar, newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();

        const a = newRoundTripScope();
        const b = newRoundTripScope();
        runInRoundTripScope(a, () => { recordRoundTrip(10); recordRoundTrip(20); });
        runInRoundTripScope(b, () => { recordRoundTrip(5); });

        expect(scopeTally(a).reads).toBe(2);
        expect(scopeTally(b).reads).toBe(1);
        expect(roundTripsSoFar().reads).toBe(3);
        expect(roundTripsSoFar().dbMs).toBe(35);
    });

    it('and a read outside any action scope still reaches the request total', async () => {
        jest.resetModules();
        const { recordRoundTrip, roundTripsSoFar } = await meter();

        recordRoundTrip(9);

        expect(roundTripsSoFar().reads).toBe(1);
    });
});

describe('every network a page waits on is actually wired up', () => {
    /*
     *   SOURCE RATCHETS, because installFakeDb replaces the adapter wholesale
     *   and the production paths cannot be driven from a unit test — which is
     *   exactly why they went uninstrumented in the first place. A behavioural
     *   test here would prove something about a mock.
     */
    const read = (rel: string) => {
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        return readFileSync(join(process.cwd(), rel), 'utf8');
    };

    it('THE DOCUMENT READ AND THE QUERY, and nothing in between', () => {
        const adapter = read('src/lib/supabase-db.ts');

        const timed = [...adapter.matchAll(/^\s*recordRoundTrip\(Date\.now\(\) - startedAt\);/gm)];
        const entryPoints = [...adapter.matchAll(/^\s*private async _getTimed\(\)/gm)];

        expect({ timed: timed.length }).toEqual({ timed: 2 });
        expect({ entryPoints: entryPoints.length }).toEqual({ entryPoints: 2 });
        //   In a `finally`, so a read that FAILS slowly is counted too.
        expect(adapter).toContain('} finally {\n            recordRoundTrip(');
    });

    it('REDIS, the network every single action pays for', () => {
        //   requireSession() calls getCached at the top of every action. This
        //   is the call that produced "0 reads, 1848ms elsewhere".
        const redis = read('src/lib/redis.ts');

        expect(redis).toContain('measure("cache", () => redis.get<T>(key))');
        expect(redis).toContain('measure("cache", () => redis.setex(');
        //   The in-memory fallback is NOT measured: it is not a round trip,
        //   and counting it would dilute the figure this exists to expose.
        expect(redis).toContain('if (!isRedisConfigured) return getFallbackCache<T>(key);');
    });

    it('PAYSTACK initialise and verify, which a user sits through at checkout', () => {
        const paystack = read('src/lib/paystack-server.ts');

        const wrapped = [...paystack.matchAll(/measure\("http", (?:async )?\(\) => fetch\(/g)];
        expect({ wrapped: wrapped.length }).toEqual({ wrapped: 2 });
    });

    it('AND THE IMAGEKIT UPLOAD — the slowest line in the log, none of it the database', () => {
        //   `submitMultiStepWaveApplicationAction took 8145ms — 0 reads`.
        const imagekit = read('src/lib/imagekit.ts');

        expect(imagekit).toContain('measure("http", () => fetch("https://upload.imagekit.io');
    });
});
