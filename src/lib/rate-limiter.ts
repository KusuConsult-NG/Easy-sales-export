/**
 * Rate Limiting Utility - REDIS-BACKED (Distributed)
 * 
 * Prevents abuse and DDoS attacks using token bucket algorithm.
 * NOW SUPPORTS DISTRIBUTED RATE LIMITING via Upstash Redis
 */

import { redis, isRedisConfigured } from './redis';
import { Ratelimit } from '@upstash/ratelimit';
import { checkFallbackLimit } from './rate-limiter-fallback';
import { clientIpFromHeaders } from './client-ip';

interface RateLimitConfig {
    interval: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests in window
    /**
     * What this limit is FOR, and therefore its own key space in Redis.
     *
     * Required, not optional. Without it every limiter built here shared one
     * key per identifier — see the note in rate-limits.config.ts — and the
     * failure was silent: a member was refused a withdrawal because they had
     * used the app.
     *
     * rateLimitConfig stamps this from the object key, so a new limit cannot be
     * added without one and the name cannot drift from what it is called.
     */
    name: string;
}

/**
 * Create a distributed rate limiter with Redis backend
 * Uses Upstash Ratelimit (sliding window) to prevent check-then-act race conditions
 */
export function rateLimit(config: RateLimitConfig) {
    const limiter = new Ratelimit({
        redis: redis,
        limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.interval} ms`),
        // The name is in the PREFIX, so Upstash's own key already separates one
        // limit from another. It was a single constant, and every limit built
        // here therefore shared one counter per identifier.
        prefix: `@upstash/ratelimit_custom:${config.name}`,
        analytics: false,
    });

    return {
        check: async (identifier: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> => {
            // The in-memory fallback needs the same separation, and gets it here
            // rather than from a prefix it does not have. Namespacing only the
            // Redis path would leave every limit colliding again the moment
            // Upstash was unreachable — which is precisely when a member is
            // least able to tell a rate limit from an outage.
            const key = `${config.name}:${identifier}`;

            // No Upstash configured: the sliding window below runs against the
            // four-method stub in lib/redis.ts, which has no `evalsha`, and so
            // threw once per request before reaching this same fallback.
            if (!isRedisConfigured) {
                const fallback = checkFallbackLimit(key, config.maxRequests, config.interval);
                return {
                    success: fallback.success,
                    limit: config.maxRequests,
                    remaining: fallback.remaining,
                    reset: fallback.reset,
                };
            }

            try {
                const { success, limit, remaining, reset } = await limiter.limit(identifier);
                return {
                    success,
                    limit,
                    remaining,
                    reset,
                };
            } catch (error) {
                // Redis error - fall back to in-memory fallback rate limiter instead of failing fully open
                console.error('[Rate Limiter] Redis error (falling back to in-memory):', error);
                const fallback = checkFallbackLimit(key, config.maxRequests, config.interval);
                return {
                    success: fallback.success,
                    limit: config.maxRequests,
                    remaining: fallback.remaining,
                    reset: fallback.reset,
                };
            }
        },
    };
}


/**
 * Get client IP address from request
 */
export function getClientIp(request: Request): string {
    // One rule, in lib/client-ip.ts (#260). This read x-real-ip whole and then
    // took the LEFTMOST x-forwarded-for entry — the one the caller wrote — so
    // rotating a header gave every request its own rate-limit bucket.
    //
    // "unknown" groups everyone we cannot identify into ONE bucket, which
    // over-limits. That is the safe direction for a limiter: the alternative is
    // a bucket the caller names.
    return clientIpFromHeaders(request.headers) ?? 'unknown';
}

/**
 * Get client IP address from Server Action
 */
export async function getActionClientIp(): Promise<string> {
    const { headers } = await import('next/headers');
    const headersList = await headers();
    // Same rule as getClientIp — see lib/client-ip.ts (#260).
    return clientIpFromHeaders(headersList as unknown as Headers) ?? 'unknown';
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
    headers: Headers,
    result: { limit: number; remaining: number; reset: number }
): Headers {
    headers.set('X-RateLimit-Limit', result.limit.toString());
    headers.set('X-RateLimit-Remaining', result.remaining.toString());
    headers.set('X-RateLimit-Reset', Math.floor(result.reset / 1000).toString());

    return headers;
}

/**
 * Create rate limit error response
 */
export function createRateLimitResponse(
    result: { limit: number; remaining: number; reset: number }
): Response {
    const headers = new Headers();
    addRateLimitHeaders(headers, result);
    headers.set('Content-Type', 'application/json');
    headers.set('Retry-After', Math.ceil((result.reset - Date.now()) / 1000).toString());

    return new Response(
        JSON.stringify({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
        }),
        {
            status: 429,
            headers,
        }
    );
}
