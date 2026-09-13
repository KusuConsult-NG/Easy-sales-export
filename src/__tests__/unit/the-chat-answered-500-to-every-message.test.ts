/**
 * @jest-environment node
 */

/**
 *   #707 A RATE LIMITER THAT COULD TURN ANY REDIS FAILURE INTO A 500 ON EVERY
 *        CHAT MESSAGE.
 *
 *   api/ai/route.ts called `chatbotRateLimiter.limit(userId)` at step 3 of the
 *   handler, unguarded, inside the outer try. Anything that call throws falls
 *   into the catch at the foot of the file and becomes
 *
 *       { error: "Internal Server Error" }, { status: 500 }
 *
 *   — for every message, from every user. The limiter is not an optional
 *   decoration in that arrangement; it is a single point of failure in front of
 *   the whole feature.
 *
 *   AND IT IS REACHABLE WITH UPSTASH WORKING NORMALLY. lib/redis.ts configures
 *   the client with `AbortSignal.timeout(2000)` and three retries, so an
 *   Upstash slow patch — not an outage, a slow patch — is an exception on this
 *   path and a 500 to the person typing.
 *
 * ── THE STUB CASE, AND WHAT IS AND IS NOT CLAIMED ABOUT IT ──────────────────
 *
 *   lib/redis.ts hands back a FOUR-METHOD STUB — get, setex, del, keys — when
 *   the Upstash variables are absent, cast `as unknown as Redis` so it
 *   type-checks as the full client. @upstash/ratelimit drives its sliding
 *   window through `evalsha`, which the stub does not have.
 *
 *   MEASURED, NOT INFERRED — building a Ratelimit over that stub and calling
 *   .limit() gives:
 *
 *       TypeError: ctx.redis.evalsha is not a function
 *
 *   THE SCOPE OF THAT CASE IS STATED CAREFULLY, because the first version of
 *   this file got it wrong. It was written from a Railway boot log reading
 *   "[Redis] UPSTASH_REDIS_REST_URL IS NOT SET", and asserted in its own
 *   heading that this was the deployment's live state. The owner then confirmed
 *   the variable IS set. So the stub path is NOT what production takes, the
 *   TypeError above is not what was breaking the chat, and a stale log had been
 *   carried forward as a current fact.
 *
 *   It is kept here because the guard covers it and because the failure is real
 *   for any deployment without Upstash — a preview environment, a local run, a
 *   new service. What it is not is a diagnosis of production.
 *
 * ── THE PLATFORM ALREADY KNEW, AND FIXED IT EVERYWHERE ELSE ─────────────────
 *
 *   redis.ts documents this exact TypeError, and exports `isRedisConfigured`
 *   precisely so callers can skip the stub. It also says why the stub is not
 *   simply given a no-op `evalsha`: "a no-op evalsha would make rate limiting
 *   silently allow everything, which is worse than throwing."
 *
 *   Three files in this codebase build a Ratelimit. lib/rate-limit.ts consults
 *   the flag, twice. lib/rate-limiter.ts consults it. api/ai/route.ts imported
 *   `redis` and not the flag — one door out of three, which is the shape this
 *   audit keeps finding.
 *
 * ── WHY NOTHING CAUGHT IT, WHICH IS ITS OWN FINDING ─────────────────────────
 *
 *   Jest cannot load @upstash/redis in this project at all. Importing it fails
 *   with "SyntaxError: Unexpected token 'export'" — the package is ESM and the
 *   transform does not take it. So no suite imports this route, the throw was
 *   invisible to all 13,000 tests, and it could only ever have been found by
 *   running the real thing or by reading.
 *
 *   THAT IS WHY THIS FILE ASSERTS ON SOURCE. A behavioural test of the route is
 *   not available here, and pretending otherwise by mocking @upstash/ratelimit
 *   would test the mock — the stub's missing method is the entire defect, so a
 *   mock that has the method cannot see it. What CAN be executed is the
 *   fallback limiter, and it is, below.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { checkFallbackLimit, resetFallbackLimit } from '@/lib/rate-limiter-fallback';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Source with comment lines removed — several of these files DISCUSS the bug. */
function code(rel: string): string {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

/**
 * The same source with IMPORT lines dropped too.
 *
 *   Because "does this file mention isRedisConfigured" is answered `true` by
 *   the import alone. A mutant that deleted the guard from the body — the
 *   outage, exactly — left the import in place and sailed past the check; it
 *   was killed by an unrelated assertion, which is luck, not a test. The flag
 *   has to be USED, not merely imported.
 */
function body(rel: string): string {
    return code(rel)
        .split('\n')
        .filter((l) => !/^\s*import\b/.test(l))
        .join('\n');
}

/** Every file that constructs an Upstash rate limiter. */
function limiterFiles(): string[] {
    return execSync(
        'grep -rl "new Ratelimit(" src --include=*.ts | grep -v __tests__',
        { cwd: ROOT, encoding: 'utf-8' },
    ).trim().split('\n').filter(Boolean).sort();
}

describe('#707 — the chat route no longer depends on a method the stub lacks', () => {
    it('THE SWEEP FINDS THE FILES THAT BUILD A RATE LIMITER', () => {
        //   THE control: the assertions below are "for each limiter file…",
        //   and an empty list satisfies them all.
        const files = limiterFiles();
        expect(files.length).toBeGreaterThanOrEqual(3);
        expect(files).toContain('src/app/api/ai/route.ts');
    });

    it('EVERY ONE OF THEM ASKS WHETHER REDIS IS ACTUALLY CONFIGURED', () => {
        /*
         *   THE assertion. Building a Ratelimit over lib/redis's stub is safe;
         *   CALLING it is not. The flag is the only thing that distinguishes
         *   "Upstash is configured" from "a four-method object that will throw
         *   TypeError on .limit()".
         *
         *   Reported as the list of offenders so a failure names the file.
         */
        const offenders = limiterFiles().filter((rel) => !/!\s*isRedisConfigured/.test(body(rel)));
        expect(offenders).toEqual([]);
    });

    it('AND THE CHAT ROUTE FALLS BACK RATHER THAN THROWING', () => {
        const src = code('src/app/api/ai/route.ts');

        //   It reaches the shared in-memory limiter — not a fourth private one.
        expect(src).toContain('checkFallbackLimit');
        expect(src).toContain("from \"@/lib/rate-limiter-fallback\"");

        //   And the raw .limit() call is wrapped, so a LIVE Redis failure is
        //   also survivable rather than a 500.
        const decision = src.slice(src.indexOf('async function chatRateDecision'));
        expect(decision).toContain('try {');
        expect(decision).toContain('catch');
    });

    it('AND THE HANDLER NO LONGER CALLS .limit() DIRECTLY', () => {
        /*
         *   The specific regression: a future edit that goes back to
         *   `await chatbotRateLimiter.limit(userId)` in the handler reinstates
         *   the outage, because the guard lives in the helper.
         */
        const src = code('src/app/api/ai/route.ts');
        const handler = src.slice(src.indexOf('export async function POST'));

        expect(handler).toContain('chatRateDecision(');
        expect(handler).not.toContain('chatbotRateLimiter.limit(');
    });

    it('AND THE LIMIT IS WRITTEN ONCE, NOT ONCE PER PATH', () => {
        //   The Redis window and the fallback window have to agree, or the
        //   limit silently changes with the deployment's configuration.
        const src = code('src/app/api/ai/route.ts');
        expect(src).toContain('const CHAT_MESSAGES_PER_HOUR = 15');
        expect(src).toMatch(/slidingWindow\(CHAT_MESSAGES_PER_HOUR/);
        //   Both fallback calls take the same pair of constants.
        expect(src.match(/checkFallbackLimit\(key, CHAT_MESSAGES_PER_HOUR, CHAT_WINDOW_MS\)/g))
            .toHaveLength(2);
    });
});

describe('#707 — and the fallback it now uses really does limit', () => {
    /**
     * The one part of this finding that can be EXECUTED here.
     *
     * Falling back is only the right answer if the fallback still refuses the
     * sixteenth message. A fallback that allowed everything would turn an
     * outage into an open door, which redis.ts explicitly argues is worse.
     */
    const KEY = 'chatbot:user:test-707';

    it('ALLOWS THE FIRST FIFTEEN AND REFUSES THE SIXTEENTH', () => {
        resetFallbackLimit(KEY);

        const verdicts = Array.from({ length: 16 }, () => checkFallbackLimit(KEY, 15, 60 * 60 * 1000).success);

        expect(verdicts.slice(0, 15)).toEqual(Array(15).fill(true));
        expect(verdicts[15]).toBe(false);
    });

    it('AND COUNTS EACH USER SEPARATELY — the control', () => {
        /*
         *   A limiter that refused everybody once anybody hit the cap would
         *   satisfy the test above and would be a worse outage than the 500.
         */
        resetFallbackLimit(KEY);
        resetFallbackLimit('chatbot:user:other');

        for (let i = 0; i < 15; i++) checkFallbackLimit(KEY, 15, 60 * 60 * 1000);

        expect(checkFallbackLimit(KEY, 15, 60 * 60 * 1000).success).toBe(false);
        expect(checkFallbackLimit('chatbot:user:other', 15, 60 * 60 * 1000).success).toBe(true);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (7/7):
 *
 *   M1  the handler calls .limit() unguarded again — THE OUTAGE        KILLED
 *   M2  the isRedisConfigured check deleted from the helper            KILLED
 *   M3  the two windows drift apart (Redis 15/h, fallback 50/h)        KILLED
 *   M4  the fallback allows everything — an open door, not an outage   KILLED
 *   CONTROL  a log message reworded                                  SURVIVED
 *
 *   M1 is the finding itself, reinstated. M4 is its mirror: falling back is
 *   only the right answer while the fallback still refuses the sixteenth
 *   message, and redis.ts argues at length that silently allowing everything
 *   is worse than throwing.
 *
 * ── WHAT THE FIRST SWEEP CAUGHT IN THIS SUITE ITSELF ────────────────────────
 *
 *   M2 was killed by the WRONG assertion. Deleting the guard also deleted one
 *   of the two checkFallbackLimit calls, so the count check fired — while the
 *   check actually named for it passed, because `isRedisConfigured` still
 *   appeared in the IMPORT line. A file-level string match cannot tell an
 *   import from a use. The sweep now reads the body with imports stripped and
 *   requires the negated form, and M2 is killed by the assertion that is about
 *   it. That is the same file-versus-use trap #704 recorded, one finding later.
 */
