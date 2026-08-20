/**
 * @jest-environment node
 */

/**
 * With Redis unavailable, five SUCCESSFUL logins locked the account out.
 *
 * THE BUG
 * -------
 * The login limiter counts an attempt before the password is checked —
 * src/lib/auth.ts runs "STEP 3: Rate limit check" ahead of "STEP 4: Supabase
 * Auth Verification". So a correct password consumes a token exactly like a
 * wrong one. The thing that makes the limit mean "five FAILURES" rather than
 * "five logins" is resetLoginAttempts() clearing the counter on success.
 *
 * That reset only ever cleared Redis keys:
 *
 *     export async function resetLoginAttempts(email: string): Promise<void> {
 *         try {
 *             await redis.del(...loginRateLimitKeys(email));
 *         } catch (error) { ... }
 *     }
 *
 * while consumeLoginAttempt, on any path where Redis does not answer, counts
 * into the in-memory Map in rate-limiter-fallback.ts — which had no reset
 * function at all. Nothing ever decremented it. The fifth login inside fifteen
 * minutes was refused with "Too many failed login attempts" when none of them
 * had failed.
 *
 * WHEN THAT PATH IS TAKEN, WHICH IS NOT ONLY "MISCONFIGURED"
 * ---------------------------------------------------------
 *   - Upstash env vars absent: src/lib/redis.ts hands out a four-method stub
 *     ({ get, setex, del, keys }) cast `as unknown as Redis`, and
 *     @upstash/ratelimit needs evalsha, so limit() throws on every call.
 *   - Upstash down: same throw.
 *   - Upstash merely SLOW: the client is built with AbortSignal.timeout(2000),
 *     so a response over two seconds throws too.
 *
 * The third is the reason this is a production concern and not a config note.
 *
 * HOW IT PRESENTS, AND WHY IT SURVIVED
 * ------------------------------------
 * It needs Redis to be unavailable, it counts per process instance so it hits
 * some users and not others, it is indistinguishable from broken
 * authentication, and it clears itself after fifteen minutes. That is close to
 * unreproducible on demand.
 *
 * Found when a production-build Playwright run locked its own seeded accounts
 * out after five sign-ins, and the login page showed "Too many failed login
 * attempts" with a correct password on screen.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const limit = jest.fn<any>();
const del = jest.fn<any>();

/**
 * Both ways of reaching the in-memory limiter are covered, because the fix has
 * to hold on both:
 *
 *   redisConfigured = false → Upstash env vars absent, consumeLoginAttempt
 *                             short-circuits before touching Redis
 *   redisConfigured = true  → Upstash configured but limit() throws, i.e. an
 *                             outage or the client's 2-second timeout
 *
 * A getter rather than a fixed value so a single mock serves both.
 */
let redisConfigured = false;

jest.mock('@upstash/ratelimit', () => {
    class Ratelimit {
        static slidingWindow = (...args: any[]) => args;
        limit = (...args: any[]) => limit(...args);
    }
    return { Ratelimit, default: Ratelimit };
});

jest.mock('@/lib/redis', () => ({
    redis: { del: (...args: any[]) => del(...args) },
    get isRedisConfigured() { return redisConfigured; },
    CACHE_TTL: {},
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_MAX = process.env.MAX_LOGIN_ATTEMPTS;

function setNodeEnv(value: string) {
    // NODE_ENV is readonly in the Node typings; the runtime does not care.
    (process.env as Record<string, string>).NODE_ENV = value;
}

/**
 * Load rate-limit.ts and the fallback store as ONE module generation.
 *
 * The store is module-level state. Importing them in separate generations would
 * give the limiter a different Map from the one the assertions inspect, and
 * every check here would pass for the wrong reason.
 */
async function freshModules() {
    jest.resetModules();
    const rateLimit = await import('@/lib/rate-limit');
    const fallback = await import('@/lib/rate-limiter-fallback');
    return { ...rateLimit, ...fallback };
}

beforeEach(() => {
    limit.mockReset();
    del.mockReset();
    // Redis is not answering. This is the whole premise.
    redisConfigured = false;
    limit.mockRejectedValue(new TypeError('a.redis.evalsha is not a function'));
    del.mockResolvedValue(false);
    setNodeEnv('production');
    delete process.env.MAX_LOGIN_ATTEMPTS;
});

afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV as string);
    if (ORIGINAL_MAX === undefined) delete process.env.MAX_LOGIN_ATTEMPTS;
    else process.env.MAX_LOGIN_ATTEMPTS = ORIGINAL_MAX;
});

describe('the in-memory login counter is reset by a successful login', () => {
    it('ten consecutive successful logins are all allowed', async () => {
        // THE test. Before the fix the sixth call was refused, because five
        // successes had each consumed a token that nothing gave back.
        const { consumeLoginAttempt, resetLoginAttempts } = await freshModules();

        const outcomes: boolean[] = [];
        for (let i = 0; i < 10; i++) {
            const result = await consumeLoginAttempt('member@example.com');
            outcomes.push(result.allowed);
            // What lib/auth.ts does on a correct password.
            if (result.allowed) await resetLoginAttempts('member@example.com');
        }

        expect(outcomes).toEqual(Array(10).fill(true));
    });

    it('the counter is actually back to zero, not merely under the ceiling', async () => {
        const { consumeLoginAttempt, resetLoginAttempts, peekFallbackCount, loginLimitIdentifier } =
            await freshModules();
        const key = loginLimitIdentifier('member@example.com');

        await consumeLoginAttempt('member@example.com');
        expect(peekFallbackCount(key)).toBe(1);

        await resetLoginAttempts('member@example.com');

        expect(peekFallbackCount(key)).toBe(0);
    });

    it('a reset clears the same key the limiter counted against', async () => {
        // The bug this guards is a reset that clears a DIFFERENT string than the
        // one consumeLoginAttempt incremented — which is what two hand-written
        // copies of `login_${email}` invite. Case included, since the identifier
        // lower-cases.
        const { consumeLoginAttempt, resetLoginAttempts, peekFallbackCount, loginLimitIdentifier } =
            await freshModules();

        await consumeLoginAttempt('Member@Example.COM');
        expect(peekFallbackCount(loginLimitIdentifier('member@example.com'))).toBe(1);

        await resetLoginAttempts('MEMBER@example.com');

        expect(peekFallbackCount(loginLimitIdentifier('Member@Example.com'))).toBe(0);
    });

    it('still refuses the sixth attempt when logins keep FAILING', async () => {
        // The vacuity guard, and the point of the limiter. Every assertion above
        // would also pass if the fix had simply removed the limit. No reset here,
        // because a failed password never reaches resetLoginAttempts.
        const { consumeLoginAttempt } = await freshModules();

        const outcomes: boolean[] = [];
        for (let i = 0; i < 6; i++) {
            outcomes.push((await consumeLoginAttempt('attacker@example.com')).allowed);
        }

        expect(outcomes).toEqual([true, true, true, true, true, false]);
        const last = await consumeLoginAttempt('attacker@example.com');
        expect(last.allowed).toBe(false);
        expect(last.error).toMatch(/Too many failed login attempts/);
    });

    it('four failures then a success gives the next attempt a full budget', async () => {
        // The scenario resetLoginAttempts exists for, on the fallback path.
        const { consumeLoginAttempt, resetLoginAttempts, peekFallbackCount, loginLimitIdentifier } =
            await freshModules();
        const email = 'typo@example.com';

        for (let i = 0; i < 4; i++) await consumeLoginAttempt(email);
        expect(peekFallbackCount(loginLimitIdentifier(email))).toBe(4);

        // Fifth attempt is allowed and this time the password is right.
        expect((await consumeLoginAttempt(email)).allowed).toBe(true);
        await resetLoginAttempts(email);

        // Previously: locked out for the rest of the window.
        for (let i = 0; i < 5; i++) {
            expect((await consumeLoginAttempt(email)).allowed).toBe(true);
        }
    });

    it('one account being locked out does not lock out another', async () => {
        const { consumeLoginAttempt } = await freshModules();

        for (let i = 0; i < 6; i++) await consumeLoginAttempt('locked@example.com');
        expect((await consumeLoginAttempt('locked@example.com')).allowed).toBe(false);

        expect((await consumeLoginAttempt('bystander@example.com')).allowed).toBe(true);
    });

    it('resets the memory counter even when the Redis delete throws', async () => {
        // Why resetFallbackLimit is called before the try/catch: a throwing
        // redis.del must not skip it. This is the ordering, asserted.
        const { consumeLoginAttempt, resetLoginAttempts, peekFallbackCount, loginLimitIdentifier } =
            await freshModules();
        del.mockRejectedValue(new Error('Upstash unreachable'));

        await consumeLoginAttempt('member@example.com');
        await resetLoginAttempts('member@example.com');

        expect(peekFallbackCount(loginLimitIdentifier('member@example.com'))).toBe(0);
    });

    it('honours MAX_LOGIN_ATTEMPTS on the fallback path too', async () => {
        // Guards against the fallback quietly using a hardcoded 5 while the
        // Redis path uses the configured value.
        process.env.MAX_LOGIN_ATTEMPTS = '2';
        const { consumeLoginAttempt } = await freshModules();

        expect((await consumeLoginAttempt('tight@example.com')).allowed).toBe(true);
        expect((await consumeLoginAttempt('tight@example.com')).allowed).toBe(true);
        expect((await consumeLoginAttempt('tight@example.com')).allowed).toBe(false);
    });
});

describe('the same holds when Upstash is configured but failing', () => {
    // The case that makes this a production concern rather than a local-config
    // note: an outage, or a response slower than the client's
    // AbortSignal.timeout(2000), throws and lands on the same in-memory path.
    beforeEach(() => { redisConfigured = true; });

    it('ten successful logins are allowed while Redis keeps throwing', async () => {
        const { consumeLoginAttempt, resetLoginAttempts } = await freshModules();

        const outcomes: boolean[] = [];
        for (let i = 0; i < 10; i++) {
            const result = await consumeLoginAttempt('member@example.com');
            outcomes.push(result.allowed);
            if (result.allowed) await resetLoginAttempts('member@example.com');
        }

        expect(limit).toHaveBeenCalled();   // it really did try Redis first
        expect(outcomes).toEqual(Array(10).fill(true));
    });

    it('and six failures in a row are still refused', async () => {
        const { consumeLoginAttempt } = await freshModules();

        const outcomes: boolean[] = [];
        for (let i = 0; i < 6; i++) {
            outcomes.push((await consumeLoginAttempt('attacker@example.com')).allowed);
        }

        expect(outcomes[5]).toBe(false);
    });
});

describe('an unconfigured Upstash is not consulted at all', () => {
    it('skips the Redis limiter instead of throwing once per request', async () => {
        // Before this, every login built a sliding window against the
        // four-method stub in lib/redis.ts, threw "evalsha is not a function",
        // logged it, and fell through. Same answer, one exception and one log
        // line per login.
        const { consumeLoginAttempt } = await freshModules();

        await consumeLoginAttempt('member@example.com');

        expect(limit).not.toHaveBeenCalled();
    });
});

describe('the reset covers both stores', () => {
    it('still deletes the Redis buckets', async () => {
        // The original behaviour must survive the fix — when Upstash IS working,
        // clearing the Map alone would leave the real counter standing.
        const { resetLoginAttempts, loginRateLimitKeys } = await freshModules();

        await resetLoginAttempts('member@example.com');

        expect(del).toHaveBeenCalledTimes(1);
        expect(del.mock.calls[0]).toEqual(loginRateLimitKeys('member@example.com'));
    });
});
