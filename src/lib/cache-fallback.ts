/**
 * In-Memory Fallback Cache Store
 *
 *   #459 EVERY CACHE ON THIS PLATFORM WAS A NO-OP IN PRODUCTION, AND THE RATE
 *   LIMITERS BESIDE THEM WERE NOT.
 *
 *   lib/redis.ts replaces the Upstash client with a stub when
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are absent:
 *
 *       get:   async () => null,
 *       setex: async () => false,
 *
 *   so `getCached` always missed and `setCache` always discarded. This platform
 *   is deployed with those variables unset — its own startup log says so — and
 *   roughly fifty call sites across sixteen files were caching into nothing:
 *
 *       lib/session-guard.ts, lib/user-cache.ts    the user profile, re-read
 *                                                  by EVERY server action
 *       lib/hub-guard.ts                           every gated page
 *       cooperatives/(member)/layout.tsx           every page in the module
 *       marketplace/seller/layout.tsx              every page in the module
 *       admin-analytics, and eleven more           the dashboard tiles
 *
 *   THE ASYMMETRY IS THE FINDING. The same file's own warning says the rate
 *   limiters fall back to "per-instance in-memory" when Redis is missing, and
 *   they do — rate-limiter-fallback.ts exists for exactly that. Losing a rate
 *   limit fails open, so somebody built the fallback. Losing a CACHE only makes
 *   things slow, so nobody did, and the platform has been paying full price for
 *   every read since.
 *
 *   Per-instance, like the rate limiter's, with the same honesty about it: this
 *   is NOT shared between containers, so a write on one instance is not visible
 *   to another. That is fine for what these caches hold — platform aggregates
 *   and a user's own profile, both re-derivable and both already given short
 *   TTLs by their callers. Configuring Upstash still gets shared caching; this
 *   only stops "no Redis" from meaning "no cache at all".
 *
 *   VALUES ARE STORED AS JSON, DELIBERATELY. @upstash/redis serialises on write
 *   and parses on read, so a Date written through the real client comes back an
 *   ISO string. A perfect in-memory clone would return the Date — and a caller
 *   that worked in development would break the day Upstash was configured. The
 *   round trip is matched rather than improved on, so both paths are lossy in
 *   exactly the same way.
 */

interface Entry {
    /** JSON, matching what the real client would have stored. */
    json: string;
    expiresAt: number;
}

const store = new Map<string, Entry>();

/**
 * The cap, and why it is a count rather than a byte size.
 *
 * These caches hold dashboard payloads and user profiles — bounded by the
 * number of admin views and signed-in users an instance sees inside a TTL, not
 * by anything an anonymous caller can drive. A count is what can be enforced
 * without measuring every value, and 500 is comfortably above the working set
 * while staying far below anything that would trouble a container.
 */
export const MAX_ENTRIES = 500;

/** Drop everything already past its TTL. Cheap, and only called when full. */
function sweep(now: number): void {
    for (const [key, entry] of store.entries()) {
        if (now >= entry.expiresAt) store.delete(key);
    }
}

export function getFallbackCache<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
        store.delete(key);
        return null;
    }

    try {
        return JSON.parse(entry.json) as T;
    } catch {
        // Unreachable via setFallbackCache, which only stores what it could
        // serialise. Dropping the entry is still the right answer to a value
        // that cannot be read back.
        store.delete(key);
        return null;
    }
}

export function setFallbackCache(key: string, value: unknown, ttlSeconds: number): boolean {
    // A non-positive TTL is already expired. Storing it would mean a hit that
    // can never happen and an entry that only occupies the cap.
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return false;

    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        // Circular, or a BigInt. The real client would reject it too.
        return false;
    }
    // `undefined` stringifies to undefined, not to a string.
    if (json === undefined) return false;

    const now = Date.now();

    if (store.size >= MAX_ENTRIES && !store.has(key)) {
        sweep(now);
        // Still full: drop the oldest INSERTED key. A Map iterates in insertion
        // order, so this is the entry that has had the longest run.
        while (store.size >= MAX_ENTRIES) {
            const oldest = store.keys().next();
            if (oldest.done) break;
            store.delete(oldest.value);
        }
    }

    // Delete first so a re-set moves the key to the back of the eviction order
    // rather than keeping its original position.
    store.delete(key);
    store.set(key, { json, expiresAt: now + ttlSeconds * 1000 });
    return true;
}

export function deleteFallbackCache(key: string): boolean {
    return store.delete(key);
}

/**
 * Forget everything.
 *
 * Called between tests so one test's cached value cannot decide another's
 * result — a cache that outlives its test is a test that passes for the wrong
 * reason. Not used in production.
 */
export function clearFallbackCache(): void {
    store.clear();
}

/** Entry count, for tests and for the eviction assertions. */
export function fallbackCacheSize(): number {
    return store.size;
}
