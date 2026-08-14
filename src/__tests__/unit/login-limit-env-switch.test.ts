/**
 * @jest-environment node
 */

/**
 * An environment variable switched off the login brute-force guard.
 *
 * THE BUG
 * -------
 * consumeLoginAttempt opened with:
 *
 *     const isEmulator = !!(
 *         process.env.FIREBASE_AUTH_EMULATOR_HOST ||
 *         process.env.FIRESTORE_EMULATOR_HOST ||
 *         process.env.NODE_ENV === 'test'
 *     );
 *     if (isEmulator && !email.toLowerCase().includes('ratelimit-test')) {
 *         return { allowed: true, remainingAttempts: 999 };
 *     }
 *
 * The *presence* of either emulator variable removed the limit on password
 * attempts. Not "no Redis, fall back to something conservative" — the function
 * returns `allowed: true` without consulting anything, for every address that
 * does not contain the string "ratelimit-test".
 *
 * Both call sites — lib/auth.ts's authorize() and actions/auth.ts's
 * preValidateCredentials — treat `allowed: true` as permission to attempt the
 * password, so the guard is the only thing bounding password guessing.
 *
 * AND THE SAME SWITCH ON THE CLIENT UNDERNEATH
 * --------------------------------------------
 * lib/redis.ts carried the identical condition, and it decides whether `redis`
 * is the real Upstash client or a stub. The stub backs every rate limiter on
 * the platform, so one variable stood down throttling everywhere at once.
 *
 * Those clauses bought nothing: local emulator work has no
 * UPSTASH_REDIS_REST_URL either, and the surrounding condition already falls
 * back to the stub when the Upstash variables are absent. The only case they
 * changed was "Upstash is configured AND an emulator host is set", where using
 * the configured Redis is what the operator asked for.
 *
 * WHY REMOVED RATHER THAN NARROWED
 * --------------------------------
 * Nothing sets these in production and the app would not work if they were set:
 * they point Firebase at a local emulator. That is the same argument #154 made
 * about ADMIN_OVERRIDE and #192 about PLAYWRIGHT_TEST — harmless until somebody
 * copies a .env into a deploy config — and this one guards the login form.
 *
 * NODE_ENV is the discriminator now, which is what this codebase already trusts
 * for the question: security-checks.ts enforces strong secrets on
 * `NODE_ENV === 'production'`. Next sets it at build and start, so it cannot be
 * flipped by adding a variable.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const limit = jest.fn<any>();

jest.mock('@upstash/ratelimit', () => {
    class Ratelimit {
        static slidingWindow = (...args: any[]) => args;
        limit = (...args: any[]) => limit(...args);
    }
    return { Ratelimit, default: Ratelimit };
});

jest.mock('@/lib/redis', () => ({
    redis: {},
    CACHE_TTL: {},
}));

const ORIGINAL = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    STORE: process.env.FIRESTORE_EMULATOR_HOST,
};

function setNodeEnv(value: string) {
    // NODE_ENV is readonly in the Node typings; the runtime does not care.
    (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
    jest.resetModules();
    limit.mockReset();
    limit.mockResolvedValue({ success: true, remaining: 4, reset: Date.now() + 60_000 });
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
});

afterEach(() => {
    setNodeEnv(ORIGINAL.NODE_ENV as string);
    if (ORIGINAL.AUTH === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = ORIGINAL.AUTH;
    if (ORIGINAL.STORE === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = ORIGINAL.STORE;
});

describe('a production login is counted, whatever else is in the environment', () => {
    beforeEach(() => setNodeEnv('production'));

    it('an emulator variable no longer waves the attempt through', async () => {
        // THE test. This exact variable used to return allowed: true, 999.
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        const result = await consumeLoginAttempt('victim@example.com');

        expect(limit).toHaveBeenCalledWith('login_victim@example.com');
        expect(result.remainingAttempts).toBe(4);
    });

    it('nor does the firestore one', async () => {
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        await consumeLoginAttempt('victim@example.com');

        expect(limit).toHaveBeenCalledTimes(1);
    });

    it('nor both together', async () => {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        await consumeLoginAttempt('victim@example.com');

        expect(limit).toHaveBeenCalledTimes(1);
    });

    it('and a refusal is still a refusal', async () => {
        // Vacuity guard: every assertion above passes if the limiter is
        // consulted and its answer ignored.
        limit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 600_000 });
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        const result = await consumeLoginAttempt('victim@example.com');

        expect(result.allowed).toBe(false);
        expect(result.error).toMatch(/Too many failed login attempts/);
    });

    it('the email is lower-cased into the key, so case is not a fresh budget', async () => {
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        await consumeLoginAttempt('Victim@Example.COM');

        expect(limit).toHaveBeenCalledWith('login_victim@example.com');
    });
});

describe('development still gets out of the way', () => {
    it('a developer is not locked out by their own password typos', async () => {
        // The bypass is kept where it costs nothing — it just cannot be reached
        // by setting a variable on a production build.
        setNodeEnv('development');
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        const result = await consumeLoginAttempt('dev@example.com');

        expect(result).toEqual({ allowed: true, remainingAttempts: 999 });
        expect(limit).not.toHaveBeenCalled();
    });

    it('except for the address the e2e suite uses to prove the limit works', async () => {
        // tests/e2e/auth.spec.ts signs in as ratelimit-test@example.com.
        setNodeEnv('development');
        const { consumeLoginAttempt } = await import('@/lib/rate-limit');

        await consumeLoginAttempt('ratelimit-test@example.com');

        expect(limit).toHaveBeenCalledWith('login_ratelimit-test@example.com');
    });
});

describe('the switch is gone from the source', () => {
    function codeOf(rel: string): string {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        return readFileSync(join(process.cwd(), rel), 'utf-8')
            .split('\n')
            .filter((l: string) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');
    }

    it('rate-limit.ts reads no emulator variable', async () => {
        const code = codeOf('src/lib/rate-limit.ts');

        expect(code).not.toContain('FIREBASE_AUTH_EMULATOR_HOST');
        expect(code).not.toContain('FIRESTORE_EMULATOR_HOST');
    });

    it('redis.ts does not choose its client by one either', async () => {
        // The stub it selects backs every rate limiter on the platform.
        const code = codeOf('src/lib/redis.ts');

        expect(code).not.toContain('FIREBASE_AUTH_EMULATOR_HOST');
        expect(code).not.toContain('FIRESTORE_EMULATOR_HOST');
    });

    it('redis.ts still stubs itself for jest, and when Upstash is unconfigured', async () => {
        // Vacuity guard: removing the clauses must not make the test suite talk
        // to a real Redis, nor crash a local run that has no Upstash keys.
        const code = codeOf('src/lib/redis.ts');

        expect(code).toContain("process.env.NODE_ENV === 'test'");
        expect(code).toContain('redisUrl && redisToken');
    });
});
