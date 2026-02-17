import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitConfig } from './security';

/**
 * Distributed Rate Limiter (Redis-backed for 100k+ users)
 * Uses Upstash Redis for global state across serverless functions
 */
const rateLimiter = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(rateLimitConfig.maxRequests, `${rateLimitConfig.windowMs} ms`),
    analytics: true,
    prefix: "@upstash/ratelimit",
});

/**
 * Rate limiting middleware for API routes
 */
export async function rateLimit(
    request: NextRequest,
    identifier?: string
): Promise<{ success: boolean; remaining?: number; error?: string }> {
    // Get identifier from parameter, or fallback to IP from headers
    const key =
        identifier ||
        request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        'anonymous';

    try {
        const { success, limit, remaining, reset } = await rateLimiter.limit(key);

        if (success) {
            return {
                success: true,
                remaining: remaining,
            };
        } else {
            // Calculate retry time based on reset timestamp
            const now = Date.now();
            const retryAfterSeconds = Math.ceil((reset - now) / 1000);

            return {
                success: false,
                error: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
            };
        }
    } catch (error) {
        console.error("Rate limit error:", error);
        // Fail open to avoid blocking legitimate users on Redis error
        return {
            success: true,
            remaining: 1,
        };
    }
}

/**
 * Wrap API handler with rate limiting
 */
export function withRateLimit(
    handler: (req: NextRequest) => Promise<NextResponse>,
    getIdentifier?: (req: NextRequest) => string
) {
    return async (req: NextRequest): Promise<NextResponse> => {
        const identifier = getIdentifier ? getIdentifier(req) : undefined;
        const limitResult = await rateLimit(req, identifier);

        if (!limitResult.success) {
            return NextResponse.json(
                { error: limitResult.error },
                {
                    status: 429,
                    headers: {
                        'Retry-After': '60',
                        'X-RateLimit-Limit': rateLimitConfig.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                    }
                }
            );
        }

        const response = await handler(req);

        // Add rate limit headers
        response.headers.set('X-RateLimit-Limit', rateLimitConfig.maxRequests.toString());
        response.headers.set('X-RateLimit-Remaining', (limitResult.remaining || 0).toString());

        return response;
    };
}

/**
 * Rate limiter for login attempts per user (Redis-backed)
 */
const loginLimiter = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(
        parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
        "15 m" // 15 minutes
    ),
    prefix: "@upstash/login_limit",
});

/**
 * Check and consume login attempt
 */
export async function consumeLoginAttempt(
    email: string
): Promise<{ allowed: boolean; remainingAttempts?: number; error?: string }> {
    const key = `login_${email.toLowerCase()}`;

    try {
        const { success, remaining, reset } = await loginLimiter.limit(key);

        if (success) {
            return {
                allowed: true,
                remainingAttempts: remaining,
            };
        } else {
            const now = Date.now();
            const minutesRemaining = Math.ceil((reset - now) / 1000 / 60);
            return {
                allowed: false,
                error: `Too many failed login attempts. Please try again in ${minutesRemaining} minutes.`,
            };
        }
    } catch (error) {
        console.error("Login rate limit error:", error);
        // Fail open for login to prevent DoS via Redis failure
        return { allowed: true };
    }
}

/**
 * Reset login attempts (call on successful login)
 */
export async function resetLoginAttempts(email: string): Promise<void> {
    try {
        const key = `@upstash/login_limit:login_${email.toLowerCase()}`;

        // 🗑️ HARD RESET: Delete the sliding window key directly
        // This effectively resets the counter to 0 for this user
        await redis.del(key);

        console.log(`[Auth] Login attempt counter reset for ${email}`);
    } catch (error) {
        console.error("Failed to reset login attempts:", error);
        // Non-blocking error
    }
}
