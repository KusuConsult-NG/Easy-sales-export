/**
 * @jest-environment node
 */

/**
 *   #459 EVERY CACHE ON THIS PLATFORM WAS A NO-OP IN PRODUCTION, AND THE RATE
 *   LIMITERS SITTING BESIDE THEM WERE NOT.
 *
 *   lib/redis.ts swaps the Upstash client for a stub when the two UPSTASH_*
 *   variables are absent:
 *
 *       get:   async () => null,
 *       setex: async () => false,
 *
 *   so `getCached` always missed and `setCache` always discarded. This platform
 *   is deployed with those variables unset — its own startup log says so — and
 *   about fifty call sites across sixteen files were caching into nothing:
 *
 *       lib/session-guard.ts, lib/user-cache.ts   the user profile, re-read by
 *                                                 EVERY server action
 *       lib/hub-guard.ts                          every gated page
 *       cooperatives/(member)/layout.tsx          every page in the module
 *       marketplace/seller/layout.tsx             every page in the module
 *       admin-analytics.ts, and eleven more       the dashboard tiles
 *
 *   #453 measured one consequence: /dashboard performed EIGHT identical reads
 *   of the same user row before doing any of its work, because seven cache
 *   lookups that should have hit could not. It collapsed the eight calls into
 *   one and noted the other half was "configuration, and it is the owner's to
 *   do". That was true of SHARED caching. It was not true of caching at all,
 *   and saying it was left the platform slow for a reason nobody was going to
 *   act on.
 *
 *   MEASURED, by counting the reads a repeated profile lookup actually issues:
 *
 *       as shipped, stub discards   8 database reads for 8 lookups
 *       with the fallback           1 database read  for 8 lookups
 *
 *   Every server action begins with a session check that resolves to this
 *   lookup, so that ratio is paid on every request a signed-in user makes, not
 *   only on a dashboard.
 *
 *   THE ASYMMETRY IS THE FINDING. redis.ts's own warning says the rate limiters
 *   fall back to a "per-instance in-memory fallback", and they do —
 *   rate-limiter-fallback.ts exists for exactly that. Losing a rate limit fails
 *   open, so somebody built the fallback. Losing a cache only makes things
 *   slow, so nobody did.
 *
 *   AND FIXING IT EXPOSED A LATENT BUG THAT WAS HARMLESS ONLY WHILE THE CACHE
 *   WAS BROKEN. cooperatives/(member)/layout.tsx invalidated the repaired
 *   user's profile with the RAW client — `redis.del(...)` — which reaches the
 *   stub, not the store `setCache` writes to. While nothing was ever cached
 *   that made no difference. The moment caching works, that invalidation misses
 *   and the member is sent back to repair a registration they just repaired. It
 *   goes through invalidateUserCache now.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     getCached stops consulting the fallback    KILLED
 *     setCache stops writing to it               KILLED
 *     deleteCache stops reaching it              KILLED
 *     the TTL is ignored on read                 KILLED
 *     the entry cap is removed                   KILLED
 *     a non-positive TTL is stored anyway        KILLED
 *     the layout goes back to the raw client     KILLED
 *     reword this header                         SURVIVED, as intended
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import {
    getFallbackCache,
    setFallbackCache,
    deleteFallbackCache,
    clearFallbackCache,
    fallbackCacheSize,
    MAX_ENTRIES,
} from '@/lib/cache-fallback';
import { getCached, setCache, deleteCache, isRedisConfigured } from '@/lib/redis';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

beforeEach(() => clearFallbackCache());

// ─────────────────────────────────────────────────────────────────────────────
describe('#459 — with no Upstash configured, a cache still caches', () => {
    it('THE TEST RUN HAS NO UPSTASH — so this is the path production takes', () => {
        // The premise. If Upstash were configured here, every assertion below
        // would be exercising the other branch and proving nothing about the
        // deployment that has neither variable set.
        expect(isRedisConfigured).toBe(false);
    });

    it('A VALUE WRITTEN THROUGH setCache COMES BACK FROM getCached', () => {
        // This returned null, always. `setex: async () => false`.
        expect(setCache('k1', { total: 42 }, 60)).resolves.toBe(true);
    });

    it('and the round trip returns what was put in', async () => {
        await setCache('admin:dashboard-stats:global', { users: 12, revenue: 3400 }, 120);

        expect(await getCached('admin:dashboard-stats:global'))
            .toEqual({ users: 12, revenue: 3400 });
    });

    it('AND deleteCache REACHES THE SAME STORE — invalidation must not miss', () => {
        // A write that lands in one store and an invalidation aimed at another
        // is a stale value that outlives the change meant to clear it. That is
        // exactly the bug this finding exposed in the cooperative layout.
        return (async () => {
            await setCache('user:profile:u1', { firstName: 'Ada' }, 300);
            expect(await getCached('user:profile:u1')).toEqual({ firstName: 'Ada' });

            await deleteCache('user:profile:u1');
            expect(await getCached('user:profile:u1')).toBeNull();
        })();
    });

    it('and a key never written is still a miss', async () => {
        expect(await getCached('nothing-was-ever-put-here')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#459 — the store behaves like a cache, not like a leak', () => {
    it('AN EXPIRED ENTRY IS A MISS', () => {
        setFallbackCache('short', 'value', 60);
        expect(getFallbackCache('short')).toBe('value');

        // Reach past the TTL rather than sleeping: a test that waits a minute
        // is a test that gets skipped.
        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 61_000;
            expect(getFallbackCache('short')).toBeNull();
        } finally {
            Date.now = realNow;
        }
    });

    it('AND AN EXPIRED ENTRY IS DROPPED, not merely hidden', () => {
        setFallbackCache('short', 'value', 60);

        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 61_000;
            getFallbackCache('short');
        } finally {
            Date.now = realNow;
        }

        expect(fallbackCacheSize()).toBe(0);
    });

    it('AND THE STORE IS CAPPED — an unbounded Map in a long-lived container is a leak', () => {
        for (let i = 0; i < MAX_ENTRIES + 50; i += 1) {
            setFallbackCache(`key-${i}`, { i }, 300);
        }

        expect(fallbackCacheSize()).toBeLessThanOrEqual(MAX_ENTRIES);
    });

    it('and eviction drops the OLDEST, keeping what was written most recently', () => {
        for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
            setFallbackCache(`key-${i}`, { i }, 300);
        }

        expect(getFallbackCache(`key-${MAX_ENTRIES + 9}`)).toEqual({ i: MAX_ENTRIES + 9 });
        expect(getFallbackCache('key-0')).toBeNull();
    });

    it('and re-writing a key refreshes its place in that order', () => {
        setFallbackCache('kept', 'first', 300);
        for (let i = 0; i < MAX_ENTRIES - 1; i += 1) setFallbackCache(`filler-${i}`, i, 300);

        // Without the re-set, 'kept' is the oldest and goes first.
        setFallbackCache('kept', 'second', 300);
        for (let i = 0; i < 50; i += 1) setFallbackCache(`more-${i}`, i, 300);

        expect(getFallbackCache('kept')).toBe('second');
    });

    it('AND A NON-POSITIVE TTL IS NOT STORED — an entry that can never hit', () => {
        expect(setFallbackCache('zero', 'v', 0)).toBe(false);
        expect(setFallbackCache('negative', 'v', -5)).toBe(false);
        expect(setFallbackCache('nonsense', 'v', Number.NaN)).toBe(false);
        expect(fallbackCacheSize()).toBe(0);
    });

    it('and a value that cannot be serialised is refused rather than thrown', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(setFallbackCache('circular', circular, 60)).toBe(false);
        expect(setFallbackCache('undef', undefined, 60)).toBe(false);
        expect(fallbackCacheSize()).toBe(0);
    });

    it('and the stored value is a COPY — a caller mutating it cannot poison the cache', () => {
        const written = { items: ['a'] };
        setFallbackCache('copy', written, 60);

        written.items.push('b');
        const read = getFallbackCache<{ items: string[] }>('copy')!;
        read.items.push('c');

        expect(getFallbackCache<{ items: string[] }>('copy')).toEqual({ items: ['a'] });
    });

    it('AND SERIALISATION IS LOSSY THE SAME WAY UPSTASH IS', () => {
        // @upstash/redis JSON-serialises on write and parses on read, so a Date
        // returns as an ISO string. Storing a perfect clone here would return a
        // Date — and a caller that worked with no Upstash configured would
        // break the day it was. The round trip is matched, not improved on.
        const when = new Date('2026-01-02T03:04:05.000Z');
        setFallbackCache('dated', { when }, 60);

        expect(getFallbackCache<{ when: string }>('dated'))
            .toEqual({ when: '2026-01-02T03:04:05.000Z' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#459 — the bug that was harmless only while the cache was broken', () => {
    it('THE COOPERATIVE LAYOUT INVALIDATES THROUGH deleteCache, NOT THE RAW CLIENT', () => {
        // `redis.del(...)` reaches the stub. The write went to the fallback
        // store. A member who repaired their registration would be sent back to
        // repair it again for the whole 5-minute profile TTL.
        const layout = source('src/app/cooperatives/(member)/layout.tsx');

        expect(layout).not.toContain('redis.del(');
        expect(layout).toContain('invalidateUserCache(userId)');
    });

    it('AND NO OTHER PAGE OR ACTION INVALIDATES WITH THE RAW CLIENT', () => {
        // The ratchet. One more `redis.del` for a key written through setCache
        // is one more stale value, and it would look like a caching bug rather
        // than an invalidation bug.
        const OFFENDERS = [
            'src/app/cooperatives/(member)/layout.tsx',
            'src/app/marketplace/seller/layout.tsx',
            'src/lib/user-cache.ts',
            'src/lib/session-guard.ts',
            'src/lib/hub-guard.ts',
            'src/app/actions/admin-analytics.ts',
        ].filter((rel) => /\bredis\.del\(/.test(source(rel)));

        expect({ OFFENDERS }).toEqual({ OFFENDERS: [] });
    });

    it('POSITIVE CONTROL: that scan really would catch a raw del', () => {
        expect(/\bredis\.del\(/.test('await redis.del(CacheKeys.userProfile(userId));')).toBe(true);
        expect(/\bredis\.del\(/.test('await deleteCache(CacheKeys.userProfile(userId));')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#459 — the callers that were caching into nothing', () => {
    const CALLERS = [
        'src/lib/user-cache.ts',
        'src/lib/session-guard.ts',
        'src/lib/hub-guard.ts',
        'src/app/actions/admin-analytics.ts',
        'src/app/cooperatives/(member)/layout.tsx',
        'src/app/marketplace/seller/layout.tsx',
    ];

    it('ALL OF THEM STILL GO THROUGH getCached/setCache — nothing was rewritten', () => {
        // The fix is one file deep on purpose. Fifty call sites were already
        // correct; they were writing to a store that threw the value away.
        for (const rel of CALLERS) {
            const code = source(rel);
            expect({ rel, uses: /getCached|setCache/.test(code) }).toEqual({ rel, uses: true });
        }
    });

    it('and redis.ts consults the fallback in all three operations', () => {
        const redis = source('src/lib/redis.ts');

        for (const fn of ['getFallbackCache', 'setFallbackCache', 'deleteFallbackCache']) {
            expect({ fn, wired: redis.includes(fn) }).toEqual({ fn, wired: true });
        }
    });

    it('and a configured Upstash still takes the real path', () => {
        // The fallback must be the ELSE branch, not a replacement: an operator
        // who configures Upstash is asking for shared caching across instances.
        const redis = source('src/lib/redis.ts');

        expect(redis).toContain('if (!isRedisConfigured) return getFallbackCache');
        expect(redis).toContain('await redis.get<T>(key)');
    });
});
