/**
 * Rate Limiting Utility - REDIS-BACKED (Distributed)
 * 
 * Prevents abuse and DDoS attacks using token bucket algorithm.
 * NOW SUPPORTS DISTRIBUTED RATE LIMITING via Upstash Redis
 */

import { redis } from './redis';
import { Ratelimit } from '@upstash/ratelimit';

interface RateLimitConfig {
    interval: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests in window
}

/**
 * Create a distributed rate limiter with Redis backend
 * Uses Upstash Ratelimit (sliding window) to prevent check-then-act race conditions
 */
export function rateLimit(config: RateLimitConfig) {
    const limiter = new Ratelimit({
        redis: redis,
        limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.interval} ms`),
        prefix: "@upstash/ratelimit_custom",
        analytics: false,
    });

    return {
        check: async (identifier: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> => {
            const now = Date.now();
            try {
                const { success, limit, remaining, reset } = await limiter.limit(identifier);
                return {
                    success,
                    limit,
                    remaining,
                    reset,
                };
            } catch (error) {
                // Redis error - fail open (allow request) but log
                console.error('[Rate Limiter] Redis error:', error);
                return {
                    success: true, // Fail open for availability
                    limit: config.maxRequests,
                    remaining: config.maxRequests,
                    reset: now + config.interval,
                };
            }
        },
    };
}


/**
 * Get client IP address from request
 */
export function getClientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    if (realIp) {
        return realIp;
    }

    return 'unknown';
}

/**
 * Get client IP address from Server Action
 */
export async function getActionClientIp(): Promise<string> {
    const { headers } = await import('next/headers');
    const headersList = await headers();
    const forwarded = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    if (realIp) {
        return realIp;
    }

    return 'unknown';
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
