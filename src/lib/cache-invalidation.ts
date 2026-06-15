import { deleteCache, CacheKeys } from './redis';
import { revalidateTag, revalidatePath } from 'next/cache';

export { deleteCache };

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
        revalidatePath("/", "layout"); 
        
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

        revalidatePath("/admin/marketplace", "page");
        revalidatePath("/", "layout");

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

        revalidatePath("/admin/cooperatives", "page");
        revalidatePath("/", "layout");

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

        revalidatePath("/", "layout");
        if (service) {
            revalidatePath(`/admin/${service}`, "page");
            revalidateTag(`module-${service}-stats`, "page");
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
        revalidateTag("module-registration-stats", "page");
        revalidatePath("/admin", "layout");
        revalidatePath("/admin/dashboard", "page");
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
