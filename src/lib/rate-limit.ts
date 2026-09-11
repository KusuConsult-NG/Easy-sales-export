import { Ratelimit } from '@upstash/ratelimit';
import { redis, isRedisConfigured } from './redis';
import { NextRequest, NextResponse } from 'next/server';
//   #644 ONE NAME, TWO TABLES.
//
//   This imported a DIFFERENT object called `rateLimitConfig`, from
//   lib/security.ts, while the other twenty-one importers in the codebase get
//   the named-bucket table from lib/rate-limits.config.ts. Same identifier, two
//   meanings, and the one this module used is the one that governs twelve
//   routes — so the declaration a reader finds (`api: 100 a minute`) was not the
//   limit in force (200).
//
//   The `api` bucket now carries the env-driven values this module was using, so
//   the number is written down once, in the table where every other limit is.
import { rateLimitConfig } from './rate-limits.config';

/** The generic tier, from the one table. */
const apiLimit = rateLimitConfig.api;
import { checkFallbackLimit, resetFallbackLimit } from './rate-limiter-fallback';
import { auth } from '@/lib/auth';
import { clientIpFromHeaders } from './client-ip';

/**
 * Distributed Rate Limiter (Redis-backed for 100k+ users)
 * Uses Upstash Redis for global state across serverless functions
 */
const rateLimiter = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(apiLimit.maxRequests, `${apiLimit.interval} ms`),
    analytics: true,
    prefix: "@upstash/ratelimit",
});

/**
 * Rate limiting middleware for API routes
 */
export async function rateLimit(
    request: NextRequest,
    /**
     *   #643 The scope is REQUIRED here too, not only on the wrapper.
     *
     *   An optional parameter on the low-level function is a door the pooling
     *   can come back through: one future caller reaching past `withRateLimit`
     *   and omitting it puts that route back in everybody else's budget, and
     *   nothing would say so. `identifier` stays optional because the fallback
     *   chain below has a real answer for its absence; a missing key space does
     *   not.
     */
    scope: string,
    identifier?: string,
): Promise<{ success: boolean; remaining?: number; error?: string }> {
    let userId: string | undefined;
    try {
        const session = await auth();
        userId = session?.user?.id;
    } catch {}

    // Identifier from the parameter, else the authenticated userId, else the
    // address our own proxy observed (#260).
    //
    // This preferred x-real-ip and fell back to the LEFTMOST x-forwarded-for
    // entry, under a comment that called that one "client-controlled" — and
    // then keyed on it anyway. Rotating the header gave every request its own
    // bucket, which is no limit at all.
    //
    // 'anonymous' groups everyone we cannot identify into ONE bucket. That
    // over-limits, which is the safe direction; a caller-named key does not.
    const identity =
        identifier ||
        userId ||
        clientIpFromHeaders(request.headers) ||
        'anonymous';

    /**
     *   #643 ONE COUNTER FOR TWELVE ROUTES.
     *
     *   Every `withRateLimit` route shared this key — the identity alone, under
     *   the single Upstash prefix `@upstash/ratelimit` and the same string in
     *   the in-memory fallback. So one member's MFA setup, QR verification,
     *   loan application and three KYC submissions all drew from ONE budget of
     *   `RATE_LIMIT_MAX_REQUESTS` per window.
     *
     *   rate-limits.config.ts documents this exact failure in its own header,
     *   for the other rate-limiting module:
     *
     *       without it every limiter built here shared one key per identifier
     *       … and the failure was silent: a member was refused a withdrawal
     *       because they had used the app
     *
     *   That repair made `name` a REQUIRED field of a limiter's config and put
     *   it in the prefix. It reached `lib/rate-limiter.ts` and not this file —
     *   the fourth time in this area that a control reached one of two doors,
     *   after #274, #527 and #642.
     *
     *   The scope changes the KEY SPACE, not the limit. No route becomes more
     *   restricted; they stop spending each other's budget.
     */
    const key = `${scope}:${identity}`;

    // See the note in consumeLoginAttempt: with no Upstash configured, the
    // limiter below cannot work and threw once per request.
    if (!isRedisConfigured) {
        return apiFallbackDecision(key);
    }

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
        return apiFallbackDecision(key);
    }
}

/** The in-memory API decision — see loginFallbackDecision for why it is shared. */
function apiFallbackDecision(
    key: string
): { success: boolean; remaining?: number; error?: string } {
    const fallback = checkFallbackLimit(key, apiLimit.maxRequests, apiLimit.interval);

    if (fallback.success) {
        return {
            success: true,
            remaining: fallback.remaining,
        };
    }

    const retryAfterSeconds = Math.ceil((fallback.reset - Date.now()) / 1000);
    return {
        success: false,
        error: `Too many requests (Redis connection failed). Please try again in ${retryAfterSeconds} seconds.`,
    };
}

/**
 * Wrap API handler with rate limiting
 */
export function withRateLimit(
    handler: (req: NextRequest) => Promise<NextResponse>,
    /**
     *   #643 What this limit is FOR, and therefore its own key space.
     *
     *   Required, not optional, for the reason rate-limits.config.ts gives for
     *   the same field on the other limiter: an optional name is a name nobody
     *   passes, and the failure is silent — the routes keep working and quietly
     *   spend one another's budget until a member is refused something they
     *   have not done.
     */
    scope: string,
    getIdentifier?: (req: NextRequest) => string
) {
    return async (req: NextRequest): Promise<NextResponse> => {
        const identifier = getIdentifier ? getIdentifier(req) : undefined;
        const limitResult = await rateLimit(req, scope, identifier);

        if (!limitResult.success) {
            return NextResponse.json(
                { error: limitResult.error },
                {
                    status: 429,
                    headers: {
                        'Retry-After': '60',
                        'X-RateLimit-Limit': apiLimit.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                    }
                }
            );
        }

        const response = await handler(req);

        // Add rate limit headers
        response.headers.set('X-RateLimit-Limit', apiLimit.maxRequests.toString());
        response.headers.set('X-RateLimit-Remaining', (limitResult.remaining || 0).toString());

        return response;
    };
}

/**
 * One definition of the login window.
 *
 * It was written three times — "15 m" in the limiter below, `15 * 60 * 1000` in
 * the in-memory fallback, and implicitly in resetLoginAttempts' key wildcard.
 * The reset now computes the exact bucket keys from this number, so a change
 * here that did not reach the others would stop the reset matching anything.
 * `${n} ms` is a format the library's own parser accepts.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_PREFIX = "@upstash/login_limit";

/**
 * Rate limiter for login attempts per user (Redis-backed)
 */
const loginLimiter = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(
        parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
        `${LOGIN_WINDOW_MS} ms`
    ),
    prefix: LOGIN_LIMIT_PREFIX,
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
 * NODE_ENV is the discriminator now, and the reason it can be trusted is that
 * Next sets it at build and start, so it cannot be turned off by adding a
 * variable. Local development and jest keep the bypass; a production build
 * cannot have it at any price.
 *
 * #441 CORRECTS THE SUPPORTING SENTENCE, NOT THE CONCLUSION. This used to read
 * "security-checks.ts ENFORCES strong secrets on NODE_ENV === 'production'".
 * That module checks them and writes a console.error; it does not refuse, block
 * or throw — it must not, because it runs at module scope in the root layout.
 * The argument above stands on what Next guarantees about NODE_ENV, which is
 * true; the citation overstated a neighbouring module and is removed.
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

    // Same identifier resetLoginAttempts clears — see loginLimitIdentifier.
    const key = loginLimitIdentifier(email);

    // No Upstash configured — go straight to the in-memory limiter.
    //
    // Without this the code below builds a Redis sliding window against the
    // four-method stub in lib/redis.ts, which has no `evalsha`, so it threw
    // TypeError on every single login and landed in the catch anyway. Same
    // decision, minus an exception and a log line per request, and a genuine
    // Redis failure is now the only thing that reaches that console.error.
    if (!isRedisConfigured) {
        return loginFallbackDecision(key);
    }

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
        return loginFallbackDecision(key);
    }
}

/**
 * The in-memory login decision, used both when Upstash is absent and when it
 * errors.
 *
 * One copy on purpose: this used to exist only inside the catch block, and the
 * short-circuit above would otherwise have been a second, drifting copy of the
 * limit, the window and the message.
 */
function loginFallbackDecision(
    key: string
): { allowed: boolean; remainingAttempts?: number; error?: string } {
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
    const fallback = checkFallbackLimit(key, maxAttempts, LOGIN_WINDOW_MS);

    if (fallback.success) {
        return {
            allowed: true,
            remainingAttempts: fallback.remaining,
        };
    }

    const minutesRemaining = Math.ceil((fallback.reset - Date.now()) / 1000 / 60);
    return {
        allowed: false,
        error: `Too many failed login attempts. If you cannot remember your credentials, please contact support at support@easysalesexport.com, or try again in ${minutesRemaining} minutes.`,
    };
}

/**
 * Reset login attempts (call on successful login).
 *
 * IT RAN A FULL KEYSPACE SCAN ON EVERY SUCCESSFUL LOGIN
 * -----------------------------------------------------
 * The previous version was:
 *
 *     const pattern = `@upstash/login_limit:login_${email.toLowerCase()}*`;
 *     const matchingKeys = await redis.keys(pattern);
 *
 * The observation that led to it is correct and is kept below: the sliding
 * window appends a bucket suffix, so deleting the bare key matches nothing.
 * The remedy was the problem. `KEYS` walks the ENTIRE keyspace and then
 * filters — the pattern narrows the result, not the work — and this keyspace
 * holds a rate-limit bucket per active identifier plus a cached profile per
 * signed-in user (CacheKeys.userProfile, 5-minute TTL). At 41,105 accounts that
 * is a scan of everything, on the login path, on every success.
 *
 * It also fails in a way that hides itself. The Upstash client is built with
 * `AbortSignal.timeout(2000)`; once the scan exceeds two seconds it throws, the
 * caller in lib/auth.ts logs "[Auth:Fallback] Redis resetLoginAttempts failed"
 * and lets the login through — so the reset silently stops happening exactly
 * when the keyspace is largest, and a user who failed four times before
 * succeeding keeps those four against them for the rest of the window.
 *
 * The keys are computable, so no scan is needed. @upstash/ratelimit builds them
 * as [prefix, identifier].join(":") and the sliding window appends
 * `:${Math.floor(now / windowMs)}`; it consults the current bucket and the one
 * before it, and nothing else. Two deletes, no scan, and both are exact.
 */
/**
 * The identifier both limiter paths count against.
 *
 * One definition on purpose. This string was written out separately in
 * consumeLoginAttempt (as the in-memory fallback's key) and in
 * loginRateLimitKeys (as the Redis identifier). Two copies of the key a reset
 * has to match is how a reset ends up clearing the wrong thing, which is the
 * bug being fixed here.
 */
export function loginLimitIdentifier(email: string): string {
    return `login_${email.toLowerCase()}`;
}

export function loginRateLimitKeys(email: string, now: number = Date.now()): string[] {
    const identifier = loginLimitIdentifier(email);
    const currentWindow = Math.floor(now / LOGIN_WINDOW_MS);

    // The only two buckets a sliding window reads.
    return [
        `${LOGIN_LIMIT_PREFIX}:${identifier}:${currentWindow}`,
        `${LOGIN_LIMIT_PREFIX}:${identifier}:${currentWindow - 1}`,
    ];
}

export async function resetLoginAttempts(email: string): Promise<void> {
    // The in-memory store first, and OUTSIDE the try below.
    //
    // consumeLoginAttempt counts into this store on every path where Redis is
    // not answering, and until now nothing ever cleared it: the reset deleted
    // Redis keys only. Because the attempt is consumed before the password is
    // verified, that turned "five failed attempts" into "five logins" whenever
    // Upstash was unconfigured, down, or merely slower than the client's
    // 2-second timeout — and refused the fifth with a message blaming failures
    // that had not happened.
    //
    // It runs first and unguarded so that a Redis error below cannot skip it;
    // Map.delete cannot throw.
    resetFallbackLimit(loginLimitIdentifier(email));

    try {
        await redis.del(...loginRateLimitKeys(email));
    } catch (error) {
        console.error("Failed to reset login attempts:", error);
        // Non-blocking: do not throw — a reset failure must never block login
    }
}
