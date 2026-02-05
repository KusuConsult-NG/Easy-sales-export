/**
 * Rate Limiting Utility
 * 
 * Prevents abuse and DDoS attacks using token bucket algorithm.
 * Supports IP-based tracking with configurable limits per endpoint.
 */

interface RateLimitConfig {
    interval: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests in window
}

interface RateLimitStore {
    [key: string]: {
        count: number;
        resetTime: number;
    };
}

// In-memory store (use Redis in production for multi-instance deployments)
const limitStore: RateLimitStore = {};

/**
 * Create a rate limiter with specified config
 */
export function rateLimit(config: RateLimitConfig) {
    return {
        check: async (identifier: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> => {
            const now = Date.now();
            const record = limitStore[identifier];

            // Initialize or reset if window expired
            if (!record || now > record.resetTime) {
                limitStore[identifier] = {
                    count: 1,
                    resetTime: now + config.interval,
                };

                return {
                    success: true,
                    limit: config.maxRequests,
                    remaining: config.maxRequests - 1,
                    reset: now + config.interval,
                };
            }

            // Check if limit exceeded
            if (record.count >= config.maxRequests) {
                return {
                    success: false,
                    limit: config.maxRequests,
                    remaining: 0,
                    reset: record.resetTime,
                };
            }

            // Increment count
            record.count++;

            return {
                success: true,
                limit: config.maxRequests,
                remaining: config.maxRequests - record.count,
                reset: record.resetTime,
            };
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
