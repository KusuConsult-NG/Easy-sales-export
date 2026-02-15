import { NextRequest, NextResponse } from 'next/server';
import { redis, CACHE_TTL } from '@/lib/redis';

/**
 * Redis Cache Monitoring API
 * GET /api/cache/monitor
 * 
 * Returns cache statistics for monitoring
 */
export async function GET(request: NextRequest) {
    try {
        // Get Redis database info
        const info = await redis.info();

        // Parse cache statistics
        const stats = {
            status: 'connected',
            hitRate: 'N/A', // Upstash dashboard has this
            keysCount: 0,
            memoryUsed: 'N/A',
            uptimeSeconds: 0,
            timestamp: new Date().toISOString(),
        };

        // Try to get key count
        try {
            // This might be slow in production - use sparingly
            const keys = await redis.keys('*');
            stats.keysCount = keys.length;
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
 * Clear all cache (admin only)
 * DELETE /api/cache/monitor
 */
export async function DELETE(request: NextRequest) {
    try {
        // TODO: Add admin authentication check

        // Clear all keys
        const keys = await redis.keys('*');
        if (keys.length > 0) {
            await redis.del(...keys);
        }

        return NextResponse.json({
            success: true,
            clearedKeys: keys.length,
            message: `Cleared ${keys.length} cache keys`,
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    }
}
