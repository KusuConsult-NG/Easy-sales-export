/**
 * In-Memory Fallback Rate Limiter Store
 * Used when Upstash Redis is unavailable to prevent rate-limit bypass.
 */

const fallbackStore = new Map<string, { count: number; resetTime: number }>();

export function checkFallbackLimit(
    key: string,
    maxRequests: number,
    windowMs: number
): { success: boolean; remaining: number; reset: number } {
    const now = Date.now();
    
    // Periodic cleanup of expired entries to prevent memory leaks
    if (fallbackStore.size > 2000) {
        for (const [k, v] of fallbackStore.entries()) {
            if (now > v.resetTime) {
                fallbackStore.delete(k);
            }
        }
    }

    const record = fallbackStore.get(key);

    if (!record || now > record.resetTime) {
        const newRecord = { count: 1, resetTime: now + windowMs };
        fallbackStore.set(key, newRecord);
        return {
            success: true,
            remaining: maxRequests - 1,
            reset: newRecord.resetTime,
        };
    }

    if (record.count >= maxRequests) {
        return {
            success: false,
            remaining: 0,
            reset: record.resetTime,
        };
    }

    record.count += 1;
    return {
        success: true,
        remaining: maxRequests - record.count,
        reset: record.resetTime,
    };
}
