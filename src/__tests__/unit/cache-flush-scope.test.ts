/**
 * @jest-environment node
 */

/**
 * "Clear cache" cleared the rate limits as well.
 *
 * THE BUG
 * -------
 *     const keys = await redis.keys('*');
 *     if (keys.length > 0) await redis.del(...keys);
 *
 * Everything, on an endpoint named for the cache. The same Redis instance holds
 * three enforcement namespaces alongside the cached values:
 *
 *     @upstash/ratelimit_custom   the per-route request limiters
 *     @upstash/ratelimit          the shared request limiter
 *     @upstash/login_limit        failed login attempts, 15-minute window
 *
 * So a cache flush also handed a fresh allowance to every throttled caller and
 * reset the failed-login counter on every account — including any account being
 * guessed at when the button was pressed. A fifteen-minute lockout that an
 * administrator can end by clearing the cache is not a fifteen-minute lockout.
 *
 * WHAT IS CACHE, AND WHAT IS NOT
 * ------------------------------
 * `user:` is CacheKeys — profile, permissions, session, stats, suspended — and
 * `admin:` is the dashboard, finance and cooperative aggregates that
 * cache-invalidation.ts clears by name. Losing either costs a recomputation.
 * Losing the enforcement keys costs the enforcement.
 *
 * SEVERITY, HONESTLY
 * ------------------
 * This route is admin-only and no screen calls it, so reaching it takes a
 * deliberate request from someone who already holds administrative access. It
 * is in the audit because it quietly undoes the two login-limiter fixes that
 * came before it (#197, #199), not because an attacker can reach it.
 *
 * NOT CHANGED
 * -----------
 * The keyspace scan. It costs what it costs, and this endpoint is manual and
 * rare — unlike resetLoginAttempts, where the same call sat on the login path.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const requireSession = jest.fn<any>();
const keys = jest.fn<any>();
const del = jest.fn<any>();

jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => requireSession(...a),
}));

jest.mock('@/lib/redis', () => ({
    redis: {
        keys: (...a: any[]) => keys(...a),
        del: (...a: any[]) => del(...a),
    },
    CACHE_TTL: {},
}));

const ADMIN = { session: { user: { id: 'a1', roles: ['admin'] } }, error: null };
const ANONYMOUS = { session: null, error: { error: 'nope' } };

/** A keyspace holding both kinds of key. */
const CACHE_KEYS = ['user:profile:u1', 'user:stats:u1', 'admin:dashboard-stats:global'];
const ENFORCEMENT_KEYS = [
    '@upstash/login_limit:login_victim@example.com:1969580',
    '@upstash/ratelimit:some-ip',
    '@upstash/ratelimit_custom:a1',
];

/** redis.keys(pattern) over the fixture, with glob semantics good enough here. */
function keyspace(pattern: string): string[] {
    const all = [...CACHE_KEYS, ...ENFORCEMENT_KEYS];
    if (pattern === '*') return all;
    const prefix = pattern.replace(/\*$/, '');
    return all.filter((k) => k.startsWith(prefix));
}

beforeEach(() => {
    jest.resetModules();
    requireSession.mockReset();
    keys.mockReset();
    del.mockReset();
    requireSession.mockResolvedValue(ADMIN);
    keys.mockImplementation(async (pattern: string) => keyspace(pattern));
    del.mockResolvedValue(1);
});

describe('a cache flush leaves the enforcement state alone', () => {
    it('deletes no login-limit key', async () => {
        // THE test. This key is a failed-login counter, and it used to go.
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        await DELETE({} as any);

        const deleted = del.mock.calls[0] ?? [];
        expect(deleted).not.toContain('@upstash/login_limit:login_victim@example.com:1969580');
    });

    it('deletes no rate-limit key of any kind', async () => {
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        await DELETE({} as any);

        const deleted = (del.mock.calls[0] ?? []) as string[];
        for (const key of deleted) {
            expect(`${key} starts with @upstash/: ${key.startsWith('@upstash/')}`)
                .toBe(`${key} starts with @upstash/: false`);
        }
    });

    it('never asks for the whole keyspace', async () => {
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        await DELETE({} as any);

        expect(keys).not.toHaveBeenCalledWith('*');
    });

    it('still clears the cache it is named for', async () => {
        // Vacuity guard: an endpoint that deletes nothing passes everything
        // above and silently stops working.
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        const res: any = await DELETE({} as any);
        const body = await res.json();
        const deleted = (del.mock.calls[0] ?? []) as string[];

        expect(deleted).toEqual(expect.arrayContaining(CACHE_KEYS));
        expect(body.clearedKeys).toBe(CACHE_KEYS.length);
    });

    it('and says so, so the caller is not left guessing', async () => {
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        const res: any = await DELETE({} as any);
        const body = await res.json();

        expect(body.message).toMatch(/login lockouts were not touched/i);
    });

    it('does not call del at all when there is nothing cached', async () => {
        // redis.del() with no arguments is an error, not a no-op.
        keys.mockResolvedValue([]);
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        const res: any = await DELETE({} as any);

        expect(del).not.toHaveBeenCalled();
        expect(res.status).toBe(200);
    });
});

describe('the monitor separates the two counts', () => {
    it('reports cache and enforcement keys apart', async () => {
        // The number that used to be reported was "everything", which is the
        // same number DELETE used to act on.
        const { GET } = await import('@/app/api/cache/monitor/route');

        const res: any = await GET({} as any);
        const body = await res.json();

        expect(body.stats.keysCount).toBe(CACHE_KEYS.length + ENFORCEMENT_KEYS.length);
        expect(body.stats.cacheKeysCount).toBe(CACHE_KEYS.length);
        expect(body.stats.enforcementKeysCount).toBe(ENFORCEMENT_KEYS.length);
    });
});

describe('both verbs are still admin-only', () => {
    it('DELETE refuses an anonymous caller', async () => {
        requireSession.mockResolvedValue(ANONYMOUS);
        const { DELETE } = await import('@/app/api/cache/monitor/route');

        const res: any = await DELETE({} as any);

        expect(res.status).toBe(403);
        expect(del).not.toHaveBeenCalled();
    });

    it('GET refuses an ordinary account', async () => {
        requireSession.mockResolvedValue({
            session: { user: { id: 'u9', roles: ['general_user'] } },
            error: null,
        });
        const { GET } = await import('@/app/api/cache/monitor/route');

        const res: any = await GET({} as any);

        expect(res.status).toBe(403);
        expect(keys).not.toHaveBeenCalled();
    });
});
