import { Redis } from '@upstash/redis';
import {
    getFallbackCache,
    setFallbackCache,
    deleteFallbackCache,
} from './cache-fallback';

// Initialize Redis client safely
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

// Only jest forces the stub.
//
// This also treated FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST as
// reasons to replace the Redis client with the stub below — and the stub backs
// every rate limiter on the platform, so setting either variable stood down
// throttling everywhere at once.
//
// The clauses bought nothing they were needed for. Local emulator work has no
// UPSTASH_REDIS_REST_URL either, and the condition on the next line already
// falls back to the stub whenever the Upstash variables are absent. So the only
// case those two clauses actually changed was "Upstash IS configured and an
// emulator host is set", where using the configured Redis is what the operator
// asked for.
const isTestRun = process.env.NODE_ENV === 'test';

const redis = (redisUrl && redisToken && !isTestRun)
    ? new Redis({ 
        url: redisUrl, 
        token: redisToken,
        retry: {
            retries: 3,
            backoff: (retryCount: number) => Math.min(500, 50 * Math.pow(2, retryCount))
        },
        fetch: (url: string | URL | Request, init?: RequestInit) => {
            return fetch(url, {
                ...init,
                signal: AbortSignal.timeout(2000)
            });
        }
      } as any)
    : {
        // Mock limited interface if missing (prevents crash)
        get: async () => null,
        setex: async () => false,
        del: async () => false,
        keys: async () => [],
        // Add other methods as needed by rate-limit
    } as unknown as Redis;

/**
 * Whether `redis` above is a real Upstash client or the stub.
 *
 * WHY CALLERS NEED TO KNOW
 * ------------------------
 * The stub implements four methods — get, setex, del, keys — and is cast
 * `as unknown as Redis`, so it type-checks as the full client while being
 * nothing like it. @upstash/ratelimit drives its sliding window through
 * `evalsha`/`scriptLoad`, neither of which is here, so every rate limiter on
 * the platform threw
 *
 *     TypeError: a.redis.evalsha is not a function
 *
 * on EVERY request, caught it, logged "Redis error (falling back to
 * in-memory)", and used the in-memory fallback. The outcome was right; the cost
 * was a thrown exception and a log line per request, and real Redis failures
 * were indistinguishable from "no Redis configured" in the logs.
 *
 * The stub deliberately does NOT gain the missing methods: a no-op evalsha
 * would make rate limiting silently allow everything, which is worse than
 * throwing. Callers check this flag and go straight to their in-memory fallback
 * instead.
 */
export const isRedisConfigured = !!(redisUrl && redisToken && !isTestRun);

/**
 * Which of the three states this deployment is in — #661.
 *
 *   "NOT SET" WAS BEING SAID TO SOMEBODY WHO HAD SET ONE OF THEM.
 *
 *   `isRedisConfigured` is `url && token`, so a deployment with the TOKEN set
 *   and the URL missing is reported, logged and rendered exactly like one that
 *   never had Upstash at all. This platform's deployment is in that state
 *   today: the audit's own owner-side list records "only the token is set".
 *
 *   Those two situations are not the same thing and want different answers:
 *
 *     neither  — a choice. Local work, a preview, a deployment that does not
 *                want a shared cache. The warning below is right for it.
 *     one      — a MISTAKE. Nobody sets half of a credential pair on purpose.
 *                Somebody believed they had configured Upstash, and every rate
 *                limiter on the platform is quietly using a per-instance
 *                in-memory fallback that shares no state between instances.
 *     both     — configured.
 *
 *   The middle one is the whole finding, and it was invisible: the message told
 *   the operator to set two variables when they had set one, and never said
 *   which was missing. "Could not tell" rendered as "no", which is the class
 *   #620 and #621 are filed under.
 */
export type RedisConfigState = 'configured' | 'half-configured' | 'absent';

export function redisConfigState(env: NodeJS.ProcessEnv = process.env): RedisConfigState {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) return 'configured';
    if (url || token) return 'half-configured';
    return 'absent';
}

/** The variable that is missing when exactly one was set, for a message that can be acted on. */
export function missingRedisVariable(env: NodeJS.ProcessEnv = process.env): string | null {
    if (redisConfigState(env) !== 'half-configured') return null;
    return env.UPSTASH_REDIS_REST_URL ? 'UPSTASH_REDIS_REST_TOKEN' : 'UPSTASH_REDIS_REST_URL';
}

if (!isRedisConfigured && !isTestRun) {
    // Once, at module load — not once per request.
    const missing = missingRedisVariable();

    if (missing) {
        //   An error, not a warning: somebody set one of these on purpose and
        //   believes the platform has a shared cache. It does not.
        console.error(
            `[Redis] ${missing} IS NOT SET, and its partner is. Upstash is HALF-CONFIGURED, ` +
            'so it is not being used at all: caching is disabled and every rate limiter is ' +
            'using its per-instance in-memory fallback, which does NOT share state between ' +
            'server instances. This is almost certainly a mistake — set the missing variable.'
        );
    } else {
        console.warn(
            '[Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. ' +
            'Caching is disabled and every rate limiter is using its per-instance ' +
            'in-memory fallback, which does NOT share state between server instances.'
        );
    }
}

export { redis };

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
    SESSION: 30,           // 30 seconds for session data
    USER_PROFILE: 300,     // 5 minutes for user profiles
    USER_PERMISSIONS: 60,  // 1 minute for permissions
    STATS: 120,            // 2 minutes for dashboard stats
} as const;

/**
 * Get cached value
 */
export async function getCached<T>(key: string): Promise<T | null> {
    //   #459 WITHOUT UPSTASH, `redis` IS A STUB WHOSE get() RETURNS null AND
    //        WHOSE setex() DISCARDS — so every cache on this platform was a
    //        no-op, while the rate limiters beside them fell back to memory.
    //        See cache-fallback.ts for what that cost and why the fallback is
    //        per-instance.
    if (!isRedisConfigured) return getFallbackCache<T>(key);

    try {
        const value = await redis.get<T>(key);
        return value;
    } catch (error) {
        console.error('[Redis] Get error:', error);
        return null; // Fail gracefully - return null if cache fails
    }
}

/**
 * Set cached value with TTL
 */
export async function setCache(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    if (!isRedisConfigured) return setFallbackCache(key, value, ttlSeconds);

    try {
        await redis.setex(key, ttlSeconds, value);
        return true;
    } catch (error) {
        console.error('[Redis] Set error:', error);
        return false; // Fail gracefully
    }
}

/**
 * Delete cached value
 */
export async function deleteCache(key: string): Promise<boolean> {
    // Invalidation must reach the same store the write went to, or a stale
    // entry outlives the change that was meant to clear it.
    if (!isRedisConfigured) return deleteFallbackCache(key);

    try {
        await redis.del(key);
        return true;
    } catch (error) {
        console.error('[Redis] Delete error:', error);
        return false;
    }
}

/**
 * Delete multiple cached values by pattern
 */
export async function deleteCachePattern(pattern: string): Promise<boolean> {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        return true;
    } catch (error) {
        console.error('[Redis] Delete pattern error:', error);
        return false;
    }
}

/**
 * Generate cache keys
 */
export const CacheKeys = {
    userProfile: (userId: string) => `user:profile:${userId}`,
    userPermissions: (userId: string) => `user:permissions:${userId}`,
    userSession: (userId: string) => `user:session:${userId}`,
    userStats: (userId: string) => `user:stats:${userId}`,
    allUserData: (userId: string) => `user:*:${userId}`,
} as const;

/**
 * Check if Redis is connected and configured
 */
export async function getRedisClientStatus(): Promise<boolean> {
    if (!redisUrl || !redisToken) return false;
    try {
        await redis.get("health-check");
        return true;
    } catch (e) {
        return false;
    }
}
