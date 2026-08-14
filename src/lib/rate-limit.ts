import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitConfig } from './security';
import { checkFallbackLimit } from './rate-limiter-fallback';
import { auth } from '@/lib/auth';

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
    let userId: string | undefined;
    try {
        const session = await auth();
        userId = session?.user?.id;
    } catch {}

    // Get identifier from parameter, or fallback to authenticated userId,
    // or platform-verified X-Real-IP, or client-controlled X-Forwarded-For
    const key =
        identifier ||
        userId ||
        request.headers.get('x-real-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0] ||
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
        console.error("Rate limit error (falling back to in-memory):", error);
        // Fall back to a conservative in-memory rate limiter instead of failing fully open
        const fallback = checkFallbackLimit(key, rateLimitConfig.maxRequests, rateLimitConfig.windowMs);
        if (fallback.success) {
            return {
                success: true,
                remaining: fallback.remaining,
            };
        } else {
            const retryAfterSeconds = Math.ceil((fallback.reset - Date.now()) / 1000);
            return {
                success: false,
                error: `Too many requests (Redis connection failed). Please try again in ${retryAfterSeconds} seconds.`,
            };
        }
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
 * Check and consume login attempt.
 *
 * THE BRUTE-FORCE GUARD HAD AN ENVIRONMENT-VARIABLE OFF SWITCH
 * ------------------------------------------------------------
 * This opened with:
 *
 *     const isEmulator = !!(
 *         process.env.FIREBASE_AUTH_EMULATOR_HOST ||
 *         process.env.FIRESTORE_EMULATOR_HOST ||
 *         process.env.NODE_ENV === 'test'
 *     );
 *     if (isEmulator && !email.toLowerCase().includes('ratelimit-test')) {
 *         return { allowed: true, remainingAttempts: 999 };
 *     }
 *
 * So the *presence* of either emulator variable removed the limit on password
 * attempts — not "no Redis, fall back to something conservative", but
 * `allowed: true` unconditionally, for every address that does not happen to
 * contain the string "ratelimit-test".
 *
 * Nothing sets those variables in production today and the app would not work
 * if they were: they point Firebase at a local emulator. The argument for
 * removing rather than narrowing is the one #154 made about ADMIN_OVERRIDE and
 * #192 about PLAYWRIGHT_TEST — a variable like this is harmless until somebody
 * copies a .env into a deploy config, and this one guards the login form.
 *
 * NODE_ENV is the discriminator now, and it is the one this codebase already
 * trusts for exactly this question: security-checks.ts enforces strong secrets
 * on `NODE_ENV === 'production'`. Next sets it at build and start, so it cannot
 * be turned off by adding a variable. Local development and jest keep the
 * bypass; a production build cannot have it at any price.
 *
 * The "ratelimit-test" carve-out stays: tests/e2e/auth.spec.ts signs in as
 * ratelimit-test@example.com precisely to prove the limit still bites.
 */
export async function consumeLoginAttempt(
    email: string
): Promise<{ allowed: boolean; remainingAttempts?: number; error?: string }> {
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction && !email.toLowerCase().includes('ratelimit-test')) {
        return { allowed: true, remainingAttempts: 999 };
    }

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
                error: `Too many failed login attempts. If you cannot remember your credentials, please contact support at support@easysalesexport.com, or try again in ${minutesRemaining} minutes.`,
            };
        }
    } catch (error) {
        console.error("Login rate limit error (falling back to in-memory):", error);
        // Fall back to a conservative in-memory rate limiter instead of failing fully open
        const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
        const fallback = checkFallbackLimit(key, maxAttempts, 15 * 60 * 1000); // 15 minutes window
        if (fallback.success) {
            return {
                allowed: true,
                remainingAttempts: fallback.remaining,
            };
        } else {
            const now = Date.now();
            const minutesRemaining = Math.ceil((fallback.reset - now) / 1000 / 60);
            return {
                allowed: false,
                error: `Too many failed login attempts. If you cannot remember your credentials, please contact support at support@easysalesexport.com, or try again in ${minutesRemaining} minutes.`,
            };
        }
    }
}

/**
 * Reset login attempts (call on successful login)
 *
 * FIX: Upstash Ratelimit (sliding window) appends timestamp bucket suffixes to
 * keys, e.g. `@upstash/login_limit:login_email@gmail.com:1969580`.
 * A single redis.del() on the bare key never matched anything.
 * We now use KEYS with a wildcard to find and delete ALL window buckets.
 */
export async function resetLoginAttempts(email: string): Promise<void> {
    try {
        const pattern = `@upstash/login_limit:login_${email.toLowerCase()}*`;

        // Scan for all sliding-window bucket keys for this email
        const matchingKeys = await redis.keys(pattern);

        if (matchingKeys && matchingKeys.length > 0) {
            // Delete all matching keys in one call
            await redis.del(...matchingKeys);
            console.log(`[Auth] Cleared ${matchingKeys.length} rate-limit key(s) for ${email}`);
        } else {
            console.log(`[Auth] No rate-limit keys found for ${email} (already clean)`);
        }
    } catch (error) {
        console.error("Failed to reset login attempts:", error);
        // Non-blocking: do not throw — a reset failure must never block login
    }
}
