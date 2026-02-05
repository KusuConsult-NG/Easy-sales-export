import { RateLimiterMemory } from 'rate-limiter-flexible';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitConfig } from './security';

/**
 * In-memory rate limiter for API routes
 * In production, consider using Redis for distributed rate limiting
 */
const rateLimiter = new RateLimiterMemory({
    points: rateLimitConfig.maxRequests,
    duration: rateLimitConfig.windowMs / 1000, // Convert to seconds
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
        const rateLimiterRes = await rateLimiter.consume(key);

        return {
            success: true,
            remaining: rateLimiterRes.remainingPoints,
        };
    } catch (error) {
        if (error instanceof Error && 'msBeforeNext' in error) {
            const msBeforeNext = (error as any).msBeforeNext;
            const retryAfterSeconds = Math.ceil(msBeforeNext / 1000);

            return {
                success: false,
                error: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
            };
        }

        return {
            success: false,
            error: 'Rate limit exceeded',
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
 * Rate limiter for login attempts per user
 */
const loginAttemptLimiter = new RateLimiterMemory({
    points: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    duration: 900, // 15 minutes
    blockDuration: 900, // Block for 15 minutes after max attempts
});

/**
 * Check and consume login attempt
 */
export async function consumeLoginAttempt(
    email: string
): Promise<{ allowed: boolean; remainingAttempts?: number; error?: string }> {
    const key = `login_${email.toLowerCase()}`;

    try {
        const result = await loginAttemptLimiter.consume(key);

        return {
            allowed: true,
            remainingAttempts: result.remainingPoints,
        };
    } catch (error) {
        if (error instanceof Error && 'msBeforeNext' in error) {
            const msBeforeNext = (error as any).msBeforeNext;
            const minutesRemaining = Math.ceil(msBeforeNext / 1000 / 60);

            return {
                allowed: false,
                error: `Too many failed login attempts. Please try again in ${minutesRemaining} minutes.`,
            };
        }

        return {
            allowed: false,
            error: 'Login attempt limit exceeded',
        };
    }
}

/**
 * Reset login attempts (call on successful login)
 */
export async function resetLoginAttempts(email: string): Promise<void> {
    const key = `login_${email.toLowerCase()}`;
    await loginAttemptLimiter.delete(key);
}
