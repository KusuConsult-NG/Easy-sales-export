import { getCached, setCache, deleteCache, CacheKeys, CACHE_TTL } from './redis';
import { runQueryWithRetry } from './firestore-utils';
import { getAdminDb } from './firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";

export interface CachedUserProfile {
    id: string;
    email: string;
    displayName: string;
    photoURL?: string;
    roles: string[];
    serviceRegistrations?: any;
    createdAt: string;
    updatedAt: string;
    profileComplete?: boolean;
    onboardingCompleted?: boolean;
    requiresPasswordChange?: boolean;
    isBanned?: boolean;
    suspended?: boolean;
    status?: string;
    sellerVerificationStatus?: string;
    verified?: boolean;
    isVerified?: boolean;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    otherName?: string;
    phone?: string;
    location?: string;
    bio?: string;
    identityDocument?: any;
    gender?: string;
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
            return cached;
        }

        // Cache miss — fetch from Supabase
        const { supabaseAdmin } = await import("./supabase");
        const { data: dbRow, error } = await supabaseAdmin
            .from("users")
            .select("*")
            .eq("id", userId)
            .single();

        let userData: any = null;

        if (error || !dbRow) {
            // Fallback: Try Firestore as a safe guard if not found in Supabase
            try {
                const db = getAdminDb();
                const userDoc = await runQueryWithRetry<any>(() => db.collection(COLLECTIONS.USERS).doc(userId).get());
                if (!userDoc.exists) {
                    return null;
                }
                userData = userDoc.data()!;
            } catch (fsErr) {
                console.error('[getUserProfile] Firestore fallback failed:', fsErr);
                return null;
            }
        } else {
            userData = dbRow.raw_data || {};
        }

        // Self-healing migration resolver:
        // If the database profile points to a migrated target, fetch and cache the migrated target instead!
        if (userData && userData._migratedTo && userData._migratedTo !== userId) {
            const migratedId = userData._migratedTo;
            console.log(`[getUserProfile] Intercepted legacy user ${userId} migrated to ${migratedId}. Fetching migrated profile.`);
            return getUserProfile(migratedId);
        }

        // NOTE: registerAction writes 'fullName' to Firestore, not 'displayName'.
        // We read both to handle legacy documents that may have used 'displayName'.
        const resolvedName = userData.fullName || userData.displayName || '';
        const profile: CachedUserProfile = {
            id: userId,
            email: dbRow?.email || userData.email,
            displayName: resolvedName,
            photoURL: userData.photoURL,
            roles: dbRow?.roles || userData.roles || [],
            serviceRegistrations: userData.serviceRegistrations,
            createdAt: dbRow?.created_at || userData.createdAt,
            updatedAt: dbRow?.updated_at || userData.updatedAt,
            profileComplete: userData.profileComplete,
            onboardingCompleted: userData.onboardingCompleted,
            requiresPasswordChange: userData.requiresPasswordChange,
            isBanned: userData.isBanned,
            suspended: userData.suspended,
            status: userData.status,
            sellerVerificationStatus: userData.sellerVerificationStatus,
            verified: userData.verified,
            isVerified: userData.isVerified,
            fullName: userData.fullName || resolvedName,
            firstName: userData.firstName,
            lastName: userData.lastName,
            otherName: userData.otherName,
            phone: userData.phone,
            location: userData.location,
            bio: userData.bio,
            identityDocument: userData.identityDocument,
            gender: userData.gender,
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
