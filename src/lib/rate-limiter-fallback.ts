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

/**
 * Clear a key's counter — the reset half of the login limiter, which this file
 * did not have.
 *
 * WHY THIS EXISTS
 * ---------------
 * The login limiter counts an attempt BEFORE the password is checked
 * (src/lib/auth.ts STEP 3 precedes STEP 4), so a SUCCESSFUL login consumes a
 * token exactly like a failed one. What makes the limit mean "five failures"
 * rather than "five logins" is resetLoginAttempts() clearing the counter on
 * success.
 *
 * That reset only ever cleared REDIS keys. This store had no reset at all. So
 * on every path that lands here — Upstash not configured, an outage, or just
 * the client's own AbortSignal.timeout(2000) firing on a slow response — the
 * count went up on success and never came down, and the fifth login inside
 * fifteen minutes was refused with "Too many failed login attempts" when none
 * of them had failed.
 *
 * It is worth being precise about how that presents in production, because it
 * is nearly impossible to reproduce on purpose: it needs Redis to be
 * unavailable, it counts per process instance so it hits some users and not
 * others, it looks identical to broken authentication, and it clears itself
 * after fifteen minutes.
 *
 * Found because a production-build e2e run locked its own test accounts out
 * after five sign-ins. That is the same defect, not a test artefact.
 */
export function resetFallbackLimit(key: string): void {
    fallbackStore.delete(key);
}

/**
 * The count currently held for a key, or 0. Exists so a test can observe that a
 * reset actually happened rather than inferring it from a later allow.
 */
export function peekFallbackCount(key: string): number {
    const record = fallbackStore.get(key);
    if (!record || Date.now() > record.resetTime) return 0;
    return record.count;
}
