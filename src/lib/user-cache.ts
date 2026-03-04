import { getCached, setCache, deleteCache, CacheKeys, CACHE_TTL } from './redis';
import { getAdminDb } from './firebase-admin';

export interface CachedUserProfile {
    id: string;
    email: string;
    displayName: string;
    photoURL?: string;
    roles: string[];
    serviceRegistrations?: any;
    createdAt: string;
    updatedAt: string;
}

/**
 * Get user profile from cache or Firestore
 */
export async function getUserProfile(userId: string): Promise<CachedUserProfile | null> {
    try {
        // Try cache first
        const cacheKey = CacheKeys.userProfile(userId);
        const cached = await getCached<CachedUserProfile>(cacheKey);

        if (cached) {
            console.log('[Cache HIT] User profile:', userId);
            return cached;
        }

        // Cache miss - fetch from Firestore
        console.log('[Cache MISS] Fetching user profile from Firestore:', userId);
        const db = getAdminDb();
        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            return null;
        }

        const userData = userDoc.data()!;
        // NOTE: registerAction writes 'fullName' to Firestore, not 'displayName'.
        // We read both to handle legacy documents that may have used 'displayName'.
        const resolvedName = userData.fullName || userData.displayName || '';
        console.log(`[getUserProfile] UID ${userId}: fullName='${userData.fullName}' displayName='${userData.displayName}' → resolved='${resolvedName}'`);
        const profile: CachedUserProfile = {
            id: userId,
            email: userData.email,
            displayName: resolvedName,
            photoURL: userData.photoURL,
            roles: userData.roles || [],
            serviceRegistrations: userData.serviceRegistrations,
            createdAt: userData.createdAt,
            updatedAt: userData.updatedAt,
        };

        // Cache for next time
        await setCache(cacheKey, profile, CACHE_TTL.USER_PROFILE);

        return profile;
    } catch (error) {
        console.error('[getUserProfile] Error:', error);
        return null;
    }
}

/**
 * Invalidate user cache (call this when user data changes)
 */
export async function invalidateUserCache(userId: string): Promise<void> {
    try {
        await Promise.all([
            deleteCache(CacheKeys.userProfile(userId)),
            deleteCache(CacheKeys.userPermissions(userId)),
            deleteCache(CacheKeys.userSession(userId)),
            deleteCache(CacheKeys.userStats(userId)),
        ]);
        console.log('[Cache] Invalidated cache for user:', userId);
    } catch (error) {
        console.error('[invalidateUserCache] Error:', error);
    }
}

/**
 * Check if user has specific role (with caching)
 */
export async function userHasRole(userId: string, role: string): Promise<boolean> {
    const profile = await getUserProfile(userId);
    return profile?.roles?.includes(role) ?? false;
}

/**
 * Check if user service is approved (with caching)
 */
export async function isServiceApproved(
    userId: string,
    service: 'wave' | 'export' | 'marketplace' | 'academy' | 'cooperatives' | 'farmNation'
): Promise<boolean> {
    const profile = await getUserProfile(userId);
    return profile?.serviceRegistrations?.[service]?.status === 'approved';
}
