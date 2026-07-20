import { revalidatePath } from 'next/cache';
import { logger } from './logger';

export interface CacheSideEffects {
    revalidatePaths: string[];
    redisKeys?: string[];
    redisPatterns?: string[];
}

/**
 * Centralized mapping of database collections to their cache invalidation side-effects.
 * When a write occurs in supabase-db, these invalidations trigger automatically.
 */
export const WRITE_SIDE_EFFECTS: Record<string, CacheSideEffects> = {
    users: {
        revalidatePaths: ['/admin/users', '/admin/dashboard', '/dashboard'],
        redisPatterns: ['user:profile:*', 'user:permissions:*', 'user:session:*'],
    },
    cooperative_members: {
        revalidatePaths: ['/admin/cooperative/members', '/admin/cooperatives', '/dashboard'],
        redisPatterns: ['cooperative:member:*', 'admin:coop-stats:*', 'admin:coop-reports:*'],
    },
    cooperative_loans: {
        revalidatePaths: ['/admin/cooperative/loans', '/admin/finance'],
        redisPatterns: ['admin:coop-stats:*', 'admin:finance-overview:*'],
    },
    transactions: {
        revalidatePaths: ['/admin/finance', '/wallet', '/dashboard'],
        redisPatterns: ['admin:finance-overview:*', 'admin:dashboard-stats:*'],
    },
    processed_payments: {
        revalidatePaths: ['/admin/finance', '/admin/dashboard', '/dashboard'],
        redisPatterns: ['admin:finance-overview:*', 'admin:dashboard-stats:*', 'admin:coop-reports:*'],
    },
    marketplace_orders: {
        revalidatePaths: ['/admin/marketplace', '/marketplace/seller/dashboard', '/dashboard'],
        redisPatterns: ['admin:dashboard-stats:*'],
    },
    wallets: {
        revalidatePaths: ['/wallet', '/admin/finance', '/dashboard'],
        redisPatterns: ['user:stats:*'],
    },
    academy_applications: {
        revalidatePaths: ['/admin/academy/applications', '/admin/academy'],
        redisPatterns: ['module-registration-stats:*'],
    },
    wave_applications: {
        revalidatePaths: ['/admin/wave/applications', '/admin/wave', '/wave/dashboard'],
        redisPatterns: ['module-registration-stats:*'],
    },
    export_onboarding_applications: {
        revalidatePaths: ['/admin/export/applications', '/admin/export'],
        redisPatterns: ['module-registration-stats:*'],
    },
    farm_nation_applications: {
        revalidatePaths: ['/admin/farm-nation/applications', '/admin/farm-nation'],
        redisPatterns: ['module-registration-stats:*'],
    },
    land_listings: {
        revalidatePaths: ['/admin/land/listings', '/land', '/dashboard'],
    },
    products: {
        revalidatePaths: ['/admin/marketplace/products', '/marketplace'],
    },
};

/**
 * Triggers all cache invalidation side-effects for a given collection write.
 * Wrapped in try/catch to ensure database writes never fail due to cache errors.
 */
export async function invalidateCacheForCollection(collection: string, docId?: string): Promise<void> {
    const effects = WRITE_SIDE_EFFECTS[collection];
    if (!effects) return;

    // 1. Next.js Route Revalidation
    for (const path of effects.revalidatePaths) {
        try {
            revalidatePath(path);
        } catch {
            // Safe to ignore outside Next.js request context (e.g., standalone scripts/background jobs)
        }
    }

    // 2. Redis Key / Pattern Deletion
    if (effects.redisKeys?.length || effects.redisPatterns?.length) {
        try {
            const { deleteCache, deleteCachePattern } = await import('./redis');
            const tasks: Promise<unknown>[] = [];

            if (effects.redisKeys?.length) {
                for (const key of effects.redisKeys) {
                    const targetKey = docId ? key.replace('{id}', docId) : key;
                    tasks.push(deleteCache(targetKey));
                }
            }

            if (effects.redisPatterns?.length) {
                for (const pattern of effects.redisPatterns) {
                    tasks.push(deleteCachePattern(pattern));
                }
            }

            if (tasks.length > 0) {
                await Promise.all(tasks);
            }
        } catch (err: any) {
            logger.warn(`[Cache Map] Invalidation warning for ${collection}:`, err?.message || err);
        }
    }
}
