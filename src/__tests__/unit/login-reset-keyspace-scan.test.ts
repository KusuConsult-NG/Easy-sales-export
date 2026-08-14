/**
 * @jest-environment node
 */

/**
 * Every successful login ran a full Redis keyspace scan.
 *
 * THE BUG
 * -------
 *     const pattern = `@upstash/login_limit:login_${email.toLowerCase()}*`;
 *     const matchingKeys = await redis.keys(pattern);
 *
 * The observation behind it is correct, and the fix keeps it: the sliding
 * window appends a bucket suffix to the key, so deleting the bare key matches
 * nothing. The remedy was the problem. `KEYS` walks the ENTIRE keyspace and
 * then filters — the pattern narrows the result, not the work.
 *
 * What is in that keyspace: a rate-limit bucket per active identifier, plus a
 * cached user profile per signed-in user (CacheKeys.userProfile, 5-minute TTL),
 * plus cached stats. At 41,105 accounts, a successful login walked all of it,
 * on the login path, every time.
 *
 * AND IT FAILED IN A WAY THAT HID ITSELF
 * --------------------------------------
 * The Upstash client is constructed with `AbortSignal.timeout(2000)`. Once the
 * scan exceeds two seconds it throws; lib/auth.ts catches, logs
 * "[Auth:Fallback] Redis resetLoginAttempts failed", and lets the login
 * through. So the reset stops happening exactly when the keyspace is largest —
 * and a user who failed four times before succeeding keeps those four against
 * them for the rest of the fifteen-minute window, with nothing on screen and a
 * line in the log that reads like a transient blip.
 *
 * THE KEYS ARE COMPUTABLE
 * -----------------------
 * @upstash/ratelimit builds a key as [prefix, identifier].join(":"), and the
 * sliding window appends `:${Math.floor(now / windowMs)}`. It reads the current
 * bucket and the one before it, and nothing else. Two deletes, both exact, no
 * scan.
 *
 * The window is now one constant feeding the limiter, the in-memory fallback
 * and this key arithmetic. It was previously written three times, and a change
 * to one that missed the others would leave the reset deleting keys nothing
 * uses.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const del = jest.fn<any>();
const keys = jest.fn<any>();

jest.mock('@/lib/redis', () => ({
    redis: {
        del: (...a: any[]) => del(...a),
        keys: (...a: any[]) => keys(...a),
    },
    CACHE_TTL: {},
}));

jest.mock('@upstash/ratelimit', () => {
    class Ratelimit {
        static slidingWindow = (...args: any[]) => args;
        limit = async () => ({ success: true, remaining: 4, reset: 0 });
    }
    return { Ratelimit, default: Ratelimit };
});

/**
 * A real production key, recorded in the comment the old implementation carried:
 *
 *     e.g. `@upstash/login_limit:login_email@gmail.com:1969580`
 *
 * 1969580 × 900000 ms puts it in March 2026, which is the arithmetic this fix
 * depends on. Reproducing it is the check that the computed keys are the keys
 * Upstash actually holds — the assumption the whole change rests on, tested
 * against an observation rather than against a re-reading of the library.
 */
const OBSERVED_KEY = '@upstash/login_limit:login_email@gmail.com:1969580';
const OBSERVED_WINDOW = 1969580;

beforeEach(() => {
    jest.resetModules();
    del.mockReset();
    keys.mockReset();
    del.mockResolvedValue(1);
    keys.mockResolvedValue([]);
});

describe('the reset computes its keys instead of scanning for them', () => {
    it('never calls KEYS', async () => {
        // THE test. This ran on every successful login.
        const { resetLoginAttempts } = await import('@/lib/rate-limit');

        await resetLoginAttempts('ada@example.com');

        expect(keys).not.toHaveBeenCalled();
    });

    it('deletes exactly the two buckets a sliding window reads', async () => {
        const { resetLoginAttempts, loginRateLimitKeys } = await import('@/lib/rate-limit');

        await resetLoginAttempts('ada@example.com');

        const expected = loginRateLimitKeys('ada@example.com');
        expect(expected).toHaveLength(2);
        expect(del).toHaveBeenCalledWith(...expected);
    });

    it('the two keys are the current window and the one before it', async () => {
        const { loginRateLimitKeys, LOGIN_WINDOW_MS } = await import('@/lib/rate-limit');

        const now = 1_772_622_000_000 + 12_345;
        const [current, previous] = loginRateLimitKeys('ada@example.com', now);
        const index = Math.floor(now / LOGIN_WINDOW_MS);

        expect(current.endsWith(`:${index}`)).toBe(true);
        expect(previous.endsWith(`:${index - 1}`)).toBe(true);
    });

    it('a delete failure never propagates to the login', async () => {
        // Non-blocking by design: a reset failure must not stop a valid sign-in.
        del.mockRejectedValue(new Error('redis unreachable'));
        const { resetLoginAttempts } = await import('@/lib/rate-limit');

        await expect(resetLoginAttempts('ada@example.com')).resolves.toBeUndefined();
    });
});

describe('the computed key matches a key Upstash really held', () => {
    it('reproduces the production key recorded in the old comment', async () => {
        // Prefix, identifier and window arithmetic, all three at once.
        const { loginRateLimitKeys } = await import('@/lib/rate-limit');

        const insideThatWindow = OBSERVED_WINDOW * 15 * 60 * 1000 + 1;

        expect(loginRateLimitKeys('email@gmail.com', insideThatWindow)[0]).toBe(OBSERVED_KEY);
    });

    it('and the old wildcard would have matched the new keys', async () => {
        // The bridge between the two implementations: whatever KEYS used to
        // find, these deletes now name directly.
        const { loginRateLimitKeys } = await import('@/lib/rate-limit');

        for (const key of loginRateLimitKeys('email@gmail.com')) {
            expect(key.startsWith('@upstash/login_limit:login_email@gmail.com')).toBe(true);
        }
    });

    it('an address is lower-cased, so case is not a fresh budget', async () => {
        const { loginRateLimitKeys } = await import('@/lib/rate-limit');

        expect(loginRateLimitKeys('Ada@Example.COM', 0)).toEqual(
            loginRateLimitKeys('ada@example.com', 0)
        );
    });
});

describe('one definition of the window', () => {
    it('the library parses the format the limiter is given', async () => {
        // `${n} ms` has to be a window string @upstash/ratelimit accepts, or the
        // limiter throws at module load. Checked against the real package.
        const actual: any = jest.requireActual('@upstash/ratelimit');
        const { LOGIN_WINDOW_MS } = await import('@/lib/rate-limit');

        expect(() => actual.Ratelimit.slidingWindow(5, `${LOGIN_WINDOW_MS} ms`)).not.toThrow();
    });

    it('and it is still fifteen minutes', async () => {
        // Vacuity guard: the refactor must not have quietly changed the policy.
        const { LOGIN_WINDOW_MS } = await import('@/lib/rate-limit');

        expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
    });

    it('the source no longer writes the window three times', async () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const code: string = readFileSync(join(process.cwd(), 'src/lib/rate-limit.ts'), 'utf-8')
            .split('\n')
            .filter((l: string) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('"15 m"');
        expect(code).not.toContain('15 * 60 * 1000)');
        expect(code).not.toContain('redis.keys(');
    });
});
