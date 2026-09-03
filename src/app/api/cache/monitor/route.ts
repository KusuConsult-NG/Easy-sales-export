export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireSession } from "@/lib/session-guard";
import { isPlatformAdmin } from "@/lib/admin-permissions";

/**
 * Redis Cache Monitoring API
 * GET /api/cache/monitor
 *
 * Returns cache statistics for monitoring
 */

/**
 * The key namespaces that hold CACHE, and may be thrown away at will.
 *
 * `user:` is CacheKeys (profile, permissions, session, stats, suspended) and
 * `admin:` is the dashboard/finance/coop aggregates cleared by
 * cache-invalidation.ts. Losing either costs a recomputation and nothing else.
 */
const CACHE_NAMESPACES = ['user:*', 'admin:*'] as const;

/**
 * The namespace that is NOT cache, and is the reason DELETE no longer takes
 * everything.
 *
 * @upstash/ratelimit_custom  the per-route request limiters
 * @upstash/ratelimit         the shared request limiter
 * @upstash/login_limit       failed login attempts, 15-minute sliding window
 *
 * These are enforcement state. Deleting them does not clear a cache, it clears
 * every rate limit on the platform — including the failed-login counters
 * standing against accounts being guessed at right now.
 */
const ENFORCEMENT_NAMESPACE = '@upstash/';

export async function GET(request: NextRequest) {
    // ADMIN AUTHENTICATION REQUIRED
    const session = (await requireSession()).session;
    if (!isPlatformAdmin(session?.user?.roles)) {
        return NextResponse.json(
            { error: 'Unauthorized: Admin access required' },
            { status: 403 }
        );
    }

    try {
        // Parse cache statistics
        const stats = {
            status: 'connected',
            hitRate: 'N/A', // Upstash dashboard has this
            keysCount: 0,
            cacheKeysCount: 0,
            enforcementKeysCount: 0,
            memoryUsed: 'N/A',
            timestamp: new Date().toISOString(),
        };

        // Try to get key count
        try {
            // This might be slow in production - use sparingly
            const keys = await redis.keys('*');
            stats.keysCount = keys.length;
            // Split out, because the two halves mean different things and only
            // one of them is safe for DELETE below to remove.
            stats.enforcementKeysCount = keys.filter(
                (k: string) => k.startsWith(ENFORCEMENT_NAMESPACE)
            ).length;
            stats.cacheKeysCount = stats.keysCount - stats.enforcementKeysCount;
        } catch (error) {
            stats.keysCount = -1; // Error getting keys
        }

        return NextResponse.json({
            success: true,
            stats,
            message: 'Cache is operational. Check Upstash dashboard for detailed metrics.',
            dashboardUrl: 'https://console.upstash.com',
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message,
            message: 'Cache connection failed. Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
        }, { status: 500 });
    }
}

/**
 * Clear the cache (admin only)
 * DELETE /api/cache/monitor
 *
 * IT USED TO CLEAR THE RATE LIMITS TOO
 * ------------------------------------
 *     const keys = await redis.keys('*');
 *     if (keys.length > 0) await redis.del(...keys);
 *
 * Everything, under a name that says cache. The same Redis holds three
 * enforcement namespaces — the two request limiters and the login limiter — so
 * "clear all cache keys" also handed a fresh allowance to every throttled
 * caller and wiped the failed-login counter on every account, including any
 * currently being guessed at.
 *
 * Scoped to the cache namespaces now. The enforcement keys expire on their own
 * schedule, which is the whole point of them: a 15-minute lockout that an admin
 * can end by clicking Clear Cache is not a 15-minute lockout.
 *
 * Left as it was: the keyspace scan. It costs what it costs and this endpoint
 * is admin-only and manual, unlike resetLoginAttempts (#199) where the same
 * call sat on every successful login. Noted rather than changed, because
 * scanning a namespace is what SCAN is for and pretending otherwise would be
 * the third rewrite of this file today.
 */
export async function DELETE(request: NextRequest) {
    // ADMIN AUTHENTICATION REQUIRED
    const session = (await requireSession()).session;
    if (!isPlatformAdmin(session?.user?.roles)) {
        return NextResponse.json(
            { error: 'Unauthorized: Admin access required' },
            { status: 403 }
        );
    }

    try {
        const found: string[] = [];
        for (const namespace of CACHE_NAMESPACES) {
            const keys = await redis.keys(namespace);
            found.push(...keys);
        }

        // Belt and braces: a namespace pattern should never match enforcement
        // state, and if one ever did, this is the line that stops it.
        const cacheKeys = found.filter((k) => !k.startsWith(ENFORCEMENT_NAMESPACE));

        if (cacheKeys.length > 0) {
            await redis.del(...cacheKeys);
        }

        return NextResponse.json({
            success: true,
            clearedKeys: cacheKeys.length,
            message: `Cleared ${cacheKeys.length} cache keys. Rate limits and login lockouts were not touched.`,
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    }
}
