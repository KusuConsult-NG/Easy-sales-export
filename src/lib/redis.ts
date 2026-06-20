import { Redis } from '@upstash/redis';

// Initialize Redis client safely
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (redisUrl && redisToken)
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
