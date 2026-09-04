import { deleteCache, CacheKeys } from './redis';
import { revalidateTag, revalidatePath } from 'next/cache';

export { deleteCache };

function safeRevalidatePath(path: string, type?: "layout" | "page") {
    try {
        revalidatePath(path, type);
    } catch (e) {
        // Safe to ignore outside Next.js request context (e.g. standalone scripts)
    }
}

/**
 *   #256 THIS TOOK A `type` AND THREW IT AWAY, BEHIND A CAST.
 *
 *        It was:
 *
 *            function safeRevalidateTag(tag: string, type?: string) {
 *                try { (revalidateTag as any)(tag); } catch {}
 *            }
 *
 *        The parameter was accepted and never passed, and the `as any` existed
 *        to silence the type error that omitting the second argument causes.
 *        Four callers pass "page" believing it does something. That is #252
 *        again — the same wrong second argument — with the compiler's objection
 *        cast away instead of heard, and the cast is also why the #252 ratchet
 *        could not see this one: the source reads `revalidateTag as any)(tag)`
 *        rather than `revalidateTag(`.
 *
 *        The bare single-argument call it was actually making still works, but
 *        Next deprecates it ("may be removed in a future version") and warns on
 *        every call.
 *
 * `{ expire: 0 }` rather than updateTag: this module is imported by BOTH Server
 * Actions and route handlers, and updateTag throws in a route handler. An
 * inline object profile is legal in both and is validated by shape rather than
 * looked up by name, so it cannot hit the invalid-name throw. Immediate expiry
 * matches what the bare form did, and matches what these callers want — every
 * one of them is invalidating after a decision an admin just made.
 *
 * The `type` parameter is gone rather than plumbed through: no caller had a
 * meaningful value for it, and keeping a parameter that is always the same
 * wrong string is how this survived.
 */
function safeRevalidateTag(tag: string) {
    try {
        revalidateTag(tag, { expire: 0 });
    } catch {
        // Safe to ignore outside Next.js request context (e.g. standalone scripts)
    }
}

/**
 * Cache Invalidation Functions
 * Call these when user data changes to ensure cache stays fresh
 */

/**
 * Invalidate ALL user-related cache
 * Use after major user updates (approval, role changes, etc.)
 */
export async function invalidateUserCache(userId: string): Promise<void> {
    try {
        await Promise.all([
            deleteCache(CacheKeys.userProfile(userId)),
            deleteCache(CacheKeys.userPermissions(userId)),
            deleteCache(CacheKeys.userSession(userId)),
            deleteCache(CacheKeys.userStats(userId)),
            // Service-specific caches
            deleteCache(`seller:status:${userId}`),
            deleteCache(`cooperative:member:${userId}`),
        ]);
        
        // Trigger Next.js revalidation
        safeRevalidatePath("/", "layout"); 
        
        console.log(`[Cache Invalidation] Cleared all cache for user: ${userId}`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error clearing cache for ${userId}:`, error);
    }
}

/**
 * Invalidate seller status cache
 * Call after admin approves/rejects seller
 */
export async function invalidateSellerCache(userId: string): Promise<void> {
    try {
        await Promise.all([
            deleteCache(`seller:status:${userId}`),
            deleteCache(CacheKeys.userProfile(userId)), // Also clear profile
        ]);

        safeRevalidatePath("/admin/marketplace", "page");
        safeRevalidatePath("/admin/marketplace/sellers", "page");
        safeRevalidatePath("/admin/marketplace/buyers", "page");
        safeRevalidatePath("/dashboard", "page");
        safeRevalidateTag("module-registration-stats-service");

        console.log(`[Cache Invalidation] Cleared seller cache for: ${userId}`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error clearing seller cache:`, error);
    }
}

/**
 * Invalidate cooperative member cache
 * Call after membership status changes
 */
export async function invalidateCooperativeCache(userId: string, cooperativeId?: string): Promise<void> {
    try {
        const keysToDelete: string[] = [
            `cooperative:member:${userId}`,
            CacheKeys.userProfile(userId),
            "admin:coop-stats:global",
            "admin:coop-reports:global",
        ];
        if (cooperativeId) {
            keysToDelete.push(`admin:coop-stats:${cooperativeId}`);
            keysToDelete.push(`admin:coop-reports:${cooperativeId}`);
        }
        await Promise.all(keysToDelete.map(k => deleteCache(k)));

        safeRevalidatePath("/admin/cooperatives", "page");
        safeRevalidatePath("/admin/cooperatives/members", "page");
        safeRevalidatePath("/dashboard", "page");
        safeRevalidateTag("module-registration-stats-service");

        console.log(`[Cache Invalidation] Cleared cooperative cache for: ${userId}${cooperativeId ? ` (coop: ${cooperativeId})` : ""}`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error clearing cooperative cache:`, error);
    }
}


/**
 * Invalidate service access cache
 * Call after service registration status changes (Wave, Academy, Export, Farm Nation)
 */
export async function invalidateServiceCache(userId: string, service?: string): Promise<void> {
    try {
        // Always clear user profile (contains serviceRegistrations)
        await deleteCache(CacheKeys.userProfile(userId));

        safeRevalidatePath("/dashboard", "page");
        if (service) {
            safeRevalidatePath(`/admin/${service}`, "page");
            safeRevalidatePath(`/admin/${service}/applications`, "page");
            safeRevalidatePath(`/admin/${service}/members`, "page");
            if (service === "wave") {
                safeRevalidatePath("/wave/dashboard", "page");
            }
            safeRevalidateTag("module-registration-stats-service");
        }

        console.log(`[Cache Invalidation] Cleared ${service || 'service'} cache for: ${userId}`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error clearing service cache:`, error);
    }
}

/**
 * Invalidate Global Admin Dashboard Stats
 * Call after any action that affects platform-wide metrics (approvals, new registrations)
 */
export async function invalidateAdminGlobalStats(): Promise<void> {
    try {
        await Promise.all([
            deleteCache("admin:dashboard-stats:global"),
            deleteCache("admin:finance-overview:global"),
            deleteCache("admin:coop-stats:global"),
            deleteCache("admin:coop-reports:global"),
        ]);
        // Also trigger Next.js tag and path revalidation
        safeRevalidateTag("module-registration-stats-service");
        safeRevalidatePath("/admin", "layout");
        safeRevalidatePath("/admin/dashboard", "page");
        console.log(`[Cache Invalidation] Cleared global admin stats and tags`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error clearing global admin stats:`, error);
    }
}

/**
 * Batch invalidate multiple users
 * Use after bulk admin actions
 */
export async function invalidateMultipleUsers(userIds: string[]): Promise<void> {
    try {
        await Promise.all(
            userIds.map(userId => invalidateUserCache(userId))
        );
        console.log(`[Cache Invalidation] Cleared cache for ${userIds.length} users`);
    } catch (error) {
        console.error(`[Cache Invalidation] Error in batch invalidation:`, error);
    }
}

/**
 * Drop the cached platform fees, exchange rate and WAVE commission.
 *
 *   #381 WITHOUT THIS, A SAVE REPORTS SUCCESS AND CHANGES NOTHING FOR AN HOUR.
 *
 *        The three getters in lib/system-settings are `unstable_cache` with
 *        `revalidate: 3600`. An admin who corrects the USD→NGN rate because the
 *        naira moved would see "Settings saved", and export buyers would keep
 *        being charged at the old rate for up to an hour with nothing on the
 *        screen saying so. That is the report-success-on-no-effect shape this
 *        audit keeps finding (#188, #246, #296, #337).
 *
 *        The tag names come from SYSTEM_SETTINGS_TAGS rather than being typed
 *        again here, so a getter registered under a new tag cannot be missed by
 *        a hand-written list — the defect #189 found in the audit sweep.
 */
export async function invalidateSystemSettingsCache(): Promise<void> {
    const { SYSTEM_SETTINGS_TAGS } = await import("./system-settings");
    for (const tag of Object.values(SYSTEM_SETTINGS_TAGS)) {
        safeRevalidateTag(tag);
    }
}

/**
 * USAGE EXAMPLES:
 *
 * // After admin approves seller:
 * await invalidateSellerCache(userId);
 * 
 * // After admin approves Wave applicant:
 * await invalidateServiceCache(userId, 'wave');
 * 
 * // After user updates their profile:
 * await invalidateUserCache(userId);
 * 
 * // After bulk approval of 10 users:
 * await invalidateMultipleUsers([userId1, userId2, ...]);
 */
